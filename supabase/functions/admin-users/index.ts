// PGENRO IMS - Supabase Edge Function: admin-users
// Deploy with:
//   supabase functions deploy admin-users --project-ref zssrxubajhqryrwijyzm
//
// IMPORTANT:
// SUPABASE_URL and a server-only Supabase secret are provided to hosted Edge
// Functions. This function supports the current SUPABASE_SECRET_KEYS JSON
// variable and the legacy SUPABASE_SERVICE_ROLE_KEY fallback. Never copy any
// secret/service-role key into browser JavaScript.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const ADMIN_ROLES = new Set([
  "admin",
  "administrator",
  "super admin",
  "superadmin",
  "system administrator"
]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const cleanRole = (value: unknown) =>
  String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const isActiveStatus = (value: unknown) =>
  ["active", "approved"].includes(String(value ?? "").trim().toLowerCase());


function getProjectSecretKey() {
  // Current Supabase projects expose secret keys as a JSON dictionary.
  const current = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (current) {
    try {
      const parsed = JSON.parse(current) as Record<string, string>;
      if (parsed?.default) return parsed.default;
      const first = Object.values(parsed ?? {}).find(Boolean);
      if (first) return first;
    } catch (error) {
      console.warn("Unable to parse SUPABASE_SECRET_KEYS; checking legacy key.", error);
    }
  }

  // Kept for projects that still expose the legacy default secret.
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

const authBanForStatus = (status: unknown) =>
  isActiveStatus(status) ? "none" : "876000h"; // 100 years for disabled accounts

const legacyUserPayload = (profile: Record<string, unknown>) => ({
  fullName: profile.full_name ?? "",
  username: profile.username ?? "",
  email: profile.email ?? "",
  contact: profile.contact ?? "",
  position: profile.position ?? "",
  division: profile.division ?? "",
  role: profile.role ?? "System Staff",
  accountType: profile.account_type ?? "Standard User",
  status: isActiveStatus(profile.status) && profile.is_active ? "Active" : (profile.status ?? "Inactive"),
  lastLogin: profile.last_login ?? "Never",
  updatedAt: new Date().toISOString()
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = getProjectSecretKey();

    if (!supabaseUrl || !serviceKey) {
      return json({ error: "Edge Function Supabase secrets are not configured." }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Missing authenticated session." }, 401);

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: authData, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !authData.user) {
      return json({ error: "Invalid or expired administrator session." }, 401);
    }

    const callerId = authData.user.id;
    const { data: callerProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("user_id,full_name,email,role,status,is_active")
      .eq("user_id", callerId)
      .maybeSingle();

    if (
      profileError ||
      !callerProfile ||
      !callerProfile.is_active ||
      !isActiveStatus(callerProfile.status) ||
      !ADMIN_ROLES.has(cleanRole(callerProfile.role))
    ) {
      return json({ error: "Administrator permission is required." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "").trim();

    const writeAudit = async (actionName: string, target: string, details: Record<string, unknown> = {}) => {
      await adminClient.from("admin_logs").insert({
        id: crypto.randomUUID(),
        data: {
          action: actionName,
          performedBy: callerProfile.email ?? authData.user.email ?? callerId,
          performedById: callerId,
          targetUser: target,
          details,
          timestamp: new Date().toISOString()
        }
      });
    };

    const syncLegacyRegistry = async (profile: Record<string, any>) => {
      const uid = String(profile.user_id);
      const userData = legacyUserPayload(profile);

      await adminClient.from("users").upsert({
        id: uid,
        data: userData,
        updated_at: new Date().toISOString()
      }, { onConflict: "id" });

      if (ADMIN_ROLES.has(cleanRole(profile.role)) && profile.is_active && isActiveStatus(profile.status)) {
        await adminClient.from("admins").upsert({
          id: uid,
          data: {
            fullName: profile.full_name ?? "",
            email: profile.email ?? "",
            role: profile.role,
            status: "Active",
            assignedBy: callerProfile.email ?? authData.user.email ?? "System Administrator",
            updatedAt: new Date().toISOString()
          },
          updated_at: new Date().toISOString()
        }, { onConflict: "id" });
      } else {
        await adminClient.from("admins").delete().eq("id", uid);
      }
    };

    const syncAccessRequestRegistry = async (profile: Record<string, any>) => {
      const uid = String(profile.user_id);
      const { data: rows, error } = await adminClient
        .from("access_requests")
        .select("id,data")
        .contains("data", { uid });
      if (error) throw error;

      const profileStatus = String(profile.status ?? "Inactive");
      const requestStatus = isActiveStatus(profileStatus) && profile.is_active
        ? "Approved"
        : profileStatus;

      for (const row of rows ?? []) {
        const current = row.data ?? {};
        const next = {
          ...current,
          uid,
          fullName: profile.full_name ?? current.fullName ?? "",
          username: profile.username ?? current.username ?? "",
          email: profile.email ?? current.email ?? "",
          contact: profile.contact ?? current.contact ?? "",
          position: profile.position ?? current.position ?? "",
          division: profile.division ?? current.division ?? "",
          role: profile.role ?? current.role ?? "System Staff",
          accountType: profile.account_type ?? current.accountType ?? "Standard User",
          status: requestStatus,
          updatedAt: new Date().toISOString()
        };
        delete next.password;
        delete next.confirmPassword;

        const { error: updateError } = await adminClient
          .from("access_requests")
          .update({ data: next, updated_at: new Date().toISOString() })
          .eq("id", row.id);
        if (updateError) throw updateError;
      }
    };

    if (action === "list") {
      const { data: profiles, error } = await adminClient
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return json({ ok: true, users: profiles ?? [] });
    }

    if (action === "create") {
      const input = body.user ?? {};
      const email = String(input.email ?? "").trim().toLowerCase();
      const password = String(input.password ?? "");
      if (!email || !password || password.length < 8) {
        return json({ error: "A valid email and password of at least 8 characters are required." }, 400);
      }

      const requestedRole = String(input.role ?? "System Staff").trim() || "System Staff";
      const status = String(input.status ?? "Active").trim() || "Active";
      const active = isActiveStatus(status);

      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: String(input.fullName ?? "").trim(),
          username: String(input.username ?? "").trim(),
          created_by_admin: true
        }
      });
      if (createError) throw createError;
      if (!created.user) throw new Error("Supabase Auth did not return the created user.");

      const uid = created.user.id;
      const profile = {
        user_id: uid,
        full_name: String(input.fullName ?? "").trim() || email.split("@")[0],
        email,
        username: String(input.username ?? "").trim() || email.split("@")[0],
        contact: String(input.contact ?? "").trim(),
        position: String(input.position ?? "").trim(),
        division: String(input.division ?? "").trim(),
        role: requestedRole,
        account_type: ADMIN_ROLES.has(cleanRole(requestedRole)) ? "Administrator" : "Standard User",
        status,
        is_active: active,
        updated_at: new Date().toISOString()
      };

      const { data: saved, error: saveError } = await adminClient
        .from("profiles")
        .upsert(profile, { onConflict: "user_id" })
        .select()
        .single();
      if (saveError) throw saveError;

      const { error: authStatusError } = await adminClient.auth.admin.updateUserById(uid, {
        ban_duration: authBanForStatus(saved.status)
      });
      if (authStatusError) throw authStatusError;

      await syncLegacyRegistry(saved);

      // The auth trigger creates a Pending request for every new Auth user.
      // Accounts created directly by an administrator are immediately marked
      // Approved so they do not remain in the pending review queue.
      const { data: directRequests } = await adminClient
        .from("access_requests")
        .select("id,data")
        .contains("data", { uid });

      for (const row of directRequests ?? []) {
        const next = {
          ...(row.data ?? {}),
          role: saved.role,
          accountType: saved.account_type,
          status: "Approved",
          reason: row.data?.reason || "Account created directly by administrator.",
          approvedAt: new Date().toISOString(),
          approvedBy: callerProfile.email ?? authData.user.email ?? "System Administrator"
        };
        delete next.password;
        delete next.confirmPassword;
        await adminClient
          .from("access_requests")
          .update({ data: next, updated_at: new Date().toISOString() })
          .eq("id", row.id);
      }

      await syncAccessRequestRegistry(saved);
      await writeAudit("CREATE_USER", email, { role: saved.role, status: saved.status });
      return json({ ok: true, user: saved });
    }

    if (action === "update") {
      const userId = String(body.userId ?? "").trim();
      const input = body.user ?? {};
      if (!userId) return json({ error: "userId is required." }, 400);

      const authUpdates: Record<string, unknown> = {};
      if (input.email) authUpdates.email = String(input.email).trim().toLowerCase();
      if (input.password) {
        const password = String(input.password);
        if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
        authUpdates.password = password;
      }
      authUpdates.user_metadata = {
        full_name: String(input.fullName ?? "").trim(),
        username: String(input.username ?? "").trim()
      };

      const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(userId, authUpdates);
      if (authUpdateError) throw authUpdateError;

      const current = await adminClient.from("profiles").select("*").eq("user_id", userId).single();
      if (current.error) throw current.error;

      const role = String(input.role ?? current.data.role ?? "System Staff").trim();
      const status = String(input.status ?? current.data.status ?? "Active").trim();

      if (
        userId === callerId &&
        (!ADMIN_ROLES.has(cleanRole(role)) || !isActiveStatus(status))
      ) {
        return json({ error: "You cannot remove your own active administrator access." }, 400);
      }

      const profileUpdate = {
        full_name: String(input.fullName ?? current.data.full_name ?? "").trim(),
        email: String(input.email ?? current.data.email ?? "").trim().toLowerCase(),
        username: String(input.username ?? current.data.username ?? "").trim(),
        contact: String(input.contact ?? current.data.contact ?? "").trim(),
        position: String(input.position ?? current.data.position ?? "").trim(),
        division: String(input.division ?? current.data.division ?? "").trim(),
        role,
        account_type: ADMIN_ROLES.has(cleanRole(role)) ? "Administrator" : "Standard User",
        status,
        is_active: isActiveStatus(status),
        updated_at: new Date().toISOString()
      };

      const { data: saved, error: saveError } = await adminClient
        .from("profiles")
        .update(profileUpdate)
        .eq("user_id", userId)
        .select()
        .single();
      if (saveError) throw saveError;

      const { error: authStatusError } = await adminClient.auth.admin.updateUserById(userId, {
        ban_duration: authBanForStatus(saved.status)
      });
      if (authStatusError) throw authStatusError;

      await syncLegacyRegistry(saved);
      await syncAccessRequestRegistry(saved);
      await writeAudit("UPDATE_USER", saved.email ?? userId, { role: saved.role, status: saved.status });
      return json({ ok: true, user: saved });
    }

    if (action === "set_status") {
      const userId = String(body.userId ?? "").trim();
      const status = String(body.status ?? "").trim();
      if (!userId || !status) return json({ error: "userId and status are required." }, 400);
      if (userId === callerId && !isActiveStatus(status)) {
        return json({ error: "You cannot suspend or deactivate your own administrator account." }, 400);
      }

      const { data: saved, error } = await adminClient
        .from("profiles")
        .update({
          status,
          is_active: isActiveStatus(status),
          updated_at: new Date().toISOString()
        })
        .eq("user_id", userId)
        .select()
        .single();
      if (error) throw error;

      const { error: authStatusError } = await adminClient.auth.admin.updateUserById(userId, {
        ban_duration: authBanForStatus(status)
      });
      if (authStatusError) throw authStatusError;

      await syncLegacyRegistry(saved);
      await syncAccessRequestRegistry(saved);
      await writeAudit("SET_USER_STATUS", saved.email ?? userId, { status });
      return json({ ok: true, user: saved });
    }

    if (action === "delete") {
      const userId = String(body.userId ?? "").trim();
      if (!userId) return json({ error: "userId is required." }, 400);
      if (userId === callerId) return json({ error: "You cannot delete your own administrator account." }, 400);

      const profile = await adminClient.from("profiles").select("email").eq("user_id", userId).maybeSingle();
      const target = profile.data?.email ?? userId;

      await adminClient.from("users").delete().eq("id", userId);
      await adminClient.from("admins").delete().eq("id", userId);

      const { error } = await adminClient.auth.admin.deleteUser(userId, false);
      if (error) throw error;

      await writeAudit("DELETE_USER", target, {});
      return json({ ok: true });
    }

    if (action === "approve_request") {
      const requestId = String(body.requestId ?? "").trim();
      const requestedRole = String(body.role ?? "System Staff").trim() || "System Staff";
      if (!requestId) return json({ error: "requestId is required." }, 400);

      const { data: requestRow, error: requestError } = await adminClient
        .from("access_requests")
        .select("id,data")
        .eq("id", requestId)
        .single();
      if (requestError) throw requestError;

      const requestData = requestRow.data ?? {};
      const userId = String(body.userId ?? requestData.uid ?? "").trim();
      if (!userId) return json({ error: "The request is not linked to a Supabase Auth user." }, 400);

      const { error: confirmError } = await adminClient.auth.admin.updateUserById(userId, {
        email_confirm: true,
        ban_duration: "none",
        user_metadata: {
          full_name: requestData.fullName ?? requestData.name ?? "",
          username: requestData.username ?? String(requestData.email ?? "").split("@")[0]
        }
      });
      if (confirmError) throw confirmError;

      const profilePatch = {
        full_name: requestData.fullName ?? requestData.name ?? "",
        email: String(requestData.email ?? "").toLowerCase(),
        username: requestData.username ?? String(requestData.email ?? "").split("@")[0],
        contact: requestData.contact ?? "",
        position: requestData.position ?? "",
        division: requestData.division ?? "",
        role: requestedRole,
        account_type: ADMIN_ROLES.has(cleanRole(requestedRole)) ? "Administrator" : "Standard User",
        status: "Active",
        is_active: true,
        updated_at: new Date().toISOString()
      };

      const { data: profile, error: profileSaveError } = await adminClient
        .from("profiles")
        .update(profilePatch)
        .eq("user_id", userId)
        .select()
        .single();
      if (profileSaveError) throw profileSaveError;

      const nextRequest = {
        ...requestData,
        role: requestedRole,
        accountType: profilePatch.account_type,
        status: "Approved",
        approvedAt: new Date().toISOString(),
        approvedBy: callerProfile.email ?? authData.user.email ?? "System Administrator"
      };
      delete nextRequest.password;
      delete nextRequest.confirmPassword;

      const { error: requestSaveError } = await adminClient
        .from("access_requests")
        .update({ data: nextRequest, updated_at: new Date().toISOString() })
        .eq("id", requestId);
      if (requestSaveError) throw requestSaveError;

      await syncLegacyRegistry(profile);
      await writeAudit("APPROVE_ACCOUNT_REQUEST", profile.email ?? userId, {
        requestId,
        role: requestedRole
      });
      return json({ ok: true, user: profile, request: nextRequest });
    }

    if (action === "reject_request") {
      const requestId = String(body.requestId ?? "").trim();
      if (!requestId) return json({ error: "requestId is required." }, 400);

      const { data: requestRow, error: requestError } = await adminClient
        .from("access_requests")
        .select("id,data")
        .eq("id", requestId)
        .single();
      if (requestError) throw requestError;

      const requestData = requestRow.data ?? {};
      const userId = String(body.userId ?? requestData.uid ?? "").trim();
      const reason = String(body.reason ?? "Request declined").trim();
      const remarks = String(body.remarks ?? "").trim();

      if (userId) {
        const { error: banError } = await adminClient.auth.admin.updateUserById(userId, {
          ban_duration: "876000h"
        });
        if (banError) throw banError;

        await adminClient
          .from("profiles")
          .update({
            status: "Rejected",
            is_active: false,
            updated_at: new Date().toISOString()
          })
          .eq("user_id", userId);

        await adminClient.from("users").delete().eq("id", userId);
        await adminClient.from("admins").delete().eq("id", userId);
      }

      const nextRequest = {
        ...requestData,
        status: "Rejected",
        declineReason: reason,
        declineRemarks: remarks,
        declinedAt: new Date().toISOString(),
        declinedBy: callerProfile.email ?? authData.user.email ?? "System Administrator"
      };
      delete nextRequest.password;
      delete nextRequest.confirmPassword;

      const { error: requestSaveError } = await adminClient
        .from("access_requests")
        .update({ data: nextRequest, updated_at: new Date().toISOString() })
        .eq("id", requestId);
      if (requestSaveError) throw requestSaveError;

      await writeAudit("DECLINE_ACCOUNT_REQUEST", requestData.email ?? userId ?? requestId, {
        requestId,
        reason,
        remarks
      });
      return json({ ok: true, request: nextRequest });
    }

    return json({ error: `Unsupported admin action: ${action || "(empty)"}` }, 400);
  } catch (error) {
    console.error("admin-users error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected server error." }, 500);
  }
});

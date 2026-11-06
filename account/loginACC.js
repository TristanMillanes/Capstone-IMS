// PGENRO IMS - Supabase login compatibility controller.
// The page using this file must load @supabase/supabase-js@2 and ../shared/supabase.js first.

const supabase = window.pgenroSupabase;
const PGENRO_API = window.PGENRO_API;
const loginForm = document.getElementById("loginForm");

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const employeeNumber = (document.getElementById("employeeNumber") || document.getElementById("email"))?.value.trim().replace(/@pgenro\.ims$/i, "") || "";
  const password = document.getElementById("password")?.value || "";

  try {
    if (!supabase || !window.PGENRO_SUPABASE?.configured) {
      throw new Error("Supabase is not configured.");
    }

    if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/.test(employeeNumber) || employeeNumber.endsWith('.') || employeeNumber.includes('..')) throw new Error('Enter a valid employee ID.');
    const result = await supabase.functions.invoke('employee-login', { body: { employee_number: employeeNumber, password } });
    if (result.error) throw new Error('Unable to sign in. Check your employee ID/password and the employee-login service.');
    if (!result.data?.access_token || !result.data?.refresh_token) throw new Error('The login service did not return a valid session.');
    const { data, error } = await supabase.auth.setSession(result.data);
    if (error) throw error;
    if (!data.user) throw new Error("No authenticated user returned.");
    const email = data.user.email || employeeNumber.toLowerCase() + '@pgenro.ims';

    const profile = await PGENRO_API.getCurrentProfile();
    if (!profile || !profile.is_active || !["active", "approved"].includes(String(profile.status || "").toLowerCase())) {
      await supabase.auth.signOut();
      alert(`Access denied: account status is ${profile?.status || "unverified"}.`);
      return;
    }

    const currentUser = {
      uid: profile.user_id,
      id: profile.user_id,
      fullName: profile.full_name || email.split("@")[0],
      email: profile.email || email,
      division: profile.division || "",
      position: profile.position || "",
      role: profile.role || "User",
      status: profile.status || "Active"
    };

    localStorage.setItem("pgenro_current_user", JSON.stringify(currentUser));
    sessionStorage.setItem("pgenro_session_active", "true");
    sessionStorage.setItem("pgenro_session_token", profile.user_id);

    window.location.href = PGENRO_API.isAdminRole(profile.role)
      ? "../admin/admin.html"
      : "../User/homepage.html";
  } catch (error) {
    console.error("Supabase login failed:", error);
    alert(error.message || "Unable to sign in.");
  }
});

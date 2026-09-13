/** PGENRO IMS - Admin Dashboard Controller (Supabase + graceful local preview fallback) */
document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) lucide.createIcons();
  const $ = (id) => document.getElementById(id);
  const safeJson = (raw, fallback = []) => { try { return JSON.parse(raw) ?? fallback; } catch { return fallback; } };
  const arrFromObject = (value) => Array.isArray(value) ? value : (value && typeof value === "object" ? Object.entries(value).map(([id,v]) => ({ id, ...(v || {}) })) : []);
  const escapeHTML = (v) => String(v ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const setText = (id, value) => { const el=$(id); if(el) el.textContent = Number.isFinite(Number(value)) ? Number(value).toLocaleString() : String(value ?? ""); };

  const firebaseConfig = {}; // Legacy API shape; all persistence is routed to Supabase. // Legacy API adapter; configure Supabase in shared/supabase.js.

  let db = null;
  let currentAuthLogs = [];
  let memos = [];
  let stats = {
    communications: 0, travel: 0, memos: 0, employees: 0, inventory: 0, visitors: 0, services: 0, ics: 0, users: 0, requests: 0,
    lowStock: 0, serviceStatus: { completed:0, progress:0, pending:0, archived:0 },
    monthlyMemos: Array(12).fill(0), monthlyComms: Array(12).fill(0), monthlyIcs: Array(12).fill(0)
  };

  // ---------- shell / navigation ----------
  const sidebar = $("sidebar");
  $("mobileMenuBtn")?.addEventListener("click", e => { e.stopPropagation(); sidebar?.classList.toggle("mobile-open"); });
  $("sidebarCollapseBtn")?.addEventListener("click", () => sidebar?.classList.toggle("collapsed"));
  const profileMenu = $("profileMenu");
  const notificationDropdown = $("notificationDropdown");
  $("profileBtn")?.addEventListener("click", e => { e.stopPropagation(); profileMenu?.classList.toggle("open"); notificationDropdown?.classList.remove("open"); });
  $("notificationsBtn")?.addEventListener("click", e => { e.stopPropagation(); notificationDropdown?.classList.toggle("open"); profileMenu?.classList.remove("open"); });
  document.addEventListener("click", () => { profileMenu?.classList.remove("open"); notificationDropdown?.classList.remove("open"); });
  document.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==="k") { e.preventDefault(); $("globalSearchInput")?.focus(); } });
  $("logoutBtn")?.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to sign out of PGENRO IMS?")) return;
    try { if (window.firebase?.auth) await firebase.auth().signOut(); } catch (_) {}
    sessionStorage.removeItem("pgenro_session_token"); sessionStorage.removeItem("pgenro_session_active");
    window.location.href = "../User/login.html";
  });

  function updateProfile(profile = {}) {
    const name = profile.fullName || profile.name || profile.displayName || "PGENRO Admin";
    const email = profile.email || "Administrator Session";
    const role = profile.role || "System Administrator";
    if ($("currentUserName")) $("currentUserName").textContent = name;
    if ($("currentUserRole")) $("currentUserRole").textContent = role;
    if ($("dropdownUserName")) $("dropdownUserName").textContent = name;
    if ($("dropdownUserEmail")) $("dropdownUserEmail").textContent = email;
  }
  let localProfile = safeJson(localStorage.getItem("pgenro_current_user"), null);
  if (localProfile && typeof localProfile === "object") updateProfile(localProfile);

  // ---------- charts ----------
  let monthlyChart, categoryChart, statusChart;
  function initCharts() {
    if (!window.Chart) return;
    const m=$("monthlyChart")?.getContext("2d");
    if (m) monthlyChart = new Chart(m,{type:"line",data:{labels:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],datasets:[
      {label:"Memos",data:stats.monthlyMemos,borderColor:"#059669",backgroundColor:"rgba(5,150,105,.08)",tension:.35},
      {label:"Communications",data:stats.monthlyComms,borderColor:"#2563eb",backgroundColor:"rgba(37,99,235,.08)",tension:.35},
      {label:"ICS",data:stats.monthlyIcs,borderColor:"#7c3aed",backgroundColor:"rgba(124,58,237,.08)",tension:.35}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom"}},scales:{y:{beginAtZero:true}}}});
    const c=$("categoryChart")?.getContext("2d");
    if (c) categoryChart = new Chart(c,{type:"doughnut",data:{labels:["Documents","Travel","Employees","Visitors","Inventory","Services"],datasets:[{data:[0,0,0,0,0,0],backgroundColor:["#059669","#2563eb","#7c3aed","#f59e0b","#0ea5e9","#e11d48"],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:"68%",plugins:{legend:{position:"bottom"}}}});
    const s=$("statusChart")?.getContext("2d");
    if (s) statusChart = new Chart(s,{type:"bar",data:{labels:["Completed","In Progress","Pending","Archived"],datasets:[{label:"Requests",data:[0,0,0,0],backgroundColor:["#059669","#2563eb","#f59e0b","#94a3b8"],borderRadius:6}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});
  }
  function monthBuckets(list) {
    const out=Array(12).fill(0); list.forEach(item=>{ const raw=item.createdAt||item.created_at||item.timestamp||item.date||item.dateIssued||item.issueDate; const d=raw?.toDate?raw.toDate():new Date(raw); if(!Number.isNaN(d.getTime())) out[d.getMonth()]++; }); return out;
  }
  function updateCharts() {
    if (monthlyChart) { monthlyChart.data.datasets[0].data=stats.monthlyMemos; monthlyChart.data.datasets[1].data=stats.monthlyComms; monthlyChart.data.datasets[2].data=stats.monthlyIcs; monthlyChart.update(); }
    if (categoryChart) { categoryChart.data.datasets[0].data=[stats.memos+stats.communications,stats.travel,stats.employees,stats.visitors,stats.inventory,stats.services]; categoryChart.update(); }
    if (statusChart) { const s=stats.serviceStatus; statusChart.data.datasets[0].data=[s.completed,s.progress,s.pending,s.archived]; statusChart.update(); }
  }

  // ---------- local module data ----------
  function firstLocalArray(keys) {
    for (const key of keys) { const value=safeJson(localStorage.getItem(key), null); if (value && (Array.isArray(value) || typeof value==="object")) return arrFromObject(value); }
    return [];
  }
  function refreshLocalStats() {
    const comms=firstLocalArray(["communicationRecords"]);
    const travel=firstLocalArray(["pgenro_admin_travel_orders","travelOrders"]);
    const employees=firstLocalArray(["pgenro_admin_employees","employees"]);
    const inventory=firstLocalArray(["pgenro_admin_inventory","inventoryRecords"]);
    const localMemos=firstLocalArray(["pgenro_office_memos","officeMemos"]);
    const ics=firstLocalArray(["pgenro_ics_records","icsRecords"]);
    stats.communications=comms.length; stats.travel=travel.length; stats.employees=Math.max(stats.employees,employees.length); stats.inventory=inventory.length; stats.ics=ics.length;
    if (localMemos.length) { memos=localMemos; stats.memos=localMemos.length; stats.monthlyMemos=monthBuckets(localMemos); renderMemoStream(memos); }
    stats.monthlyComms=monthBuckets(comms); stats.monthlyIcs=monthBuckets(ics);
    stats.lowStock=inventory.filter(i=>Number(i.quantity ?? i.qty ?? i.stock ?? 0) <= Number(i.threshold ?? i.reorderLevel ?? i.minimumStock ?? 10)).length;
    updateUI();
  }

  function updateUI() {
    setText("kpiPersonnel",stats.employees); setText("kpiPendingAcc",stats.requests); setText("kpiActiveICS",stats.ics); setText("kpiLowStock",stats.lowStock);
    const ids={modCommCount:stats.communications,modTravelCount:stats.travel,modMemoCount:stats.memos,modEmployeeCount:stats.employees,modInventoryCount:stats.inventory,modVisitorCount:stats.visitors,modServiceCount:stats.services,modIcsCount:stats.ics,modUserCount:stats.users,modRequestCount:stats.requests}; Object.entries(ids).forEach(([id,v])=>setText(id,v));
    if ($("sidebarPendingAccBadge")) $("sidebarPendingAccBadge").textContent=`${stats.requests} New`;
    const open=stats.serviceStatus.pending+stats.serviceStatus.progress; if ($("sidebarOpenServicesBadge")) $("sidebarOpenServicesBadge").textContent=`${open} Open`;
    updateCharts();
  }

  // ---------- Supabase realtime (legacy adapter + normalized tables) ----------
  function setDbStatus(ok,text) { const dot=$("dbStatusDot"), label=$("dbStatusText"); if(dot) dot.className=`status-dot ${ok?"online":"offline"}`; if(label) label.textContent=text; }
  function subscribe(path, handler) {
    if (!db) return;
    db.ref(path).on("value", snap => handler(arrFromObject(snap.val() || {})), err => { console.warn(`RTDB ${path} unavailable`,err); setDbStatus(false,"Cloud sync unavailable / local mode"); });
  }
  function initSupabase() {
    try {
      if (!window.firebase) throw new Error("Supabase SDK unavailable");
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db=firebase.database();
      db.ref(".info/connected").on("value", s=>setDbStatus(!!s.val(),s.val()?"Supabase Live":"Offline / reconnecting"));
      if (firebase.auth) firebase.auth().onAuthStateChanged(user=>{ if(user) updateProfile({displayName:user.displayName,email:user.email,role:localProfile?.role||"Administrator"}); });

      subscribe("users", rows=>{ stats.users=rows.length; if(rows.length) stats.employees=Math.max(stats.employees,rows.length); updateUI(); });
      subscribe("access_requests", rows=>{ stats.requests=rows.filter(r=>String(r.status||"Pending").toLowerCase()==="pending").length; renderNotifications(rows); updateUI(); });
      subscribe("visitors", rows=>{ stats.visitors=rows.length; updateUI(); });
      subscribe("service_requests", rows=>{ stats.services=rows.length; const c={completed:0,progress:0,pending:0,archived:0}; rows.forEach(r=>{ const s=String(r.status||r.serviceStatus||"Pending Review").toLowerCase(); if(s.includes("complete")||s.includes("closed"))c.completed++; else if(s.includes("progress")||s.includes("processing"))c.progress++; else if(s.includes("archive"))c.archived++; else c.pending++; }); stats.serviceStatus=c; updateUI(); });
      subscribe("admin_logs", rows=>{ currentAuthLogs=rows.sort((a,b)=>new Date(b.timestamp||b.createdAt||0)-new Date(a.timestamp||a.createdAt||0)).slice(0,50); renderAuthLogs(currentAuthLogs); });
      // These listeners are harmless if the paths do not exist; local storage remains the fallback.
      subscribe("office_memos", rows=>{ if(rows.length){ memos=rows;stats.memos=rows.length;stats.monthlyMemos=monthBuckets(rows);renderMemoStream(rows);updateUI();} });
      subscribe("communications", rows=>{ if(rows.length){stats.communications=rows.length;stats.monthlyComms=monthBuckets(rows);updateUI();} });
      subscribe("ics_records", rows=>{ if(rows.length){stats.ics=rows.length;stats.monthlyIcs=monthBuckets(rows);updateUI();} });

      // Modules that already use normalized Supabase tables.
      const liveTable = (table, handler) => {
        const sb = window.pgenroSupabase;
        if (!sb) return;
        const load = async () => {
          const { data, error } = await sb.from(table).select("*");
          if (error) { console.warn(`Supabase ${table} unavailable`, error); return; }
          handler(data || []);
        };
        load();
        sb.channel(`dashboard-${table}-${Math.random().toString(36).slice(2)}`)
          .on("postgres_changes", { event:"*", schema:"public", table }, load)
          .subscribe();
      };

      liveTable("employees", rows => { stats.employees = rows.length; updateUI(); });
      liveTable("travel_orders", rows => { stats.travel = rows.length; updateUI(); });
      liveTable("inventory", rows => {
        stats.inventory = rows.length;
        stats.lowStock = rows.filter(i => Number(i.quantity || 0) <= Number(i.threshold || 0)).length;
        updateUI();
      });
    } catch (err) { console.warn("Supabase dashboard fallback",err); setDbStatus(false,"Local module storage mode"); }
  }

  function renderNotifications(requests) {
    const pending=requests.filter(r=>String(r.status||"Pending").toLowerCase()==="pending");
    if ($("notifBadgeCount")) $("notifBadgeCount").textContent=`${pending.length} Unread`;
    if ($("notifPing")) $("notifPing").style.display=pending.length?"block":"none";
    const list=$("notificationList"); if(!list)return;
    list.innerHTML=pending.length?pending.slice(0,5).map(r=>`<a href="requestACC.html" class="notification-item"><strong>${escapeHTML(r.fullName||r.name||"New applicant")}</strong><span>${escapeHTML(r.email||r.role||"Access request")}</span></a>`).join(""):'<div class="empty-notif-state">No new notifications</div>';
  }

  function renderMemoStream(rows) {
    const box=$("memoStreamList"); if(!box)return; setText("memosTotalCountLabel",`${rows.length} Memos Recorded`);
    if(!rows.length){box.innerHTML='<div class="empty-table-cell">No memos recorded in database.</div>';return;}
    const sorted=[...rows].sort((a,b)=>new Date(b.createdAt||b.date||0)-new Date(a.createdAt||a.date||0));
    box.innerHTML=sorted.slice(0,5).map(m=>`<div class="memo-stream-item"><div class="memo-stream-info"><span class="memo-stream-title">${escapeHTML(m.memoNo?`[${m.memoNo}] `:"")}${escapeHTML(m.title||m.subject||"Office Memorandum")}</span><span class="memo-stream-meta">${escapeHTML(m.issuedBy||m.author||"PGENRO Admin")}</span></div><a href="officememo-admin.html" class="icon-btn-sm" title="Open memo administration"><i data-lucide="external-link"></i></a></div>`).join("");
    if(window.lucide)lucide.createIcons();
  }

  function renderAuthLogs(logs) {
    const tbody=$("auditTableBody"), info=$("tablePaginationInfo"); if(!tbody)return;
    if(!logs.length){tbody.innerHTML='<tr class="empty-row"><td colspan="7" class="empty-table-cell">No login/logout activity recorded in database.</td></tr>'; if(info)info.textContent="Showing 0 to 0 of 0 log entries";return;}
    tbody.innerHTML=logs.map(log=>{const d=new Date(log.timestamp||Date.now()); const action=log.activity||log.action||"Authentication Event"; const email=log.userEmail||log.emailMasked||"Protected account"; const ok=String(log.status||log.sessionStatus||"Success").toLowerCase().includes("success"); return `<tr><td><input type="checkbox" class="row-checkbox"></td><td class="text-muted">${escapeHTML(d.toLocaleString())}</td><td><div class="user-cell"><div class="avatar-sm">${escapeHTML(email.slice(0,2).toUpperCase())}</div><div><strong>${escapeHTML(log.userName||email)}</strong><small>${escapeHTML(email)}</small></div></div></td><td><span class="badge-status ${ok?"success":"urgent"}"><span class="dot"></span>${escapeHTML(action.replaceAll("_"," "))}</span></td><td><span class="table-tag">${escapeHTML(log.role||log.division||log.details||"PGENRO")}</span></td><td class="font-mono">${escapeHTML(log.ipAddress||"Client session")}</td><td><span class="badge-status ${ok?"success":"urgent"}">${escapeHTML(log.sessionStatus||log.status||"Logged")}</span></td></tr>`;}).join("");
    if(info)info.textContent=`Showing 1 to ${logs.length} of ${logs.length} log entries`; if(window.lucide)lucide.createIcons();
  }

  // table controls
  $("tableSearchInput")?.addEventListener("input", e=>{const q=e.target.value.toLowerCase().trim(); document.querySelectorAll("#auditTableBody tr").forEach(row=>row.style.display=row.textContent.toLowerCase().includes(q)?"":"none");});
  $("selectAllRows")?.addEventListener("change", e=>document.querySelectorAll(".row-checkbox").forEach(cb=>cb.checked=e.target.checked));
  $("exportCsvBtn")?.addEventListener("click",()=>{
    if(!currentAuthLogs.length)return alert("No authentication logs available to export.");
    const q=v=>`"${String(v??"").replace(/"/g,'""')}"`; const rows=[["Timestamp","Account","Action","Details","Status"].map(q).join(","),...currentAuthLogs.map(l=>[new Date(l.timestamp||Date.now()).toISOString(),l.userEmail||l.emailMasked||l.userName||"",l.activity||l.action||"",l.details||l.role||"",l.status||l.sessionStatus||""].map(q).join(","))];
    downloadBlob(rows.join("\n"),`PGENRO_Auth_Audit_${new Date().toISOString().slice(0,10)}.csv`,"text/csv;charset=utf-8");
  });
  $("globalSearchInput")?.addEventListener("input",e=>{const q=e.target.value.toLowerCase().trim(); document.querySelectorAll(".module-control-card").forEach(card=>card.style.display=!q||card.textContent.toLowerCase().includes(q)?"":"none");});

  function downloadBlob(content,name,type) { const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url); }

  // ---------- local backup / preferences ----------
  $("downloadLocalBackupBtn")?.addEventListener("click",()=>{
    const data={meta:{system:"PGENRO IMS",exportedAt:new Date().toISOString(),version:2},localStorage:{}};
    for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i); if(key && (key.startsWith("pgenro_")||["communicationRecords","travelOrders","employees","inventoryRecords","officeMemos","icsRecords"].includes(key))) data.localStorage[key]=localStorage.getItem(key);}
    downloadBlob(JSON.stringify(data,null,2),`PGENRO_IMS_Local_Backup_${new Date().toISOString().slice(0,10)}.json`,"application/json");
  });
  $("restoreBackupInput")?.addEventListener("change", async e=>{const file=e.target.files?.[0];if(!file)return;try{const parsed=JSON.parse(await file.text());if(!parsed.localStorage||typeof parsed.localStorage!=="object")throw new Error("Invalid backup structure");if(!confirm("Restore this local IMS backup? Matching browser records will be replaced.")){e.target.value="";return;}Object.entries(parsed.localStorage).forEach(([k,v])=>{if(typeof v==="string")localStorage.setItem(k,v);});alert("Local backup restored successfully. The dashboard will refresh.");location.reload();}catch(err){alert(`Unable to restore backup: ${err.message}`);}finally{e.target.value="";}});
  const prefKey="pgenro_admin_preferences";
  function applyPrefs(){const p=safeJson(localStorage.getItem(prefKey),{});$("compactModeToggle") && ($("compactModeToggle").checked=!!p.compact);$("showDbStatusToggle") && ($("showDbStatusToggle").checked=p.showDb!==false);document.body.classList.toggle("compact-mode",!!p.compact);document.body.classList.toggle("hide-db-status",p.showDb===false);}
  function savePrefs(){const p={compact:!!$("compactModeToggle")?.checked,showDb:$("showDbStatusToggle")?.checked!==false};localStorage.setItem(prefKey,JSON.stringify(p));applyPrefs();}
  $("compactModeToggle")?.addEventListener("change",savePrefs);$("showDbStatusToggle")?.addEventListener("change",savePrefs);$("resetAdminPrefsBtn")?.addEventListener("click",()=>{localStorage.removeItem(prefKey);applyPrefs();}); applyPrefs();

  window.addEventListener("storage",refreshLocalStats); document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshLocalStats();});
  initCharts(); refreshLocalStats(); initSupabase(); updateUI();
});

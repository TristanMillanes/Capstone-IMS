/* Module-owned runtime. Kept inside each module; no extra shared file required. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const storage = {
    get(key, fallback = null) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uuid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  function toast(message, type = 'success') {
    let root = $('toastContainer');
    if (!root) { root = document.createElement('div'); root.id = 'toastContainer'; root.className = 'toast-container'; root.setAttribute('aria-live','polite'); document.body.append(root); }
    const limit = innerWidth <= 600 ? 1 : 3;
    while (root.children.length >= limit) root.firstElementChild.remove();
    const item = document.createElement('div'); item.className = `toast show ${type}`; item.textContent = message; root.append(item); setTimeout(() => item.remove(), 5500);
  }
  function csv(rows, filename) {
    const cell = v => { let s = String(v ?? ''); if (/^[\s]*[=+@-]/.test(s)) s = "'"+s; return `"${s.replaceAll('"','""')}"`; };
    const blob = new Blob(['\ufeff', rows.map(row => row.map(cell).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const modalTriggers = new Map();
  function openModal(id) {
    const modal = $(id); if (!modal) return;
    if([...document.querySelectorAll('.modal-overlay.open,.modal-backdrop.open,.admin-modal.open')].some(other=>other.dataset.busy==='true'))return false;
    document.querySelectorAll('.modal-overlay.open,.modal-backdrop.open,.admin-modal.open').forEach(other => { if (other !== modal) closeModal(other.id); });
    modalTriggers.set(id, document.activeElement); modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); document.body.classList.add('admin-modal-open');
    const wrapper = document.querySelector('.app-layout'); if (wrapper) wrapper.inert = true;
    const dialog = modal.querySelector('[role=dialog]') || modal; dialog.setAttribute('tabindex','-1');
    (modal.querySelector('input:not([type=hidden]):not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled)') || dialog).focus();
  }
  function closeModal(id) {
    const modal = $(id); if (!modal || !modal.classList.contains('open') || modal.dataset.busy === 'true') return;
    modal.classList.remove('open'); modal.setAttribute('aria-hidden','true');
    if (!document.querySelector('.modal-overlay.open,.modal-backdrop.open,.admin-modal.open')) {
      document.body.classList.remove('admin-modal-open'); const wrapper = document.querySelector('.app-layout'); if (wrapper) wrapper.inert = false;
    }
    const trigger=modalTriggers.get(id);modalTriggers.delete(id);
    if(trigger?.isConnected&&trigger.getClientRects?.().length&&!trigger.closest?.('[inert]')&&!trigger.disabled)trigger.focus({preventScroll:true});
    else if(!document.querySelector('.modal-overlay.open,.modal-backdrop.open,.admin-modal.open'))(document.querySelector('.header-actions .btn-primary')||document.querySelector('main'))?.focus({preventScroll:true});
    modal.dispatchEvent(new Event('pgenro:modal-close'));
  }
  let currentIds = new Map(); const unread = [];
  function observeRecords(key, rows) {
    window.PGENRO_Notifications?.scheduleRefresh();
    const ids = rows.map(r => String(r.id)).filter(Boolean); const prior = currentIds.get(key);
    if (prior) {
      const added = ids.filter(id => !prior.has(id));
      if (added.length) { unread.unshift(`${added.length} new ${key.replaceAll('_',' ')} record${added.length === 1 ? '' : 's'} added.`); renderNotifications(); }
    }
    currentIds.set(key, new Set(ids));
  }
  function renderNotifications() {
    if ($('notificationList')) $('notificationList').innerHTML = unread.length ? unread.slice(0,20).map(t => `<div class="notification-item"><strong>New record</strong><span>${escape(t)}</span></div>`).join('') : '<div class="empty-notif-state">No new notifications</div>';
    if ($('notifBadgeCount')) $('notifBadgeCount').textContent = `${unread.length} Unread`;
    if ($('notifPing')) $('notifPing').style.display = unread.length ? 'block' : 'none';
  }
  const wrapped = new Map();
  const client = () => window.pgenroSupabase || window.PGENRO_DB?.client || null;
  const unwrap = row => row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? {...row.data,id:row.id,created_at:row.created_at ?? row.data.created_at,updated_at:row.updated_at ?? row.data.updated_at} : row;
  async function read(table) {
    const sb = client(); if (!sb) throw new Error('Database client is unavailable. Refresh the page and try again.');
    if (!wrapped.has(table)) {
      const probe = await sb.from(table).select('data').limit(1);
      if (probe.error && !['42703','PGRST204'].includes(probe.error.code)) throw probe.error;
      wrapped.set(table, !probe.error);
    }
    const rows = []; let offset = 0;
    while (true) {
      const response = await sb.from(table).select('*',{count:'exact'}).order('id',{ascending:true}).range(offset,offset+499);
      if (response.error) throw response.error;
      const batch = response.data || []; rows.push(...batch); offset += batch.length;
      if (batch.length < 500 || (response.count !== null && response.count !== undefined && offset >= response.count)) break;
    }
    return rows.map(unwrap);
  }
  async function write(table, payload, id = null) {
    await window.PGENRO_API?.requireAdmin?.();
    const sb = client(); if (!sb) throw new Error('Database client is unavailable.');
    let body = wrapped.get(table) ? {data:payload} : payload;
    if (id && wrapped.get(table)) {
      const existing = await sb.from(table).select('data').eq('id',id).limit(1);
      if (existing.error) throw existing.error;
      if (!existing.data?.length) throw new Error('This record is no longer available. Refresh before saving.');
      body = {data:{...(existing.data[0].data || {}), ...payload}};
    }
    if (!id && wrapped.get(table)) body = {id:uuid(), ...body};
    const response = await (id ? sb.from(table).update(body).eq('id',id) : sb.from(table).insert(body)).select('*');
    if (response.error) throw response.error;
    if (!response.data?.length) throw new Error('The record was not saved or is not accessible. Check your database permissions.');
    return unwrap(response.data[0]);
  }
  async function remove(table, ids) {
    await window.PGENRO_API?.requireAdmin?.();
    const response = await client().from(table).delete().in('id',ids).select('id');
    if (response.error) throw response.error;
    if (response.data?.length !== ids.length) throw new Error('Some records could not be deleted. Refresh and check your database permissions.');
  }
  async function audit(action, details) {
    const event = {id:uuid(),action,details,module:document.title.split('|')[1]?.trim(),timestamp:new Date().toISOString(),created_at:new Date().toISOString()};
    const cached = storage.get('pgenro_audit_log_fallback',[]); storage.set('pgenro_audit_log_fallback',[event,...(Array.isArray(cached) ? cached : [])].slice(0,500));
    // Keep the page usable if the optional audit table is unavailable.
    if (client()) { try { await readAuditShape(); const result = await client().from('audit_logs').insert(wrapped.get('audit_logs') ? {id:event.id,data:event} : event); if (result.error) console.warn('Audit retained locally:',result.error.message); } catch {} }
  }
  async function readAuditShape() { if (!wrapped.has('audit_logs')) { const r = await client().from('audit_logs').select('data').limit(1); wrapped.set('audit_logs',!r.error); } }
  function initShell() {
    renderIcons(); renderNotifications();
    const sidebar = $('sidebar'); const mobile = $('mobileMenuBtn'); const collapse = $('sidebarCollapseBtn'); const backdrop = $('sidebarBackdrop');
    function closeMobile() { sidebar?.classList.remove('mobile-open'); backdrop?.classList.remove('active'); backdrop?.setAttribute('aria-hidden','true'); document.body.classList.remove('mobile-nav-open'); mobile?.setAttribute('aria-expanded','false'); if (innerWidth <= 900 && sidebar) sidebar.inert = true; }
    function sync() {
      let pref = 'expanded'; try { pref = localStorage.getItem('pgenro_admin_sidebar') || pref; } catch {}
      const collapsed = innerWidth > 900 && pref === 'collapsed'; sidebar?.classList.toggle('collapsed',collapsed); document.body.classList.toggle('sidebar-collapsed',collapsed);
      collapse?.setAttribute('aria-expanded',String(!collapsed)); collapse?.setAttribute('aria-label',collapsed ? 'Expand administrator menu' : 'Collapse administrator menu'); if (collapse) collapse.title = collapsed ? 'Expand Menu' : 'Collapse Menu';
      if (innerWidth > 900) closeMobile(); if (sidebar) sidebar.inert = innerWidth <= 900 && !sidebar.classList.contains('mobile-open');
    }
    collapse?.addEventListener('click',() => { if (innerWidth <= 900) { closeMobile(); mobile?.focus(); return; } try { localStorage.setItem('pgenro_admin_sidebar',sidebar.classList.contains('collapsed') ? 'expanded' : 'collapsed'); } catch {} sync(); });
    mobile?.addEventListener('click',() => { const open = !sidebar.classList.contains('mobile-open'); if (!open) return closeMobile(); sidebar.inert = false; sidebar.classList.add('mobile-open'); backdrop?.classList.add('active'); backdrop?.setAttribute('aria-hidden','false'); document.body.classList.add('mobile-nav-open'); mobile.setAttribute('aria-expanded','true'); sidebar.querySelector('a')?.focus(); });
    backdrop?.addEventListener('click',() => {closeMobile();mobile?.focus();});
    sidebar?.querySelectorAll('a').forEach(a => { a.title = a.textContent.trim(); a.addEventListener('click',closeMobile); });
    let wasMobile = innerWidth <= 900; window.addEventListener('resize',() => {const next = innerWidth <= 900; if(next !== wasMobile){wasMobile = next; sync();}}); window.addEventListener('storage',event => {if(event.key === 'pgenro_admin_sidebar') sync();}); sync();
    const pairs = [['profileBtn','profileDropdown'],['notificationsBtn','notificationDropdown']];
    function closeMenus() { pairs.forEach(([button,menu])=>{$(button)?.setAttribute('aria-expanded','false');$(menu)?.classList.remove('open');}); }
    pairs.forEach(([button,menu]) => $(button)?.addEventListener('click',() => { const open = !$(menu)?.classList.contains('open'); closeMenus(); if(open){$(menu)?.classList.add('open');$(button).setAttribute('aria-expanded','true'); if(button==='profileBtn')$(menu)?.querySelector('a,button')?.focus();if(button==='notificationsBtn'){unread.length=0; if($('notifBadgeCount'))$('notifBadgeCount').textContent='0 Unread'; if($('notifPing'))$('notifPing').style.display='none';}} }));
    document.addEventListener('click',e => { if (!e.target.closest('.profile-menu,.notification-wrapper')) closeMenus(); });
    document.addEventListener('keydown',e => {
      if ((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k') {e.preventDefault();$('globalSearchInput')?.focus();}
      const modal = document.querySelector('.modal-overlay.open,.modal-backdrop.open,.admin-modal.open');
      const surface = modal || (sidebar?.classList.contains('mobile-open') ? sidebar : null);
      if (e.key === 'Escape') {const menuTrigger=pairs.find(([,menu])=>$(menu)?.classList.contains('open'))?.[0];const wasOpen=sidebar?.classList.contains('mobile-open');closeMenus();if(modal)closeModal(modal.id);closeMobile();if(wasOpen)mobile?.focus();else if(menuTrigger)$(menuTrigger)?.focus();}
      if (e.key === 'Tab' && surface) {const elements = [...surface.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[tabindex="0"]')].filter(el=>!el.disabled && !el.closest('[inert]') && el.getClientRects().length); if (!elements.length) return; const first=elements[0],last=elements.at(-1);if(!surface.contains(document.activeElement)){e.preventDefault();(e.shiftKey?last:first).focus();}else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
    });
    document.querySelectorAll('.modal-overlay,.modal-backdrop').forEach(m => m.addEventListener('click',e => { if(e.target===m)closeModal(m.id); }));
    const user = storage.get('pgenro_current_user',{}); if($('dropdownUserName'))$('dropdownUserName').textContent=user.fullName||user.full_name||user.name||'PGENRO Admin'; if($('dropdownUserEmail'))$('dropdownUserEmail').textContent=user.email||'Administrator Session';
    if(document.body.dataset.adminPage !== 'admin.html') $('logoutBtn')?.addEventListener('click',async () => {
      try { if(client()){const result=await client().auth.signOut();if(result?.error)throw result.error;} try{localStorage.removeItem('pgenro_current_user');sessionStorage.removeItem('pgenro_current_user');}catch{} location.href='../User/login.html'; }catch{toast('Sign out failed. Please try again.','error');}
    });
  }
  // ICON_MAP is inserted while packaging, from the existing local Lucide subset.
  const icons = {"archive":[["rect",{"width":"20","height":"5","x":"2","y":"3","rx":"1"}],["path",{"d":"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"}],["path",{"d":"M10 12h4"}]],"archive-restore":[["rect",{"width":"20","height":"5","x":"2","y":"3","rx":"1"}],["path",{"d":"M4 8v11a2 2 0 0 0 2 2h2"}],["path",{"d":"M20 8v11a2 2 0 0 1-2 2h-2"}],["path",{"d":"m9 15 3-3 3 3"}],["path",{"d":"M12 12v9"}]],"badge":[["path",{"d":"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"}]],"badge-check":[["path",{"d":"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"}],["path",{"d":"m9 12 2 2 4-4"}]],"check":[["path",{"d":"M20 6 9 17l-5-5"}]],"check-circle-2":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m9 12 2 2 4-4"}]],"clipboard-pen-line":[["rect",{"width":"8","height":"4","x":"8","y":"2","rx":"1"}],["path",{"d":"M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-.5"}],["path",{"d":"M16 4h2a2 2 0 0 1 1.73 1"}],["path",{"d":"M8 18h1"}],["path",{"d":"M21.378 12.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"}]],"coins":[["path",{"d":"M13.744 17.736a6 6 0 1 1-7.48-7.48"}],["path",{"d":"M15 6h1v4"}],["path",{"d":"m6.134 14.768.866-.5 2 3.464"}],["circle",{"cx":"16","cy":"8","r":"6"}]],"database":[["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3"}],["path",{"d":"M3 5V19A9 3 0 0 0 21 19V5"}],["path",{"d":"M3 12A9 3 0 0 0 21 12"}]],"database-backup":[["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3"}],["path",{"d":"M3 12a9 3 0 0 0 5 2.69"}],["path",{"d":"M21 9.3V5"}],["path",{"d":"M3 5v14a9 3 0 0 0 6.47 2.88"}],["path",{"d":"M12 12v4h4"}],["path",{"d":"M13 20a5 5 0 0 0 9-3 4.5 4.5 0 0 0-4.5-4.5c-1.33 0-2.54.54-3.41 1.41L12 16"}]],"download":[["path",{"d":"M12 15V3"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["path",{"d":"m7 10 5 5 5-5"}]],"eye":[["path",{"d":"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"file-badge":[["path",{"d":"M13 22h5a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v3.3"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"m7.69 16.479 1.29 4.88a.5.5 0 0 1-.698.591l-1.843-.849a1 1 0 0 0-.879.001l-1.846.85a.5.5 0 0 1-.692-.593l1.29-4.88"}],["circle",{"cx":"6","cy":"14","r":"3"}]],"file-check-2":[["path",{"d":"M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v6"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"m14 20 2 2 4-4"}]],"file-plus-2":[["path",{"d":"M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M14 19h6"}],["path",{"d":"M17 16v6"}]],"file-search":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["circle",{"cx":"11.5","cy":"14.5","r":"2.5"}],["path",{"d":"M13.3 16.3 15 18"}]],"file-text":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M10 9H8"}],["path",{"d":"M16 13H8"}],["path",{"d":"M16 17H8"}]],"files":[["path",{"d":"M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"}],["path",{"d":"M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z"}],["path",{"d":"M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1"}]],"hash":[["line",{"x1":"4","x2":"20","y1":"9","y2":"9"}],["line",{"x1":"4","x2":"20","y1":"15","y2":"15"}],["line",{"x1":"10","x2":"8","y1":"3","y2":"21"}],["line",{"x1":"16","x2":"14","y1":"3","y2":"21"}]],"info":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 16v-4"}],["path",{"d":"M12 8h.01"}]],"list-filter-x":[["path",{"d":"M3 5h18M6 12h9M9 19h3M17 16l5 5M22 16l-5 5"}]],"menu":[["path",{"d":"M4 5h16"}],["path",{"d":"M4 12h16"}],["path",{"d":"M4 19h16"}]],"package":[["path",{"d":"M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"}],["path",{"d":"M12 22V12"}],["polyline",{"points":"3.29 7 12 12 20.71 7"}],["path",{"d":"m7.5 4.27 9 5.15"}]],"panel-left-close":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M9 3v18"}],["path",{"d":"m16 15-3-3 3-3"}]],"panel-left-open":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M9 3v18"}],["path",{"d":"m14 9 3 3-3 3"}]],"philippine-peso":[["path",{"d":"M20 11H4"}],["path",{"d":"M20 7H4"}],["path",{"d":"M7 21V4a1 1 0 0 1 1-1h4a1 1 0 0 1 0 12H7"}]],"plus":[["path",{"d":"M5 12h14"}],["path",{"d":"M12 5v14"}]],"printer":[["path",{"d":"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"}],["path",{"d":"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"}],["rect",{"x":"6","y":"14","width":"12","height":"8","rx":"1"}]],"refresh-cw":[["path",{"d":"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{"d":"M21 3v5h-5"}],["path",{"d":"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{"d":"M8 16H3v5"}]],"rows-3":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M21 9H3"}],["path",{"d":"M21 15H3"}]],"save":[["path",{"d":"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"}],["path",{"d":"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"}],["path",{"d":"M7 3v4a1 1 0 0 0 1 1h7"}]],"search":[["path",{"d":"m21 21-4.34-4.34"}],["circle",{"cx":"11","cy":"11","r":"8"}]],"search-x":[["path",{"d":"m13.5 8.5-5 5"}],["path",{"d":"m8.5 8.5 5 5"}],["circle",{"cx":"11","cy":"11","r":"8"}],["path",{"d":"m21 21-4.3-4.3"}]],"settings":[["path",{"d":"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"square-pen":[["path",{"d":"M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"}],["path",{"d":"M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"}]],"table":[["path",{"d":"M12 3v18"}],["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M3 9h18"}],["path",{"d":"M3 15h18"}]],"tag":[["path",{"d":"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"}],["circle",{"cx":"7.5","cy":"7.5","r":".5","fill":"currentColor"}]],"trash-2":[["path",{"d":"M10 11v6"}],["path",{"d":"M14 11v6"}],["path",{"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{"d":"M3 6h18"}],["path",{"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]],"user":[["path",{"d":"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"}],["circle",{"cx":"12","cy":"7","r":"4"}]],"user-check":[["path",{"d":"m16 11 2 2 4-4"}],["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"users":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["path",{"d":"M16 3.128a4 4 0 0 1 0 7.744"}],["path",{"d":"M22 21v-2a4 4 0 0 0-3-3.87"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"x":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],"sun":[["circle",{"cx":"12","cy":"12","r":"4"}],["path",{"d":"M12 2v2"}],["path",{"d":"M12 20v2"}],["path",{"d":"m4.93 4.93 1.41 1.41"}],["path",{"d":"m17.66 17.66 1.41 1.41"}],["path",{"d":"M2 12h2"}],["path",{"d":"M20 12h2"}],["path",{"d":"m6.34 17.66-1.41 1.41"}],["path",{"d":"m19.07 4.93-1.41 1.41"}]],"moon":[["path",{"d":"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"}]],"columns-3":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M9 3v18"}],["path",{"d":"M15 3v18"}]],"inbox":[["polyline",{"points":"22 12 16 12 14 15 10 15 8 12 2 12"}],["path",{"d":"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"}]]};
  const aliases = {'eye':'search','pencil':'file-text','save':'file-check-2','cloud-upload':'file-up','plus-circle':'user-plus','database':'database-backup','hash':'file-text','files':'file-text','folder-open':'briefcase','file-search':'search','scan-text':'file-text','paperclip':'file-text','trash':'trash-2','shield-check':'shield-alert','calendar-days':'calendar','clock-3':'clock','contact':'user-round','building-2':'briefcase','printer':'file-text','file-spreadsheet':'file-text'};
  function renderIcons() {
    document.querySelectorAll('i[data-lucide]').forEach(el => {
      const name = el.dataset.lucide;
      const nodes = icons[name] || icons[aliases[name]] || icons['file-text'];
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const attrs = { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' };
      for (const [key, value] of Object.entries(attrs)) svg.setAttribute(key, value);
      svg.setAttribute('class', 'lucide lucide-' + name + ' ' + el.className);
      if (el.hasAttribute('style')) svg.setAttribute('style', el.getAttribute('style'));
      for (const [tag, attributes] of nodes) {
        const node = document.createElementNS(svg.namespaceURI, tag);
        for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
        svg.append(node);
      }
      el.replaceWith(svg);
    });
  }
  const canStartAction = () => !document.querySelector('.modal-overlay.open[data-busy="true"],.modal-backdrop.open[data-busy="true"],.admin-modal.open[data-busy="true"]');
  window.PGENRO_Module = {canStartAction,storage,escape,uuid,today,toast,csv,openModal,closeModal,observeRecords,renderIcons,read,write,remove,audit,client,unwrap};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initShell,{once:true});else initShell();
})();

/* ===== ICS Admin page controller — admin-interface matched v4 ===== */
(() => {
  'use strict';
  const M=window.PGENRO_Module;let saving=false,loadVersion=0,channel=null;

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const state = { records: [], activeRecordId: null, statusFilter: 'ALL', db: null, dbReady: false, unsubscribe: null };
  const requiredIds = ['controlNo','icsNo','article','itemDescription','quantity','unitCost','accountablePerson'];

  function escapeHtml(value){
    return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  }
  function formatMoney(value){
    return `₱${(Number(value)||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  }
  function formatNumber(value){
    return (Number(value)||0).toLocaleString('en-PH',{maximumFractionDigits:2});
  }
  function toDate(value){
    if(!value) return null;
    if(typeof value?.toDate === 'function') return value.toDate();
    if(value instanceof Date) return value;
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value))?value+'T00:00:00':value); return Number.isNaN(d.getTime()) ? null : d;
  }
  function formatDate(value){
    const d = toDate(value); if(!d) return value ? String(value) : '---';
    return d.toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'2-digit'});
  }
  function formatDateInput(value){
    if(!value) return '';
    if(/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
    const d=toDate(value); if(!d) return '';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function refreshIcons(){ M.renderIcons(); }

  const toast=M.toast;
  function setDatabaseStatus(online){state.dbReady=online;}
  function initDatabase(){state.db=M.client();state.dbReady=false;}

  function serverTimestamp(){
    return window.PGENRO_SUPABASE_STORE?.tableStore?.FieldValue?.serverTimestamp?.() || new Date().toISOString();
  }

  /* Shell controls */

  /* Form UI */
  const form=$('icsForm'), editorModal=$('editorModal'), viewModal=$('viewModal');
  function setModalOpen(modal,open){if(modal)(open?M.openModal:M.closeModal)(modal.id);}

  function showFormFeedback(message,type='error'){
    const el=$('formFeedback'); if(!el) return;
    if(!message){ el.hidden=true; el.textContent=''; el.className='form-feedback'; return; }
    el.hidden=false; el.className=`form-feedback${type==='success'?' success':''}`; el.textContent=message;
    el.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function clearFieldError(el){
    if(!el) return; el.classList.remove('invalid'); el.removeAttribute('aria-invalid');
    el.closest('.field')?.querySelector('.field-error')?.remove();
  }
  function setFieldError(el,message){
    if(!el) return; clearFieldError(el); el.classList.add('invalid'); el.setAttribute('aria-invalid','true');
    const msg=document.createElement('small'); msg.className='field-error'; msg.textContent=message; el.closest('.field')?.appendChild(msg);
  }
  function clearValidation(){ $$('input.invalid,select.invalid,textarea.invalid',form).forEach(clearFieldError); showFormFeedback(''); }

  function validateForm(){
    clearValidation(); const invalid=[];
    requiredIds.forEach(id=>{
      const el=$(id); if(!el) return;
      const raw=String(el.value ?? '').trim();
      if(!raw){ setFieldError(el,'This field is required.'); invalid.push(el); return; }
      if((id==='quantity'||id==='unitCost') && (!Number.isFinite(Number(raw)) || Number(raw)<0)){ setFieldError(el,'Enter a valid non-negative number.'); invalid.push(el); }
      if(id==='quantity' && Number(raw)<=0){ setFieldError(el,'Quantity must be greater than zero.'); invalid.push(el); }
    });
    if(invalid.length){
      showFormFeedback(`Please review ${invalid.length} required field${invalid.length===1?'':'s'} highlighted below.`);
      invalid[0].focus({preventScroll:true}); invalid[0].scrollIntoView({behavior:'smooth',block:'center'}); return false;
    }
    return form.checkValidity() || (form.reportValidity(),false);
  }

  function updateTotals(){
    const qty=Math.max(0,Number($('quantity')?.value||0)); const cost=Math.max(0,Number($('unitCost')?.value||0)); const total=qty*cost;
    if($('totalValuePreview')) $('totalValuePreview').textContent=formatMoney(total);
    if($('summaryQuantity')) $('summaryQuantity').textContent=formatNumber(qty);
    if($('summaryUnitCost')) $('summaryUnitCost').textContent=formatMoney(cost);
    if($('summaryTotal')) $('summaryTotal').textContent=formatMoney(total);
    updateProgress();
  }
  function updateRemarksCounter(){ if($('remarksCounter')) $('remarksCounter').textContent=String($('remarks')?.value.length||0); }
  function updateProgress(){
    const completed=requiredIds.filter(id=>{ const el=$(id); if(!el) return false; const v=String(el.value??'').trim(); if(!v) return false; if(id==='quantity') return Number(v)>0; if(id==='unitCost') return Number(v)>=0; return true; }).length;
    const pct=Math.round((completed/requiredIds.length)*100);
    if($('icsProgressFill')) $('icsProgressFill').style.width=`${pct}%`;
    if($('icsProgressPercent')) $('icsProgressPercent').textContent=`${pct}%`;
    if($('icsProgressText')) $('icsProgressText').textContent=pct===100?'Required information complete':'Complete the required fields';
    const sectionComplete=[
      ['controlNo','icsNo'],['article','itemDescription','quantity'],['unitCost'],['accountablePerson']
    ];
    $$('.progress-step').forEach((btn,i)=>btn.classList.toggle('completed',(sectionComplete[i]||[]).every(id=>String($(id)?.value??'').trim()!=='')));
  }
  function setActiveFormSection(index){ $$('.progress-step').forEach((btn,i)=>btn.classList.toggle('active',i===index)); }

  function resetForm(){
    form?.reset(); if($('recordId')) $('recordId').value=''; if($('unit')) $('unit').value='unit'; if($('quantity')) $('quantity').value='1'; if($('unitCost')) $('unitCost').value='0'; if($('fundCluster')) $('fundCluster').value='General Fund (01)'; if($('status')) $('status').value='Active';
    clearValidation(); updateTotals(); updateRemarksCounter(); setActiveFormSection(0); if($('editorTitle')) $('editorTitle').textContent='New Inventory Custodian Slip';
  }
  function populateForm(record){
    const fields=['controlNo','icsNo','entryNo','accountCode','article','itemDescription','serialNo','itemNo','unit','quantity','unitCost','prNo','fundCluster','accountablePerson','division','status','remarks'];
    fields.forEach(id=>{ if($(id)) $(id).value=record?.[id] ?? ''; });
    if($('dateAcquired')) $('dateAcquired').value=formatDateInput(record?.dateAcquired);
    if($('prDate')) $('prDate').value=formatDateInput(record?.prDate);
    updateTotals(); updateRemarksCounter();
  }
  function openEditor(record=null){
    if(saving)return;resetForm();
    if(!record){const prefix=`ICS-${new Date().getFullYear()}-`;const highest=Math.max(0,...state.records.map(r=>String(r.controlNo||'').startsWith(prefix)?Number(String(r.controlNo).slice(prefix.length))||0:0));$('controlNo').value=prefix+String(highest+1).padStart(4,'0');}
    if(record){ if($('editorTitle')) $('editorTitle').textContent='Edit Inventory Custodian Slip'; if($('recordId')) $('recordId').value=record.id||''; populateForm(record); }
    setModalOpen(editorModal,true); $('controlNo')?.focus({preventScroll:true});
  }
  function closeEditor(){ setModalOpen(editorModal,false); clearValidation(); }

  function getFormData(){
    const quantity=Number($('quantity')?.value||0), unitCost=Number($('unitCost')?.value||0);
    return {
      controlNo:$('controlNo')?.value.trim()||'', icsNo:$('icsNo')?.value.trim()||'', entryNo:$('entryNo')?.value.trim()||'', accountCode:$('accountCode')?.value.trim()||'',
      article:$('article')?.value.trim()||'', itemDescription:$('itemDescription')?.value.trim()||'', serialNo:$('serialNo')?.value.trim()||'', itemNo:$('itemNo')?.value.trim()||'', unit:$('unit')?.value.trim()||'unit',
      quantity, unitCost, totalValue:Number((quantity*unitCost).toFixed(2)), dateAcquired:$('dateAcquired')?.value||'', prNo:$('prNo')?.value.trim()||'', prDate:$('prDate')?.value||'', fundCluster:$('fundCluster')?.value.trim()||'',
      accountablePerson:$('accountablePerson')?.value.trim()||'', division:$('division')?.value.trim()||'', status:$('status')?.value||'Active', remarks:$('remarks')?.value.trim()||''
    };
  }

  async function saveForm(event){
    event.preventDefault();if(saving||!validateForm())return;
    if(!state.dbReady){showFormFeedback('Refresh the registry successfully before saving.');return;}
    const data=getFormData(),id=$('recordId').value.trim();
    if(state.records.some(r=>String(r.id)!==id&&String(r.controlNo||'').trim().toLowerCase()===data.controlNo.toLowerCase())){showFormFeedback('Control number already exists. Choose a unique number.');$('controlNo').focus();return;}
    saving=true;editorModal.dataset.busy='true';const button=$('saveIcsBtn'),markup=button.innerHTML;button.disabled=true;button.textContent='Saving…';
    try{
      data.updatedAt=new Date().toISOString();if(!id)data.createdAt=data.updatedAt;
      const saved=await window.PGENRO_ICS.save(data,id||null);
      state.records=id?state.records.map(r=>String(r.id)===id?saved:r):[saved,...state.records];updateKpis();populateFilters();applyFilters();M.observeRecords('ICS slips',state.records);
      editorModal.dataset.busy='false';closeEditor();toast(`ICS record ${id?'updated':'saved'}.`);M.audit(id?'EDIT_RECORD':'ADD_RECORD',`ICS ${data.controlNo}`);
    }catch(error){showFormFeedback(error.message||'The record could not be saved.');}
    finally{saving=false;editorModal.dataset.busy='false';button.disabled=false;button.innerHTML=markup;refreshIcons();}
  }

  function bindForm(){
    $('addIcsBtn')?.addEventListener('click',()=>openEditor()); $('closeEditorBtn')?.addEventListener('click',closeEditor); $('cancelEditorBtn')?.addEventListener('click',closeEditor); form?.addEventListener('submit',saveForm);
    form?.addEventListener('input',(e)=>{ clearFieldError(e.target); showFormFeedback(''); if(e.target.id==='quantity'||e.target.id==='unitCost') updateTotals(); else updateProgress(); if(e.target.id==='remarks') updateRemarksCounter(); });
    form?.addEventListener('focusin',(e)=>{ const section=e.target.closest?.('[data-form-section]'); if(section) setActiveFormSection(Number(section.dataset.formSection)); });
    $$('.progress-step').forEach((btn,i)=>btn.addEventListener('click',()=>{ setActiveFormSection(i); const target=$(btn.dataset.sectionTarget); target?.scrollIntoView({behavior:'smooth',block:'start'}); target?.querySelector('input,select,textarea')?.focus({preventScroll:true}); }));
    editorModal?.addEventListener('click',(e)=>{ if(e.target===editorModal) closeEditor(); });
  }

  /* Data rendering */
  function sortRecords(){ state.records.sort((a,b)=>(toDate(b.updatedAt||b.createdAt||b.dateAcquired)?.getTime()||0)-(toDate(a.updatedAt||a.createdAt||a.dateAcquired)?.getTime()||0)); }
  function updateKpis(){
    const total=state.records.length, active=state.records.filter(r=>(r.status||'Active')==='Active').length, archived=state.records.filter(r=>(r.status||'Active')==='Archived').length;
    const value=state.records.reduce((sum,r)=>sum+(r.totalValue!=null?(Number(r.totalValue)||0):(Number(r.quantity)||0)*(Number(r.unitCost)||0)),0);
    if($('kpiTotal')) $('kpiTotal').textContent=total.toLocaleString();
    if($('kpiActive')) $('kpiActive').textContent=active.toLocaleString();
    if($('kpiArchived')) $('kpiArchived').textContent=archived.toLocaleString();
    if($('kpiValue')) $('kpiValue').textContent=formatMoney(value);
    if($('tabCountPending')) $('tabCountPending').textContent=state.records.filter(r=>r.status==='Pending').length.toLocaleString();
    if($('tabCountAll')) $('tabCountAll').textContent=total.toLocaleString();
    if($('tabCountActive')) $('tabCountActive').textContent=active.toLocaleString();
    if($('tabCountArchived')) $('tabCountArchived').textContent=archived.toLocaleString();
  }
  function rebuildSelect(select,label,values){
    if(!select) return; const current=select.value; select.innerHTML=`<option value="ALL">${escapeHtml(label)}</option>`; values.forEach(v=>{ const o=document.createElement('option'); o.value=v;o.textContent=v;select.appendChild(o); }); if(values.includes(current)) select.value=current;
  }
  function populateFilters(){
    rebuildSelect($('articleFilter'),'All Articles',[...new Set(state.records.map(r=>String(r.article||'').trim()).filter(Boolean))].sort());
    rebuildSelect($('divisionFilter'),'All Divisions',[...new Set(state.records.map(r=>String(r.division||'').trim()).filter(Boolean))].sort());
  }
  function getFilteredRecords(){
    const term=($('icsSearchInput')?.value||'').toLowerCase().trim(), article=$('articleFilter')?.value||'ALL', division=$('divisionFilter')?.value||'ALL';
    return state.records.filter(r=>{
      const hay=[r.controlNo,r.icsNo,r.entryNo,r.accountCode,r.article,r.itemDescription,r.serialNo,r.itemNo,r.accountablePerson,r.division,r.prNo,r.remarks].join(' ').toLowerCase();
      return (!term||hay.includes(term)) && (article==='ALL'||String(r.article||'')===article) && (division==='ALL'||String(r.division||'')===division) && (state.statusFilter==='ALL'||(r.status||'Active')===state.statusFilter);
    });
  }
  function renderTable(records=getFilteredRecords()){
    const tbody=$('icsTableBody'); if(!tbody) return;
    if(!records.length){
      const hasAnyRecords=state.records.length>0;
      const title=state.dbReady ? (hasAnyRecords?'No matching ICS records':'No ICS records yet') : 'ICS database unavailable';
      const message=state.dbReady
        ? (hasAnyRecords?'Try changing your search term or resetting the active filters.':'Create your first Inventory Custodian Slip using the New ICS Record button above.')
        : 'The interface is ready, but records cannot be loaded until the Supabase connection is restored.';
      const icon=state.dbReady ? (hasAnyRecords?'search-x':'file-plus-2') : 'cloud-off';
      tbody.innerHTML=`<tr><td class="empty-row" colspan="9"><div class="empty-state-content"><div class="empty-state-icon"><i data-lucide="${icon}"></i></div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div></td></tr>`;
      if($('recordCounter')) $('recordCounter').textContent=hasAnyRecords?'0 matching records':'0 records';
      refreshIcons();
      return;
    }
    tbody.innerHTML=records.map(r=>{
      const status=r.status||'Active', total=r.totalValue!=null?(Number(r.totalValue)||0):(Number(r.quantity)||0)*(Number(r.unitCost)||0);
      return `<tr>
        <td><div class="record-primary font-mono">${escapeHtml(r.controlNo||'---')}</div><div class="record-secondary font-mono">${escapeHtml(r.icsNo||'---')}</div></td>
        <td><div class="record-primary">${escapeHtml(r.article||'Uncategorized')}</div><div class="record-secondary item-description" title="${escapeHtml(r.itemDescription||'')}">${escapeHtml(r.itemDescription||'---')}</div></td>
        <td class="font-mono">${escapeHtml(r.serialNo||'---')}</td><td>${formatNumber(r.quantity||0)} ${escapeHtml(r.unit||'unit')}</td><td class="font-mono">${formatMoney(total)}</td>
        <td><div class="record-primary">${escapeHtml(r.accountablePerson||'---')}</div><div class="record-secondary">${escapeHtml(r.division||'')}</div>${r.submissionSource==='user'?`<div class="record-secondary submission-origin">Staff form · ${escapeHtml(r.submittedBy||'Staff member')}</div>`:''}</td>
        <td>${escapeHtml(formatDate(r.dateAcquired))}</td><td><span class="status-badge ${status==='Pending'?'pending':status==='Archived'?'archived':'active'}">${escapeHtml(status==='Pending'?'Pending review':status)}</span></td>
        <td><div class="row-actions"><button class="row-btn" type="button" title="View" data-action="view" data-id="${escapeHtml(r.id)}"><i data-lucide="eye"></i></button><button class="row-btn edit" type="button" title="Edit" data-action="edit" data-id="${escapeHtml(r.id)}"><i data-lucide="square-pen"></i></button><button class="row-btn delete" type="button" title="Delete" data-action="delete" data-id="${escapeHtml(r.id)}"><i data-lucide="trash-2"></i></button></div></td>
      </tr>`;
    }).join('');
    if($('recordCounter')) $('recordCounter').textContent=`Showing ${records.length.toLocaleString()} of ${state.records.length.toLocaleString()} records`; refreshIcons();
  }
  function applyFilters(){ renderTable(getFilteredRecords()); }

  async function loadRecords(){
    const version=++loadVersion;
    try{const rows=await window.PGENRO_ICS.list();if(version!==loadVersion)return false;state.records=rows;sortRecords();setDatabaseStatus(true);M.observeRecords('ICS slips',rows);updateKpis();populateFilters();applyFilters();if(viewModal.classList.contains('open')){const record=activeRecord();if(record)openView(record);else closeView();}return true;}
    catch(error){if(version!==loadVersion)return false;setDatabaseStatus(false);updateKpis();populateFilters();applyFilters();toast(error.message||'ICS registry could not refresh.','error');return false;}
  }
  function attachRealtime(){loadRecords();document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadRecords();});window.addEventListener('online',()=>loadRecords());if(M.client())channel=M.client().channel('admin-ics').on('postgres_changes',{event:'*',schema:'public',table:'ics_records'},loadRecords).subscribe();$('refreshIcsBtn').onclick=async()=>{$('refreshIcsBtn').disabled=true;try{if(await loadRecords())toast('ICS registry refreshed.');}finally{$('refreshIcsBtn').disabled=false;}};}

  /* View modal */
  function setText(id,value){ if($(id)) $(id).textContent=value; }
  function openView(record){
    state.activeRecordId=record.id; const total=record.totalValue!=null?(Number(record.totalValue)||0):(Number(record.quantity)||0)*(Number(record.unitCost)||0);
    setText('viewTitle',record.controlNo||'ICS Record Details'); setText('viewArticle',record.article||'---'); setText('viewDescription',record.itemDescription||'---'); setText('viewControlNo',record.controlNo||'---'); setText('viewIcsNo',record.icsNo||'---'); setText('viewAccountCode',record.accountCode||'---'); setText('viewEntryNo',record.entryNo||'---'); setText('viewSerialNo',record.serialNo||'---'); setText('viewItemNo',record.itemNo||'---'); setText('viewQty',formatNumber(record.quantity||0)); setText('viewUnit',record.unit||'unit'); setText('viewUnitCost',formatMoney(record.unitCost)); setText('viewTotalValue',formatMoney(total)); setText('viewDateAcquired',formatDate(record.dateAcquired)); setText('viewPrNo',record.prNo||'---'); setText('viewPrDate',formatDate(record.prDate)); setText('viewFundCluster',record.fundCluster||'---'); setText('viewAccountable',record.accountablePerson||'---'); setText('viewDivision',record.division||'---'); setText('viewRemarks',record.remarks||'No remarks.');
    setText('viewSubmittedBy',record.submittedBy||'—'); setText('viewSubmittedAt',record.submittedAt?new Date(record.submittedAt).toLocaleString('en-PH'):'—'); $('approveIcsBtn').hidden=record.status!=='Pending';
    const status=record.status||'Active', badge=$('viewStatus'); if(badge){ badge.textContent=status==='Pending'?'Pending review':status; badge.className=`status-badge ${status==='Pending'?'pending':status==='Archived'?'archived':'active'}`; }
    setModalOpen(viewModal,true);
  }
  function closeView(){ setModalOpen(viewModal,false); state.activeRecordId=null; }
  function activeRecord(){ return state.records.find(r=>r.id===state.activeRecordId) || null; }

  async function deleteRecord(record){
    if(!record) return; if(!state.dbReady||!state.db){ toast('Database is not connected. Delete is unavailable.','error'); return; }
    const label=record.controlNo||record.icsNo||record.id; if(!confirm(`Delete ICS record "${label}"?\n\nThis permanently removes the record.`)) return;
    try{ await window.PGENRO_ICS.remove(record.id);state.records=state.records.filter(r=>String(r.id)!==String(record.id));updateKpis();populateFilters();applyFilters();if(viewModal.classList.contains('open'))closeView();M.audit('DELETE_RECORD',`ICS ${label}`);toast('ICS record deleted.'); }
    catch(err){ console.error('Delete ICS error:',err); toast(`Delete failed${err?.message?': '+err.message:'.'}`,'error'); }
  }

  async function approveRecord(){
    const record=activeRecord(); if(!record||record.status!=='Pending'||saving)return;
    const button=$('approveIcsBtn'); saving=true; viewModal.dataset.busy='true'; button.disabled=true; button.textContent='Approving…';
    try {
      const saved=await window.PGENRO_ICS.save({...record,status:'Active'},record.id);
      state.records=state.records.map(row=>row.id===saved.id?saved:row);
      updateKpis();populateFilters();applyFilters();openView(saved);
      toast('ICS submission approved. The user registry will show it as Active.');
      M.audit('APPROVE_ICS',`ICS ${saved.controlNo}`);
    }catch(error){toast(error.message||'This submission could not be approved.','error');}
    finally{saving=false;viewModal.dataset.busy='false';button.disabled=false;button.innerHTML='<i data-lucide="check"></i> Approve ICS';refreshIcons();}
  }

  function bindRegistry(){
    $('approveIcsBtn')?.addEventListener('click',approveRecord);
    const search=$('icsSearchInput'), global=$('globalSearchInput'); search?.addEventListener('input',()=>{ if(global && global.value!==search.value) global.value=search.value; applyFilters(); }); global?.addEventListener('input',()=>{ if(search) search.value=global.value; applyFilters(); });
    $('articleFilter')?.addEventListener('change',applyFilters); $('divisionFilter')?.addEventListener('change',applyFilters);
    $$('.view-tab').forEach(btn=>btn.addEventListener('click',()=>{ $$('.view-tab').forEach(x=>x.classList.remove('active')); btn.classList.add('active'); state.statusFilter=btn.dataset.statusFilter||'ALL'; applyFilters(); }));
    $('clearFiltersBtn')?.addEventListener('click',()=>{ if(search) search.value=''; if(global) global.value=''; if($('articleFilter')) $('articleFilter').value='ALL'; if($('divisionFilter')) $('divisionFilter').value='ALL'; state.statusFilter='ALL'; $$('.view-tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.statusFilter==='ALL')); applyFilters(); });
    $('icsTableBody')?.addEventListener('click',(e)=>{ const btn=e.target.closest('[data-action]'); if(!btn) return; const record=state.records.find(r=>String(r.id)===String(btn.dataset.id)); if(!record) return; if(btn.dataset.action==='view') openView(record); else if(btn.dataset.action==='edit') openEditor(record); else if(btn.dataset.action==='delete') deleteRecord(record); });
    $('closeViewBtn')?.addEventListener('click',closeView); viewModal?.addEventListener('click',(e)=>{ if(e.target===viewModal) closeView(); });
    $('editViewBtn')?.addEventListener('click',()=>{ const r=activeRecord(); if(r){ closeView(); openEditor(r); } }); $('deleteViewBtn')?.addEventListener('click',async()=>{ const r=activeRecord(); if(r){ await deleteRecord(r); } }); $('printViewBtn')?.addEventListener('click',()=>{ const r=activeRecord(); if(r) printRecord(r); });
    $('exportCsvBtn')?.addEventListener('click',exportCsv);
  }

  function exportCsv(){
    const list=getFilteredRecords();if(!list.length){ toast('There are no ICS records to export.','warning'); return; }
    const headers=['Control No.','ICS No.','Entry No.','Account Code','Article','Item Description','Serial No.','Item / Inventory No.','Unit','Quantity','Unit Cost','Total Value','Date Acquired','PR No.','PR Date','Fund Cluster','Person Accountable','Division / Unit','Status','Remarks','Submitted By','Submitted On','Submission Source'];
    const rows=list.map(r=>[r.controlNo,r.icsNo,r.entryNo,r.accountCode,r.article,r.itemDescription,r.serialNo,r.itemNo,r.unit,r.quantity,r.unitCost,r.totalValue!=null?r.totalValue:(Number(r.quantity)||0)*(Number(r.unitCost)||0),r.dateAcquired,r.prNo,r.prDate,r.fundCluster,r.accountablePerson,r.division,r.status||'Active',r.remarks,r.submittedBy,r.submittedAt,r.submissionSource]);
    M.csv([headers,...rows],`PGENRO_ICS_${M.today()}.csv`);M.audit('EXPORT_RECORDS',`${list.length} ICS records exported`);toast('CSV export generated.');
  }

  function printRecord(record){
    const qty=Number(record.quantity||0), cost=Number(record.unitCost||0), total=record.totalValue!=null?(Number(record.totalValue)||0):qty*cost, w=window.open('','_blank','width=1100,height=850');
    if(!w){ toast('Please allow pop-ups to print this ICS record.','warning'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>ICS - ${escapeHtml(record.icsNo||record.controlNo||'Record')}</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0}.sheet{border:1px solid #111;padding:16px}.appendix{text-align:right;font-size:11px;font-weight:700}.header{text-align:center}.header h1{font-size:22px;margin:3px 0}.agency{font-weight:700;font-size:13px}.sub{font-size:10px}.meta{display:grid;grid-template-columns:1fr 1fr;margin-top:14px;border-left:1px solid #111;border-top:1px solid #111}.meta div{padding:7px;border-right:1px solid #111;border-bottom:1px solid #111;font-size:10px}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border:1px solid #111;padding:7px;font-size:10px;vertical-align:top}th{background:#eee}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:70px;margin-top:42px}.line{height:28px;border-bottom:1px solid #111;text-align:center}.sig{text-align:center;font-size:10px;margin-top:4px}.remarks{margin-top:10px;font-size:10px}</style></head><body><div class="sheet"><div class="appendix">Appendix 59</div><div class="header"><h1>INVENTORY CUSTODIAN SLIP</h1><div class="agency">PROVINCIAL GOVERNMENT ENVIRONMENT &amp; NATURAL RESOURCES OFFICE (PGENRO)</div><div class="sub">Republic of the Philippines</div></div><div class="meta"><div><b>Control No.:</b> ${escapeHtml(record.controlNo||'---')}</div><div><b>ICS No.:</b> ${escapeHtml(record.icsNo||'---')}</div><div><b>Account Code:</b> ${escapeHtml(record.accountCode||'---')}</div><div><b>Fund Cluster:</b> ${escapeHtml(record.fundCluster||'General Fund (01)')}</div><div><b>Review status:</b> ${escapeHtml(record.status==='Pending'?'Pending review':record.status||'Active')}</div></div><table><thead><tr><th>Qty</th><th>Unit</th><th>Unit Cost</th><th>Total Value</th><th>Article / Description / Serial</th><th>Inventory No.</th><th>Date Acquired</th></tr></thead><tbody><tr><td>${escapeHtml(formatNumber(qty))}</td><td>${escapeHtml(record.unit||'unit')}</td><td>${formatMoney(cost)}</td><td>${formatMoney(total)}</td><td><b>${escapeHtml(record.article||'')}</b><br>${escapeHtml(record.itemDescription||'')}<br>Serial: ${escapeHtml(record.serialNo||'---')}</td><td>${escapeHtml(record.itemNo||'---')}</td><td>${escapeHtml(formatDate(record.dateAcquired))}</td></tr></tbody></table><div class="remarks"><b>Person Accountable:</b> ${escapeHtml(record.accountablePerson||'---')} &nbsp; <b>Division:</b> ${escapeHtml(record.division||'---')}<br><br><b>Remarks:</b> ${escapeHtml(record.remarks||'None')}</div><div class="signatures"><div><div class="line"></div><div class="sig"><b>PGENRO PROPERTY CUSTODIAN</b><br>Supply &amp; Property Management Unit</div></div><div><div class="line"></div><div class="sig"><b>${escapeHtml(record.accountablePerson||'ACCOUNTABLE OFFICER')}</b><br>Signature over Printed Name</div></div></div></div><script>window.onload=()=>window.print()<\/script></body></html>`); w.document.close();
  }

  function bindKeyboard(){
    document.addEventListener('keydown',(e)=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){ e.preventDefault(); ($('icsSearchInput')||$('globalSearchInput'))?.focus(); return; }
      if(e.key==='Escape'){ if(editorModal?.classList.contains('open')) closeEditor(); else if(viewModal?.classList.contains('open')) closeView(); $('profileMenu')?.classList.remove('open'); }
    });
  }

  async function init(){
    refreshIcons();
    $('addIcsBtn').disabled=true;
    try {
      const profile=await window.PGENRO_ICS.requireProfile('admin');
      $('dropdownUserName').textContent=profile.full_name||profile.username||profile.authUser.email;
      $('dropdownUserEmail').textContent=profile.email||profile.authUser.email;
      bindForm(); bindRegistry(); bindKeyboard(); initDatabase(); updateTotals(); updateRemarksCounter(); updateProgress(); attachRealtime();
      $('addIcsBtn').disabled=false;
      if(new URLSearchParams(location.search).get('form')==='new'){
        await loadRecords();openEditor();const url=new URL(location.href);url.searchParams.delete('form');history.replaceState(null,'',url);
      }
    }catch(error){
      if(error.code==='ICS_SIGN_IN_REQUIRED')location.replace('../User/login.html?next=ics');
      else if(error.code==='ICS_ADMIN_REQUIRED')location.replace('../User/ics.html');
      else{setDatabaseStatus(false);applyFilters();toast(error.message||'ICS administrator access could not be verified.','error');}
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
  window.addEventListener('pagehide',(event)=>{if(event.persisted)return;loadVersion++;if(channel)M.client()?.removeChannel(channel);});
})();


/* Page-owned workspace interactions. No additional shared application file. */
(() => {
  'use strict';
  function init() {
    const M = window.PGENRO_Module;
    if (!M) return;
    const $ = id => document.getElementById(id);
    const modal = $('workspaceJumpModal'), input = $('workspaceJumpSearch'), results = $('workspaceJumpResults');
    const links = [...document.querySelectorAll('.sidebar-nav a[href]')].map(a => ({
      name: a.textContent.trim(), href: a.getAttribute('href'), icon: a.querySelector('svg')?.outerHTML || '',
      group: a.closest('.nav-group')?.querySelector('.nav-label')?.textContent || 'Workspace'
    }));
    const isBusy = () => Boolean(document.querySelector('.modal-overlay.open[data-busy="true"],.modal-backdrop.open[data-busy="true"],.admin-modal.open[data-busy="true"]'));
    let active = -1;
    function render() {
      const query = input.value.trim().toLowerCase(), words = query.split(/\s+/).filter(Boolean);
      const matches = links.filter(a => words.every(word => `${a.name} ${a.group} ${a.href}`.toLowerCase().includes(word)));
      active = -1;
      results.innerHTML = matches.length ? matches.map(a => `<a class="workspace-jump-result" href="${M.escape(a.href)}">${a.icon}<span><strong>${M.escape(a.name)}</strong><small>${M.escape(a.group)}</small></span><span class="workspace-jump-arrow" aria-hidden="true">↗</span></a>`).join('') : '<p class="workspace-jump-empty">No matching module. Try “memo”, “inventory”, or “users”.</p>';
      $('workspaceJumpCount').textContent = `${matches.length} destination${matches.length === 1 ? '' : 's'}`;
    }
    function open() {
      if (isBusy()) return;
      // Keep a record draft open; the module switcher is intended for the workspace.
      if (document.querySelector('.modal-overlay.open,.modal-backdrop.open,.admin-modal.open')) return;
      input.value = ''; render(); M.openModal('workspaceJumpModal'); input.focus();
    }
    $('workspaceJumpBtn')?.addEventListener('click', open);
    $('workspaceJumpClose')?.addEventListener('click', () => M.closeModal('workspaceJumpModal'));
    input?.addEventListener('input', render);
    modal?.addEventListener('keydown', event => {
      const items = [...results.querySelectorAll('a')];
      if (['ArrowDown','ArrowUp','Home','End'].includes(event.key) && items.length) {
        event.preventDefault();
        active = event.key === 'Home' ? 0 : event.key === 'End' ? items.length-1 : active < 0 ? (event.key === 'ArrowUp' ? items.length-1 : 0) : (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((a,i) => a.classList.toggle('is-active', i === active));
        items[active].focus(); items[active].scrollIntoView({block:'nearest'});
      } else if (event.key === 'Enter' && event.target === input && items.length) {
        event.preventDefault(); items[Math.max(0,active)].click();
      }
    });
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (modal.classList.contains('open')) input.focus(); else open();
      }
    }, true);
    // Programmatic clicks must respect the same busy boundary as native inert content.
    document.addEventListener('click', event => {
      const busy = document.querySelector('.modal-overlay.open[data-busy="true"],.modal-backdrop.open[data-busy="true"],.admin-modal.open[data-busy="true"]');
      if (busy && !busy.contains(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    const busyObservers = [];
    document.querySelectorAll('.modal-overlay,.modal-backdrop,.admin-modal').forEach(surface => {
      const dialog = surface.querySelector('[role="dialog"]'), form = surface.querySelector('form');
      if (!dialog || !surface.querySelector('.modal-header')) return;
      const status = document.createElement('p'); status.className = 'workspace-busy-message'; status.hidden = true; status.setAttribute('role','status');
      surface.querySelector('.modal-header').after(status);
      let locked = false, wasInert = false, focus = null;
      const update = () => {
        const busy = surface.dataset.busy === 'true'; dialog.setAttribute('aria-busy',String(busy)); status.hidden = !busy; status.textContent = busy ? 'Working… Please wait before making more changes.' : '';
        if (busy && !locked && form) { locked = true; wasInert = form.inert; focus = document.activeElement; form.inert = true; }
        if (!busy && locked) { locked = false; form.inert = wasInert; if (surface.classList.contains('open') && focus?.isConnected && !focus.disabled) focus.focus({preventScroll:true}); }
      };
      const observer = new MutationObserver(update); observer.observe(surface,{attributes:true,attributeFilter:['data-busy']}); busyObservers.push(observer); update();
    });
    window.addEventListener('pagehide', event => {if(!event.persisted)busyObservers.forEach(o => o.disconnect());});
    window.addEventListener('pageshow',event => {
      if(!event.persisted||document.querySelector('.modal-overlay.open,.modal-backdrop.open,.admin-modal.open'))return;
      const refresh=document.querySelector('#refreshBtn,#refreshMemosBtn,#syncCommunicationsBtn,#refreshUsersBtn,#refreshRequestsBtn,#refreshServicesBtn,#refreshIcsBtn');
      if(refresh&&!refresh.disabled)refresh.click();
    });
    const date = $('workspaceToday');
    if (date) {
      const updateDate = () => { const d = new Date(); date.dateTime = M.today(); date.textContent = d.toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric',year:'numeric'}); };
      updateDate(); document.addEventListener('visibilitychange', () => { if (!document.hidden) updateDate(); });
    }
    // Surface native validation messages beside the field, including after scrolling.
    document.addEventListener('invalid', event => {
      const field = event.target, group = field.closest('.form-group,.field-group');
      if (!group) return;
      field.setAttribute('aria-invalid','true');
      let message = group.querySelector('.workspace-field-error');
      if (!message) { message = document.createElement('span'); message.className = 'workspace-field-error'; message.id = `workspace-error-${M.uuid()}`; group.append(message); }
      message.textContent = field.validationMessage;
      const descriptions = new Set((field.getAttribute('aria-describedby') || '').split(' ').filter(Boolean)); descriptions.add(message.id); field.setAttribute('aria-describedby',[...descriptions].join(' '));
    }, true);
    document.addEventListener('input', event => {
      const field = event.target, group = field.closest?.('.form-group,.field-group'), message = group?.querySelector('.workspace-field-error');
      if (message && field.validity?.valid) { field.removeAttribute('aria-invalid'); field.setAttribute('aria-describedby',(field.getAttribute('aria-describedby') || '').split(' ').filter(id => id !== message.id).join(' ')); message.remove(); }
    });
    document.addEventListener('reset', event => {
      event.target.querySelectorAll('[aria-invalid="true"]').forEach(field => { field.removeAttribute('aria-invalid'); const message = field.closest('.form-group,.field-group')?.querySelector('.workspace-field-error'); if(message) { field.setAttribute('aria-describedby',(field.getAttribute('aria-describedby') || '').split(' ').filter(id => id !== message.id).join(' ')); message.remove(); } });
    });
    // Horizontal controls make wide registries usable on touch and keyboard screens.
    const observers = [];
    document.querySelectorAll('.table-responsive,.analytics-table-scroll,.table-scroll').forEach((region,index) => {
      if (!region.querySelector('table')) return;
      if (!region.id) region.id = `workspace-table-${index}`;
      region.setAttribute('tabindex','0'); region.setAttribute('role','region');
      if (!region.hasAttribute('aria-label')) region.setAttribute('aria-label','Registry table; scroll horizontally to see all columns');
      const controls = document.createElement('div'); controls.className = 'workspace-table-controls'; controls.hidden = true;
      controls.innerHTML = `<span>Scroll to see all columns</span><div><button type="button" aria-controls="${region.id}" aria-label="Scroll table left">←</button><button type="button" aria-controls="${region.id}" aria-label="Scroll table right">→</button></div>`;
      region.after(controls); const [left,right] = controls.querySelectorAll('button');
      let scheduled = 0;
      const measure = () => {
        scheduled = 0;
        const width = region.clientWidth, scrollWidth = region.scrollWidth, scrollLeft = region.scrollLeft;
        const hidden = scrollWidth <= width + 2, atStart = scrollLeft <= 2, atEnd = scrollLeft + width >= scrollWidth - 2;
        if (controls.hidden !== hidden) controls.hidden = hidden;
        if (left.disabled !== atStart) left.disabled = atStart;
        if (right.disabled !== atEnd) right.disabled = atEnd;
      };
      const update = () => { if (!scheduled) scheduled = requestAnimationFrame(measure); };
      window.addEventListener('pagehide', () => { if (scheduled) cancelAnimationFrame(scheduled); scheduled = 0; });
      const motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      left.onclick = () => region.scrollBy({left:-region.clientWidth*.75,behavior:motion}); right.onclick = () => region.scrollBy({left:region.clientWidth*.75,behavior:motion});
      region.addEventListener('scroll',update,{passive:true});
      if ('ResizeObserver' in window) { const resize = new ResizeObserver(update); resize.observe(region); resize.observe(region.querySelector('table')); observers.push(resize); }
      const changes = new MutationObserver(update); changes.observe(region,{childList:true,subtree:true}); observers.push(changes); update();
    });
    window.addEventListener('pagehide', event => {if(!event.persisted)observers.forEach(o => o.disconnect());});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();


/* PGENRO Modern Workspace: page-owned appearance and presentation enhancements. */
(() => {
  'use strict';
  function initModernWorkspace() {
    if (!document.querySelector('.page-heading-mark')) return;
    const renderIcons = () => window.PGENRO_Module?.renderIcons?.();
    const themeButton = document.getElementById('appearanceThemeBtn');
    const themeSelect = document.getElementById('appearanceThemeSelect');
    const preferenceKey = 'pgenro_admin_preferences';
    const themeKey = 'pgenro_admin_theme';
    function readPreferences() {
      try { const value = JSON.parse(localStorage.getItem(preferenceKey) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
      catch { return {}; }
    }
    function applyTheme(value, remember = false) {
      const theme = value === 'dark' ? 'dark' : 'light';
      document.documentElement.dataset.theme = theme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0f1d18' : '#f5f7f8');
      if (remember) { try { localStorage.setItem(themeKey, theme); } catch {} }
      if (themeButton) {
        const label = theme === 'dark' ? 'Switch to light appearance' : 'Switch to dark appearance';
        themeButton.setAttribute('aria-label', label);
        themeButton.setAttribute('aria-pressed', String(theme === 'dark'));
        themeButton.title = label;
        const icon = document.createElement('i');
        icon.dataset.lucide = theme === 'dark' ? 'sun' : 'moon';
        themeButton.replaceChildren(icon);
      }
      if (themeSelect) themeSelect.value = theme;
      renderIcons();
    }
    applyTheme(document.documentElement.dataset.theme);
    themeButton?.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true));
    themeSelect?.addEventListener('change', () => applyTheme(themeSelect.value, true));

    function syncDensity() {
      const compact = Boolean(readPreferences().compact);
      document.body.classList.toggle('compact-mode', compact);
      const existingToggle = document.getElementById('compactModeToggle');
      if (existingToggle) existingToggle.checked = compact;
      document.querySelectorAll('.modern-density-switch').forEach(button => {
        button.setAttribute('aria-pressed', String(compact));
        button.setAttribute('aria-label', compact ? 'Use comfortable table spacing' : 'Use compact table spacing');
        button.title = compact ? 'Use comfortable table spacing' : 'Use compact table spacing';
        button.querySelector('span').textContent = compact ? 'Compact' : 'Comfortable';
      });
    }
    document.querySelectorAll('.main-content .data-table, .main-content .analytics-table').forEach(table => {
      const wrapper = table.closest('.table-responsive, .table-wrap, .table-wrapper, .table-container, .analytics-table-scroll, .ws-table-scroll') || table;
      if (wrapper.dataset.modernTable) return;
      wrapper.dataset.modernTable = 'true';
      const toolbar = document.createElement('div');
      toolbar.className = 'modern-table-toolbar';
      toolbar.innerHTML = '<span class="modern-table-toolbar-label"><i data-lucide="columns-3"></i>Registry view</span><button class="modern-density-switch" type="button" aria-pressed="false"><i data-lucide="rows-3"></i><span>Comfortable</span></button>';
      wrapper.before(toolbar);
      toolbar.querySelector('button').addEventListener('click', () => {
        const preferences = readPreferences();
        preferences.compact = !document.body.classList.contains('compact-mode');
        try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); }
        catch { return; }
        syncDensity();
      });
    });
    syncDensity();
    document.getElementById('compactModeToggle')?.addEventListener('change', syncDensity);
    document.getElementById('resetAdminPrefsBtn')?.addEventListener('click', () => {
      try { localStorage.removeItem(themeKey); } catch {}
      applyTheme('light'); syncDensity();
    });
    window.addEventListener('storage', event => {
      if (event.key === themeKey || event.key === null) applyTheme(event.newValue);
      if (event.key === preferenceKey || event.key === null) syncDensity();
    });

    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebarCollapseBtn');
    let currentSidebarIcon = '';
    function syncSidebarIcon() {
      if (!sidebar || !sidebarToggle) return;
      const mobile = innerWidth <= 900;
      const name = mobile ? 'x' : sidebar.classList.contains('collapsed') ? 'panel-left-open' : 'panel-left-close';
      if (name !== currentSidebarIcon) {
        currentSidebarIcon = name;
        const icon = document.createElement('i'); icon.dataset.lucide = name;
        const label=document.createElement('span');label.className='navigation-button-label';label.textContent='Menu';sidebarToggle.replaceChildren(icon,label); renderIcons();
      }
      if (mobile) { sidebarToggle.setAttribute('aria-label', 'Close navigation'); sidebarToggle.title = 'Close navigation'; }
    }
    syncSidebarIcon();
    const sidebarObserver = typeof MutationObserver === 'function' ? new MutationObserver(syncSidebarIcon) : null;
    if (sidebar) sidebarObserver?.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', syncSidebarIcon);

    function enhanceEmptyStates() {
      document.querySelectorAll('.main-content .data-table tbody tr:only-child td[colspan]').forEach(cell => {
        if (cell.dataset.modernEmpty || cell.childElementCount) return;
        const message = cell.textContent.trim();
        if (!message || !/\b(no |not found|empty|waiting|loading|unavailable|failed|error)/i.test(message)) return;
        cell.dataset.modernEmpty = 'true';
        const content = document.createElement('div'); content.className = 'modern-empty-state';
        const icon = document.createElement('i'); icon.dataset.lucide = /failed|error|unavailable/i.test(message) ? 'file-search' : 'inbox';
        const copy = document.createElement('p'); copy.textContent = message;
        content.append(icon, copy); cell.replaceChildren(content);
      });
    }
    enhanceEmptyStates();
    const profileName = document.getElementById('dropdownUserName');
    const profileRole = document.getElementById('dropdownUserRole');
    const buttonName = document.querySelector('.profile-button-name');
    const buttonRole = document.querySelector('.profile-button-role');
    function syncProfileCopy() {
      if (buttonName && profileName) buttonName.textContent = profileName.textContent.trim() || 'PGENRO Admin';
      if (buttonRole && profileRole) buttonRole.textContent = profileRole.textContent.trim() || 'Administrator';
    }
    syncProfileCopy();
    const profileObserver = typeof MutationObserver === 'function' ? new MutationObserver(syncProfileCopy) : null;
    if (profileName) profileObserver?.observe(profileName, { childList: true, characterData: true, subtree: true });
    if (profileRole) profileObserver?.observe(profileRole, { childList: true, characterData: true, subtree: true });

    // Keep the genuine seal when available; show a simple letter mark if missing.
    const seal = document.querySelector('.logo-image');
    function showSealFallback() {
      if (!seal || !seal.parentElement) return;
      seal.hidden = true;
      const host = seal.parentElement;
      host.classList.add('logo-fallback');
      if (!host.querySelector('.logo-fallback-mark')) {
        const mark = document.createElement('span');
        mark.textContent = 'P';
        mark.className = 'logo-fallback-mark';
        host.append(mark);
        renderIcons();
      }
    }
    seal?.addEventListener('error', showSealFallback);
    if (seal?.complete && !seal.naturalWidth) showSealFallback();
    renderIcons();

    // Table rows, OCR states and attachment controls create icons after page load.
    const iconObserver = typeof MutationObserver === 'function' ? new MutationObserver(records => {
      const hasIcons = records.some(record => [...record.addedNodes].some(node =>
        node.nodeType === 1 && (node.matches('i[data-lucide]') || node.querySelector('i[data-lucide]'))
      ));
      if (hasIcons) renderIcons();
      if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches('tr,tbody') || node.querySelector('tbody'))))) enhanceEmptyStates();
    }) : null;
    iconObserver?.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('pagehide', event => { if (!event.persisted) { profileObserver?.disconnect(); iconObserver?.disconnect(); sidebarObserver?.disconnect(); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initModernWorkspace, { once: true });
  else initModernWorkspace();
})();

/* ===== PGENRO SLIDE NAVIGATION AND LOGOUT · module-owned presentation ===== */
(() => {
  'use strict';
  function initWorkspaceNavigation() {
    const body = document.body;
    if (!body?.classList.contains('depth-workspace') || body.dataset.navigationReady) return;
    body.dataset.navigationReady = 'true';
    const surface = document.querySelector('main');
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = () => media.matches || body.classList.contains('pgenro-reduced-motion');
    let navigationPending = false, navigationTimer = 0, entranceTimer = 0;

    function resetTransition() {
      clearTimeout(entranceTimer);
      clearTimeout(navigationTimer);
      navigationPending = false;
      surface?.classList.remove('workspace-slide-enter', 'workspace-slide-leave');
      body.classList.remove('workspace-transitioning');
      body.dataset.pageTransition = 'idle';
    }
    function enter() {
      resetTransition();
      if (!surface || reduced()) return;
      body.classList.add('workspace-transitioning');
      body.dataset.pageTransition = 'entering';
      surface.classList.add('workspace-slide-enter');
      entranceTimer = setTimeout(resetTransition, 280);
    }
    // One short compositor animation, with no continuous rendering loop.
    enter();
    window.addEventListener('pageshow', event => { if (event.persisted) enter(); });
    media.addEventListener?.('change', () => { if (!navigationPending) resetTransition(); });

    window.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self') || link.getAttribute('aria-disabled') === 'true') return;
      const destination = new URL(link.href, location.href);
      if (destination.origin !== location.origin || !/\/(?:admin|User|SettingIMS)\/[^/]+\.html$/i.test(destination.pathname)) return;
      if (destination.pathname === location.pathname && destination.search === location.search) return;
      event.preventDefault();
      if (navigationPending || document.querySelector('dialog[open]')) return;
      navigationPending = true;
      clearTimeout(entranceTimer);
      const go = () => location.assign(destination.href);
      if (reduced() || !surface) { go(); return; }
      surface.classList.remove('workspace-slide-enter');
      surface.classList.add('workspace-slide-leave');
      body.classList.add('workspace-transitioning');
      body.dataset.pageTransition = 'leaving';
      navigationTimer = setTimeout(go, 140);
    });

    let dialog = null, resolveConfirmation = null, confirmationPromise = null, busy = false, returnFocus = null;
    function setBusy(value) {
      busy = value;
      dialog.classList.toggle('is-busy', value);
      dialog.setAttribute('aria-busy', String(value));
      dialog.querySelector('[data-workspace-logout-cancel]').disabled = value;
      dialog.querySelector('[data-workspace-logout-confirm]').disabled = value;
      dialog.querySelector('[data-workspace-logout-confirm] span').textContent = value ? 'Logging out…' : 'Yes, log out';
    }
    function dismiss() {
      if (busy) return;
      const done = resolveConfirmation;
      resolveConfirmation = null; confirmationPromise = null;
      dialog.close();
      body.classList.remove('workspace-logout-open');
      done?.(false);
      if (returnFocus?.isConnected && returnFocus.getClientRects().length && !returnFocus.closest('[inert]')) returnFocus.focus({preventScroll: true});
      else document.querySelector('#profileBtn, [data-pgenro-logout]')?.focus({preventScroll: true});
    }
    function confirmLogout() {
      if (busy) return;
      dialog.querySelector('.workspace-logout-error').textContent = '';
      setBusy(true);
      if (resolveConfirmation) {
        const done = resolveConfirmation; resolveConfirmation = null; done(true);
      } else {
        // Retry uses the existing session gateway; never opens a second prompt.
        window.PGENRO_API?.signOut?.({confirm: false, ask: false});
      }
    }
    function createDialog() {
      if (dialog) return;
      dialog = document.createElement('dialog');
      dialog.id = 'workspaceLogoutDialog';
      dialog.className = 'workspace-logout-dialog';
      dialog.setAttribute('aria-labelledby', 'workspaceLogoutTitle');
      dialog.setAttribute('aria-describedby', 'workspaceLogoutDescription');
      dialog.innerHTML = `
        <div class="workspace-logout-content">
          <div class="workspace-logout-heading"><span class="workspace-logout-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></svg></span><span class="workspace-logout-brand">PGENRO IMS<span>Secure workspace</span></span></div>
          <h2 id="workspaceLogoutTitle">Log out of your workspace?</h2>
          <p id="workspaceLogoutDescription">You’ll need to sign in again to access your records and office modules.</p>
          <p class="workspace-logout-error" role="alert"></p>
          <div class="workspace-logout-actions"><button type="button" class="workspace-logout-cancel" data-workspace-logout-cancel autofocus>Cancel</button><button type="button" class="workspace-logout-confirm" data-workspace-logout-confirm><span>Yes, log out</span></button></div>
        </div>`;
      body.appendChild(dialog);
      dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
      dialog.addEventListener('click', event => {
        event.stopPropagation();
        if (event.target.closest('[data-workspace-logout-cancel]')) dismiss();
        else if (event.target.closest('[data-workspace-logout-confirm]')) confirmLogout();
        else if (event.target === dialog) {
          const rect = dialog.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
        }
      });
    }
    // The auth gateway asks this page-owned UI for confirmation before signing out.
    window.PGENRO_ConfirmLogout = () => {
      if (confirmationPromise) return confirmationPromise;
      createDialog();
      returnFocus = document.activeElement;
      dialog.querySelector('.workspace-logout-error').textContent = '';
      setBusy(false);
      confirmationPromise = new Promise(resolve => { resolveConfirmation = resolve; });
      if (!dialog.open) dialog.showModal();
      body.classList.add('workspace-logout-open');
      dialog.querySelector('[data-workspace-logout-cancel]').focus({preventScroll: true});
      return confirmationPromise;
    };
    window.addEventListener('pgenro:logout-error', () => {
      if (!dialog?.open) return;
      confirmationPromise = null; resolveConfirmation = null;
      setBusy(false);
      dialog.querySelector('.workspace-logout-error').textContent = 'Could not log out. Check your connection and try again.';
      dialog.querySelector('[data-workspace-logout-confirm]').focus({preventScroll: true});
    });
    window.addEventListener('keydown', event => {
      if (!dialog?.open) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); dismiss();
      } else if (event.key === 'Tab') {
        const buttons = [...dialog.querySelectorAll('button:not(:disabled)')];
        if (!buttons.length) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
      }
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initWorkspaceNavigation, {once: true});
  else initWorkspaceNavigation();
})();
/* ===== END PGENRO SLIDE NAVIGATION AND LOGOUT ===== */

/* PGENRO module notifications, 10 October 2026. */
/* Module-owned notifications: copies live inside each workspace page script. */
(() => {
  'use strict';
  if (window.PGENRO_Notifications) return;
  const modules = {
    communications:['Communications','admincommunication.html','communication.html'],
    travel_orders:['Travel Orders','travelOR-admin.html','travelOR.html'],
    office_memos:['Office Memos','officememo-admin.html','officememo.html'],
    employees:['Employees','employee-admin.html','employee.html'],
    inventory:['Inventory','invetoryadmin.html','inventory.html'],
    visitors:['Visitors','visitors-admin.html','visitorsView.html'],
    service_requests:['Service Requests','serviceAdmin.html','service.html'],
    ics_records:['Property Slips','ics-admin.html','ics.html'],
    user_accounts:['User Management','Usermanagement.html',null],
    account_requests:['Account Requests','requestacc.html',null]
  };
  const empty=()=>({total:0,counts:{},items:[],workspace:'user'});
  let feed=empty(),status='loading',db,userId='',generation=0,loading=false,again=false,disposed=false;
  let wrapper,button,panel,list,count,markAll,badge,channel,timer,debounce,authSubscription;
  const element=(tag,className,text)=>{const el=document.createElement(tag);el.className=className||'';if(text!==undefined)el.textContent=text;return el;};
  function destination(module){
    const info=modules[module],admin=feed.workspace==='admin',file=info?.[admin?1:2];
    return file?new URL(`../${admin?'admin':'User'}/${file}`,location.href).href:null;
  }
  function render(){
    if(!button)return;
    const total=Number(feed.total)||0;
    badge.textContent=total>99?'99+':String(total);badge.hidden=!total;
    count.textContent=`${total} unread`;markAll.disabled=!total||status!=='ready';
    button.setAttribute('aria-label',`Notifications${total?`, ${total} unread`:''}`);
    list.replaceChildren();
    if(status==='loading')list.append(element('p','module-notification-empty','Loading notifications…'));
    else if(status==='unavailable')list.append(element('p','module-notification-empty','Notifications are unavailable. Try again.'));
    else if(!total)list.append(element('p','module-notification-empty','No new notifications'));
    for(const item of feed.items||[]){
      const href=destination(item.module);if(!href)continue;
      const link=element('a','module-notification-item');link.href=href;link.dataset.notificationId=item.id;
      const dot=element('span','module-notification-dot');dot.setAttribute('aria-hidden','true');
      const copy=element('span','module-notification-copy');copy.append(element('strong','',modules[item.module][0]));
      copy.append(element('span','module-notification-title',item.title||'New record added'));
      const date=new Date(item.createdAt);copy.append(element('small','',Number.isNaN(date.getTime())?'New record':date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})));
      link.append(dot,copy);link.addEventListener('click',async event=>{
        event.preventDefault();link.setAttribute('aria-busy','true');
        try{await markRead({p_ids:[item.id]});}catch{/* The destination remains usable if marking read fails. */}
        location.assign(href);
      });list.append(link);
    }
    if(total>(feed.items||[]).length&&status==='ready')list.append(element('p','module-notification-more',`Showing the latest ${(feed.items||[]).length} new records`));
    document.querySelectorAll('aside a[href], .sidebar a[href]').forEach(link=>{
      const path=new URL(link.getAttribute('href'),location.href).pathname;
      const module=Object.keys(modules).find(key=>destination(key)&&new URL(destination(key)).pathname===path);
      let chip=link.querySelector('.module-new-badge');
      if(!module){chip?.remove();return;}
      const value=Number(feed.counts?.[module])||0;
      if(!chip){chip=element('span','module-new-badge');link.append(chip);}
      chip.dataset.module=module;chip.hidden=!value;chip.textContent=value>99?'99+':String(value);
      chip.setAttribute('aria-label',`${value} new ${modules[module][0]} records`);
    });
    document.body.dataset.notificationsState=status;
  }
  function close(){if(!panel)return;panel.hidden=true;button.setAttribute('aria-expanded','false');}
  function position(){
    const rect=button.getBoundingClientRect(),width=Math.min(390,innerWidth-24);
    panel.style.width=`${width}px`;panel.style.right=`${Math.min(Math.max(12,innerWidth-rect.right),innerWidth-width-12)}px`;
    panel.style.top=`${Math.min(Math.max(12,rect.bottom+10),innerHeight-160)}px`;
  }
  async function refresh(){
    if(disposed||!db||!userId)return;
    if(loading){again=true;return;}
    loading=true;const token=generation;
    try{
      const result=await db.rpc('pgenro_get_module_notifications',{p_limit:30});
      if(token!==generation||disposed)return;
      if(result.error)throw result.error;
      const data=result.data;
      if(!data||!Array.isArray(data.items)||typeof data.counts!=='object')throw new Error('Invalid notification response');
      feed=data;status='ready';render();
    }catch{if(token===generation&&!disposed){feed=empty();status='unavailable';render();}}
    finally{loading=false;if(again){again=false;scheduleRefresh();}}
  }
  function scheduleRefresh(){clearTimeout(debounce);debounce=setTimeout(refresh,250);}
  async function markRead(args={}){
    const result=await db.rpc('pgenro_mark_notifications_read',args);if(result.error)throw result.error;
    await refresh();
  }
  async function attachSession(user){
    if(disposed)return;
    if(!user?.id){generation++;userId='';feed=empty();status='unavailable';close();render();if(channel)db.removeChannel(channel);channel=null;return;}
    if(userId===user.id){scheduleRefresh();return;}
    generation++;userId=user.id;feed=empty();status='loading';render();
    if(channel)db.removeChannel(channel);
    channel=db.channel(`pgenro-module-notifications-${user.id}`)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'pgenro_module_notifications'},scheduleRefresh)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'pgenro_notification_reads',filter:`user_id=eq.${user.id}`},scheduleRefresh)
      .subscribe(state=>{if(state==='SUBSCRIBED')scheduleRefresh();});
    await refresh();
  }
  function init(){
    const header=document.querySelector('.topbar-right,.depth-topbar-actions,.settings-topbar');if(!header)return;
    document.getElementById('notificationsBtn')?.closest('.notification-wrapper')?.remove();
    wrapper=element('div','module-notifications');button=element('button','module-notification-button');button.type='button';button.id='moduleNotificationButton';
    button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','moduleNotificationPanel');
    button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>';
    badge=element('span','module-notification-badge');badge.hidden=true;button.append(badge);wrapper.append(button);
    if(header.classList.contains('settings-topbar'))header.insertBefore(wrapper,header.lastElementChild);else header.prepend(wrapper);
    panel=element('section','module-notification-panel');panel.id='moduleNotificationPanel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','moduleNotificationTitle');
    const top=element('div','module-notification-heading'),heading=element('div');const title=element('h3','','Notifications');title.id='moduleNotificationTitle';
    count=element('small','','0 unread');count.setAttribute('aria-live','polite');heading.append(title,count);
    const closeBtn=element('button','module-notification-close','×');closeBtn.type='button';closeBtn.setAttribute('aria-label','Close notifications');closeBtn.onclick=()=>{close();button.focus();};top.append(heading,closeBtn);
    const tools=element('div','module-notification-tools'),retry=element('button','','Refresh');retry.type='button';retry.onclick=refresh;
    markAll=element('button','','Mark all read');markAll.type='button';markAll.onclick=async()=>{markAll.disabled=true;try{await markRead();}catch{count.textContent='Could not mark read. Try again.';}finally{markAll.disabled=!feed.total;}};
    tools.append(retry,markAll);list=element('div','module-notification-list');panel.append(top,tools,list);document.body.append(panel);
    button.addEventListener('click',()=>{const open=panel.hidden;close();if(open){panel.hidden=false;position();button.setAttribute('aria-expanded','true');closeBtn.focus();refresh();}});
    document.addEventListener('click',event=>{if(!wrapper.contains(event.target)&&!panel.contains(event.target))close();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){close();button.focus();}});
    window.addEventListener('resize',()=>{if(!panel.hidden)position();});
    window.addEventListener('focus',scheduleRefresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleRefresh();});
    window.addEventListener('pageshow',event=>{if(event.persisted)scheduleRefresh();});
    render();db=window.pgenroSupabase||window.PGENRO_DB?.client;
    if(!db){status='unavailable';render();return;}
    db.auth.getUser().then(result=>attachSession(result.data?.user)).catch(()=>attachSession(null));
    const subscription=db.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>attachSession(session?.user),0);});authSubscription=subscription.data?.subscription;
    timer=setInterval(()=>{if(!document.hidden&&navigator.onLine!==false)refresh();},60000);
    window.addEventListener('pagehide',event=>{if(event.persisted)return;disposed=true;generation++;clearInterval(timer);clearTimeout(debounce);authSubscription?.unsubscribe();if(channel)db.removeChannel(channel);});
  }
  window.PGENRO_Notifications={refresh,scheduleRefresh};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

/* Page-owned layout helpers; do not change record permissions or data writes. */
(() => {
  'use strict';
  function init() {
    if (document.body.dataset.unifiedLayoutReady) return;
    document.body.dataset.unifiedLayoutReady = 'true';
    // A wide registry scrolls within its own region, including dynamically mounted tables.
    function containTables() {
      document.querySelectorAll('main table,.modal-body table,.modal-content table').forEach(table => {
        if (table.closest('.table-responsive,.table-wrapper,.table-container,.table-scroll,.responsive-table,.ui-table-scroll,.ws-table-scroll,.audit-table-scroll,.audit-scroll-box,.monitor-table-scroll')) return;
        const region = document.createElement('div'); region.className = 'ui-table-scroll';
        table.before(region); region.append(table);
      });
    }
    containTables();
    let tableFrame;
    const insertedTables = new MutationObserver(records => {
      if (!records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.tagName === 'TABLE' || node.querySelector?.('table'))))) return;
      cancelAnimationFrame(tableFrame); tableFrame = requestAnimationFrame(containTables);
    });
    insertedTables.observe(document.body, {childList:true,subtree:true});
    document.querySelector('.admin-sidebar-close')?.addEventListener('click',()=>document.getElementById('sidebarBackdrop')?.click());
    // Account Settings and the module pages use one saved user appearance.
    let appearanceObserver;
    if (document.body.classList.contains('pgenro-user')) {
      const html=document.documentElement, button=document.getElementById('userAppearanceBtn');
      const icon=dark=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${dark?'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>':'<path d="M20.9 12.5A9 9 0 1 1 11.5 3a6.3 6.3 0 0 0 9.4 9.5Z"/>'}</svg>`;
      function applyAppearance(theme) {
        theme=theme==='dark'?'dark':'light';
        if(html.dataset.theme!==theme)html.dataset.theme=theme;
        const dark=theme==='dark';
        if(button&&button.dataset.appearance!==theme) {
          button.dataset.appearance=theme;button.innerHTML=icon(dark);button.setAttribute('aria-pressed',String(dark));
          button.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');button.title=button.getAttribute('aria-label');
        }
        document.querySelector('meta[name="color-scheme"]')?.setAttribute('content',theme);
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#0d2119':'#f4f7f5');
      }
      let saved={};try{saved=JSON.parse(localStorage.getItem('pgenro_preferences')||'{}')||{};}catch{}
      let localTheme;try{localTheme=localStorage.getItem('pgenro_user_theme');}catch{}
      applyAppearance(localTheme||html.dataset.pgenroTheme||saved.theme||html.dataset.theme);
      appearanceObserver=new MutationObserver(()=>{let selected;try{selected=localStorage.getItem('pgenro_user_theme');}catch{}applyAppearance(selected||html.dataset.pgenroTheme||html.dataset.theme);});
      appearanceObserver.observe(html,{attributes:true,attributeFilter:['data-pgenro-theme']});
      button?.addEventListener('click',()=>{
        const theme=html.dataset.theme==='dark'?'light':'dark';
        try{const prefs=JSON.parse(localStorage.getItem('pgenro_preferences')||'{}')||{};localStorage.setItem('pgenro_preferences',JSON.stringify({...prefs,theme}));localStorage.setItem('pgenro_user_theme',theme);}catch{}
        const preferenceRadio=document.querySelector(`input[name="theme"][value="${theme}"]`);if(preferenceRadio)preferenceRadio.checked=true;
        html.dataset.pgenroTheme=theme;applyAppearance(theme);
      });
      window.addEventListener('storage',event=>{if(event.key==='pgenro_user_theme')applyAppearance(event.newValue);else if(event.key==='pgenro_preferences'){try{html.dataset.pgenroTheme=JSON.parse(event.newValue||'{}').theme||'light';}catch{}}});
    }
    // The existing user page controls continue to open and close its module menu.
    const sidebar = document.querySelector('.pgenro-user .sidebar');
    if (sidebar) {
      const media = matchMedia('(max-width: 900px)'), menu = document.getElementById('hamburgerMenu');
      let previouslyOpen = false;
      sidebar.querySelectorAll('.modules-list a').forEach(link=>link.title=link.textContent.trim());
      function desktopNavigation() {
        let collapsed=false;try{collapsed=localStorage.getItem('pgenro_user_sidebar')==='collapsed';}catch{}
        collapsed=!media.matches&&collapsed;
        sidebar.classList.toggle('collapsed',collapsed);document.body.classList.toggle('user-sidebar-collapsed',collapsed);
        if(!media.matches&&menu){menu.setAttribute('aria-expanded',String(!collapsed));menu.setAttribute('aria-label',collapsed?'Expand module menu':'Collapse module menu');menu.title=menu.getAttribute('aria-label');}
      }
      menu?.addEventListener('click',event=>{
        if(media.matches)return;
        event.preventDefault();event.stopImmediatePropagation();
        try{localStorage.setItem('pgenro_user_sidebar',sidebar.classList.contains('collapsed')?'expanded':'collapsed');}catch{}
        desktopNavigation();
      },true);
      function sync() {
        const open = media.matches && sidebar.classList.contains('open');
        sidebar.inert = media.matches && !open;
        sidebar.setAttribute('aria-hidden', String(media.matches && !open));
        if (open && !previouslyOpen) sidebar.querySelector('.user-sidebar-close,a[href]')?.focus({preventScroll:true});
        if (!open && previouslyOpen) menu?.focus({preventScroll:true});
        previouslyOpen = open;
      }
      const state = new MutationObserver(sync); state.observe(sidebar,{attributes:true,attributeFilter:['class']});
      media.addEventListener('change',()=>{desktopNavigation();sync();});desktopNavigation();sync();
      let navigationFrame;
      window.addEventListener('resize',()=>{cancelAnimationFrame(navigationFrame);navigationFrame=requestAnimationFrame(desktopNavigation);});
      window.addEventListener('pagehide',()=>cancelAnimationFrame(navigationFrame));
      document.querySelector('.user-sidebar-close')?.addEventListener('click',()=>{ if(sidebar.classList.contains('open')) menu?.click(); });
      document.addEventListener('keydown',event=>{
        if(!media.matches||!sidebar.classList.contains('open')) return;
        if(event.key==='Escape') {menu?.click();return;}
        if(event.key!=='Tab')return;
        const items=[...sidebar.querySelectorAll('a[href],button:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length && !el.closest('[inert]'));
        if(!items.length)return;
        const first=items[0],last=items.at(-1);
        if(!sidebar.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus();}
        else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      });
    }
    window.addEventListener('pagehide',event=>{if(event.persisted)return;insertedTables.disconnect();appearanceObserver?.disconnect();cancelAnimationFrame(tableFrame);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();


/* Module-owned consistent layout, viewport sizing, and dialog surfaces. */
(() => {
 'use strict';
 function initUnifiedUI(){
  if(document.body.dataset.unifiedUiBound)return;document.body.dataset.unifiedUiBound='true';
  let viewportFrame=0;
  const fit=()=>{viewportFrame=0;const height=window.visualViewport?.height||innerHeight;document.documentElement.style.setProperty('--ui-viewport-height',`${Math.round(height)}px`);};
  const scheduleFit=()=>{if(!viewportFrame)viewportFrame=requestAnimationFrame(fit);};fit();
  window.addEventListener('resize',scheduleFit,{passive:true});window.visualViewport?.addEventListener('resize',scheduleFit,{passive:true});
  // Assign the same surfaces without changing IDs, field mapping, or event handlers.
  document.querySelectorAll('.modal-overlay,.modal-backdrop').forEach(surface=>{
   surface.classList.add('unified-dialog-overlay');
   const dialog=surface.querySelector(':scope > [role="dialog"],:scope > .modal-card,:scope > .modal-container,:scope > .ics-modal');
   if(!dialog)return;dialog.classList.add('unified-dialog');
   dialog.querySelectorAll('.modal-header,.admin-modal-header,.ics-modal-header').forEach(el=>el.classList.add('unified-dialog-header'));
   dialog.querySelectorAll('.modal-body,.admin-modal-body,.ics-modal-body').forEach(el=>el.classList.add('unified-dialog-body'));
   dialog.querySelectorAll('.modal-actions,.modal-footer,.admin-modal-footer,.ics-modal-footer').forEach(el=>el.classList.add('unified-dialog-footer'));
  });
  const main=document.querySelector('main.main-content'),metrics=main?.querySelector(':scope > .kpi-grid,:scope > .audit-metrics');
  const quick=main?.querySelector(':scope > .quick-actions-strip,:scope > .quick-actions-section,:scope > .quick-actions-panel');
  if(metrics&&quick&&quick.compareDocumentPosition(metrics)&Node.DOCUMENT_POSITION_FOLLOWING)metrics.after(quick);
  // Only vertical chrome is standardized; each module retains its record actions.
  document.querySelectorAll('.modal-close,.modal-close-btn,.admin-modal-close').forEach(button=>{if(!button.hasAttribute('aria-label'))button.setAttribute('aria-label','Close dialog');});
  window.addEventListener('pagehide',event=>{if(!event.persisted&&viewportFrame)cancelAnimationFrame(viewportFrame);});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initUnifiedUI,{once:true});else initUnifiedUI();
})();

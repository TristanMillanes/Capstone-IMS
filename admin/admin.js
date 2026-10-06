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
  const icons = {"activity":[["path",{"d":"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"}]],"alert-circle":[["circle",{"cx":"12","cy":"12","r":"10"}],["line",{"x1":"12","x2":"12","y1":"8","y2":"12"}],["line",{"x1":"12","x2":"12.01","y1":"16","y2":"16"}]],"alert-triangle":[["path",{"d":"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}],["path",{"d":"M12 9v4"}],["path",{"d":"M12 17h.01"}]],"archive":[["rect",{"width":"20","height":"5","x":"2","y":"3","rx":"1"}],["path",{"d":"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"}],["path",{"d":"M10 12h4"}]],"archive-restore":[["rect",{"width":"20","height":"5","x":"2","y":"3","rx":"1"}],["path",{"d":"M4 8v11a2 2 0 0 0 2 2h2"}],["path",{"d":"M20 8v11a2 2 0 0 1-2 2h-2"}],["path",{"d":"m9 15 3-3 3 3"}],["path",{"d":"M12 12v9"}]],"arrow-down-left":[["path",{"d":"M17 7 7 17"}],["path",{"d":"M17 17H7V7"}]],"arrow-left":[["path",{"d":"m12 19-7-7 7-7"}],["path",{"d":"M19 12H5"}]],"arrow-left-right":[["path",{"d":"M8 3 4 7l4 4"}],["path",{"d":"M4 7h16"}],["path",{"d":"m16 21 4-4-4-4"}],["path",{"d":"M20 17H4"}]],"arrow-right":[["path",{"d":"M5 12h14"}],["path",{"d":"m12 5 7 7-7 7"}]],"arrow-up-down":[["path",{"d":"m21 16-4 4-4-4"}],["path",{"d":"M17 20V4"}],["path",{"d":"m3 8 4-4 4 4"}],["path",{"d":"M7 4v16"}]],"arrow-up-right":[["path",{"d":"M7 7h10v10"}],["path",{"d":"M7 17 17 7"}]],"award":[["path",{"d":"m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"}],["circle",{"cx":"12","cy":"8","r":"6"}]],"badge":[["path",{"d":"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"}]],"badge-check":[["path",{"d":"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"}],["path",{"d":"m9 12 2 2 4-4"}]],"bar-chart-3":[["path",{"d":"M3 3v16a2 2 0 0 0 2 2h16"}],["path",{"d":"M18 17V9"}],["path",{"d":"M13 17V5"}],["path",{"d":"M8 17v-3"}]],"bell":[["path",{"d":"M10.268 21a2 2 0 0 0 3.464 0"}],["path",{"d":"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"}]],"boxes":[["path",{"d":"M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"}],["path",{"d":"m7 16.5-4.74-2.85"}],["path",{"d":"m7 16.5 5-3"}],["path",{"d":"M7 16.5v5.17"}],["path",{"d":"M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"}],["path",{"d":"m17 16.5-5-3"}],["path",{"d":"m17 16.5 4.74-2.85"}],["path",{"d":"M17 16.5v5.17"}],["path",{"d":"M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"}],["path",{"d":"M12 8 7.26 5.15"}],["path",{"d":"m12 8 4.74-2.85"}],["path",{"d":"M12 13.5V8"}]],"briefcase":[["path",{"d":"M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"}],["rect",{"width":"20","height":"14","x":"2","y":"6","rx":"2"}]],"briefcase-business":[["path",{"d":"M12 12h.01"}],["path",{"d":"M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"}],["path",{"d":"M22 13a18.15 18.15 0 0 1-20 0"}],["rect",{"width":"20","height":"14","x":"2","y":"6","rx":"2"}]],"building-2":[["path",{"d":"M10 12h4"}],["path",{"d":"M10 8h4"}],["path",{"d":"M14 21v-3a2 2 0 0 0-4 0v3"}],["path",{"d":"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"}],["path",{"d":"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"}]],"calendar":[["path",{"d":"M8 2v4"}],["path",{"d":"M16 2v4"}],["rect",{"width":"18","height":"18","x":"3","y":"4","rx":"2"}],["path",{"d":"M3 10h18"}]],"calendar-arrow-down":[["path",{"d":"m14 18 4 4 4-4"}],["path",{"d":"M16 2v4"}],["path",{"d":"M18 14v8"}],["path",{"d":"M21 11.354V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7.343"}],["path",{"d":"M3 10h18"}],["path",{"d":"M8 2v4"}]],"calendar-arrow-up":[["path",{"d":"m14 18 4-4 4 4"}],["path",{"d":"M16 2v4"}],["path",{"d":"M18 22v-8"}],["path",{"d":"M21 11.343V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9"}],["path",{"d":"M3 10h18"}],["path",{"d":"M8 2v4"}]],"calendar-check-2":[["path",{"d":"M8 2v4"}],["path",{"d":"M16 2v4"}],["path",{"d":"M21 14V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8"}],["path",{"d":"M3 10h18"}],["path",{"d":"m16 20 2 2 4-4"}]],"calendar-clock":[["path",{"d":"M16 14v2.2l1.6 1"}],["path",{"d":"M16 2v4"}],["path",{"d":"M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"}],["path",{"d":"M3 10h5"}],["path",{"d":"M8 2v4"}],["circle",{"cx":"16","cy":"16","r":"6"}]],"calendar-days":[["path",{"d":"M8 2v4"}],["path",{"d":"M16 2v4"}],["rect",{"width":"18","height":"18","x":"3","y":"4","rx":"2"}],["path",{"d":"M3 10h18"}],["path",{"d":"M8 14h.01"}],["path",{"d":"M12 14h.01"}],["path",{"d":"M16 14h.01"}],["path",{"d":"M8 18h.01"}],["path",{"d":"M12 18h.01"}],["path",{"d":"M16 18h.01"}]],"calendar-off":[["path",{"d":"M4.2 4.2A2 2 0 0 0 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 1.82-1.18"}],["path",{"d":"M21 15.5V6a2 2 0 0 0-2-2H9.5"}],["path",{"d":"M16 2v4"}],["path",{"d":"M3 10h7"}],["path",{"d":"M21 10h-5.5"}],["path",{"d":"m2 2 20 20"}]],"calendar-range":[["rect",{"width":"18","height":"18","x":"3","y":"4","rx":"2"}],["path",{"d":"M16 2v4"}],["path",{"d":"M3 10h18"}],["path",{"d":"M8 2v4"}],["path",{"d":"M17 14h-6"}],["path",{"d":"M13 18H7"}],["path",{"d":"M7 14h.01"}],["path",{"d":"M17 18h.01"}]],"car-front":[["path",{"d":"m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8"}],["path",{"d":"M7 14h.01"}],["path",{"d":"M17 14h.01"}],["rect",{"width":"18","height":"8","x":"3","y":"10","rx":"2"}],["path",{"d":"M5 18v2"}],["path",{"d":"M19 18v2"}]],"chart-no-axes-combined":[["path",{"d":"M12 16v5"}],["path",{"d":"M16 14v7"}],["path",{"d":"M20 10v11"}],["path",{"d":"m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15"}],["path",{"d":"M4 18v3"}],["path",{"d":"M8 14v7"}]],"check":[["path",{"d":"M20 6 9 17l-5-5"}]],"check-check":[["path",{"d":"M18 6 7 17l-5-5"}],["path",{"d":"m22 10-7.5 7.5L13 16"}]],"check-circle-2":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m9 12 2 2 4-4"}]],"chevron-down":[["path",{"d":"m6 9 6 6 6-6"}]],"chevron-left":[["path",{"d":"m15 18-6-6 6-6"}]],"chevron-right":[["path",{"d":"m9 18 6-6-6-6"}]],"circle-check":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m9 12 2 2 4-4"}]],"circle-dot":[["circle",{"cx":"12","cy":"12","r":"10"}],["circle",{"cx":"12","cy":"12","r":"1"}]],"clipboard-check":[["rect",{"width":"8","height":"4","x":"8","y":"2","rx":"1","ry":"1"}],["path",{"d":"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"}],["path",{"d":"m9 14 2 2 4-4"}]],"clipboard-list":[["rect",{"width":"8","height":"4","x":"8","y":"2","rx":"1","ry":"1"}],["path",{"d":"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"}],["path",{"d":"M12 11h4"}],["path",{"d":"M12 16h4"}],["path",{"d":"M8 11h.01"}],["path",{"d":"M8 16h.01"}]],"clipboard-pen-line":[["rect",{"width":"8","height":"4","x":"8","y":"2","rx":"1"}],["path",{"d":"M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-.5"}],["path",{"d":"M16 4h2a2 2 0 0 1 1.73 1"}],["path",{"d":"M8 18h1"}],["path",{"d":"M21.378 12.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"}]],"clock":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 6v6l4 2"}]],"clock-3":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 6v6h4"}]],"cloud":[["path",{"d":"M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"}]],"cloud-upload":[["path",{"d":"M12 13v8"}],["path",{"d":"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"}],["path",{"d":"m8 17 4-4 4 4"}]],"coins":[["path",{"d":"M13.744 17.736a6 6 0 1 1-7.48-7.48"}],["path",{"d":"M15 6h1v4"}],["path",{"d":"m6.134 14.768.866-.5 2 3.464"}],["circle",{"cx":"16","cy":"8","r":"6"}]],"contact":[["path",{"d":"M16 2v2"}],["path",{"d":"M7 22v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"}],["path",{"d":"M8 2v2"}],["circle",{"cx":"12","cy":"11","r":"3"}],["rect",{"x":"3","y":"4","width":"18","height":"18","rx":"2"}]],"database":[["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3"}],["path",{"d":"M3 5V19A9 3 0 0 0 21 19V5"}],["path",{"d":"M3 12A9 3 0 0 0 21 12"}]],"database-backup":[["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3"}],["path",{"d":"M3 12a9 3 0 0 0 5 2.69"}],["path",{"d":"M21 9.3V5"}],["path",{"d":"M3 5v14a9 3 0 0 0 6.47 2.88"}],["path",{"d":"M12 12v4h4"}],["path",{"d":"M13 20a5 5 0 0 0 9-3 4.5 4.5 0 0 0-4.5-4.5c-1.33 0-2.54.54-3.41 1.41L12 16"}]],"download":[["path",{"d":"M12 15V3"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["path",{"d":"m7 10 5 5 5-5"}]],"edit-3":[["path",{"d":"M13 21h8"}],["path",{"d":"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}]],"external-link":[["path",{"d":"M15 3h6v6"}],["path",{"d":"M10 14 21 3"}],["path",{"d":"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"}]],"eye":[["path",{"d":"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"file-badge":[["path",{"d":"M13 22h5a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v3.3"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"m7.69 16.479 1.29 4.88a.5.5 0 0 1-.698.591l-1.843-.849a1 1 0 0 0-.879.001l-1.846.85a.5.5 0 0 1-.692-.593l1.29-4.88"}],["circle",{"cx":"6","cy":"14","r":"3"}]],"file-check":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"m9 15 2 2 4-4"}]],"file-check-2":[["path",{"d":"M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v6"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"m14 20 2 2 4-4"}]],"file-plus-2":[["path",{"d":"M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M14 19h6"}],["path",{"d":"M17 16v6"}]],"file-search":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["circle",{"cx":"11.5","cy":"14.5","r":"2.5"}],["path",{"d":"M13.3 16.3 15 18"}]],"file-spreadsheet":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M8 13h2"}],["path",{"d":"M14 13h2"}],["path",{"d":"M8 17h2"}],["path",{"d":"M14 17h2"}]],"file-text":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M10 9H8"}],["path",{"d":"M16 13H8"}],["path",{"d":"M16 17H8"}]],"file-up":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M12 12v6"}],["path",{"d":"m15 15-3-3-3 3"}]],"file-x-2":[["path",{"d":"M11 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"m15 17 5 5"}],["path",{"d":"m20 17-5 5"}]],"files":[["path",{"d":"M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"}],["path",{"d":"M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z"}],["path",{"d":"M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1"}]],"flag":[["path",{"d":"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"}]],"folder-open":[["path",{"d":"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"}]],"git-branch":[["path",{"d":"M15 6a9 9 0 0 0-9 9V3"}],["circle",{"cx":"18","cy":"6","r":"3"}],["circle",{"cx":"6","cy":"18","r":"3"}]],"hash":[["line",{"x1":"4","x2":"20","y1":"9","y2":"9"}],["line",{"x1":"4","x2":"20","y1":"15","y2":"15"}],["line",{"x1":"10","x2":"8","y1":"3","y2":"21"}],["line",{"x1":"16","x2":"14","y1":"3","y2":"21"}]],"id-card":[["path",{"d":"M16 10h2"}],["path",{"d":"M16 14h2"}],["path",{"d":"M6.17 15a3 3 0 0 1 5.66 0"}],["circle",{"cx":"9","cy":"11","r":"2"}],["rect",{"x":"2","y":"5","width":"20","height":"14","rx":"2"}]],"info":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 16v-4"}],["path",{"d":"M12 8h.01"}]],"landmark":[["path",{"d":"M10 18v-7"}],["path",{"d":"M11.12 2.198a2 2 0 0 1 1.76.006l7.866 3.847c.476.233.31.949-.22.949H3.474c-.53 0-.695-.716-.22-.949z"}],["path",{"d":"M14 18v-7"}],["path",{"d":"M18 18v-7"}],["path",{"d":"M3 22h18"}],["path",{"d":"M6 18v-7"}]],"layers":[["path",{"d":"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"}],["path",{"d":"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"}],["path",{"d":"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"}]],"layers-3":[["path",{"d":"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"}],["path",{"d":"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"}],["path",{"d":"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"}]],"layout-dashboard":[["rect",{"width":"7","height":"9","x":"3","y":"3","rx":"1"}],["rect",{"width":"7","height":"5","x":"14","y":"3","rx":"1"}],["rect",{"width":"7","height":"9","x":"14","y":"12","rx":"1"}],["rect",{"width":"7","height":"5","x":"3","y":"16","rx":"1"}]],"leaf":[["path",{"d":"M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"}],["path",{"d":"M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"}]],"lightbulb":[["path",{"d":"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"}],["path",{"d":"M9 18h6"}],["path",{"d":"M10 22h4"}]],"list-checks":[["path",{"d":"M13 5h8"}],["path",{"d":"M13 12h8"}],["path",{"d":"M13 19h8"}],["path",{"d":"m3 17 2 2 4-4"}],["path",{"d":"m3 7 2 2 4-4"}]],"list-filter":[["path",{"d":"M2 5h20"}],["path",{"d":"M6 12h12"}],["path",{"d":"M9 19h6"}]],"list-filter-x":[["path",{"d":"M3 5h18M6 12h9M9 19h3M17 16l5 5M22 16l-5 5"}]],"loader-2":[["path",{"d":"M21 12a9 9 0 1 1-6.219-8.56"}]],"loader-circle":[["path",{"d":"M21 12a9 9 0 1 1-6.219-8.56"}]],"log-out":[["path",{"d":"m16 17 5-5-5-5"}],["path",{"d":"M21 12H9"}],["path",{"d":"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"}]],"mail":[["path",{"d":"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"}],["rect",{"x":"2","y":"4","width":"20","height":"16","rx":"2"}]],"map-pin":[["path",{"d":"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"}],["circle",{"cx":"12","cy":"10","r":"3"}]],"map-pinned":[["path",{"d":"M18 8c0 3.613-3.869 7.429-5.393 8.795a1 1 0 0 1-1.214 0C9.87 15.429 6 11.613 6 8a6 6 0 0 1 12 0"}],["circle",{"cx":"12","cy":"8","r":"2"}],["path",{"d":"M8.714 14h-3.71a1 1 0 0 0-.948.683l-2.004 6A1 1 0 0 0 3 22h18a1 1 0 0 0 .948-1.316l-2-6a1 1 0 0 0-.949-.684h-3.712"}]],"menu":[["path",{"d":"M4 5h16"}],["path",{"d":"M4 12h16"}],["path",{"d":"M4 19h16"}]],"message-circle":[["path",{"d":"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"}]],"package":[["path",{"d":"M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"}],["path",{"d":"M12 22V12"}],["polyline",{"points":"3.29 7 12 12 20.71 7"}],["path",{"d":"m7.5 4.27 9 5.15"}]],"package-search":[["path",{"d":"M12 22V12"}],["path",{"d":"M20.27 18.27 22 20"}],["path",{"d":"M21 10.498V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.729l7 4a2 2 0 0 0 2 .001l.98-.559"}],["path",{"d":"M3.29 7 12 12l8.71-5"}],["path",{"d":"m7.5 4.27 8.997 5.148"}],["circle",{"cx":"18.5","cy":"16.5","r":"2.5"}]],"panel-left-close":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M9 3v18"}],["path",{"d":"m16 15-3-3 3-3"}]],"panel-left-open":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M9 3v18"}],["path",{"d":"m14 9 3 3-3 3"}]],"paperclip":[["path",{"d":"m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"}]],"pencil":[["path",{"d":"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}],["path",{"d":"m15 5 4 4"}]],"philippine-peso":[["path",{"d":"M20 11H4"}],["path",{"d":"M20 7H4"}],["path",{"d":"M7 21V4a1 1 0 0 1 1-1h4a1 1 0 0 1 0 12H7"}]],"phone":[["path",{"d":"M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"}]],"pin":[["path",{"d":"M12 17v5"}],["path",{"d":"M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"}]],"plus":[["path",{"d":"M5 12h14"}],["path",{"d":"M12 5v14"}]],"plus-circle":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M8 12h8"}],["path",{"d":"M12 8v8"}]],"printer":[["path",{"d":"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"}],["path",{"d":"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"}],["rect",{"x":"6","y":"14","width":"12","height":"8","rx":"1"}]],"receipt-text":[["path",{"d":"M13 16H8"}],["path",{"d":"M14 8H8"}],["path",{"d":"M16 12H8"}],["path",{"d":"M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"}]],"refresh-cw":[["path",{"d":"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{"d":"M21 3v5h-5"}],["path",{"d":"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{"d":"M8 16H3v5"}]],"rotate-ccw":[["path",{"d":"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}],["path",{"d":"M3 3v5h5"}]],"route":[["circle",{"cx":"6","cy":"19","r":"3"}],["path",{"d":"M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"}],["circle",{"cx":"18","cy":"5","r":"3"}]],"rows-3":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M21 9H3"}],["path",{"d":"M21 15H3"}]],"save":[["path",{"d":"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"}],["path",{"d":"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"}],["path",{"d":"M7 3v4a1 1 0 0 0 1 1h7"}]],"scan-text":[["path",{"d":"M3 7V5a2 2 0 0 1 2-2h2"}],["path",{"d":"M17 3h2a2 2 0 0 1 2 2v2"}],["path",{"d":"M21 17v2a2 2 0 0 1-2 2h-2"}],["path",{"d":"M7 21H5a2 2 0 0 1-2-2v-2"}],["path",{"d":"M7 8h8"}],["path",{"d":"M7 12h10"}],["path",{"d":"M7 16h6"}]],"search":[["path",{"d":"m21 21-4.34-4.34"}],["circle",{"cx":"11","cy":"11","r":"8"}]],"search-x":[["path",{"d":"m13.5 8.5-5 5"}],["path",{"d":"m8.5 8.5 5 5"}],["circle",{"cx":"11","cy":"11","r":"8"}],["path",{"d":"m21 21-4.3-4.3"}]],"send":[["path",{"d":"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"}],["path",{"d":"m21.854 2.147-10.94 10.939"}]],"settings":[["path",{"d":"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"shield-alert":[["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{"d":"M12 8v4"}],["path",{"d":"M12 16h.01"}]],"shield-check":[["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{"d":"m9 12 2 2 4-4"}]],"shield-x":[["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{"d":"m14.5 9.5-5 5"}],["path",{"d":"m9.5 9.5 5 5"}]],"shirt":[["path",{"d":"M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"}]],"square-pen":[["path",{"d":"M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"}],["path",{"d":"M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"}]],"table":[["path",{"d":"M12 3v18"}],["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M3 9h18"}],["path",{"d":"M3 15h18"}]],"tag":[["path",{"d":"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"}],["circle",{"cx":"7.5","cy":"7.5","r":".5","fill":"currentColor"}]],"tags":[["path",{"d":"M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 6 9.172V3a1 1 0 0 1 1-1z"}],["path",{"d":"M2 7v6.172a2 2 0 0 0 .586 1.414l6.71 6.71a2.4 2.4 0 0 0 3.191.193"}],["circle",{"cx":"10.5","cy":"6.5","r":".5","fill":"currentColor"}]],"trash":[["path",{"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{"d":"M3 6h18"}],["path",{"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]],"trash-2":[["path",{"d":"M10 11v6"}],["path",{"d":"M14 11v6"}],["path",{"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{"d":"M3 6h18"}],["path",{"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]],"trending-up":[["path",{"d":"M16 7h6v6"}],["path",{"d":"m22 7-8.5 8.5-5-5L2 17"}]],"upload":[["path",{"d":"M12 3v12"}],["path",{"d":"m17 8-5-5-5 5"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}]],"upload-cloud":[["path",{"d":"M12 13v8"}],["path",{"d":"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"}],["path",{"d":"m8 17 4-4 4 4"}]],"user":[["path",{"d":"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"}],["circle",{"cx":"12","cy":"7","r":"4"}]],"user-check":[["path",{"d":"m16 11 2 2 4-4"}],["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"user-cog":[["path",{"d":"M10 15H6a4 4 0 0 0-4 4v2"}],["path",{"d":"m14.305 16.53.923-.382"}],["path",{"d":"m15.228 13.852-.923-.383"}],["path",{"d":"m16.852 12.228-.383-.923"}],["path",{"d":"m16.852 17.772-.383.924"}],["path",{"d":"m19.148 12.228.383-.923"}],["path",{"d":"m19.53 18.696-.382-.924"}],["path",{"d":"m20.772 13.852.924-.383"}],["path",{"d":"m20.772 16.148.924.383"}],["circle",{"cx":"18","cy":"15","r":"3"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"user-plus":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}],["line",{"x1":"19","x2":"19","y1":"8","y2":"14"}],["line",{"x1":"22","x2":"16","y1":"11","y2":"11"}]],"user-round":[["circle",{"cx":"12","cy":"8","r":"5"}],["path",{"d":"M20 21a8 8 0 0 0-16 0"}]],"user-round-check":[["path",{"d":"M2 21a8 8 0 0 1 13.292-6"}],["circle",{"cx":"10","cy":"8","r":"5"}],["path",{"d":"m16 19 2 2 4-4"}]],"user-x":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}],["line",{"x1":"17","x2":"22","y1":"8","y2":"13"}],["line",{"x1":"22","x2":"17","y1":"8","y2":"13"}]],"users":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["path",{"d":"M16 3.128a4 4 0 0 1 0 7.744"}],["path",{"d":"M22 21v-2a4 4 0 0 0-3-3.87"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"users-round":[["path",{"d":"M18 21a8 8 0 0 0-16 0"}],["circle",{"cx":"10","cy":"8","r":"5"}],["path",{"d":"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"}]],"wallet-cards":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2"}],["path",{"d":"M3 11h3c.8 0 1.6.3 2.1.9l1.1.9c1.6 1.6 4.1 1.6 5.7 0l1.1-.9c.5-.5 1.3-.9 2.1-.9H21"}]],"wrench":[["path",{"d":"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"}]],"x":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],"x-circle":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m15 9-6 6"}],["path",{"d":"m9 9 6 6"}]],"sun":[["circle",{"cx":"12","cy":"12","r":"4"}],["path",{"d":"M12 2v2"}],["path",{"d":"M12 20v2"}],["path",{"d":"m4.93 4.93 1.41 1.41"}],["path",{"d":"m17.66 17.66 1.41 1.41"}],["path",{"d":"M2 12h2"}],["path",{"d":"M20 12h2"}],["path",{"d":"m6.34 17.66-1.41 1.41"}],["path",{"d":"m19.07 4.93-1.41 1.41"}]],"moon":[["path",{"d":"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"}]],"columns-3":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M9 3v18"}],["path",{"d":"M15 3v18"}]],"inbox":[["polyline",{"points":"22 12 16 12 14 15 10 15 8 12 2 12"}],["path",{"d":"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"}]]};
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

(() => {


/* ============================================================================
   PGENRO IMS — ADMIN CONTROL CENTER ENGINE
   Unified Supabase Data Layer, Real-time Analytics, and Interactive Controls
   ============================================================================ */

(() => {
  "use strict";

  // Prevent duplicate initialization
  if (window.PGENRO_ADMIN_DASHBOARD_INITIALIZED) return;
  window.PGENRO_ADMIN_DASHBOARD_INITIALIZED = true;

  /* --------------------------------------------------------------------------
     1. SUPABASE CLIENT & COMPATIBILITY STORE WRAPPER
     -------------------------------------------------------------------------- */
  const sb = window.pgenroSupabase || window.PGENRO_DB?.client || null;
  const localStore = {
    getItem(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
    setItem(key, value) { try { window.localStorage.setItem(key, value); return true; } catch { return false; } },
    removeItem(key) { try { window.localStorage.removeItem(key); } catch {} }
  };
  const subscriptions = [];
  const channelRegistry = new Set();
  const wrappedCache = new Map();

  const TABLE_ALIASES = {
    users: "profiles"
  };

  const tableName = (name) => TABLE_ALIASES[name] || name;

  const uuid = () =>
    globalThis.crypto?.randomUUID?.() ||
    `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function unwrapRow(row) {
    if (!row || typeof row !== "object") return row;
    if (row.data && typeof row.data === "object" && !Array.isArray(row.data)) {
      return {
        ...row.data,
        id: row.id ?? row.data.id,
        created_at: row.created_at ?? row.data.created_at,
        updated_at: row.updated_at ?? row.data.updated_at
      };
    }
    return { ...row };
  }

  async function isWrappedTable(rawName) {
    if (!sb) return false;
    const name = tableName(rawName);
    if (wrappedCache.has(name)) return wrappedCache.get(name);
    try {
      const { error } = await sb.from(name).select("data").limit(1);
      const wrapped = !error;
      wrappedCache.set(name, wrapped);
      return wrapped;
    } catch {
      return false;
    }
  }

  async function readRows(rawName) {
    if (!sb) throw new Error("Supabase client unavailable");
    const name = tableName(rawName);
    const allRows = [];
    const batchSize = 500;
    let offset = 0;

    while (true) {
      let query = sb.from(name).select("*", { count: "exact" });

      // Robust pagination: try ordering by id, fall back cleanly if table lacks id
      let response = await query.order("id", { ascending: true }).range(offset, offset + batchSize - 1);
      if (response.error && (response.error.code === "42703" || String(response.error.message).includes("does not exist"))) {
        response = await sb.from(name).select("*", { count: "exact" }).range(offset, offset + batchSize - 1);
      }
      if (response.error) throw response.error;

      const batch = response.data || [];
      allRows.push(...batch);
      offset += batch.length;
      if (typeof response.count === "number" && offset >= response.count) break;
      if (!batch.length || batch.length < batchSize) break;
    }

    return allRows.map(unwrapRow);
  }

  class RealtimeRef {
    constructor(path = "") {
      this.path = String(path || "").replace(/^\/+|\/+$/g, "");
      this._unsubs = [];
    }

    _parts() {
      return this.path.split("/").filter(Boolean);
    }

    async set(payload) {
      if (!sb) throw new Error("Supabase client unavailable");
      const [rawTable, id] = this._parts();
      if (!rawTable || !id) return payload;
      const name = tableName(rawTable);
      const wrapped = await isWrappedTable(name);

      const { error } = await sb.from(name).upsert(
        wrapped ? { id, data: payload } : { id, ...payload }, { onConflict: "id" }
      );
      if (error) throw error;
      return payload;
    }

    on(eventName, callback, errorCallback) {
      if (eventName !== "value") return callback;

      if (this.path === ".info/connected") {
        const emit = () => callback({ val: () => Boolean(navigator.onLine) });
        emit();
        window.addEventListener("online", emit);
        window.addEventListener("offline", emit);
        this._unsubs.push(() => {
          window.removeEventListener("online", emit);
          window.removeEventListener("offline", emit);
        });
        return callback;
      }

      const [rawTable] = this._parts();
      if (!rawTable || !sb) {
        errorCallback?.(new Error("Supabase unavailable"));
        return callback;
      }

      const name = tableName(rawTable);
      let active = true;
      let reading = false;
      let queued = false;

      const refresh = async () => {
        if (!active) return;
        if (reading) { queued = true; return; }
        reading = true;
        try {
          const rows = await readRows(name);
          if (active) {
            const dataObj = Object.fromEntries(rows.map((row, idx) => [String(row.id ?? idx), row]));
            callback({ val: () => dataObj });
          }
        } catch (err) {
          if (active) errorCallback?.(err);
        } finally {
          reading = false;
          if (active && queued) { queued = false; refresh(); }
        }
      };

      refresh();
      window.addEventListener("online", refresh);
      this._unsubs.push(() => window.removeEventListener("online", refresh));

      const channel = sb
        .channel(`admin-dashboard-${name}-${uuid()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: name }, refresh)
        .subscribe((status) => {
          if (status === "SUBSCRIBED") refresh();
          else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status) && active) {
            errorCallback?.(new Error("Realtime subscription unavailable"));
          }
        });

      channelRegistry.add(channel);
      this._unsubs.push(() => {
        active = false;
        channelRegistry.delete(channel);
        try { sb.removeChannel(channel); } catch {}
      });

      return callback;
    }

    off() {
      this._unsubs.splice(0).forEach((unsub) => {
        try { unsub(); } catch {}
      });
    }
  }

  const supabaseStore = {
    realtimeStore: () => ({
      ref: (path = "") => new RealtimeRef(path)
    }),
    auth: () => ({
      onAuthStateChanged: (cb) => {
        sb?.auth?.getSession?.().then(({ data }) => cb(data?.session?.user || null)).catch(() => cb(null));
        const { data } = sb?.auth?.onAuthStateChange?.((_evt, session) => cb(session?.user || null)) || {};
        return () => data?.subscription?.unsubscribe?.();
      },
      signOut: async () => {
        const response = await sb?.auth?.signOut?.();
        if (response?.error) throw response.error;
      }
    })
  };

  /* --------------------------------------------------------------------------
     2. ADMIN DASHBOARD STATE & CONTROLLER
     -------------------------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);

  // Local Lucide icon subset (ISC license), so navigation icons work without a CDN.
  const iconNodes = {"panel-left-close":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M9 3v18"}],["path",{"d":"m16 15-3-3 3-3"}]],"layout-dashboard":[["rect",{"width":"7","height":"9","x":"3","y":"3","rx":"1"}],["rect",{"width":"7","height":"5","x":"14","y":"3","rx":"1"}],["rect",{"width":"7","height":"9","x":"14","y":"12","rx":"1"}],["rect",{"width":"7","height":"5","x":"3","y":"16","rx":"1"}]],"arrow-left-right":[["path",{"d":"M8 3 4 7l4 4"}],["path",{"d":"M4 7h16"}],["path",{"d":"m16 21 4-4-4-4"}],["path",{"d":"M20 17H4"}]],"briefcase":[["path",{"d":"M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"}],["rect",{"width":"20","height":"14","x":"2","y":"6","rx":"2"}]],"file-text":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M10 9H8"}],["path",{"d":"M16 13H8"}],["path",{"d":"M16 17H8"}]],"users-round":[["path",{"d":"M18 21a8 8 0 0 0-16 0"}],["circle",{"cx":"10","cy":"8","r":"5"}],["path",{"d":"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"}]],"boxes":[["path",{"d":"M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"}],["path",{"d":"m7 16.5-4.74-2.85"}],["path",{"d":"m7 16.5 5-3"}],["path",{"d":"M7 16.5v5.17"}],["path",{"d":"M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"}],["path",{"d":"m17 16.5-5-3"}],["path",{"d":"m17 16.5 4.74-2.85"}],["path",{"d":"M17 16.5v5.17"}],["path",{"d":"M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"}],["path",{"d":"M12 8 7.26 5.15"}],["path",{"d":"m12 8 4.74-2.85"}],["path",{"d":"M12 13.5V8"}]],"clipboard-check":[["rect",{"width":"8","height":"4","x":"8","y":"2","rx":"1","ry":"1"}],["path",{"d":"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"}],["path",{"d":"m9 14 2 2 4-4"}]],"wrench":[["path",{"d":"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"}]],"file-check-2":[["path",{"d":"M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v6"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"m14 20 2 2 4-4"}]],"user-cog":[["path",{"d":"M10 15H6a4 4 0 0 0-4 4v2"}],["path",{"d":"m14.305 16.53.923-.382"}],["path",{"d":"m15.228 13.852-.923-.383"}],["path",{"d":"m16.852 12.228-.383-.923"}],["path",{"d":"m16.852 17.772-.383.924"}],["path",{"d":"m19.148 12.228.383-.923"}],["path",{"d":"m19.53 18.696-.382-.924"}],["path",{"d":"m20.772 13.852.924-.383"}],["path",{"d":"m20.772 16.148.924.383"}],["circle",{"cx":"18","cy":"15","r":"3"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"user-plus":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}],["line",{"x1":"19","x2":"19","y1":"8","y2":"14"}],["line",{"x1":"22","x2":"16","y1":"11","y2":"11"}]],"shield-alert":[["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{"d":"M12 8v4"}],["path",{"d":"M12 16h.01"}]],"database-backup":[["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3"}],["path",{"d":"M3 12a9 3 0 0 0 5 2.69"}],["path",{"d":"M21 9.3V5"}],["path",{"d":"M3 5v14a9 3 0 0 0 6.47 2.88"}],["path",{"d":"M12 12v4h4"}],["path",{"d":"M13 20a5 5 0 0 0 9-3 4.5 4.5 0 0 0-4.5-4.5c-1.33 0-2.54.54-3.41 1.41L12 16"}]],"settings":[["path",{"d":"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"menu":[["path",{"d":"M4 5h16"}],["path",{"d":"M4 12h16"}],["path",{"d":"M4 19h16"}]],"search":[["path",{"d":"m21 21-4.34-4.34"}],["circle",{"cx":"11","cy":"11","r":"8"}]],"bell":[["path",{"d":"M10.268 21a2 2 0 0 0 3.464 0"}],["path",{"d":"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"}]],"user-round":[["circle",{"cx":"12","cy":"8","r":"5"}],["path",{"d":"M20 21a8 8 0 0 0-16 0"}]],"users":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["path",{"d":"M16 3.128a4 4 0 0 1 0 7.744"}],["path",{"d":"M22 21v-2a4 4 0 0 0-3-3.87"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"user-check":[["path",{"d":"m16 11 2 2 4-4"}],["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"log-out":[["path",{"d":"m16 17 5-5-5-5"}],["path",{"d":"M21 12H9"}],["path",{"d":"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"}]],"chevron-right":[["path",{"d":"m9 18 6-6-6-6"}]],"trending-up":[["path",{"d":"M16 7h6v6"}],["path",{"d":"m22 7-8.5 8.5-5-5L2 17"}]],"alert-circle":[["circle",{"cx":"12","cy":"12","r":"10"}],["line",{"x1":"12","x2":"12","y1":"8","y2":"12"}],["line",{"x1":"12","x2":"12.01","y1":"16","y2":"16"}]],"check-circle-2":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m9 12 2 2 4-4"}]],"alert-triangle":[["path",{"d":"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}],["path",{"d":"M12 9v4"}],["path",{"d":"M12 17h.01"}]],"chart-no-axes-combined":[["path",{"d":"M12 16v5"}],["path",{"d":"M16 14v7"}],["path",{"d":"M20 10v11"}],["path",{"d":"m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15"}],["path",{"d":"M4 18v3"}],["path",{"d":"M8 14v7"}]],"download":[["path",{"d":"M12 15V3"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["path",{"d":"m7 10 5 5 5-5"}]],"activity":[["path",{"d":"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"}]],"circle-check":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m9 12 2 2 4-4"}]],"clock-3":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 6v6h4"}]],"package-search":[["path",{"d":"M12 22V12"}],["path",{"d":"M20.27 18.27 22 20"}],["path",{"d":"M21 10.498V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.729l7 4a2 2 0 0 0 2 .001l.98-.559"}],["path",{"d":"M3.29 7 12 12l8.71-5"}],["path",{"d":"m7.5 4.27 8.997 5.148"}],["circle",{"cx":"18.5","cy":"16.5","r":"2.5"}]],"lightbulb":[["path",{"d":"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"}],["path",{"d":"M9 18h6"}],["path",{"d":"M10 22h4"}]],"upload":[["path",{"d":"M12 3v12"}],["path",{"d":"m17 8-5-5-5 5"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}]],"file-up":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M12 12v6"}],["path",{"d":"m15 15-3-3-3 3"}]],"info":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 16v-4"}],["path",{"d":"M12 8h.01"}]],"rotate-ccw":[["path",{"d":"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}],["path",{"d":"M3 3v5h5"}]],"x":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],"external-link":[["path",{"d":"M15 3h6v6"}],["path",{"d":"M10 14 21 3"}],["path",{"d":"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"}]]};
  function renderIcons() {
    if (window.PGENRO_Module) { window.PGENRO_Module.renderIcons(); return; }
    document.querySelectorAll("i[data-lucide]").forEach((placeholder) => {
      const name = placeholder.getAttribute("data-lucide");
      const nodes = iconNodes[name];
      if (!nodes) return;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false", class: "lucide " + (placeholder.getAttribute("class") || "") })) svg.setAttribute(key, value);
      if (placeholder.getAttribute("style")) svg.setAttribute("style", placeholder.getAttribute("style"));
      nodes.forEach(([tag, attributes]) => {
        const child = document.createElementNS("http://www.w3.org/2000/svg", tag);
        Object.entries(attributes).forEach(([key, value]) => child.setAttribute(key, value));
        svg.appendChild(child);
      });
      placeholder.replaceWith(svg);
    });
  }


  const safeJson = (raw, fallback = null) => {
    try {
      return JSON.parse(raw) ?? fallback;
    } catch {
      return fallback;
    }
  };

  const escapeHTML = (str) =>
    String(str ?? "").replace(/[&<>'"]/g, (tag) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[tag]);

  const counterFrames = new Map();
  // Cancel obsolete animations when realtime updates arrive together.
  function animateCounter(elementId, targetValue) {
    const el = $(elementId);
    if (!el) return;
    cancelAnimationFrame(counterFrames.get(elementId));
    const target = Number(targetValue);
    if (!Number.isFinite(target)) {
      el.textContent = String(targetValue ?? "0");
      return;
    }
    const current = Number(el.textContent.replace(/,/g, "")) || 0;
    if (current === target) {
      el.textContent = target.toLocaleString();
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = target.toLocaleString();
      return;
    }
    const duration = 450;
    const startTime = performance.now();

    function update(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const val = Math.round(current + (target - current) * ease);
      el.textContent = val.toLocaleString();
      if (progress < 1) counterFrames.set(elementId, requestAnimationFrame(update));
      else el.textContent = target.toLocaleString();
    }
    counterFrames.set(elementId, requestAnimationFrame(update));
  }

  const setText = (id, value) => {
    const el = $(id);
    if (!el) return;
    el.textContent = Number.isFinite(Number(value))
      ? Number(value).toLocaleString()
      : String(value ?? "");
  };

  // Operational Modules Definition
  const activityModules = [
    { key: "communications", label: "Communications", table: "communications", href: "admincommunication.html", color: "#2563eb" },
    { key: "memos", label: "Office Memos", table: "office_memos", href: "officememo-admin.html", color: "#059669" },
    { key: "travel", label: "Travel Orders", table: "travel_orders", href: "travelOR-admin.html", color: "#8b5cf6" },
    { key: "visitors", label: "Visitors", table: "visitors", href: "visitors-admin.html", color: "#d97706" },
    { key: "services", label: "Service Requests", table: "service_requests", href: "serviceAdmin.html", color: "#e05271" },
    { key: "ics", label: "ICS Property Slips", table: "ics_records", href: "ics-admin.html", color: "#0891b2" }
  ];

  const moduleTableKeys = {
    communications: "communications",
    office_memos: "memos",
    travel_orders: "travel",
    visitors: "visitors",
    service_requests: "services",
    ics_records: "ics",
    inventory: "inventory",
    employees: "employees",
    users: "users",
    access_requests: "requests"
  };

  const analyticsSources = Object.fromEntries(
    Object.values(moduleTableKeys).map((k) => [k, { rows: null, source: "unavailable" }])
  );

  let currentAuthLogs = [];
  let remoteAuthLogs = [];
  let localAuditLogs = [];
  let memosList = [];
  let analyticsRange = "90";
  let lastAnalyticsModel = null;
  const analyticsDayMs = 86400000;
  let analyticsFrame = null;
  function scheduleAnalytics() {
    if (analyticsFrame !== null) return;
    analyticsFrame = requestAnimationFrame(() => {
      analyticsFrame = null;
      updateChartsAndAnalytics();
    });
  }

  // Audit Log Pagination state
  let auditCurrentPage = 1;
  const auditPageSize = 25;
  let selectedAuditIds = new Set();
  let filteredAuditLogs = [];
  let inspectorTrigger = null;

  /* --------------------------------------------------------------------------
     3. PROFILE & USER PREFERENCES
     -------------------------------------------------------------------------- */
  function updateProfileUI(profile = {}) {
    const name = profile.fullName || profile.name || profile.displayName || "PGENRO Admin";
    const email = profile.email || "Administrator Session";
    const role = profile.role || "Administrator";

    if ($("dropdownUserName")) $("dropdownUserName").textContent = name;
    if ($("dropdownUserEmail")) $("dropdownUserEmail").textContent = email;
    if ($("dropdownUserRole")) $("dropdownUserRole").textContent = role;
  }

  const preferenceKey = "pgenro_admin_preferences";

  function applyPreferences() {
    const prefs = safeJson(localStore.getItem(preferenceKey), {});
    if ($("compactModeToggle")) $("compactModeToggle").checked = Boolean(prefs.compact);
    if ($("showDbStatusToggle")) $("showDbStatusToggle").checked = prefs.showDb !== false;

    document.body.classList.toggle("compact-mode", Boolean(prefs.compact));
    document.body.classList.add("hide-db-status");
  }

  function savePreferences() {
    const prefs = {
      compact: Boolean($("compactModeToggle")?.checked),
      showDb: $("showDbStatusToggle")?.checked !== false
    };
    if (!localStore.setItem(preferenceKey, JSON.stringify(prefs))) {
      showToast("Browser storage is unavailable. Preferences could not be saved.", "error");
      return;
    }
    applyPreferences();
    logAudit("PREFERENCES_UPDATED", "Updated workspace layout and status display settings.");
    showToast("Preferences updated.");
  }

  /* --------------------------------------------------------------------------
     4. AUDIT TRAIL LOGGING & INSPECTION
     -------------------------------------------------------------------------- */
  const auditLocalKey = "pgenro_audit_log_fallback";

  function auditDate(log) {
    const raw = log?.timestamp || log?.createdAt || log?.created_at || log?.date || 0;
    const d = raw?.toDate ? raw.toDate() : new Date(raw);
    return Number.isNaN(d.getTime()) ? new Date(0) : d;
  }

  function auditKey(log) {
    return String(
      log?.eventId ||
      log?.id ||
      `${auditDate(log).getTime()}|${log?.userEmail || ""}|${log?.activity || ""}|${log?.details || ""}`
    );
  }

  function loadLocalAuditLogs() {
    localAuditLogs = safeJson(localStore.getItem(auditLocalKey), []);
    if (!Array.isArray(localAuditLogs)) localAuditLogs = [];
  }

  function saveLocalAuditLogs() {
    try {
      localStore.setItem(auditLocalKey, JSON.stringify(localAuditLogs.slice(0, 300)));
    } catch (e) {
      console.warn("Local audit log storage limit reached", e);
    }
  }

  function refreshAuditLogs() {
    const unique = new Map();
    [...remoteAuthLogs, ...localAuditLogs]
      .sort((a, b) => auditDate(b) - auditDate(a))
      .forEach((log) => {
        const key = auditKey(log);
        if (!unique.has(key)) unique.set(key, log);
      });

    currentAuthLogs = [...unique.values()].slice(0, 500);
    applyAuditFilters();
  }

  async function logAudit(action, details, options = {}) {
    const profile = safeJson(localStore.getItem("pgenro_current_user"), {}) || {};
    const timestamp = new Date().toISOString();
    const eventId = uuid();
    const normalizedAction = String(action || "SYSTEM_ACTIVITY").trim().toUpperCase().replace(/\s+/g, "_");

    const record = {
      eventId,
      timestamp,
      createdAt: timestamp,
      userId: profile.id || profile.userId || "admin",
      userEmail: profile.email || "Administrator",
      userName: profile.fullName || profile.name || "PGENRO Admin",
      role: profile.role || "Administrator",
      activity: normalizedAction,
      action: normalizedAction,
      actionType: normalizedAction === "LOGIN" ? "login" : normalizedAction === "LOGOUT" ? "logout" : "activity",
      module: options.module || "Security Audit Trail",
      details: String(details || "System activity recorded."),
      ipAddress: options.ipAddress || "Not captured",
      sessionStatus: options.status || "Success"
    };

    localAuditLogs.unshift(record);
    saveLocalAuditLogs();
    refreshAuditLogs();

    try {
      const dbRef = supabaseStore.realtimeStore().ref(`audit_logs/${eventId}`);
      await dbRef.set(record);
    } catch {
      // Local log remains active
    }
    return record;
  }

  window.PGENRO_AUDIT = { log: logAudit, refresh: refreshAuditLogs };

  /* --------------------------------------------------------------------------
     5. AUDIT TABLE RENDERING & PAGINATION
     -------------------------------------------------------------------------- */
  function renderAuthLogs(logs) {
    const tbody = $("auditTableBody");
    const info = $("tablePaginationInfo");
    const pagContainer = $("auditPaginationControls");
    if (!tbody) return;

    if (!logs.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-table-cell">No matching user activity recorded.</td></tr>`;
      if (info) info.textContent = "Showing 0 of 0 log entries";
      if (pagContainer) pagContainer.innerHTML = "";
      syncAuditSelection();
      return;
    }

    const totalPages = Math.ceil(logs.length / auditPageSize);
    auditCurrentPage = Math.min(Math.max(1, auditCurrentPage), totalPages);

    const startIdx = (auditCurrentPage - 1) * auditPageSize;
    const pageLogs = logs.slice(startIdx, startIdx + auditPageSize);

    tbody.innerHTML = pageLogs.map((log) => {
      const date = auditDate(log);
      const action = String(log.activity || log.action || "ACTIVITY");
      const name = log.userName || log.userEmail || "System Operator";
      const email = log.userEmail || "Protected Account";
      const status = String(log.sessionStatus || log.status || "Success");
      const isSuccess = !/fail|error|denied|blocked/i.test(status);
      const id = auditKey(log);
      const checked = selectedAuditIds.has(id) ? "checked" : "";

      return `
        <tr tabindex="0" aria-label="Inspect audit event" data-audit-id="${escapeHTML(id)}" class="${checked ? "is-selected" : ""}">
          <td class="audit-select-cell">
            <input type="checkbox" class="row-checkbox" data-id="${escapeHTML(id)}" ${checked} aria-label="Select log entry">
          </td>
          <td class="font-mono text-muted" style="white-space: nowrap;">${escapeHTML(date.toLocaleString())}</td>
          <td>
            <div class="user-cell">
              <div class="avatar-sm">${escapeHTML(name.slice(0, 2).toUpperCase())}</div>
              <div>
                <strong>${escapeHTML(name)}</strong>
                <small>${escapeHTML(email)}</small>
              </div>
            </div>
          </td>
          <td>
            <span class="badge-status ${isSuccess ? "success" : "urgent"}">
              <span class="dot"></span>${escapeHTML(action.replace(/_/g, " "))}
            </span>
          </td>
          <td class="audit-action-detail">
            ${escapeHTML(log.details || log.description || "Activity recorded.")}
            <span class="audit-source">${escapeHTML(log.module || "System")}</span>
          </td>
          <td><span class="table-tag">${escapeHTML(log.role || log.division || "Admin")}</span></td>
          <td class="font-mono">${escapeHTML(log.ipAddress || "Session")}</td>
          <td>
            <span class="badge-status ${isSuccess ? "success" : "urgent"}">${escapeHTML(status)}</span>
          </td>
        </tr>
      `;
    }).join("");

    if (info) {
      info.textContent = `Showing ${startIdx + 1}–${Math.min(startIdx + auditPageSize, logs.length)} of ${logs.length} log entries`;
    }

    // Render Pagination Buttons
    if (pagContainer) {
      let buttonsHtml = `
        <button class="audit-page-btn" id="auditPrevBtn" ${auditCurrentPage === 1 ? "disabled" : ""} type="button">‹ Prev</button>
      `;
      for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || Math.abs(p - auditCurrentPage) <= 1) {
          buttonsHtml += `<button class="audit-page-btn ${p === auditCurrentPage ? "active" : ""}" data-page="${p}" type="button">${p}</button>`;
        } else if (p === 2 && auditCurrentPage > 3) {
          buttonsHtml += `<span style="padding: 0 4px;">…</span>`;
        } else if (p === totalPages - 1 && auditCurrentPage < totalPages - 2) {
          buttonsHtml += `<span style="padding: 0 4px;">…</span>`;
        }
      }
      buttonsHtml += `
        <button class="audit-page-btn" id="auditNextBtn" ${auditCurrentPage === totalPages ? "disabled" : ""} type="button">Next ›</button>
      `;
      pagContainer.innerHTML = buttonsHtml;
    }

    // Attach Row Click Inspect Event
    tbody.querySelectorAll("tr").forEach((row) => {
      row.addEventListener("click", (event) => {
        if (event.target.closest(".audit-select-cell")) return;
        const id = row.getAttribute("data-audit-id");
        const log = currentAuthLogs.find((l) => auditKey(l) === id);
        if (log) openAuditInspector(log);
      });
      row.addEventListener("keydown", (event) => {
        if (event.target === row && ["Enter", " "].includes(event.key)) {
          event.preventDefault(); row.click();
        }
      });
    });

    // Checkbox selections
    tbody.querySelectorAll(".row-checkbox").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        const id = e.target.getAttribute("data-id");
        if (e.target.checked) selectedAuditIds.add(id);
        else selectedAuditIds.delete(id);
        e.target.closest("tr").classList.toggle("is-selected", e.target.checked);
        syncAuditSelection();
      });
    });

    renderIcons();
  }

  function syncAuditSelection() {
    const boxes = [...document.querySelectorAll(".row-checkbox")];
    const selected = boxes.filter((box) => box.checked).length;
    const all = $("selectAllRows");
    if (all) {
      all.checked = boxes.length > 0 && selected === boxes.length;
      all.indeterminate = selected > 0 && selected < boxes.length;
      all.disabled = !boxes.length;
    }
  }

  function applyAuditFilters() {
    const q = ($("tableSearchInput")?.value || "").toLowerCase().trim();
    const type = $("auditTypeFilter")?.value || "all";

    const filtered = currentAuthLogs.filter((log) => {
      const action = String(log.activity || log.action || "");
      const logType = log.actionType || (/login/i.test(action) ? "login" : /logout/i.test(action) ? "logout" : "activity");
      if (type !== "all" && type !== logType) return false;
      if (!q) return true;

      const haystack = [
        auditDate(log).toLocaleString(),
        log.userName,
        log.userEmail,
        action,
        log.details,
        log.module,
        log.role,
        log.ipAddress,
        log.sessionStatus
      ].join(" ").toLowerCase();

      return haystack.includes(q);
    });

    filteredAuditLogs = filtered;
    selectedAuditIds = new Set([...selectedAuditIds].filter((id) => filtered.some((log) => auditKey(log) === id)));
    renderAuthLogs(filtered);
    syncAuditSelection();
  }

  // Audit Inspector Dialog
  function openAuditInspector(log) {
    const modal = $("auditDetailModal");
    if (!modal) return;
    $("modalEventTitle").textContent = String(log.activity || log.action || "Audit Event").replace(/_/g, " ");
    $("modalEventTime").textContent = auditDate(log).toLocaleString();
    $("modalEventStatus").textContent = log.sessionStatus || log.status || "Success";
    $("modalEventUser").textContent = `${log.userName || "Admin"} (${log.userEmail || "No email"})`;
    $("modalEventRole").textContent = log.role || log.division || "Administrator";
    $("modalEventIp").textContent = log.ipAddress || "Client Session";
    $("modalEventModule").textContent = log.module || "IMS Console";
    $("modalEventAction").textContent = log.activity || log.action || "SYSTEM_ACTIVITY";
    $("modalEventDetails").textContent = log.details || log.description || "No additional metadata recorded.";

    inspectorTrigger = document.activeElement;
    modal.classList.add("open");
    document.body.classList.add("modal-open");
    modal.setAttribute("aria-hidden", "false");
    $("closeAuditModalBtn")?.focus();
  }

  function closeAuditInspector() {
    const modal = $("auditDetailModal");
    if (!modal) return;
    if (!modal.classList.contains("open")) return;
    modal.classList.remove("open");
    document.body.classList.remove("modal-open");
    modal.setAttribute("aria-hidden", "true");
    inspectorTrigger?.focus();
  }

  /* --------------------------------------------------------------------------
     6. DATA ANALYTICS & CHART CONTROLLERS (WITH EXPANDED ACCURACY)
     -------------------------------------------------------------------------- */
  function recordDay(row, key) {
    // High-accuracy fallback checking all potential timestamp fields across all modules
    const fields = [
      "date", "receivedDate", "date_received", "letterDate", "docDate",
      "requestDate", "date_requested", "dateIssued", "memoDate",
      "departureDate", "travelDate", "date_from", "dateFrom",
      "dateAcquired", "time_in", "timeIn", "created_at", "createdAt", "timestamp"
    ];

    for (const f of fields) {
      const raw = row?.[f];
      if (!raw) continue;
      let d;
      if (typeof raw?.toDate === "function") d = raw.toDate();
      else if (typeof raw === "string") {
        // Keep natural-language dates intact; normalize only SQL-style timestamps.
        d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:/.test(raw) ? raw.replace(" ", "T") : raw);
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) d = new Date(`${raw}T00:00:00`);
      } else if (raw instanceof Date) {
        d = raw;
      } else if (typeof raw === "number") {
        d = new Date(raw > 1e11 ? raw : raw * 1000);
      }
      if (d instanceof Date && !isNaN(d.getTime())) {
        return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / analyticsDayMs);
      }
    }
    return null;
  }

  function serviceBucket(row) {
    const s = String(row?.status || row?.serviceStatus || "").trim().toLowerCase();
    if (/archive/.test(s)) return "archived";
    if (/^(complete|completed|closed|resolved|done)$/.test(s)) return "completed";
    if (/progress|ongoing|processing/.test(s)) return "progress";
    if (/pending|open|new|for review/.test(s)) return "pending";
    return "other";
  }

  function stockSummary(rows) {
    const res = { out: 0, low: 0, healthy: 0, unknown: 0 };
    for (const r of rows || []) {
      const quantity = r.quantity ?? r.qty ?? r.stock;
      const threshold = r.threshold ?? r.reorderLevel ?? r.minimumStock ?? r.reorder_level ?? r.minimum_stock;
      const q = quantity == null || String(quantity).trim() === "" ? NaN : Number(quantity);
      const th = threshold == null || String(threshold).trim() === "" ? NaN : Number(threshold);
      if (!Number.isFinite(q)) res.unknown++;
      else if (q <= 0) res.out++;
      else if (!Number.isFinite(th) || th < 0) res.unknown++;
      else if (q <= th) res.low++;
      else res.healthy++;
    }
    return res;
  }

  // Model builder with Personnel Division and Communications Flow calculations
  function buildAnalyticsModel(sources, range, now = new Date()) {
    const today = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / analyticsDayMs);
    let earliest = today;
    const dated = {};

    const breakdown = activityModules.map((m) => {
      const src = sources[m.key] || { rows: null, source: "unavailable" };
      const list = (src.rows || []).map((row) => ({ row, day: recordDay(row, m.key) }));
      dated[m.key] = list;
      for (const item of list) {
        if (item.day !== null && item.day <= today) earliest = Math.min(earliest, item.day);
      }
      return {
        ...m,
        available: Array.isArray(src.rows),
        source: src.source,
        current: 0,
        previous: 0,
        missing: list.filter((i) => i.day === null).length
      };
    });

    const start = range === "all" ? earliest : range === "year" ? Math.floor(Date.UTC(now.getFullYear(), 0, 1) / analyticsDayMs) : today - (range === "30" ? 29 : 89);
    const days = Math.max(1, today - start + 1);
    const prevStart = start - days;
    const prevEnd = start - 1;
    const bucketType = days <= 45 ? "day" : days <= 120 ? "week" : "month";

    const keyFor = (day) => {
      const d = new Date(day * analyticsDayMs);
      if (bucketType === "day") return String(day);
      if (bucketType === "week") return String(start + Math.floor((day - start) / 7) * 7);
      return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    };

    const buckets = [];
    const bucketMap = new Map();
    for (let day = start; day <= today; day++) {
      const k = keyFor(day);
      if (bucketMap.has(k)) continue;
      const d = new Date(day * analyticsDayMs);
      const label = bucketType === "month"
        ? d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      const b = { key: k, label, total: 0, documents: 0, travel: 0, visitors: 0, services: 0 };
      bucketMap.set(k, b);
      buckets.push(b);
    }

    const serviceStatuses = { completed: 0, progress: 0, pending: 0, archived: 0, other: 0 };

    for (const mod of breakdown) {
      for (const { row, day } of dated[mod.key]) {
        if (day === null) continue;
        if (day >= start && day <= today) {
          mod.current++;
          const b = bucketMap.get(keyFor(day));
          if (b) {
            b.total++;
            b[["communications", "memos", "ics"].includes(mod.key) ? "documents" : mod.key]++;
          }
          if (mod.key === "services") serviceStatuses[serviceBucket(row)]++;
        } else if (day >= prevStart && day <= prevEnd) {
          mod.previous++;
        }
      }
    }

    const available = breakdown.filter((m) => m.available);
    const total = available.reduce((acc, m) => acc + m.current, 0);
    const previous = available.reduce((acc, m) => acc + m.previous, 0);
    const servTotal = Object.values(serviceStatuses).reduce((a, b) => a + b, 0);

    let openRequests = 0;
    let agedRequests = 0;
    for (const r of sources.services?.rows || []) {
      if (["pending", "progress"].includes(serviceBucket(r))) {
        openRequests++;
        const d = recordDay(r, "services");
        if (d !== null && today - d >= 7) agedRequests++;
      }
    }

    // Preserve the actual division names; do not silently reclassify staff.
    const divisionCounts = Object.create(null);
    const employeeRows = sources.employees?.rows || [];
    employeeRows.forEach((emp) => {
      const division = String(emp.division || emp.department || emp.section || emp.office || "Unassigned").trim() || "Unassigned";
      divisionCounts[division] = (divisionCounts[division] || 0) + 1;
    });

    // Direction categories are mutually exclusive. Action required is a separate metric.
    const commBreakdown = { incoming: 0, outgoing: 0, internal: 0, unclassified: 0, actionRequired: 0 };
    const commRows = (sources.communications?.rows || []).filter((comm) => {
      const day = recordDay(comm, "communications");
      return day !== null && day >= start && day <= today;
    });
    commRows.forEach((comm) => {
      const type = String(comm.direction || comm.type || comm.documentType || "").trim().toLowerCase();
      const status = String(comm.status || comm.action || "").toLowerCase();
      if (/internal|directive|memorandum|memo/.test(type)) commBreakdown.internal++;
      else if (/outgoing|outbound|^out$|send|sent|endorse/.test(type)) commBreakdown.outgoing++;
      else if (/incoming|inbound|^in$|receive/.test(type)) commBreakdown.incoming++;
      else commBreakdown.unclassified++;
      if (!/no action|completed|closed|resolved/.test(status) && /action|urgent|for signature|pending/.test(status)) commBreakdown.actionRequired++;
    });

    return {
      start,
      end: today,
      days,
      bucketType,
      buckets,
      breakdown,
      total,
      previous,
      availableCount: available.length,
      serviceAvailable: Array.isArray(sources.services?.rows),
      serviceStatuses,
      serviceTotal: servTotal,
      completion: servTotal ? (serviceStatuses.completed / servTotal) * 100 : null,
      openRequests,
      agedRequests,
      stockAvailable: Array.isArray(sources.inventory?.rows),
      stock: stockSummary(sources.inventory?.rows),
      stockTotal: sources.inventory?.rows?.length || 0,
      missingDates: breakdown.reduce((acc, m) => acc + m.missing, 0),
      // Newly added accurate models
      divisionCounts,
      employeeCount: employeeRows.length,
      commBreakdown,
      commTotal: commRows.length
    };
  }

  // Chart Instances
  let monthlyChartInstance, categoryChartInstance, statusChartInstance, personnelChartInstance, commChartInstance;

  function initCharts() {
    if (!window.Chart) return;
    const isReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const baseOpts = {
      responsive: true,
      maintainAspectRatio: false,
      animation: isReduced ? false : { duration: 400 },
      plugins: {
        legend: {
          position: "bottom",
          labels: { usePointStyle: true, boxWidth: 6, padding: 12, font: { size: 10, family: "Plus Jakarta Sans" } }
        }
      }
    };

    // 1. Monthly Record Trend Chart
    if (!monthlyChartInstance && $("monthlyChart")) {
      monthlyChartInstance = new window.Chart($("monthlyChart"), {
        type: "line",
        data: {
          labels: [],
          datasets: [
            { label: "Documents & ICS", borderColor: "#059669", backgroundColor: "rgba(5, 150, 105, 0.08)", data: [], fill: true },
            { label: "Travel Orders", borderColor: "#8b5cf6", data: [] },
            { label: "Visitors", borderColor: "#d97706", data: [] },
            { label: "Service Requests", borderColor: "#e05271", data: [] }
          ].map((ds) => ({ ...ds, tension: 0.3, borderWidth: 2, pointRadius: 2.5 }))
        },
        options: {
          ...baseOpts,
          scales: {
            x: { grid: { display: false }, ticks: { maxRotation: 0, font: { size: 10 } } },
            y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#e2e8f0" } }
          }
        }
      });
    }

    // 2. Activity Distribution Doughnut
    if (!categoryChartInstance && $("categoryChart")) {
      categoryChartInstance = new window.Chart($("categoryChart"), {
        type: "doughnut",
        data: {
          labels: activityModules.map((m) => m.label),
          datasets: [{ data: [], backgroundColor: activityModules.map((m) => m.color), borderWidth: 2, borderColor: "#ffffff" }]
        },
        options: { ...baseOpts, cutout: "70%" }
      });
    }

    // 3. Service Status Bar Chart
    if (!statusChartInstance && $("statusChart")) {
      statusChartInstance = new window.Chart($("statusChart"), {
        type: "bar",
        data: {
          labels: ["Completed", "In Progress", "Pending", "Archived", "Other"],
          datasets: [{ data: [], backgroundColor: ["#059669", "#2563eb", "#d97706", "#94a3b8", "#cbd5e1"], borderRadius: 4 }]
        },
        options: {
          ...baseOpts,
          indexAxis: "y",
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#e2e8f0" } },
            y: { grid: { display: false }, ticks: { font: { size: 10 } } }
          }
        }
      });
    }

    // 4. NEW: Personnel Distribution Chart
    if (!personnelChartInstance && $("personnelChart")) {
      personnelChartInstance = new window.Chart($("personnelChart"), {
        type: "bar",
        data: {
          labels: [],
          datasets: [{
            label: "Personnel Count",
            data: [],
            backgroundColor: ["#059669", "#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#64748b"],
            borderRadius: 5
          }]
        },
        options: {
          ...baseOpts,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 9.5 } } },
            y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#e2e8f0" } }
          }
        }
      });
    }

    // 5. NEW: Communications Flow Doughnut / Polar Chart
    if (!commChartInstance && $("commChart")) {
      commChartInstance = new window.Chart($("commChart"), {
        type: "doughnut",
        data: {
          labels: ["Incoming", "Outgoing", "Internal", "Unclassified"],
          datasets: [{
            data: [],
            backgroundColor: ["#2563eb", "#059669", "#6366f1", "#f59e0b"],
            borderWidth: 2,
            borderColor: "#ffffff"
          }]
        },
        options: {
          ...baseOpts,
          cutout: "60%"
        }
      });
    }
  }

  function updateChartsAndAnalytics() {
    if (!monthlyChartInstance || !categoryChartInstance || !statusChartInstance || !personnelChartInstance || !commChartInstance) {
      initCharts();
    }
    const model = buildAnalyticsModel(analyticsSources, analyticsRange);
    lastAnalyticsModel = model;

    const startDateStr = new Date(model.start * analyticsDayMs).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    const endDateStr = new Date(model.end * analyticsDayMs).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    setText("analyticsPeriodLabel", `${startDateStr} – ${endDateStr}`);

    const liveCount = Object.values(analyticsSources).filter((s) => s.source === "live").length;
    const pill = $("analyticsSourceStatus");
    if (pill) {
      const cachedCount = Object.values(analyticsSources).filter((s) => s.source === "cache").length;
      pill.textContent = liveCount > 0 ? `${liveCount} live · ${cachedCount} cached modules` : cachedCount ? `${cachedCount} cached modules` : "Data unavailable";
      pill.dataset.state = liveCount === 10 ? "live" : liveCount > 0 ? "partial" : "unavailable";
    }

    setText("analyticsVolume", model.availableCount ? model.total : "—");
    setText("analyticsVolumeChange", model.total > 0 ? `${model.total} records in timeframe` : "No activity recorded");
    setText("analyticsCompletion", model.completion !== null ? `${model.completion.toFixed(1)}%` : "—");
    setText("analyticsCompletionDetail", model.serviceAvailable ? `${model.serviceStatuses.completed} of ${model.serviceTotal} completed` : "Awaiting service data");
    setText("analyticsBacklog", model.serviceAvailable ? model.openRequests : "—");
    setText("analyticsBacklogDetail", model.serviceAvailable ? `${model.agedRequests} open 7+ days` : "Awaiting service data");
    setText("analyticsStockAlerts", model.stockAvailable ? model.stock.out + model.stock.low : "—");
    setText("analyticsStockDetail", model.stockAvailable ? `${model.stock.out} out of stock · ${model.stock.low} low stock` : "Awaiting inventory");

    // 1. Update Monthly Chart
    if (monthlyChartInstance) {
      monthlyChartInstance.data.labels = model.buckets.map((b) => b.label);
      ["documents", "travel", "visitors", "services"].forEach((key, idx) => {
        monthlyChartInstance.data.datasets[idx].data = model.buckets.map((b) => b[key]);
      });
      monthlyChartInstance.update();
      $("analyticsTrendEmpty").hidden = model.total > 0;
      if (model.total === 0) $("analyticsTrendEmpty").textContent = "No dated activity recorded in this period.";
    }

    // 2. Update Category Chart
    if (categoryChartInstance) {
      categoryChartInstance.data.datasets[0].data = model.breakdown.map((m) => m.current);
      categoryChartInstance.update();
      $("analyticsDistributionEmpty").hidden = model.total > 0;
      if (model.total === 0) $("analyticsDistributionEmpty").textContent = "No distribution available.";
    }

    // 3. Update Service Status Chart
    if (statusChartInstance) {
      statusChartInstance.data.datasets[0].data = Object.values(model.serviceStatuses);
      statusChartInstance.update();
      $("analyticsServiceEmpty").hidden = model.serviceTotal > 0;
      if (model.serviceTotal === 0) $("analyticsServiceEmpty").textContent = "No service requests in this period.";
    }

    // 4. Update Personnel Distribution Chart
    if (personnelChartInstance) {
      const divLabels = Object.keys(model.divisionCounts);
      const divValues = Object.values(model.divisionCounts);
      personnelChartInstance.data.labels = divLabels;
      personnelChartInstance.data.datasets[0].data = divValues;
      personnelChartInstance.update();

      const emptyPersonnel = $("analyticsPersonnelEmpty");
      if (emptyPersonnel) {
        emptyPersonnel.hidden = model.employeeCount > 0;
        if (model.employeeCount === 0) emptyPersonnel.textContent = "No employee records found.";
      }
    }

    // 5. Update Communications Flow Chart
    if (commChartInstance) {
      const commValues = [
        model.commBreakdown.incoming,
        model.commBreakdown.outgoing,
        model.commBreakdown.internal,
        model.commBreakdown.unclassified
      ];
      commChartInstance.data.datasets[0].data = commValues;
      commChartInstance.update();

      const emptyComm = $("analyticsCommEmpty");
      if (emptyComm) {
        emptyComm.hidden = model.commTotal > 0;
        if (model.commTotal === 0) emptyComm.textContent = "No communication records available.";
      }
    }

    // Stock Breakdown Bars
    const stockContainer = $("analyticsStockBreakdown");
    if (stockContainer) {
      const stockMeta = [
        { label: "Out of Stock", count: model.stock.out, color: "var(--rose-500)" },
        { label: "Low Stock Alert", count: model.stock.low, color: "var(--amber-500)" },
        { label: "Normal Stock", count: model.stock.healthy, color: "var(--emerald-500)" },
        { label: "Unclassified", count: model.stock.unknown, color: "var(--slate-400)" }
      ];
      stockContainer.innerHTML = model.stockAvailable
        ? stockMeta.map((s) => `
            <div>
              <div class="analytics-stock-label">
                <span>${s.label}</span>
                <strong>${s.count}</strong>
              </div>
              <div class="analytics-stock-track">
                <div class="analytics-stock-fill" style="width:${model.stockTotal ? (s.count / model.stockTotal) * 100 : 0}%; background:${s.color};"></div>
              </div>
            </div>
          `).join("")
        : `<p style="font-size: 11px; color: var(--text-muted);">Inventory records unavailable.</p>`;
    }

    // Automated Insights (Including Personnel & Communications)
    const insightsList = $("analyticsInsights");
    if (insightsList) {
      const top = model.breakdown.reduce((b, m) => (m.current > b.current ? m : b), { current: 0, label: "None" });
      const items = [];
      if (model.total > 0) items.push(`<strong>${escapeHTML(top.label)}</strong> leads operational activity with ${top.current} logs (${((top.current / model.total) * 100).toFixed(0)}% share).`);
      if (model.agedRequests > 0) items.push(`<strong>${model.agedRequests} open service requests</strong> have remained active for 7 or more days.`);
      if (model.stock.out > 0) items.push(`<strong>${model.stock.out} inventory supply items</strong> are depleted and require purchase requisition.`);
      if (model.commBreakdown.actionRequired > 0) items.push(`<strong>${model.commBreakdown.actionRequired} documents</strong> require administrative action or endorsements.`);
      if (model.employeeCount > 0) {
        const topDiv = Object.entries(model.divisionCounts).sort((a, b) => b[1] - a[1])[0];
        if (topDiv) items.push(`<strong>${escapeHTML(topDiv[0])}</strong> represents the highest personnel deployment with ${topDiv[1]} staff.`);
      }
      if (!items.length) items.push(model.availableCount ? "No actionable insights in the available records." : "Connect module data or load an existing cache to see insights.");
      insightsList.innerHTML = items.map((txt) => `<li>${txt}</li>`).join("");
    }

    // Breakdown Table
    const breakdownTbody = $("analyticsBreakdownBody");
    if (breakdownTbody) {
      breakdownTbody.innerHTML = model.breakdown.map((m) => {
        const change = m.previous ? ((m.current - m.previous) / m.previous) * 100 : null;
        const variance = !m.available ? "—" : change !== null ? `${change > 0 ? "+" : ""}${change.toFixed(1)}%` : m.current ? "New" : "0%";
        const share = model.total ? ((m.current / model.total) * 100).toFixed(1) : "0.0";
        return `
          <tr>
            <td><span class="analytics-swatch" style="background:${m.color};"></span><strong>${escapeHTML(m.label)}</strong></td>
            <td>${m.available ? m.current.toLocaleString() : "—"}</td>
            <td>${m.available ? m.previous.toLocaleString() : "—"}</td>
            <td>${variance}</td>
            <td>${share}%</td>
            <td><span class="table-tag">${m.source === "live" ? "Updated" : m.source === "cache" ? "Saved copy" : m.source === "stale" ? "Last loaded / unavailable" : "Unavailable"}</span></td>
          </tr>
        `;
      }).join("");
    }

    updateChartPresentation(model);
    $("analyticsDataNote").textContent = `${model.missingDates} records without explicit timestamps were omitted from historical date aggregation.`;
    $("exportAnalyticsBtn").disabled = !model.availableCount;
  }

  // Native, dependency-free charts keep cached dashboards usable if the CDN fails.
  function nativeChart(canvasId, entries, trend = false) {
    const canvas = $(canvasId);
    if (!canvas) return;
    let container = canvas.parentElement.querySelector(".native-chart");
    if (window.Chart) {
      canvas.hidden = false;
      container?.remove();
      return;
    }
    canvas.hidden = true;
    if (!container) {
      container = document.createElement("div");
      container.className = "native-chart";
      container.setAttribute("role", "img");
      container.setAttribute("aria-label", canvas.getAttribute("aria-label"));
      canvas.parentElement.appendChild(container);
    }
    if (trend) {
      const buckets = entries;
      const colors = ["#059669", "#8b5cf6", "#d97706", "#e05271"];
      const keys = ["documents", "travel", "visitors", "services"];
      const labels = ["Documents & ICS", "Travel", "Visitors", "Services"];
      const maximum = Math.max(1, ...buckets.flatMap((b) => keys.map((key) => b[key])));
      const x = (index) => 40 + index * 504 / Math.max(1, buckets.length - 1);
      const y = (value) => 144 - value / maximum * 120;
      const lines = keys.map((key, index) => {
        const points = buckets.map((bucket, i) => `${x(i)},${y(bucket[key])}`).join(" ");
        const markers = buckets.map((bucket, i) => `<circle cx="${x(i)}" cy="${y(bucket[key])}" r="2.6" fill="${colors[index]}"><title>${escapeHTML(bucket.label)} · ${labels[index]}: ${bucket[key]}</title></circle>`).join("");
        return `<polyline fill="none" stroke="${colors[index]}" stroke-width="2" points="${points}"/>${markers}`;
      }).join("");
      const ticks = [...new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1])].filter((i) => i >= 0).map((i) => `<text x="${x(i)}" y="168" text-anchor="${i === 0 ? "start" : i === buckets.length - 1 ? "end" : "middle"}">${escapeHTML(buckets[i].label)}</text>`).join("");
      container.innerHTML = `<svg viewBox="0 0 570 180" aria-hidden="true"><g fill="#64748b" font-size="10"><path d="M40 24H544 M40 84H544 M40 144H544" stroke="#e2e8f0"/><text x="4" y="28">${maximum}</text><text x="18" y="148">0</text>${ticks}</g>${lines}</svg><div class="native-chart-legend">${labels.map((label, i) => `<span><i style="background:${colors[i]}"></i>${label}</span>`).join("")}</div>`;
      return;
    }
    const maximum = Math.max(1, ...entries.map((entry) => entry.value));
    container.innerHTML = entries.map((entry) => `<div class="native-chart-row"><div><span>${escapeHTML(entry.label)}</span><strong>${entry.value.toLocaleString()}</strong></div><div class="native-chart-track"><div class="native-chart-fill" style="width:${entry.value / maximum * 100}%;background:${entry.color || "#059669"}"></div></div></div>`).join("");
  }

  function updateChartPresentation(model) {
    const unavailable = "Data unavailable. Connect the module or load its existing cache.";
    const states = [
      ["analyticsTrendEmpty", model.total, model.availableCount, "No dated activity recorded in this period."],
      ["analyticsDistributionEmpty", model.total, model.availableCount, "No activity in this period."],
      ["analyticsServiceEmpty", model.serviceTotal, model.serviceAvailable, "No service requests in this period."],
      ["analyticsPersonnelEmpty", model.employeeCount, Array.isArray(analyticsSources.employees.rows), "No employee records found."],
      ["analyticsCommEmpty", model.commTotal, Array.isArray(analyticsSources.communications.rows), "No dated communications in this period."]
    ];
    states.forEach(([id, count, available, emptyMessage]) => {
      const node = $(id);
      if (node) { node.hidden = count > 0; node.textContent = available ? emptyMessage : unavailable; }
    });
    setText("analyticsBucketLabel", ({ day: "Daily", week: "Weekly", month: "Monthly" })[model.bucketType]);
    setText("analyticsTrendSummary", `${model.total} dated records · ${model.buckets.length} ${model.bucketType} intervals.`);
    setText("analyticsDistributionSummary", `${model.availableCount} of 6 activity modules available for this period.`);
    setText("analyticsServiceSummary", `${model.serviceStatuses.completed} completed · ${model.serviceStatuses.progress} in progress · ${model.serviceStatuses.pending} pending.`);
    setText("analyticsPersonnelSummary", `${model.employeeCount} registered personnel across ${Object.keys(model.divisionCounts).length} divisions · Current snapshot.`);
    setText("analyticsCommSummary", `${model.commTotal} communications in this period · ${model.commBreakdown.actionRequired} require action. Direction categories count each record once.`);
    nativeChart("monthlyChart", model.buckets, true);
    nativeChart("categoryChart", model.breakdown.map((mod) => ({ label: mod.label, value: mod.current, color: mod.color })));
    nativeChart("statusChart", Object.entries(model.serviceStatuses).map(([label, value]) => ({ label: label === "progress" ? "In progress" : label[0].toUpperCase() + label.slice(1), value })));
    nativeChart("personnelChart", Object.entries(model.divisionCounts).map(([label, value]) => ({ label, value })));
    nativeChart("commChart", ["incoming", "outgoing", "internal", "unclassified"].map((key, i) => ({ label: key[0].toUpperCase() + key.slice(1), value: model.commBreakdown[key], color: ["#2563eb", "#059669", "#6366f1", "#f59e0b"][i] })));
  }

  function csvCell(value) {
    const text = String(value ?? "");
    const safe = /^[\s]*[=+@-]/.test(text) && typeof value !== "number" ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  }

  function exportAnalyticsToCSV() {
    if (!lastAnalyticsModel) return;
    const m = lastAnalyticsModel;
    const rows = [
      ["PGENRO IMS — Executive Data Analytics"],
      ["Generated", new Date().toISOString()],
      ["Reporting Period", `${new Date(m.start * analyticsDayMs).toISOString().slice(0, 10)} to ${new Date(m.end * analyticsDayMs).toISOString().slice(0, 10)}`],
      [],
      ["Module", "Current Period", "Previous Period", "Share %"],
      ...m.breakdown.map((mod) => [mod.label, mod.current, mod.previous, m.total ? ((mod.current / m.total) * 100).toFixed(1) : 0]),
      [],
      ["Personnel by Functional Division", "Headcount"],
      ...Object.entries(m.divisionCounts).map(([div, cnt]) => [div, cnt]),
      [],
      ["Communications Dispatch Classification", "Count"],
      ["Incoming Transmittals", m.commBreakdown.incoming],
      ["Outgoing Endorsements", m.commBreakdown.outgoing],
      ["Internal Directives", m.commBreakdown.internal],
      ["Unclassified", m.commBreakdown.unclassified],
      ["Action Required", m.commBreakdown.actionRequired],
      [],
      ["Service Status", "Count"],
      ...Object.entries(m.serviceStatuses).map(([st, cnt]) => [st, cnt]),
      [],
      ["Stock Classification", "Count"],
      ...Object.entries(m.stock).map(([k, v]) => [k, v])
    ];

    const csvContent = "\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    downloadBlob(csvContent, `PGENRO_Analytics_${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8;");
    logAudit("EXPORT_ANALYTICS", "Exported executive data analytics summary to CSV.");
  }

  /* --------------------------------------------------------------------------
     7. DATA CAPTURE & CACHE REFRESH
     -------------------------------------------------------------------------- */
  function captureRows(key, rows, source = "live") {
    if (!analyticsSources[key] || !Array.isArray(rows)) return;
    rows = rows.filter((row) => row && typeof row === "object" && !Array.isArray(row)).map(unwrapRow);
    analyticsSources[key] = { rows, source };

    if (key === "employees") animateCounter("kpiPersonnel", rows.length);
    if (key === "requests") animateCounter("kpiPendingAcc", rows.filter((r) => String(r.status || "Pending").toLowerCase() === "pending").length);
    if (key === "ics") animateCounter("kpiActiveICS", rows.length);
    if (key === "inventory") {
      const st = stockSummary(rows);
      animateCounter("kpiLowStock", st.out + st.low);
    }

    // Module Control Grid counts
    const countIds = {
      communications: "modCommCount",
      travel: "modTravelCount",
      memos: "modMemoCount",
      employees: "modEmployeeCount",
      inventory: "modInventoryCount",
      visitors: "modVisitorCount",
      services: "modServiceCount",
      ics: "modIcsCount",
      users: "modUserCount",
      requests: "modRequestCount"
    };

    if (countIds[key]) {
      const count = key === "requests" ? rows.filter((r) => String(r.status || "Pending").toLowerCase() === "pending").length : rows.length;
      animateCounter(countIds[key], count);
    }

    if (key === "services") {
      const openCount = rows.filter((r) => ["pending", "progress"].includes(serviceBucket(r))).length;
      setText("sidebarOpenServicesBadge", `${openCount} Open`);
    }

    if (key === "requests") {
      const pendingCount = rows.filter((r) => String(r.status || "Pending").toLowerCase() === "pending").length;
      setText("sidebarPendingAccBadge", `${pendingCount} New`);
    }

    if (key === "memos") {
      memosList = rows;
      renderMemoStream(rows);
    }

    if (source === "live") window.PGENRO_Module.observeRecords(key, rows);
    scheduleAnalytics();
  }

  function renderMemoStream(rows) {
    const stream = $("memoStreamList");
    if (!stream) return;
    setText("memosTotalCountLabel", `${rows.length} Memos Recorded`);

    if (!rows.length) {
      stream.innerHTML = `<div class="empty-table-cell">No memos recorded in database.</div>`;
      return;
    }

    const sorted = [...rows].sort((a, b) => auditDate(b) - auditDate(a)).slice(0, 5);
    stream.innerHTML = sorted.map((memo) => `
      <div class="memo-stream-item">
        <div>
          <div class="memo-stream-title">${memo.memoNo ? `[${escapeHTML(memo.memoNo)}] ` : ""}${escapeHTML(memo.title || memo.subject || "Office Memorandum")}</div>
          <div class="memo-stream-meta">${escapeHTML(memo.issuedBy || memo.author || "PGENRO Admin")} · ${auditDate(memo).toLocaleDateString()}</div>
        </div>
        <a class="icon-btn-sm" href="officememo-admin.html" title="Open Office Memos"><i data-lucide="external-link"></i></a>
      </div>
    `).join("");

    renderIcons();
  }

  function loadLocalModuleCaches() {
    const cacheMap = {
      communications: ["pgenro_communications", "communicationRecords"],
      travel: ["pgenro_admin_travel_orders_live_cache_v2", "travelOrders"],
      memos: ["pgenro_office_memos", "officeMemos"],
      employees: ["pgenro_admin_employees", "employees"],
      inventory: ["pgenro_admin_inventory_live_cache_v2", "inventoryRecords"],
      visitors: ["pgenro_visitors", "visitorRecords"],
      services: ["pgenro_service_requests", "serviceRequests"],
      ics: ["pgenro_ics_records", "icsRecords"],
      users: ["pgenro_users", "users"],
      requests: ["pgenro_access_requests", "accessRequests"]
    };

    for (const [modKey, keys] of Object.entries(cacheMap)) {
      if (analyticsSources[modKey].source === "live") continue;
      for (const k of keys) {
        const raw = localStore.getItem(k);
        if (raw) {
          const parsed = safeJson(raw, null);
          if (Array.isArray(parsed)) {
            captureRows(modKey, parsed, "cache");
            break;
          }
        }
      }
    }
  }

  function renderNotifications(requests) {
    const pending = requests.filter((r) => String(r.status || "Pending").trim().toLowerCase() === "pending");
    setText("notifBadgeCount", `${pending.length} Pending`);
    if ($("notifPing")) $("notifPing").style.display = pending.length ? "block" : "none";
    if ($("notificationList")) $("notificationList").innerHTML = pending.length
      ? pending.slice(0, 5).map((r) => `<a href="requestacc.html" class="notification-item"><strong>${escapeHTML(r.fullName || r.name || "Access Request")}</strong><span>${escapeHTML(r.email || "Pending Administrator Approval")}</span></a>`).join("")
      : '<div class="empty-notif-state">No pending requests in available data</div>';
  }

  function updateConnectionStatus() {
    const live = Object.values(analyticsSources).filter((source) => source.source === "live").length;
    const text = !navigator.onLine ? "Offline · cached data" : !sb ? "Local cache mode" : live === 10 ? "Synchronized" : live ? `${live}/10 modules available` : "Data unavailable";
    setText("dbStatusText", text);
    if ($("dbStatusDot")) $("dbStatusDot").className = `status-dot ${navigator.onLine && live === 10 ? "online" : "offline"}`;
  }

  function initDatabaseSync() {
    updateConnectionStatus();
    if (!sb) return;
    setText("dbStatusText", "Connecting…");
    Object.entries(moduleTableKeys).forEach(([table, modKey]) => {
      const ref = supabaseStore.realtimeStore().ref(table);
      subscriptions.push(ref);
      ref.on("value", (snap) => {
        captureRows(modKey, Object.values(snap.val() || {}), "live");
        updateConnectionStatus();
      }, () => {
        if (analyticsSources[modKey].source === "live") analyticsSources[modKey].source = "stale";
        updateConnectionStatus();
        scheduleAnalytics();
      });
    });
    const auditRef = supabaseStore.realtimeStore().ref("audit_logs");
    subscriptions.push(auditRef);
    auditRef.on("value", (snap) => {
      remoteAuthLogs = Object.values(snap.val() || {});
      refreshAuditLogs();
    });
  }

  /* --------------------------------------------------------------------------
     8. GLOBAL SEARCH & QUICK COMMAND PALETTE
     -------------------------------------------------------------------------- */
  function setupCommandPalette() {
    const input = $("globalSearchInput");
    const palette = $("searchPaletteDropdown");
    const modContainer = $("searchPaletteModules");
    if (!input || !palette || !modContainer) return;

    const searchableItems = [
      { name: "Executive Dashboard", href: "admin.html", icon: "layout-dashboard" },
      { name: "Communications Log", href: "admincommunication.html", icon: "arrow-left-right" },
      { name: "Travel Orders Registry", href: "travelOR-admin.html", icon: "briefcase" },
      { name: "Office Memoranda Directives", href: "officememo-admin.html", icon: "file-text" },
      { name: "Employee Directory", href: "employee-admin.html", icon: "users" },
      { name: "Supplies Inventory", href: "invetoryadmin.html", icon: "boxes" },
      { name: "Visitor Pass Management", href: "visitors-admin.html", icon: "clipboard-check" },
      { name: "Service Requests Action Center", href: "serviceAdmin.html", icon: "wrench" },
      { name: "Inventory Custodian Slips (ICS)", href: "ics-admin.html", icon: "file-check-2" },
      { name: "User Account Management", href: "Usermanagement.html", icon: "user-cog" },
      { name: "Account Requests Clearance", href: "requestacc.html", icon: "user-plus" },
      { name: "Security Audit Trail", href: "#audit", icon: "shield-alert" },
      { name: "System Backup & Recovery", href: "#backup", icon: "database-backup" },
      { name: "Workspace Preferences", href: "#settings", icon: "settings" }
    ];

    let activeIndex = -1;
    function filterPalette(q) {
      activeIndex = -1;
      const matches = searchableItems.filter((i) => i.name.toLowerCase().includes(q));
      if (!matches.length) {
        modContainer.innerHTML = `<div style="padding: 12px 14px; font-size: 11.5px; color: var(--text-muted);">No matching administrative destinations.</div>`;
      } else {
        modContainer.innerHTML = matches.map((m) => `
          <a class="search-palette-item" href="${m.href}">
            <i data-lucide="${m.icon}" style="width: 15px; height: 15px; color: var(--emerald-600);"></i>
            <span>${escapeHTML(m.name)}</span>
          </a>
        `).join("");
      }
      renderIcons();
    }

    input.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (q) {
        palette.classList.add("open");
        filterPalette(q);
      } else {
        palette.classList.remove("open");
      }
      input.setAttribute("aria-expanded", String(Boolean(q)));

      // Live filter Module Control Cards
      document.querySelectorAll(".module-control-card").forEach((card) => {
        card.style.display = !q || card.textContent.toLowerCase().includes(q) ? "" : "none";
      });
    });

    input.addEventListener("focus", () => {
      if (input.value.trim()) {
        palette.classList.add("open");
        input.setAttribute("aria-expanded", "true");
      }
    });

    input.addEventListener("keydown", (event) => {
      if (!palette.classList.contains("open")) return;
      const matches = [...modContainer.querySelectorAll("a")];
      if (!matches.length) return;
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        activeIndex = (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
        matches.forEach((match, index) => match.classList.toggle("is-active", index === activeIndex));
        matches[activeIndex].scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter") {
        event.preventDefault(); matches[Math.max(0, activeIndex)].click();
      }
    });
    palette.addEventListener("click", (event) => {
      if (event.target.closest("a")) { palette.classList.remove("open"); input.setAttribute("aria-expanded", "false"); }
    });

    document.addEventListener("click", (e) => {
      if (!input.contains(e.target) && !palette.contains(e.target)) {
        palette.classList.remove("open");
        input.setAttribute("aria-expanded", "false");
      }
    });

    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });
  }

  /* --------------------------------------------------------------------------
     9. BACKUP, RESTORE & EXPORT UTILITIES
     -------------------------------------------------------------------------- */
  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Backups cover workspace records and preferences, excluding session identities.
  const backupKeys = new Set([
    "pgenro_admin_preferences", "pgenro_admin_sidebar", "pgenro_audit_log_fallback",
    "communicationRecords", "pgenro_communications", "pgenro_admin_travel_orders_live_cache_v2", "travelOrders",
    "pgenro_office_memos", "officeMemos", "pgenro_admin_employees", "employees",
    "pgenro_admin_inventory_live_cache_v2", "inventoryRecords", "pgenro_visitors", "visitorRecords",
    "pgenro_service_requests", "serviceRequests", "pgenro_ics_records", "icsRecords",
    "pgenro_users", "users", "pgenro_access_requests", "accessRequests"
  ]);

  function validateBackup(backup) {
    if (!backup || backup.meta?.system !== "PGENRO IMS" || !backup.storage || typeof backup.storage !== "object" || Array.isArray(backup.storage)) {
      throw new Error("Choose a valid PGENRO IMS backup file.");
    }
    const entries = Object.entries(backup.storage).filter(([key]) => backupKeys.has(key));
    if (!entries.length) throw new Error("The file contains no supported workspace records.");
    for (const [key, value] of entries) {
      if (typeof value !== "string") throw new Error(`Invalid value for ${key}.`);
      if (key === "pgenro_admin_sidebar") {
        if (!["collapsed", "expanded"].includes(value)) throw new Error("Invalid sidebar preference.");
      } else {
        const parsed = JSON.parse(value);
        if (key === preferenceKey) {
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid preferences.");
        } else if (!Array.isArray(parsed)) throw new Error(`Invalid record list for ${key}.`);
      }
    }
    return entries;
  }

  function showToast(message, type = "success") { window.PGENRO_Module.toast(message,type); }

  /* --------------------------------------------------------------------------
     10. INITIALIZATION & DOM EVENT BINDINGS
     -------------------------------------------------------------------------- */
  function initializeDashboard() {
    // 1. Initialize Profile & Cache
    const localUser = safeJson(localStore.getItem("pgenro_current_user"), null);
    if (localUser) updateProfileUI(localUser);

    applyPreferences();
    loadLocalAuditLogs();
    refreshAuditLogs();
    loadLocalModuleCaches();

    // 2. Initialize Charts & Database
    updateChartsAndAnalytics();
    initDatabaseSync();
    logAudit("PAGE_VISIT", "Opened the administrator dashboard.", { module: "Admin Dashboard" });
    window.addEventListener("storage", () => {
      applyPreferences(); loadLocalAuditLogs(); refreshAuditLogs(); loadLocalModuleCaches();
    });
    window.addEventListener("offline", () => {
      Object.values(analyticsSources).forEach((source) => { if (source.source === "live") source.source = "stale"; });
      updateConnectionStatus(); scheduleAnalytics();
    });
    window.addEventListener("online", updateConnectionStatus);

    // 3. Command Palette
    setupCommandPalette();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeAuditInspector();
        $("searchPaletteDropdown")?.classList.remove("open");
        $("globalSearchInput")?.setAttribute("aria-expanded", "false");
      }
    });

    // 6. Audit Trail Search & Pagination Events
    function resetAuditFilters() { auditCurrentPage = 1; applyAuditFilters(); }
    $("tableSearchInput")?.addEventListener("input", resetAuditFilters);
    $("auditTypeFilter")?.addEventListener("change", resetAuditFilters);

    $("auditPaginationControls")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".audit-page-btn");
      if (!btn || btn.disabled) return;
      if (btn.id === "auditPrevBtn") auditCurrentPage--;
      else if (btn.id === "auditNextBtn") auditCurrentPage++;
      else if (btn.dataset.page) auditCurrentPage = Number(btn.dataset.page);
      applyAuditFilters();
      $("auditScrollBox")?.scrollTo({ top: 0, behavior: "smooth" });
    });

    $("selectAllRows")?.addEventListener("change", (e) => {
      const checked = e.target.checked;
      document.querySelectorAll(".row-checkbox").forEach((cb) => {
        cb.checked = checked;
        const id = cb.getAttribute("data-id");
        if (checked) selectedAuditIds.add(id);
        else selectedAuditIds.delete(id);
        cb.closest("tr").classList.toggle("is-selected", checked);
      });
    });

    $("exportCsvBtn")?.addEventListener("click", () => {
      if (!filteredAuditLogs.length) {
        showToast("No audit logs available to export.", "warning");
        return;
      }
      const logsToExport = selectedAuditIds.size
        ? filteredAuditLogs.filter((l) => selectedAuditIds.has(auditKey(l)))
        : filteredAuditLogs;

      const rows = [
        ["Timestamp", "User Account", "User Email", "Action", "Details", "Module", "Role", "IP Address", "Status"],
        ...logsToExport.map((l) => [
          auditDate(l).toISOString(),
          l.userName || "System",
          l.userEmail || "",
          l.activity || l.action || "",
          l.details || "",
          l.module || "",
          l.role || "",
          l.ipAddress || "",
          l.sessionStatus || "Success"
        ])
      ];

      const csv = "\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
      downloadBlob(csv, `PGENRO_Audit_Trail_${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8;");
      logAudit("EXPORT_AUDIT_CSV", `Exported ${logsToExport.length} audit logs to CSV file.`);
      showToast(`Exported ${logsToExport.length} logs to CSV.`);
    });

    $("auditDetailModal")?.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const first = $("closeAuditModalBtn"), last = $("closeAuditModalBtn2");
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });

    // 7. Modal Inspector close buttons
    $("closeAuditModalBtn")?.addEventListener("click", closeAuditInspector);
    $("closeAuditModalBtn2")?.addEventListener("click", closeAuditInspector);
    $("auditDetailModal")?.addEventListener("click", (e) => {
      if (e.target === $("auditDetailModal")) closeAuditInspector();
    });

    // 8. Analytics Period & Export
    $("analyticsPeriod")?.addEventListener("change", (e) => {
      analyticsRange = e.target.value;
      updateChartsAndAnalytics();
    });
    $("exportAnalyticsBtn")?.addEventListener("click", exportAnalyticsToCSV);

    // 9. Backup & Restore
    $("downloadLocalBackupBtn")?.addEventListener("click", () => {
      const backupData = {
        meta: { system: "PGENRO IMS", version: "2026.1", exportedAt: new Date().toISOString() },
        storage: {}
      };
      backupKeys.forEach((key) => {
        const value = localStore.getItem(key);
        if (value !== null) backupData.storage[key] = value;
      });
      if (!Object.keys(backupData.storage).length) { showToast("No local workspace records available to back up.", "warning"); return; }
      downloadBlob(JSON.stringify(backupData, null, 2), `PGENRO_Local_Backup_${new Date().toISOString().slice(0, 10)}.json`, "application/json");
      logAudit("DOWNLOAD_BACKUP", "Created full local browser backup archive.");
      showToast("Backup file downloaded.");
    });

    $("restoreBackupInput")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        if (file.size > 20 * 1024 * 1024) throw new Error("Backup exceeds the 20 MB limit.");
        const json = JSON.parse(await file.text());
        const entries = validateBackup(json);
        if (confirm("Restore this local backup archive? Existing matching cache keys will be replaced.")) {
          const previous = new Map(entries.map(([key]) => [key, localStore.getItem(key)]));
          try {
            for (const [key, value] of entries) {
              if (!localStore.setItem(key, value)) throw new Error("Browser storage is unavailable or full.");
            }
          } catch (error) {
            previous.forEach((value, key) => value === null ? localStore.removeItem(key) : localStore.setItem(key, value));
            throw error;
          }
          loadLocalAuditLogs();
          logAudit("RESTORE_BACKUP", `Restored local backup from ${file.name}.`);
          showToast("Backup restored. Reloading workspace...");
          setTimeout(() => location.reload(), 1000);
        }
      } catch (err) {
        showToast(`Restore failed: ${err.message}`, "error");
      } finally {
        e.target.value = "";
      }
    });

    // 10. Workspace Preferences
    $("compactModeToggle")?.addEventListener("change", savePreferences);
    $("showDbStatusToggle")?.addEventListener("change", savePreferences);
    $("resetAdminPrefsBtn")?.addEventListener("click", () => {
      localStore.removeItem(preferenceKey);
      applyPreferences();
      showToast("Workspace preferences reset to default.");
    });

    // 11. Sign Out
    $("logoutBtn")?.addEventListener("click", async () => {
      if (!confirm("Are you sure you want to sign out of the Administrator console?")) return;
      try {
        await logAudit("LOGOUT", "Operator signed out of administrative workspace.");
        await supabaseStore.auth().signOut();
      } catch (error) {
        showToast("Sign out failed. Please try again.", "error");
        return;
      }
      localStore.removeItem("pgenro_current_user");
      try { sessionStorage.removeItem("pgenro_current_user"); } catch {}
      window.location.href = "../User/login.html";
    });

    // Lucide Icons Render
    renderIcons();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeDashboard, { once: true });
  else initializeDashboard();
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) subscriptions.forEach((ref) => ref.off());
  });
})();

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
      const update = () => { const overflow = region.scrollWidth > region.clientWidth+2; controls.hidden = !overflow; left.disabled = region.scrollLeft <= 2; right.disabled = region.scrollLeft + region.clientWidth >= region.scrollWidth-2; };
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
        sidebarToggle.replaceChildren(icon); renderIcons();
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

    // Keep the genuine seal when available; show an environmental symbol if missing.
    const seal = document.querySelector('.logo-image');
    function showSealFallback() {
      if (!seal || !seal.parentElement) return;
      seal.hidden = true;
      const host = seal.parentElement;
      host.classList.add('logo-fallback');
      if (!host.querySelector('.logo-fallback-mark')) {
        const mark = document.createElement('i');
        mark.dataset.lucide = 'leaf';
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

    // Nothing is hidden waiting for JavaScript or an observer to run.
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let entranceObserver;
    function configureMotion() {
      entranceObserver?.disconnect();
      if (motion.matches || !('IntersectionObserver' in window)) return;
      entranceObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('ui-entering');
          entry.target.addEventListener('animationend', () => entry.target.classList.remove('ui-entering'), { once: true });
          entranceObserver.unobserve(entry.target);
        }
      }, { threshold: 0.05 });
      document.querySelectorAll('.main-content > :is(section, .card, .panel, .table-card, .memo-dashboard-grid, .visitor-filter-panel, .toolbar-container)').forEach(surface => {
        if (!surface.matches('.page-header, .kpi-grid') && !surface.dataset.calmSeen) {
          surface.dataset.calmSeen = 'true';
          entranceObserver.observe(surface);
        }
      });
    }
    configureMotion();
    motion.addEventListener?.('change', configureMotion);
    window.addEventListener('pagehide', event => { if (!event.persisted) { entranceObserver?.disconnect(); profileObserver?.disconnect(); iconObserver?.disconnect(); sidebarObserver?.disconnect(); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initModernWorkspace, { once: true });
  else initModernWorkspace();
})();

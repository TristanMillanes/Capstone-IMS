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
  Object.assign(icons,{
   'pin':[['path',{d:'M16 3 9 10l-4 1 8 8 1-4 7-7ZM5 19l-2 2'}]],
   'bar-chart-3':[['path',{d:'M3 3v18h18M7 17v-5M12 17V8M17 17V5'}]],
   'edit-3':[['path',{d:'M12 20h9M16 3l5 5-12 12-6 1 1-6Z'}]],
   'scan-text':[['path',{d:'M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M7 8h10M7 12h10M7 16h6'}]]
  });
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
const M=window.PGENRO_Module;
document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) {
    M.renderIcons();
  }

  // =========================================================================
  // 1. SUPABASE CONFIGURATION & INITIALIZATION
  // =========================================================================
  let online=false,busy=false,fileBusy=false,ocrBusy=false,readVersion=0,channel=null,returnToEditor=false;
  // =========================================================================
  // 2. STATE MANAGEMENT & DOM ELEMENTS
  // =========================================================================
  let rawMemos = [];
  let filteredMemos = [];
  const selectedMemoIds=new Set();
  let deleteTargetId = null;
  let currentPage = 1;
  const rowsPerPage = 8;

  // Table & Filters
  const memoTableBody = document.getElementById("memoAdminTableBody");
  const tableFilterInput = document.getElementById("tableFilterInput");
  const globalSearchInput = document.getElementById("globalSearchInput");
  const pinnedFilterSelect = document.getElementById("pinnedFilterSelect");
  const attachmentFilterSelect = document.getElementById("attachmentFilterSelect");
  const selectAllCheckbox = document.getElementById("selectAllCheckbox");
  const paginationInfo = document.getElementById("memoPaginationInfo");
  const paginationBtns = document.getElementById("tablePaginationBtns");
  const printRegistryBtn = document.getElementById("printRegistryBtn");

  // Memo Form Modal
  const memoFormModal = document.getElementById("memoFormModal");
  const memoForm = document.getElementById("memoForm");
  const openCreateModalBtn = document.getElementById("openCreateModalBtn");
  const closeFormModalBtn = document.getElementById("closeFormModalBtn");
  const cancelFormModalBtn = document.getElementById("cancelFormModalBtn");
  const modalFormTitle = document.getElementById("modalFormTitle");

  // Form Inputs
  const memoDocId = document.getElementById("memoDocId");
  const formControlNo = document.getElementById("formControlNo");
  const formDate = document.getElementById("formDate");
  const formAddressedTo = document.getElementById("formAddressedTo");
  const formSubject = document.getElementById("formSubject");
  const formIssuedBy = document.getElementById("formIssuedBy");
  const formRemarks = document.getElementById("formRemarks");
  const formIsPinned = document.getElementById("formIsPinned");
  const formPdfFile = document.getElementById("formPdfFile");
  const formExistingPdfBase64 = document.getElementById("formExistingPdfBase64");
  const attachedFileInfo = document.getElementById("attachedFileInfo");
  const attachedFileName = document.getElementById("attachedFileName");
  const removeAttachmentBtn = document.getElementById("removeAttachmentBtn");
  const fileDropzone = document.getElementById("fileDropzone");
  const attachedFileMeta = document.getElementById("attachedFileMeta");
  const attachedFileState = document.getElementById("attachedFileState");
  const previewSelectedPdfBtn = document.getElementById("previewSelectedPdfBtn");
  const memoUploadStatus = document.getElementById("memoUploadStatus");
  const memoUploadStatusText = document.getElementById("memoUploadStatusText");
  const memoUploadProgress = document.getElementById("memoUploadProgress");
  const memoUploadProgressBar = document.getElementById("memoUploadProgressBar");
  const memoUploadProgressLabel = document.getElementById("memoUploadProgressLabel");
  const saveMemoSubmitBtn = document.getElementById("saveMemoSubmitBtn");
  const saveMemoSubmitText = document.getElementById("saveMemoSubmitText");

  // Memorandum OCR
  const runMemoOcrBtn = document.getElementById("runMemoOcrBtn");
  const memoOcrStatus = document.getElementById("memoOcrStatus");
  const memoOcrText = document.getElementById("memoOcrText");

  let selectedMemoFile = null;
  let memoOcrToken = 0;

  // PDF Viewer Modal
  const viewPdfModal = document.getElementById("viewPdfModal");
  const memoPdfToolbar = document.getElementById("memoPdfToolbar");
  const memoPdfStage = document.getElementById("memoPdfStage");
  const memoPdfCanvas = document.getElementById("memoPdfCanvas");
  const memoPdfPrevPage = document.getElementById("memoPdfPrevPage");
  const memoPdfNextPage = document.getElementById("memoPdfNextPage");
  const memoPdfPageLabel = document.getElementById("memoPdfPageLabel");
  const memoPdfZoom = document.getElementById("memoPdfZoom");
  const memoPdfRenderStatus = document.getElementById("memoPdfRenderStatus");
  const memoAttachmentImage = document.getElementById("memoAttachmentImage");
  const memoAttachmentText = document.getElementById("memoAttachmentText");
  const openPdfNewTabBtn = document.getElementById("openPdfNewTabBtn");
  const adminNoPdfState = document.getElementById("adminNoPdfState");
  const viewPdfTitle = document.getElementById("viewPdfTitle");
  const viewPdfSubtitle = document.getElementById("viewPdfSubtitle");
  const downloadPdfBtn = document.getElementById("downloadPdfBtn");
  const closeViewPdfBtn = document.getElementById("closeViewPdfBtn");
  const dismissViewPdfBtn = document.getElementById("dismissViewPdfBtn");

  // Delete Confirmation Modal
  const deleteConfirmModal = document.getElementById("deleteConfirmModal");
  const deleteMemoNoLabel = document.getElementById("deleteMemoNoLabel");
  const closeDeleteModalBtn = document.getElementById("closeDeleteModalBtn");
  const cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
  const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");

  // KPI Counters
  const kpiTotalMemos = document.getElementById("kpiTotalMemos");
  const kpiPinnedMemos = document.getElementById("kpiPinnedMemos");
  const kpiThisMonthMemos = document.getElementById("kpiThisMonthMemos");
  const kpiWithAttachments = document.getElementById("kpiWithAttachments");

  // Shared profile/mobile navigation is centralized in the page-owned admin shell below.
  const exportCsvBtn = document.getElementById("exportCsvBtn");

  if (printRegistryBtn) {
    printRegistryBtn.addEventListener("click", () => window.print());
  }

  // =========================================================================
  // 3. TOAST NOTIFICATIONS
  // =========================================================================
  const showToast=M.toast;
  // =========================================================================
  // 4. DATA SYNCHRONIZATION
  // =========================================================================
  let routedMemoShown=false;
  async function loadMemos(){
    const version=++readVersion;
    try{const rows=await M.read('office_memos');if(version!==readVersion)return false;rawMemos=rows.map(r=>({...r,id:String(r.id),isPinned:r.isPinned===true||r.isPinned==="true"}));for(const id of selectedMemoIds)if(!rawMemos.some(m=>m.id===id))selectedMemoIds.delete(id);online=true;M.storage.set('pgenro_office_memos',rawMemos);M.observeRecords('office memos',rawMemos);
      const params=new URLSearchParams(location.search),routed=rawMemos.find(m=>m.id===params.get('memo'));
      if(!routedMemoShown&&routed&&params.get('uploaded')==='1'){routedMemoShown=true;tableFilterInput.value=globalSearchInput.value=routed.memoNo||'';showToast(`Memorandum ${routed.memoNo||''} saved in Office Memos.`);const clean=new URL(location.href);clean.searchParams.delete('uploaded');history.replaceState(null,'',clean.href);}
      applyFiltersAndRender(false);calculateKpis();return true;}
    catch(error){if(version!==readVersion)return false;online=false;const cache=M.storage.get('pgenro_office_memos',[]);if(!rawMemos.length&&Array.isArray(cache))rawMemos=cache;applyFiltersAndRender();calculateKpis();showToast(error.message||'Memo registry could not refresh. Cached records are read-only.','error');return false;}
  }
  function listenToMemos(){loadMemos();if(M.client())channel=M.client().channel('admin-office-memos').on('postgres_changes',{event:'*',schema:'public',table:'office_memos'},loadMemos).subscribe();document.getElementById('refreshMemosBtn').onclick=async()=>{const b=document.getElementById('refreshMemosBtn');b.disabled=true;try{if(await loadMemos())showToast('Memo registry refreshed.');}finally{b.disabled=false;}};window.addEventListener('pagehide',(event)=>{if(event.persisted)return;readVersion++;memoOcrToken++;if(channel)M.client()?.removeChannel(channel);});}

  // =========================================================================
  // 5. KPI METRICS
  // =========================================================================
  function computeMemoDashboard(rows,today=M.today()) {
    const [year,month]=today.split('-').map(Number),months=[];
    for(let offset=5;offset>=0;offset--){const d=new Date(Date.UTC(year,month-1-offset,1));months.push({key:`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`,label:d.toLocaleDateString('en-PH',{month:'short',timeZone:'UTC'}),count:0});}
    const current=months[5].key,previous=months[4].key;
    let pinned=0,attached=0,thisMonth=0,lastMonth=0,undated=0;
    for(const memo of rows){if(memo.isPinned)pinned++;if(String(memo.pdfUrl||'').trim())attached++;const date=parseMemoDate(memo.date);
      if(!date){undated++;continue;}const key=date.slice(0,7),bucket=months.find(m=>m.key===key);if(bucket)bucket.count++;if(key===current)thisMonth++;if(key===previous)lastMonth++;}
    return {total:rows.length,pinned,attached,thisMonth,lastMonth,undated,months};
  }
  function calculateKpis() {
    const stats=computeMemoDashboard(rawMemos);
    for(const [element,value]of [[kpiTotalMemos,stats.total],[kpiPinnedMemos,stats.pinned],[kpiThisMonthMemos,stats.thisMonth],[kpiWithAttachments,stats.attached]])if(element)element.textContent=value.toLocaleString();
    const trend=document.getElementById('memoMonthTrend'),coverage=document.getElementById('memoAttachmentCoverage');
    if(trend){const diff=stats.thisMonth-stats.lastMonth;trend.textContent=diff===0?'Same count as last month':`${Math.abs(diff)} ${diff>0?'more':'fewer'} than last month`;}
    if(coverage)coverage.textContent=stats.total?`${Math.round(stats.attached/stats.total*100)}% of records have a document`:'No documents recorded yet';
    const chart=document.getElementById('memoMonthlyChart'),max=Math.max(1,...stats.months.map(m=>m.count));
    if(chart)chart.innerHTML=stats.months.map(m=>`<div class="memo-month-column" role="listitem"><button type="button" class="memo-month-button" data-memo-month="${escapeHtml(m.key)}" aria-label="Show ${m.count} memorandums issued in ${escapeHtml(m.label+' '+m.key.slice(0,4))}" aria-pressed="${document.getElementById('memoMonthFilter').value===m.key}"><span class="memo-month-count">${m.count}</span><span class="memo-month-track" aria-hidden="true"><span class="memo-month-fill" style="height:${Math.round(m.count/max*100)}%"></span></span><span class="memo-month-label">${m.label}</span></button></div>`).join('');
    document.getElementById('memoChartPeriod').textContent=`${stats.months[0].label} ${stats.months[0].key.slice(0,4)} – ${stats.months[5].label} ${stats.months[5].key.slice(0,4)} · all registry records`;
    document.getElementById('memoChartSummary').textContent=`${stats.months.reduce((n,m)=>n+m.count,0)} memorandum(s) issued in this period.${stats.undated?` ${stats.undated} record(s) have no valid issue date.`:''}`;
    const quick=[...rawMemos].sort((a,b)=>Number(b.isPinned)-Number(a.isPinned)||String(b.date||'').localeCompare(String(a.date||''))||String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,3);
    document.getElementById('memoPriorityList').innerHTML=quick.length?quick.map(m=>`<button class="memo-quick-item" type="button" data-memo-open="${escapeHtml(m.id)}"><i data-lucide="${m.isPinned?'pin':'file-text'}"></i><span class="memo-quick-copy"><strong>${escapeHtml(m.memoNo||'Memorandum')}</strong><span>${escapeHtml(m.subject||m.title||'No subject recorded')}</span><small>${m.isPinned?'Pinned · ':''}${escapeHtml(m.date||'Date not recorded')}</small></span></button>`).join(''):'<p class="memo-dashboard-note">Your pinned and recent memorandums will appear here.</p>';
    M.renderIcons();
  }
  document.getElementById('memoPriorityList').addEventListener('click',e=>{const button=e.target.closest('[data-memo-open]');if(!button||busy||ocrBusy||fileBusy)return;const memo=rawMemos.find(m=>m.id===button.dataset.memoOpen);if(memo)openEditModal(memo);});
  function updateMemoSelection(){
    const visible=filteredMemos.slice((currentPage-1)*rowsPerPage,currentPage*rowsPerPage),count=visible.filter(m=>selectedMemoIds.has(m.id)).length;
    selectAllCheckbox.checked=visible.length>0&&count===visible.length;selectAllCheckbox.indeterminate=count>0&&count<visible.length;
    document.getElementById('memoSelectionBar').hidden=!selectedMemoIds.size;document.getElementById('memoSelectionCount').textContent=`${selectedMemoIds.size} memo(s) selected for export`;
    exportCsvBtn.innerHTML=`<i data-lucide="download"></i> ${selectedMemoIds.size?`Export Selected (${selectedMemoIds.size})`:'Export CSV'}`;M.renderIcons();
  }

  // =========================================================================
  // 6. FILTERING, SEARCH & PAGINATION
  // =========================================================================
  function applyFiltersAndRender(resetPage=true) {
    const term = (tableFilterInput?.value || globalSearchInput?.value || "").toLowerCase().trim();
    const pinnedFilter = pinnedFilterSelect?.value || "all";
    const attachmentFilter = attachmentFilterSelect?.value || "all";
    const monthFilter = document.getElementById("memoMonthFilter").value;
    const sort = document.getElementById("memoSortSelect").value;

    filteredMemos = rawMemos.filter((memo) => {
      const controlNo = String(memo.memoNo || "").toLowerCase();
      const subject = String(memo.subject || memo.title || "").toLowerCase();
      const addressedTo = String(memo.addressedTo || "").toLowerCase();
      const remarks = String(memo.remarks || "").toLowerCase();

      const matchesSearch = !term || controlNo.includes(term) || subject.includes(term) || addressedTo.includes(term) || remarks.includes(term);

      let matchesPinned = true;
      if (pinnedFilter === "pinned") matchesPinned = memo.isPinned === true;
      if (pinnedFilter === "unpinned") matchesPinned = !memo.isPinned;

      let matchesAttachment = true;
      const hasAttachment = Boolean(memo.pdfUrl && memo.pdfUrl.trim() !== "");
      if (attachmentFilter === "with_pdf") matchesAttachment = hasAttachment;
      if (attachmentFilter === "no_pdf") matchesAttachment = !hasAttachment;

      return (matchesSearch||String(memo.issuedBy||"").toLowerCase().includes(term)) && matchesPinned && matchesAttachment && (!monthFilter || parseMemoDate(memo.date).slice(0,7) === monthFilter);
    });

    const byDate = (a,b) => String(parseMemoDate(b.date)||'').localeCompare(String(parseMemoDate(a.date)||'')) || String(b.createdAt||b.created_at||'').localeCompare(String(a.createdAt||a.created_at||''));
    filteredMemos.sort((a,b) => sort==='number' ? String(a.memoNo||'').localeCompare(String(b.memoNo||''),undefined,{numeric:true}) : sort==='oldest' ? -byDate(a,b) : sort==='newest' ? byDate(a,b) : Number(b.isPinned)-Number(a.isPinned)||byDate(a,b));
    const activeFilters=[];
    if(term)activeFilters.push(`Search: ${term}`);
    if(pinnedFilter!=='all')activeFilters.push(pinnedFilter==='pinned'?'Pinned only':'Unpinned only');
    if(attachmentFilter!=='all')activeFilters.push(attachmentFilter==='with_pdf'?'With attachment':'Without attachment');
    if(monthFilter)activeFilters.push(`Issued: ${monthFilter}`);
    document.getElementById('memoFilterSummary').textContent=`${filteredMemos.length} of ${rawMemos.length} memorandums${activeFilters.length?' · '+activeFilters.join(' · '):' · All registry records'}`;
    document.querySelectorAll('[data-memo-month]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.memoMonth===monthFilter)));
    document.querySelectorAll('[data-memo-kpi]').forEach(card=>{const key=card.dataset.memoKpi;const selected=key==='all'? !activeFilters.length : key==='pinned'? pinnedFilter==='pinned' : key==='attached'? attachmentFilter==='with_pdf' : monthFilter===M.today().slice(0,7);card.setAttribute('aria-pressed',String(selected));});

    if(resetPage!==false)currentPage = 1;
    renderTable();
  }

  function renderTable() {
    if (!memoTableBody) return;

    if (filteredMemos.length === 0) {
      memoTableBody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-table-cell">No matching office memorandum records found.</td>
        </tr>
      `;
      if (paginationInfo) paginationInfo.textContent = "Showing 0 to 0 of 0 directives";
      if (paginationBtns) paginationBtns.innerHTML = `<button class="page-btn" disabled>1</button>`;
      updateMemoSelection();return;
    }

    const totalPages = Math.ceil(filteredMemos.length / rowsPerPage);
    if (currentPage > totalPages) currentPage = totalPages;

    const startIndex = (currentPage - 1) * rowsPerPage;
    const currentMemos = filteredMemos.slice(startIndex, startIndex + rowsPerPage);

    memoTableBody.innerHTML = currentMemos.map((memo) => {
      const hasPdf = Boolean(memo.pdfUrl && memo.pdfUrl.trim() !== "");
      return `
        <tr data-memo-id="${escapeHtml(memo.id)}">
          <td><input type="checkbox" class="row-checkbox" value="${escapeHtml(memo.id)}" ${selectedMemoIds.has(memo.id)?"checked":""} aria-label="Select ${escapeHtml(memo.memoNo||"memo")}" /></td>
          <td>
            <strong style="color: var(--slate-900);">${escapeHtml(memo.memoNo || "UNTITLED")}</strong>
            ${memo.isPinned ? `<span class="badge-pinned"><i data-lucide="pin" style="width:10px;height:10px;"></i> PINNED</span>` : ""}
          </td>
          <td class="text-muted font-mono">${escapeHtml(memo.date || "N/A")}</td>
          <td>
            <div class="memo-recipient-cell">${escapeHtml(memo.addressedTo || "—")}</div>
          </td>
          <td>
            <div class="memo-title-cell">${escapeHtml(memo.subject || memo.title || "No subject specified")}</div>
          </td>
          <td>
            <span class="memo-remarks-preview">${escapeHtml(splitMemoNotes(memo.remarks).notes || "—")}</span>
          </td>
          <td>
            ${
              hasPdf
                ? `<button type="button" class="badge-status success preview-pdf-btn" data-id="${escapeHtml(memo.id)}" style="cursor: pointer; border: none;">
                    <i data-lucide="file-check" style="width:12px;height:12px;"></i> View file
                  </button>`
                : `<span class="badge-status" style="background: var(--slate-100); color: var(--slate-500);"><span class="dot" style="background: var(--slate-400);"></span> None</span>`
            }
          </td>
          <td style="text-align: right;">
            <div class="action-btn-group">
              <button type="button" class="btn-action pin-toggle-btn ${memo.isPinned ? "active" : ""}" data-id="${escapeHtml(memo.id)}" title="${memo.isPinned ? "Unpin directive" : "Pin to top"}">
                <i data-lucide="pin"></i>
              </button>
              <button type="button" class="btn-action edit-memo-btn" data-id="${escapeHtml(memo.id)}" title="Edit memorandum">
                <i data-lucide="edit-3"></i>
              </button>
              <button type="button" class="btn-action delete delete-memo-btn" data-id="${escapeHtml(memo.id)}" data-no="${escapeHtml(memo.memoNo || "")}" title="Delete record">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    if (paginationInfo) {
      const endItem = Math.min(startIndex + rowsPerPage, filteredMemos.length);
      paginationInfo.textContent = `Showing ${startIndex + 1} to ${endItem} of ${filteredMemos.length} directives`;
    }

    renderPaginationControls(totalPages);
    attachRowActions();updateMemoSelection();
    M.renderIcons();
  }

  function renderPaginationControls(totalPages) {
    if (!paginationBtns) return;
    let html = `<button class="page-btn" ${currentPage === 1 ? "disabled" : ""} data-page="${currentPage - 1}">&laquo;</button>`;

    const pages=[...new Set([1,currentPage-1,currentPage,currentPage+1,totalPages])].filter(p=>p>=1&&p<=totalPages).sort((a,b)=>a-b);
    for(let i=0;i<pages.length;i++){if(i&&pages[i]-pages[i-1]>1)html+='<span aria-hidden="true">…</span>';const p=pages[i];html+=`<button type="button" aria-label="Page ${p}" ${p===currentPage?'aria-current="page"':''} class="page-btn ${p===currentPage?'active':''}" data-page="${p}">${p}</button>`;}

    html += `<button class="page-btn" ${currentPage === totalPages ? "disabled" : ""} data-page="${currentPage + 1}">&raquo;</button>`;
    paginationBtns.innerHTML = html;

    paginationBtns.querySelectorAll(".page-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = parseInt(btn.getAttribute("data-page"), 10);
        if (!isNaN(p) && p >= 1 && p <= totalPages) {
          currentPage = p;
          renderTable();
        }
      });
    });
  }

  // =========================================================================
  // 7. ROW ACTIONS
  // =========================================================================
  function attachRowActions() {
    // Preview PDF
    document.querySelectorAll(".preview-pdf-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const memo = rawMemos.find((m) => m.id === id);
        if (memo) openPdfViewer(memo);
      });
    });

    // Pin/Unpin
    document.querySelectorAll(".pin-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const memo = rawMemos.find((m) => m.id === id);
        if (!memo) return;

        if(busy||!online){showToast('Refresh successfully before pinning memos.','warning');return;}
        busy=true;try{const saved=await M.write('office_memos',{isPinned:!memo.isPinned},id);rawMemos=rawMemos.map(m=>m.id===id?{...saved,id:String(saved.id)}:m);M.storage.set('pgenro_office_memos',rawMemos);applyFiltersAndRender();calculateKpis();M.audit('EDIT_RECORD',`Memo pin ${memo.memoNo}`);showToast(saved.isPinned?'Memo pinned.':'Memo unpinned.');}catch(error){showToast(error.message,'error');}finally{busy=false;}
      });
    });


    // Edit
    document.querySelectorAll(".edit-memo-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const memo = rawMemos.find((m) => m.id === id);
        if (memo) openEditModal(memo);
      });
    });

    // Delete
    document.querySelectorAll(".delete-memo-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        deleteTargetId = btn.getAttribute("data-id");
        const memoNo = btn.getAttribute("data-no") || "this record";
        if (deleteMemoNoLabel) deleteMemoNoLabel.textContent = memoNo;
        if (deleteConfirmModal) M.openModal("deleteConfirmModal");
      });
    });
  }


  // =========================================================================
  // 8. MEMORANDUM OCR ENGINE
  // =========================================================================
/* Sender detection reads every page, including signature blocks. */
function parseCorrespondence(rawText='',signatureRegion=false) {
 const tidy=s=>String(s||'').normalize('NFC').replace(/[\u00a0\t]+/g,' ').replace(/\s+/g,' ').trim();
 const entries=[];
 for(const [p,page] of String(rawText||'').replace(/\r/g,'').split('\f').entries()){
  const top=page.split('\n').map(tidy).filter(Boolean).slice(0,8);
  if(p&&top.some(line=>/^(?:ANNEX|APPENDIX|ATTACHMENT|ENCLOSURE)\b|^(?:(?:PG\s*ENRO|PGENRO)\s+)?(?:OFFICE\s+)?(?:MEMORANDUM|MEMO|REQUEST LETTER|OFFICE ORDER)\b/i.test(line)))break;
  let excluded=false;
  page.split('\n').forEach((s,l)=>{const text=tidy(s);if(/^(?:CC\s*:|COPY\s+(?:TO|FURNISHED)|ANNEX\b|APPENDIX\b|ATTACHMENTS?\s*:|ENCLOSURES?\s*:)/i.test(text))excluded=true;if(text)entries.push({text,page:p+1,line:l+1,excluded});});
 }
 const closing=/^(?:(?:very\s+)?(?:yours\s+)?(?:sincerely|respectfully|faithfully|truly)(?:\s+(?:yours|submitted))?|yours\s+(?:truly|faithfully|sincerely|respectfully)|best\s+regards|kind\s+regards|regards|cordially|lubos\s+na\s+gumagalang|sumasainyo|for\s+your\s+(?:compliance|information\s+and\s+compliance|guidance\s+and\s+compliance))\s*[,.:!]?$/i;
 const role=/\b(?:PGDH|PGENRO|ENRO|officer|director|chief|mayor|governor|administrator|supervisor|manager|secretary|head|president|chairperson|chairman|coordinator|principal|teacher|engineer|treasurer|representative|proprietor|owner|student|applicant|dean|professor|specialist|staff|assistant|councilor|punong\s+barangay)\b/i;
 const label=/^(?:signed(?:\s+by)?|signatory|submitted\s+by|prepared\s+by|approved\s+by|noted\s+by|certified\s+by|recommending\s+approval|respectfully\s+submitted\s+by|name\s+of\s+(?:sender|signatory))\s*[:：-]?\s*(.*)$/i;
 function name(value) {
  let s=tidy(value).replace(/^(?:\(\s*sgd\.?\s*\)|sgd\.?|\/s\/|by\s*:)\s*/i,'').replace(/^[|:_\-]+|[|:_\-]+$/g,'').trim();
  s=s.split(/\s+[—–]\s+/)[0];
  if(s.length<4||s.length>100||/[\d@:/;!?()]/.test(s)||/\b(?:republic|province|government|office|department|division|subject|memorandum|dear|thank|please|request|hereby|attached|enclosed|address|telephone|email|received|copy|cc|page|for|to|from)\b/i.test(s))return '';
  const base=s.replace(/^(?:(?:Mr|Mrs|Ms|Miss|Dr|Dra|Atty|Engr|EnP|Hon|Prof|Rev|Fr|Bro|Sis)\.?\s+)+/i,'').replace(/,?\s+(?:Ph\.?D\.?|M\.?D\.?|MBA|CPA|RN|LPT|CESO(?:\s+[IVX]+)?|EnP)(?:[,\s].*)?$/i,'');
  const words=base.match(/[\p{L}][\p{L}.'’\-]*/gu)||[];
  if(words.length<2||words.length>8||role.test(base))return '';
  // Names may contain lower-case particles (de la, del, van, etc.).
  if(words.some(w=>!(/^(?:de|del|dela|la|las|los|da|dos|di|du|van|von|bin|al|y|jr\.?|sr\.?|II|III|IV)$/i.test(w)||/^\p{Lu}/u.test(w))))return '';
  if(words.filter(w=>w.replace(/[^\p{L}]/gu,'').length>1).length<2)return '';
  return s.replace(/\.{2,}/g,'.').replace(/(?<=\s)([A-Z])(?=\s)/g,'$1.');
 }
 const candidates=[];
 for(let i=0;i<entries.length;i++){
  const entry=entries[i];if(entry.excluded)continue;const m=entry.text.match(label),n=name(m?.[1]||entry.text);if(!n)continue;
  const before=entries.slice(Math.max(0,i-6),i).filter(e=>e.page===entry.page);
  const marker=[...before].reverse().find(e=>label.test(e.text));
  const nearClosing=before.some(e=>closing.test(e.text));
  const next=entries[i+1]?.page===entry.page?entries[i+1].text:'';
  const hasRole=role.test(next)&&!/^dear\b/i.test(next);
  const pageEntries=entries.filter(e=>e.page===entry.page),position=pageEntries.indexOf(entry)/Math.max(1,pageEntries.length);
  const immediateMarker=marker&&before.slice(-2).includes(marker);
  let score=m?120:nearClosing?110:immediateMarker?100:hasRole&&(signatureRegion||position>.45)?75:0;
  if(/^(?:prepared|noted|certified|recommending)\b/i.test(m?entry.text:marker?.text||''))score=60;
  if(!score)continue;
  const candidate={name:n,role:hasRole?next:'',page:entry.page,line:entry.line,score,evidence:[nearClosing?before.find(e=>closing.test(e.text))?.text:'',entry.text,hasRole?next:''].filter(Boolean).join('\n')};
  const prior=candidates.find(c=>c.name.toLocaleLowerCase()===n.toLocaleLowerCase());if(!prior)candidates.push(candidate);else if(score>prior.score)Object.assign(prior,candidate);
 }
 candidates.sort((a,b)=>b.score-a.score||a.page-b.page||a.line-b.line);
 const primary=candidates.filter(c=>c.score===candidates[0]?.score),signatory=primary.length===1?primary[0]:null;
 function labeled(pattern){
  for(let i=0;i<entries.length;i++){
   const e=entries[i];if(e.page!==1)continue;
   if(closing.test(e.text)||/^(?:dear|please|kindly|pursuant|this (?:is|letter)|I (?:am|would|respectfully)|we (?:are|would|request))\b/i.test(e.text))break;
   const m=e.text.match(pattern);if(!m)continue;
   let value=tidy(m[1]||'');if(!value){const next=entries[i+1];if(next?.page===e.page&&!/^(?:to|from|date|subject|dear|thru|through)\b/i.test(next.text))value=next.text;}
   if(value)return {value,page:e.page,line:e.line};
  }return {value:'',page:null,line:null};
 }
 let sender=labeled(/^(?:from|sender|received\s+from|issued\s+by|issuing\s+office|originating\s+office)\s*[:：-]\s*(.*)$/i);
 let recipient=labeled(/^(?:to|t0|for|addressed\s+to|recipient(?:\s+office)?|memorandum\s+for)\s*[:：-]\s*(.*)$/i);
 if(typeof parseDocumentHeader==='function'){const h=parseDocumentHeader(rawText);sender={value:h.sender===h.signatory?(signatory?.name||''):h.sender};recipient={value:h.addressedTo};}
 return {signatory:signatory?.name||'',signatoryRole:signatory?.role||'',signatoryCandidates:candidates,receivedFrom:signatory?.name||(!primary.length?sender.value:''),sender:sender.value,recipient:recipient.value,fieldEvidence:{receivedFrom:signatory?.evidence||sender.value},needsReview:primary.length>1?['receivedFrom']:[]};
}
/* End sender detection. */

/* Memo document parser: identical page-owned code in Communications and Office Memos. */
function parseMemoDocument(rawText='') {
 const labels='SUBJECT MATTER|SUBJECT|SUBJ|RE|ADDRESSED TO|MEMORANDUM FOR|ISSUED BY|ISSUING OFFICE|ORIGINATING OFFICE|SIGNATORY|DATE ISSUED|DATE|DATED|TO|T0|FROM|FOR|THROUGH|THRU|CC|ATTACHMENTS?|REFERENCE|REF|CONTROL NO\\.?|REMARKS';
 const normalize=s=>String(s||'').replace(/\u00a0/g,' ').replace(/[–—−]/g,'-').replace(/[：]/g,':').replace(/[ \t]+/g,' ').trim();
 const text=String(rawText||'').replace(/\r/g,'').split('\f')[0].replace(/\u00a0/g,' ').replace(/[：]/g,':');
 const lines=text.replace(new RegExp(`[ \\t]{2,}(?=(?:${labels})\\s*:)`,'gi'),'\n').split('\n').map(normalize);
 const labelPattern=new RegExp(`^(${labels})\\s*(?::|[-])\\s*(.*)$`,'i');
 const bodyLine=/^(?:dear\b|sir\b|madam\b|respectfully\b|please\b|kindly\b|you are\b|this (?:is|memo|memorandum)\b|pursuant\b|in (?:connection|view|compliance)\b|for your (?:information|compliance|guidance)\b|\d+\.\s)/i;
 const header=lines.map((line,index)=>({line,index})).filter(x=>x.line).slice(0,60);
 const boundary=header.findIndex(x=>bodyLine.test(x.line)||/^(?:SUBJECT(?: MATTER)?|SUBJ|RE)\s*[:\-]/i.test(x.line));
 const title=/^(?:OFFICE\s+)?(?:MEMORANDUM(?:\s+(?:ORDER|CIRCULAR))?|MEMO)(?:\s+(?:N[O0]\.?|NUMBER)\s*[:#.-]?\s*[A-Z0-9 /._,-]*|\s+FOR\s*:?.*|\s*[:#.-]?\s*\d[\d /._,-]*)?\s*$/i;
 const titleText=line=>line.replace(/MEM0RANDUM/gi,'MEMORANDUM');
 const heading=header.find((x,i)=>(boundary<0||i<boundary)&&title.test(titleText(x.line)));
 const warnings=[],evidence={};
 function field(names,maxLines=4) {
  const pattern=new RegExp(`^(?:${names})\\s*(?::|[-])?\\s*$`,'i');
  for(let i=0;i<lines.length;i++){
   const match=lines[i].match(labelPattern);
   if(!(match&&pattern.test(match[1]))&&!pattern.test(lines[i]))continue;
   const parts=match?.[2]?[match[2]]:[];
   for(let j=i+1;j<lines.length&&j<=i+maxLines;j++){
    const line=lines[j];if(!line||labelPattern.test(line)||bodyLine.test(line)||title.test(titleText(line)))break;
    parts.push(line);
   }
   const value=normalize(parts.join(' '));
   if(value)return {value,line:i+1};
  }
  return {value:'',line:null};
 }
 const fields={memoNo:'',date:'',addressedTo:'',issuedBy:'',subject:'',isMemo:!!heading,warnings,evidence};
 if(heading){
  const headingText=titleText(heading.line);
  const numberText=lines.slice(heading.index,Math.min(lines.length,heading.index+5)).map(titleText).join('\n');
  const number=numberText.match(/(?:^(?:OFFICE\s+)?(?:MEMORANDUM(?:\s+(?:ORDER|CIRCULAR))?|MEMO)\s+(?:N[O0]\.?|NUMBER)\s*[:#.-]?\s*|^(?:N[O0]\.?|NUMBER|CONTROL\s+(?:NO\.?|NUMBER))\s*[:#.-]?\s*)([A-Z0-9][A-Z0-9/._-]*)/im)||headingText.match(/^(?:OFFICE\s+)?(?:MEMORANDUM(?:\s+(?:ORDER|CIRCULAR))?|MEMO)\s*[:#.-]?\s*(\d[\d/._-]*)/i);
  if(number){fields.memoNo=number[1];const series=numberText.match(/(?:[,;]\s*s\.?\s*|\bseries\s+of\s+)(\d{4})\b/i);if(series)fields.memoNo+=`, s. ${series[1]}`;evidence.memoNo=heading.index+1;}
 }
 for(const [key,names] of Object.entries({addressedTo:'TO|T0|FOR|ADDRESSED TO|MEMORANDUM FOR',issuedBy:'FROM|ISSUED BY|ISSUING OFFICE|ORIGINATING OFFICE|SIGNATORY',subject:'SUBJECT|SUBJECT MATTER|SUBJ|RE'})){
  const result=field(names);fields[key]=result.value;evidence[key]=result.line;
 }
 const dateField=field('DATE|DATE ISSUED|DATED',1);
 if(dateField.value){fields.date=parseMemoDate(dateField.value);evidence.date=dateField.line;if(!fields.date)warnings.push('The printed date is invalid or ambiguous. Enter the date manually.');}
 if(!fields.isMemo)warnings.push('A memorandum heading was not detected. Check the document type.');
 for(const [key,label] of [['memoNo','Memo number'],['date','Issue date'],['addressedTo','Recipient'],['subject','Subject'],['issuedBy','Issuing office']])if(!fields[key])warnings.push(`${label} was not detected.`);
 return fields;
}
function parseMemoDate(value='') {
 const months={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
 const text=String(value||'').trim();let year,month,day,match;
 if((match=text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/)))[,year,month,day]=match;
 else if((match=text.match(/\b([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i))){month=months[match[1].toLowerCase()];day=match[2];year=match[3];}
 else if((match=text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4})\b/i))){day=match[1];month=months[match[2].toLowerCase()];year=match[3];}
 else if((match=text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/))){const first=Number(match[1]),second=Number(match[2]);year=match[3];if(first>12&&second<=12){day=first;month=second;}else if(second>12&&first<=12){day=second;month=first;}else if(first===second){day=first;month=second;}else return '';}
 if(!year||!month||!day)return '';
 const date=new Date(Date.UTC(Number(year),Number(month)-1,Number(day)));
 if(date.getUTCFullYear()!==Number(year)||date.getUTCMonth()+1!==Number(month)||date.getUTCDate()!==Number(day))return '';
 return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function parseDocumentHeader(rawText='') {
 const labels='SUBJECT MATTER|SUBJECT|SUBJ|RE|ADDRESSED TO|MEMORANDUM FOR|RECIPIENT OFFICE|RECEIVED FROM|SENDER|ISSUED BY|ISSUING OFFICE|ORIGINATING OFFICE|SIGNATORY|DATE RECEIVED|RECEIVED DATE|DATE RELEASED|RELEASED DATE|DATE ISSUED|DATE|DATED|TO|T0|FROM|FOR|THROUGH|THRU|CC|ATTACHMENTS?|REFERENCE(?: NO\\.?| NUMBER)?|REF(?: NO\\.?)?|CONTROL (?:NO\\.?|NUMBER)|REMARKS';
 const labelRe=new RegExp(`^(${labels})\\s*(?::|[–—-])\\s*(.*)$`,'i'),bareRe=new RegExp(`^(?:${labels})\\s*$`,'i');
 const bodyRe=/^(?:dear\b|sir\b|madam\b|respectfully\b|sincerely\b|please\b|kindly\b|you are\b|this (?:is|memo|memorandum|office|letter)\b|pursuant\b|in (?:connection|view|compliance|light)\b|for your (?:information|compliance|guidance)\b|we (?:are|would|request)\b|I (?:am|would|respectfully)\b|attached (?:is|are)\b|relative to\b|\d+\.\s)/i;
 const dateLine=/^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|[A-Za-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\.?,?\s+\d{4})\s*$/i;
 const prefix='(?:(?:PG\\s*ENRO|PGENRO|PROVINCIAL ENRO)\\s+)?';
 const memoRe=new RegExp(`^${prefix}(?:OFFICE\\s+)?(?:MEMORANDUM(?:\\s+(?:ORDER|CIRCULAR))?|MEMO)(?:\\s+(?:N[O0]\\.?|NUMBER)\\s*[:#.-]?\\s*[A-Z0-9 /._,-]*|\\s+FOR\\s*:?.*|\\s*[:#.-]?\\s*\\d[\\d /._,-]*)?\\s*$`,'i');
 const types=['Office Order','Special Order','Travel Order','Request Letter','Endorsement Letter','Transmittal Letter','Response Letter','Notice of Meeting','Invitation','Report'];
 let text=String(rawText||'').replace(/\r/g,'').split('\f')[0].replace(/\u00a0/g,' ').replace(/：/g,':');
 const lines=[];
 text.split('\n').forEach((raw,index)=>{
  raw=raw.replace(/^(?:SUBJECI|SUB3ECT|SUBIECT)\s*(?=[:\-])/i,'SUBJECT').replace(new RegExp(`^(${labels})[ \\t]{2,}(?=\\S)`,'i'),'$1: ');
  raw.split(new RegExp(`[ \\t]{2,}(?=(?:${labels})\\s*:)`,'i')).forEach(line=>lines.push({text:line.replace(/[ \t]+/g,' ').trim(),number:index+1}));
 });
 let header=lines.slice(0,Math.min(100,lines.findIndex(x=>bodyRe.test(x.text))<0?lines.length:lines.findIndex(x=>bodyRe.test(x.text))));
 const subjectIndex=header.findIndex(x=>/^(?:SUBJECT(?: MATTER)?|SUBJ|RE)\s*(?::|[–—-]|$)/i.test(x.text));
 if(subjectIndex>=0){
  let content=!!header[subjectIndex].text.match(labelRe)?.[2];
  for(let i=subjectIndex+1;i<header.length;i++){
   const line=header[i].text;
   if(line){if(!labelRe.test(line)&&!bareRe.test(line))content=true;continue;}
   const following=header.slice(i+1).find(x=>x.text)?.text||'';
   if(content&&following&&!labelRe.test(following)&&!bareRe.test(following)&&!dateLine.test(following)&&!/^(?:FOR|OF|ON|AND|OR|WITH|REGARDING|DURING)\b/i.test(following)){header=header.slice(0,i);break;}
  }
 }
 const result={memoNo:'',controlNo:'',date:'',receivedDate:'',releasedDate:'',addressedTo:'',recipient:'',issuedBy:'',subject:'',sender:'',sourceOffice:'',signatory:'',docType:'',documentType:'',isMemo:false,warnings:[],evidence:{},fieldEvidence:{},needsReview:[]};
 let heading=-1;
 for(let i=0;i<Math.min(subjectIndex<0?header.length:subjectIndex,60);i++){
  const title=header[i].text.replace(/MEM0RANDUM/gi,'MEMORANDUM');
  if(memoRe.test(title)){heading=i;result.docType='Memorandum';result.isMemo=true;break;}
  const type=types.find(name=>new RegExp(`^${prefix}${name.replace(/ /g,'\\s+')}(?:\\s+(?:N[O0]\\.?|NUMBER)\\s*[:#.-]?.*|\\s*[:#.-]?\\s*\\d[\\d /._,-]*)?\\s*$`,'i').test(title));
  if(type){heading=i;result.docType=type;break;}
 }
 function field(names,limit=6){
  const pattern=new RegExp(`^(?:${names})$`,'i');
  for(let i=0;i<header.length;i++){
   const line=header[i].text,match=line.match(labelRe);
   if(!(match&&pattern.test(match[1]))&&!pattern.test(line))continue;
   const parts=match?.[2]?[match[2]]:[];let j=i+1;
   while(j<Math.min(header.length,i+1+limit)){
    const next=header[j].text;
    if(!next){
     let probe=j+1;while(probe<header.length&&!header[probe].text&&probe-j<=2)probe++;
     if(probe<header.length&&probe-j<=2&&(!parts.length||(/^(?:FOR|OF|ON|AND|OR|WITH|REGARDING|DURING)\b/i.test(header[probe].text)&&!bodyRe.test(header[probe].text)&&!labelRe.test(header[probe].text)))){j=probe;continue;}
     break;
    }
    if(labelRe.test(next)||bareRe.test(next)||bodyRe.test(next)||memoRe.test(next)||/^[-_=]{3,}$/.test(next)||(limit===1&&parts.length))break;
    parts.push(next);j++;
   }
   const value=parts.join(' ').trim();if(value)return {value,line:header[i].number,text:header.slice(i,j).map(x=>x.text).join('\n')};
  }
  return {value:'',line:null,text:''};
 }
 if(heading>=0){
  const block=header.slice(heading,heading+5);const end=block.findIndex((x,i)=>i&&(labelRe.test(x.text)||bareRe.test(x.text)));
  const numberText=block.slice(0,end<0?block.length:end).map(x=>x.text).join('\n');
  const number=numberText.match(/\b(?:N[O0]\.?|NUMBER)\s*[:#.-]?\s*([A-Z0-9][A-Z0-9/._-]*)/i)||block[0].text.match(/(?:MEMORANDUM(?:\s+(?:ORDER|CIRCULAR))?|MEMO|ORDER)\s*[:#.-]?\s*(\d[\d/._-]*)/i);
  if(number){const series=numberText.match(/(?:[,;]\s*s\.?\s*|\bseries(?:\s+of)?\s+)(\d{4})\b/i);result.controlNo=number[1]+(series?`, s. ${series[1]}`:'');result.evidence.controlNo=header[heading].number;if(result.isMemo){result.memoNo=result.controlNo;result.evidence.memoNo=header[heading].number;}}
 }
 const printed=field('CONTROL (?:NO\\.?|NUMBER)',1),reference=printed.value?printed:field('REFERENCE(?: NO\\.?| NUMBER)?|REF(?: NO\\.?)?',1);
 if((printed.value||!result.controlNo)&&/^[A-Z0-9][A-Z0-9/._-]*(?:,?\s*s\.?\s*\d{4})?$/i.test(reference.value)){result.controlNo=reference.value;result.evidence.controlNo=reference.line;if(result.isMemo&&!result.memoNo)result.memoNo=reference.value;}
 for(const[key,names]of Object.entries({addressedTo:'TO|T0|FOR|ADDRESSED TO|MEMORANDUM FOR|RECIPIENT OFFICE',issuedBy:'FROM|ISSUED BY|ISSUING OFFICE|ORIGINATING OFFICE|SIGNATORY',sender:'RECEIVED FROM|FROM|SENDER|ORIGINATING OFFICE|ISSUING OFFICE',subject:'SUBJECT|SUBJECT MATTER|SUBJ|RE',signatory:'SIGNATORY'})){
  const f=field(names);result[key]=f.value;result.evidence[key]=f.line;result.fieldEvidence[key]=f.text;
 }
 const explicitSender=result.sender;
 if(!result.sender){
  const firstLabel=header.findIndex(x=>labelRe.test(x.text)||bareRe.test(x.text)),firstDate=header.findIndex(x=>dateLine.test(x.text));
  const top=header.slice(0,Math.min(heading<0?header.length:heading,subjectIndex<0?header.length:subjectIndex,firstLabel<0?header.length:firstLabel,firstDate<0?header.length:firstDate,20));
  const office=top.filter(x=>/\b(?:OFFICE|DEPARTMENT|BUREAU|DIVISION|COMMISSION|AUTHORITY|UNIVERSITY)\b/i.test(x.text)&&!types.some(name=>x.text.toLowerCase().includes(name.toLowerCase()))&&!/^(?:email|tel|contact|www\.|https?:)/i.test(x.text)).at(-1);
  if(office){result.sender=office.text;result.evidence.sender=office.number;}
 }
 const author=printedHeaderSignatory(rawText);
 if(author.name){result.signatory=author.name;if(!explicitSender)result.sender=author.name;if(!result.issuedBy)result.issuedBy=author.name;}
 for(const[key,names]of Object.entries({date:'DATE|DATE ISSUED|DATED',receivedDate:'DATE RECEIVED|RECEIVED DATE',releasedDate:'DATE RELEASED|RELEASED DATE'})){
  const f=field(names,1);if(f.value){result[key]=parseMemoDate(f.value);result.evidence[key]=f.line;result.fieldEvidence[key]=f.text;if(!result[key])result.warnings.push('The printed date is invalid or ambiguous. Enter it manually.');}
 }
 if(!result.evidence.date){const standalone=header.find(x=>dateLine.test(x.text));if(standalone){result.date=parseMemoDate(standalone.text);result.evidence.date=standalone.number;}}
 result.recipient=result.addressedTo;result.sourceOffice=result.sender;result.documentType=result.docType;
 for(const[key,label]of [['memoNo','Memo number'],['date','Issue date'],['addressedTo','Recipient'],['subject','Subject'],['issuedBy','Issuing office']])if(!result[key])result.warnings.push(`${label} was not detected.`);
 result.needsReview=['controlNo','date','addressedTo','subject','sender'].filter(key=>!result[key]);
 return result;
}
function printedHeaderSignatory(rawText=''){
 rawText=String(rawText||'').replace(/^((?:(?:very\s+)?(?:yours\s+)?(?:sincerely|respectfully|faithfully|truly)(?:\s+(?:yours|submitted))?|yours\s+(?:truly|faithfully|sincerely|respectfully)|best\s+regards|kind\s+regards))[,.:]\s+(?=[A-ZÀ-Þ])/gim,'$1,\n');
 const closing=/^(?:respectfully(?: yours| submitted)?|sincerely(?: yours)?|very truly yours|yours(?: truly| sincerely| faithfully)?|truly yours|best regards|kind regards|for your (?:compliance|information and compliance|guidance and compliance))\s*[,.;:!]*$/i;
 const role=/\b(?:PGDH|PGADH|PGENRO|PG\s*ENRO|OFFICER|DIRECTOR|CHIEF|MAYOR|GOVERNOR|ADMINISTRATOR|SUPERVISOR|MANAGER|SECRETARY|PRESIDENT|DEAN|PRINCIPAL|HEAD|COORDINATOR)\b/i;
 const stop=/^(?:cc\s*:|copy (?:furnished|to)|enclosures?\s*:|attachments?\s*:|annex\b|appendix\b|prepared by\b|reviewed by\b|approved by\b|recommending approval\b|ground floor\b|email\b|tel\b|www\.|https?:)|@/i;
 const pages=String(rawText||'').replace(/\r/g,'').split('\f'),lines=[];
 for(let p=0;p<pages.length;p++){
  const page=pages[p].split('\n').map(s=>s.replace(/[ \t]+/g,' ').trim());
  if(p&&page.filter(Boolean).slice(0,8).some(s=>/^(?:ANNEX|APPENDIX|ATTACHMENT|ENCLOSURE)\b|^(?:(?:PG\s*ENRO|PGENRO)\s+)?(?:OFFICE\s+)?(?:MEMORANDUM|MEMO|REQUEST LETTER|OFFICE ORDER)\b/i.test(s)))break;
  lines.push(...page);
 }
 const candidates=[];
 for(let i=0;i<lines.length;i++){
  if(!closing.test(lines[i]))continue;
  const block=[];for(const s of lines.slice(i+1,i+15)){if(stop.test(s))break;if(s)block.push(s);}
  for(let j=0;j<Math.min(6,block.length);j++){
   const name=block[j].replace(/\.{2,}/g,'.').replace(/\b([A-Z])(?=\s)/g,'$1.').replace(/^[ |;:'‘’"“”]+|[ |;:'‘’"“”]+$/g,'');
   if(role.test(name)||name.length<7||name.length>110||/[\d:!?@/]/.test(name)||/\b(?:REPUBLIC|PROVINCE|GOVERNMENT|OFFICE|DEPARTMENT|DIVISION|PERSONNEL|SUBJECT|ORDER|COMPLIANCE|DIRECTOR|MAYOR|CHIEF|GOVERNOR|SECRETARY|MANAGER|PLEASE|THANK|SHOULD|MUST|REQUEST)\b/i.test(name))continue;
   const words=name.match(/[\p{L}][\p{L}.'’\-]*/gu)||[],designation=block[j+1]||'';
   if(words.length<2||words.length>12||words.filter(w=>w.replace(/[^\p{L}]/gu,'').length>=2).length<2)continue;
   if(name!==name.toUpperCase()&&!(words.every(w=>/^\p{Lu}/u.test(w)||/^(?:de|del|dela|la|van|von)$/i.test(w))&&role.test(designation)))continue;
   if(!candidates.includes(name))candidates.push(name);
  }
 }
 return {name:candidates.length===1?candidates[0]:''};
}

/* End memo document parser. */

/* Printed heading and letter-purpose extraction for native text/browser reads. */
function parseLetterDetails(rawText=''){
 const rules={"headings":[["Memorandum",{"pattern":"^(?:OFFICE\\s+)?(?:MEMORANDUM|MEM0RANDUM|MEMO)(?:\\s+(?:ORDER|CIRCULAR))?(?:\\s+(?:N[O0]\\.?|NUMBER|FOR|SERIES)\\b.*|\\s*[:#.-]?\\s*\\d.*)?$","flags":"i"}],["Travel Order",{"pattern":"^(?:REVISED\\s+)?TRAVEL\\s+ORDER(?:\\s+(?:N[O0]\\.?|NUMBER|SERIES)\\b.*|\\s*[:#.-]?\\s*\\d.*)?$","flags":"i"}],["Special Order",{"pattern":"^SPECIAL\\s+ORDER(?:\\s+(?:N[O0]\\.?|NUMBER|SERIES)\\b.*|\\s*[:#.-]?\\s*\\d.*)?$","flags":"i"}],["Office Order",{"pattern":"^(?:OFFICE|ADMINISTRATIVE)\\s+ORDER(?:\\s+(?:N[O0]\\.?|NUMBER|SERIES)\\b.*|\\s*[:#.-]?\\s*\\d.*)?$","flags":"i"}],["Notice of Meeting",{"pattern":"^(?:NOTICE\\s+OF\\s+(?:A\\s+)?MEETING|MEETING\\s+NOTICE)(?:\\s*[:\\-].*)?$","flags":"i"}],["Request Letter",{"pattern":"^(?:REQUEST\\s+LETTER|LETTER\\s+OF\\s+REQUEST)(?:\\s*[:\\-].*)?$","flags":"i"}],["Endorsement Letter",{"pattern":"^(?:ENDORSEMENT(?:\\s+LETTER)?|LETTER\\s+OF\\s+ENDORSEMENT)(?:\\s*[:\\-].*)?$","flags":"i"}],["Transmittal Letter",{"pattern":"^(?:TRANSMITTAL(?:\\s+LETTER)?|LETTER\\s+OF\\s+TRANSMITTAL)(?:\\s*[:\\-].*)?$","flags":"i"}],["Response Letter",{"pattern":"^(?:RESPONSE|REPLY)\\s+LETTER(?:\\s*[:\\-].*)?$","flags":"i"}],["Invitation",{"pattern":"^(?:INVITATION(?:\\s+LETTER)?|LETTER\\s+OF\\s+INVITATION)(?:\\s*[:\\-].*)?$","flags":"i"}],["Report",{"pattern":"^(?:(?:MONTHLY|ANNUAL|ACCOMPLISHMENT|ACTIVITY|INSPECTION|PROGRESS|INCIDENT|NARRATIVE)\\s+){0,2}REPORT(?:\\s*[:\\-].*)?$","flags":"i"}]],"subjectRules":[["Request Letter",{"pattern":"(?:^(?:REQUEST(?:ING)?(?:\\s+(?:FOR|TO))?|APPLICATION\\s+FOR|REQUISITION\\s+FOR|PURCHASE\\s+REQUEST)\\b|\\b(?:EQUIPMENT|SUPPLY|SUPPLIES|FUNDING|ASSISTANCE|PURCHASE|PERMISSION|APPROVAL|DOCUMENT|RECORDS|FINANCIAL|BUDGET|SPONSORSHIP)\\s+REQUEST\\b)","flags":"i"}],["Notice of Meeting",{"pattern":"^(?:NOTICE\\s+OF\\s+(?:A\\s+)?MEETING|MEETING\\s+NOTICE|(?:STAFF|PERSONNEL|COORDINATION|REGULAR|SPECIAL)\\s+MEETING)\\b","flags":"i"}],["Invitation",{"pattern":"^INVITATION\\b","flags":"i"}],["Endorsement Letter",{"pattern":"^ENDORSEMENT\\b","flags":"i"}],["Transmittal Letter",{"pattern":"^(?:TRANSMITTAL\\b|(?:SUBMISSION|FORWARDING)\\s+OF\\b)","flags":"i"}],["Response Letter",{"pattern":"^(?:RESPONSE|REPLY)\\s+TO\\b","flags":"i"}],["Report",{"pattern":"^(?:(?:MONTHLY|ANNUAL|ACCOMPLISHMENT|ACTIVITY|INSPECTION|PROGRESS|INCIDENT|NARRATIVE)\\s+){0,2}REPORT\\b","flags":"i"}]],"bodyRules":[["Response Letter",{"pattern":"\\b(?:in\\s+(?:response|reply)\\s+to|respond(?:ing)?\\s+to|reply(?:ing)?\\s+to)\\b","flags":"i"}],["Invitation",{"pattern":"\\b(?:invite\\s+(?:you|your|the)|inviting\\s+(?:you|your|the)|extend\\s+(?:an?|our)\\s+invitation)\\b","flags":"i"}],["Endorsement Letter",{"pattern":"\\b(?:(?:we|I)\\s+(?:(?:hereby|respectfully)\\s+)?endorse|endorsing\\s+(?:the|this|Mr|Ms|Dr))\\b","flags":"i"}],["Transmittal Letter",{"pattern":"\\b(?:(?:we|I)\\s+(?:(?:hereby|respectfully|are)\\s+)?(?:transmit|forward|submit|transmitting|forwarding|submitting)|herewith\\s+(?:transmitted|submitted|forwarded)|transmittal\\s+of)\\b","flags":"i"}],["Request Letter",{"pattern":"\\b(?:request(?:ing)?\\s+(?:for|to|your|the|a|an|permission|approval|assistance|funding|technical\\s+assistance)|application\\s+for)\\b","flags":"i"}],["Notice of Meeting",{"pattern":"\\b(?:please\\s+be\\s+informed|inform\\s+(?:you|all)|notify\\s+(?:you|all))\\b[^.!?]{0,180}\\bmeeting\\b","flags":"i"}],["Report",{"pattern":"\\b(?:report\\s+on|(?:monthly|annual|accomplishment|activity|inspection|progress|incident)\\s+report)\\b","flags":"i"}]],"subjectLabel":{"pattern":"^(?:SUBJECT(?:\\s+(?:MATTER|OF\\s+(?:THE\\s+)?LETTER))?|SUBJEC[TIL1]|SUB3ECT|SUBJ\\.?|RE|REGARDING|PAKSA)(?:\\s*[:;\\-–—]\\s*|\\s+|$)(.*)$","flags":"i"},"fieldLabel":{"pattern":"^(?:DATE(?:\\s+(?:ISSUED|RECEIVED|RELEASED))?|DATED|TO|T0|FOR|FROM|SENDER|THRU|THROUGH|CC|ATTACHMENTS?|ENCLOSURES?|REFERENCE|REF\\.?|CONTROL(?:\\s+(?:NO\\.?|NUMBER))?|ISSUED\\s+BY|SIGNATORY|REMARKS|N[O0]\\.?|NUMBER)\\s*[:;\\-]","flags":"i"},"salutation":{"pattern":"^(?:DEAR\\b|SIR\\s*[,!:]|MADAM\\s*[,!:]|MA'AM\\s*[,!:]|TO\\s+WHOM\\s+IT\\s+MAY\\s+CONCERN)","flags":"i"},"closing":{"pattern":"^(?:(?:VERY\\s+)?(?:YOURS\\s+)?(?:SINCERELY|RESPECTFULLY|FAITHFULLY|TRULY)|YOURS\\s+(?:TRULY|FAITHFULLY|SINCERELY)|BEST\\s+REGARDS|KIND\\s+REGARDS|LUBOS\\s+NA\\s+GUMAGALANG|SIGNED\\s+BY|PREPARED\\s+BY|APPROVED\\s+BY)\\b","flags":"i"},"body":{"pattern":"^(?:DEAR\\b|GREETINGS\\b|GOOD\\s+(?:DAY|MORNING|AFTERNOON)\\b|PLEASE\\b|KINDLY\\b|WE\\b|I\\s+(?:AM|WOULD|HEREBY|WRITE|RESPECTFULLY)\\b|MAY\\s+(?:WE|I)\\b|THIS\\s+(?:IS|LETTER|REFERS|HAS|WILL)\\b|YOU\\s+ARE\\b|THE\\s+(?:UNDERSIGNED|ATTACHED|PURPOSE)\\b|ATTACHED\\s+(?:IS|ARE|HEREWITH)\\b|IN\\s+(?:CONNECTION|VIEW|LIGHT)\\b|WITH\\s+REFERENCE\\b|PURSUANT\\b|FOR\\s+YOUR\\s+(?:INFORMATION|COMPLIANCE|GUIDANCE)\\b)","flags":"i"},"titlePurpose":{"pattern":"^(?:REQUEST\\s+(?:FOR|TO)|INVITATION\\s+(?:TO|FOR)|ENDORSEMENT\\s+(?:OF|FOR)|TRANSMITTAL\\s+OF|RESPONSE\\s+TO|REPLY\\s+TO|NOTICE\\s+OF\\s+MEETING|(?:MONTHLY|ANNUAL|ACCOMPLISHMENT|ACTIVITY|INSPECTION|PROGRESS|INCIDENT)\\s+REPORT)\\b","flags":"i"}};
 const header=parseDocumentHeader(rawText),first=String(rawText||'').replace(/\r/g,'').split('\f')[0],lines=first.split('\n').map(s=>s.trim());
 const regex=key=>new RegExp(rules[key].pattern,rules[key].flags||'i');
 const greeting=lines.findIndex(line=>regex('salutation').test(line));
 let opening='';
 if(greeting>=0){const parts=[];for(const line of lines.slice(greeting+1,greeting+24)){
  if(!line){if(parts.length)break;continue;}
  if(regex('closing').test(line))break;
  if(regex('fieldLabel').test(line)||regex('subjectLabel').test(line))continue;
  parts.push(line);if(parts.join(' ').length>=650)break;
 }opening=parts.join(' ');}else opening=lines.find(line=>regex('body').test(line))||'';
 let subject=header.subject||'',subjectSource=subject?'header':'none',documentType=header.docType||'',documentTypeSource=documentType?'heading':'none';
 const top=lines.slice(0,greeting>=0?greeting:lines.findIndex(line=>regex('body').test(line))<0?60:lines.findIndex(line=>regex('body').test(line)));
 if(!subject){const title=top.find(line=>regex('titlePurpose').test(line));if(title){subject=title;subjectSource='heading';}}
 if(!subject&&/\b(?:request(?:ing)?|invite|invitation|endorse|endorsement|transmit|transmittal|submit|forward|respond|response|reply|inform|report)\b/i.test(opening)){
  const sentence=opening.match(/^.*?[.!?](?=\s+[A-Z]|$)/)?.[0]||opening;subject=sentence.length<=240?sentence:sentence.slice(0,240).replace(/\s+\S*$/,'')+'…';subjectSource='body';
 }
 if(!documentType){for(const [type,rule] of rules.headings){if(top.some(line=>new RegExp(rule.pattern,rule.flags).test(line))){documentType=type;documentTypeSource='heading';break;}}}
 if(!documentType&&subjectSource!=='body'){for(const [type,rule] of rules.subjectRules){if(new RegExp(rule.pattern,rule.flags).test(subject)){documentType=type;documentTypeSource='subject';break;}}}
 if(!documentType){for(const [type,rule] of rules.bodyRules){if(new RegExp(rule.pattern,rule.flags).test(opening)){documentType=type;documentTypeSource='body';break;}}}
 if(!documentType&&first.trim()){documentType=greeting>=0?'Letter':'Other Communication';documentTypeSource='fallback';}
 return {subject,subjectSource,documentType,documentTypeSource,isMemo:header.isMemo,needsReview:[...(subjectSource==='body'||!subject?['subject']:[]),...(['body','subject','fallback'].includes(documentTypeSource)?['documentType']:[])]};
}
/* End letter-purpose extraction. */


  function parseMemoOcr(text) { return parseDocumentHeader(text); }

  const memoOcrValues=new Map(),memoManualFields=new Set();
  for(const[key,input]of Object.entries(memoFieldInputs()))input.addEventListener('input',()=>memoManualFields.add(key));
  let generatedMemoNumber='',generatedMemoDate='',memoSavedText='';
  function splitMemoNotes(value='') {
    const text=String(value||''),marker='\n\nExtracted document text:\n',index=text.indexOf(marker);
    return index<0?{notes:text,text:''}:{notes:text.slice(0,index),text:text.slice(index+marker.length)};
  }
  function clearMemoDetection(){
    for(const [key,previous]of memoOcrValues){const input=memoFieldInputs()[key];if(input.value===previous&&!memoManualFields.has(key))input.value='';}
    memoOcrValues.clear();memoSavedText='';memoOcrText.value='';document.getElementById('memoExtractionReview').hidden=true;
  }
  function memoFieldInputs(){return {memoNo:formControlNo,date:formDate,addressedTo:formAddressedTo,subject:formSubject,issuedBy:formIssuedBy};}
  function applyMemoFields(text,metadata=null){
    const detected=parseDocumentHeader(text),inputs=memoFieldInputs(),labels={memoNo:'Memo number',date:'Issue date',addressedTo:'Addressed to',subject:'Subject',issuedBy:'Issued by'},statuses={};
    if(metadata){Object.assign(detected,{isMemo:metadata.isMemo||detected.isMemo,memoNo:metadata.memoNo||detected.memoNo,date:metadata.date||detected.date,addressedTo:metadata.recipient||detected.addressedTo,subject:metadata.subject||detected.subject,issuedBy:metadata.issuedBy||metadata.signatory||detected.issuedBy});}
    if(!detected.isMemo){document.getElementById('memoReviewSummary').textContent='A memorandum heading was not detected. Check the original document before entering its details.';}
    for(const [key,input]of Object.entries(inputs)){
      const current=input.value.trim(),previous=memoOcrValues.get(key),isGenerated=(key==='memoNo'&&current===generatedMemoNumber)||(key==='date'&&current===generatedMemoDate);
      const mayFill=!current||(!memoManualFields.has(key)&&(current===previous||isGenerated));
      if(detected.isMemo&&detected[key]&&mayFill){input.value=detected[key];memoOcrValues.set(key,detected[key]);statuses[key]='Detected from the document';}
      else if(detected.isMemo&&!detected[key]&&mayFill&&(previous!==undefined||(key==='date'&&isGenerated))){input.value=key==='memoNo'?generatedMemoNumber:'';memoOcrValues.delete(key);statuses[key]=key==='memoNo'&&generatedMemoNumber?'Generated registry number; printed number not detected':'Not detected; review manually';}
      else if(current&&!mayFill)statuses[key]='Manual value kept';
      else if(key==='memoNo'&&isGenerated)statuses[key]='Generated registry number; printed number not detected';
      else statuses[key]='Not detected; review manually';
    }
    document.getElementById('memoExtractionReview').hidden=false;
    const found=['memoNo','date','addressedTo','subject','issuedBy'].filter(k=>detected[k]).length;
    document.getElementById('memoReviewSummary').textContent=`${found} of 5 fields detected. ${detected.warnings.join(' ')} Manual edits are preserved.`;
    document.getElementById('memoReviewFields').innerHTML=Object.keys(inputs).map(key=>`<div class="memo-review-field ${detected[key]?'':'needs-review'}"><dt>${labels[key]}</dt><dd>${escapeHtml(detected[key]||'Not detected')}</dd><small>${statuses[key]}</small></div>`).join('');
    memoSavedText=String(text||'');return detected;
  }
  document.getElementById('recheckMemoFieldsBtn').onclick=()=>{if(busy||fileBusy||ocrBusy)return;if(!memoOcrText.value.trim()){showToast('Extract or paste document text first.','warning');return;}applyMemoFields(memoOcrText.value);};
  function setMemoFieldsBusy(value){for(const input of memoForm.querySelectorAll('input,textarea,select'))input.disabled=value;document.getElementById('recheckMemoFieldsBtn').disabled=value;fileDropzone.setAttribute('aria-disabled',String(value));}

  function setMemoOcrStatus(message, state = "ready") {
    if (memoOcrStatus) {
      memoOcrStatus.textContent = message;
      memoOcrStatus.dataset.state = state;
    }

    if (selectedMemoFile && attachedFileState) {
      if (state === "working") {
        attachedFileState.innerHTML = '<i data-lucide="loader-2" class="spin-icon"></i> OCR';
      } else if (state === "success") {
        attachedFileState.innerHTML = '<i data-lucide="check-circle-2"></i> OCR ready';
      } else if (state === "error") {
        attachedFileState.innerHTML = '<i data-lucide="file-check-2"></i> PDF ready';
      } else {
        attachedFileState.innerHTML = '<i data-lucide="check-circle-2"></i> Ready';
      }
      if (window.lucide) M.renderIcons();
    }
  }

/* Full-document reader, kept inside the owning module. */
const readerScripts=new Map();
function loadReaderScript(url){
 if(!readerScripts.has(url))readerScripts.set(url,new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src=url;
  const timer=setTimeout(()=>{script.remove();readerScripts.delete(url);reject(Error('The document reader could not load. Check the connection and retry.'));},20000);
  script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=()=>{clearTimeout(timer);readerScripts.delete(url);reject(Error('The document reader is unavailable.'));};document.head.append(script);
 }));return readerScripts.get(url);
}
function pdfTextLines(items){
 const rows=[];
 for(const item of items){if(!item.str?.trim())continue;const y=item.transform[5],height=Math.abs(item.height||item.transform[3]||12);let row=rows.find(r=>Math.abs(r.y-y)<Math.max(2,height*.25));if(!row){row={y,height,items:[]};rows.push(row);}row.items.push(item);}
 rows.sort((a,b)=>b.y-a.y);const lines=[];const gaps=rows.slice(1).map((r,i)=>rows[i].y-r.y).sort((a,b)=>a-b),typical=gaps[Math.floor(gaps.length/2)]||0;
 rows.forEach((row,index)=>{if(index&&rows[index-1].y-row.y>Math.max(Math.max(rows[index-1].height,row.height)*1.7,typical*1.6))lines.push('');lines.push(row.items.sort((a,b)=>a.transform[4]-b.transform[4]).map(x=>x.str).join('  '));});
 return lines.join('\n');
}
function mergeDocumentText(base,extra){
 const keys=new Set(String(base||'').split('\n').map(s=>s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,''))),lines=[];
 for(const line of String(extra||'').split('\n')){const key=line.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');if(key&&!keys.has(key)){keys.add(key);lines.push(line);}}
 return String(base||'')+(lines.length?'\n\n'+lines.join('\n'):'');
}

const readerResults=new WeakMap();
const readerRuntime={worker:null,promise:null,logger:null,idle:null,operation:null};
function notifyReaderCancel(op){
 if(!op?.requestId||!op.endpoint)return;
 const url=new URL(op.endpoint,location.href);url.pathname=url.pathname.replace(/\/ocr\/?$/,'/cancel');
 fetch(url.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:op.requestId}),keepalive:true}).catch(()=>{});
}
function cancelDocumentRead(){
 const op=readerRuntime.operation;if(!op)return;
 op.cancelled=true;op.controller?.abort();notifyReaderCancel(op);
 op.reject?.(new Error('Reading stopped. Your draft is kept; you can retry.'));
 stopReaderWorker();
}
async function readWithCancellation(source,progress){
 const op={cancelled:false,controller:null,requestId:null,endpoint:null,reject:null};readerRuntime.operation=op;
 const stopped=new Promise((_,reject)=>op.reject=reject);
 try{return await Promise.race([extractDocument(source,progress),stopped]);}
 finally{if(readerRuntime.operation===op)readerRuntime.operation=null;}
}
async function stopReaderWorker(){
 clearTimeout(readerRuntime.idle);const worker=readerRuntime.worker;
 readerRuntime.worker=null;readerRuntime.promise=null;readerRuntime.logger=null;
 if(worker)try{await worker.terminate();}catch{}
}
window.addEventListener('pagehide',()=>{cancelDocumentRead();stopReaderWorker();});
async function extractDocument(source,progress=()=>{}){
 const operation=readerRuntime.operation,checkRead=()=>{if(operation?.cancelled)throw Error('Reading stopped. Your draft is kept; you can retry.');};
 const started=performance.now(),previous=readerResults.get(source);
 if(previous){progress('Using the document already read…',98);return {...previous,cacheHit:true,durationMs:Math.round(performance.now()-started)};}
 const remember=result=>{checkRead();const finished={...result,metadata:{...parseLetterDetails(result.text),...(result.metadata||{})},durationMs:Math.round(performance.now()-started)};readerResults.set(source,finished);return finished;};
 const extension=source.name.split('.').pop().toLowerCase();
 if(/^(txt|csv)$/.test(extension)){
  const bytes=new Uint8Array(await source.arrayBuffer()),encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
  const text=new TextDecoder(encoding).decode(bytes);return remember({text,metadata:{},warnings:[],pages:text.split('\f').length,engine:'native-text'});
 }
 const warnings=[],configuredEndpoint=document.querySelector('meta[name="pgenro-ocr-endpoint"]')?.content?.trim();
 const endpoints=configuredEndpoint?[configuredEndpoint]:[];
 // Local static previews can use the supplied Python server without editing HTML.
 if(['localhost','127.0.0.1','[::1]'].includes(location.hostname)&&location.port!=='5000')endpoints.push('http://127.0.0.1:5000/ocr');
 for(const address of [...new Set(endpoints)]){
  const endpoint=new URL(address,location.href).href,sameOrigin=new URL(endpoint).origin===location.origin;
  let health=sameOrigin?{ok:true,documentTimeoutSeconds:180}:null;
  if(!sameOrigin){
   const probe=new AbortController(),probeTimer=setTimeout(()=>probe.abort(),3500);if(operation)operation.controller=probe;
   try{const url=new URL(endpoint);url.pathname=url.pathname.replace(/\/ocr\/?$/,'/health');progress('Connecting to the document reader…',3);
    const response=await fetch(url,{signal:probe.signal,cache:'no-store'});if(response.ok)health=await response.json();
   }catch{}finally{clearTimeout(probeTimer);}
  }
  checkRead();if(!health?.ok&&!health?.success)continue;
  const controller=new AbortController(),waitMs=Math.max(45000,Math.min(900000,(Number(health.documentTimeoutSeconds)||180)*1000+15000));
  const timer=setTimeout(()=>controller.abort(),waitMs);let pollTimer=null,pollAbort=null,posting=true;
  async function pollProgress(){
   if(!posting||operation?.cancelled)return;
   pollAbort=new AbortController();const deadline=setTimeout(()=>pollAbort?.abort(),2500);
   try{const url=new URL(endpoint);url.pathname=url.pathname.replace(/\/ocr\/?$/,'/ocr/status/')+operation.requestId;
    const response=await fetch(url,{signal:pollAbort.signal,cache:'no-store'});if(response.ok){const state=await response.json();if(posting&&!operation.cancelled&&state.success){
     const total=Number(state.pages)||0,done=Number(state.completedPages)||0;
     progress(total?`${state.stage} · ${done} of ${total} pages`:state.stage||'Reading the full document…',total?Math.min(96,8+88*done/total):8);
    }}
   }catch{}finally{clearTimeout(deadline);pollAbort=null;if(posting&&!operation?.cancelled)pollTimer=setTimeout(pollProgress,1000);}
  }
  try{
   if(operation){operation.controller=controller;operation.endpoint=endpoint;operation.requestId=crypto.randomUUID();controller.signal.addEventListener('abort',()=>notifyReaderCancel(operation),{once:true});}
   progress('Reading all pages, the letter body and printed signatures…',8);const body=new FormData();body.append('file',source);
   if(operation)pollTimer=setTimeout(pollProgress,700);
   const response=await fetch(endpoint,{method:'POST',body,headers:operation?{'X-OCR-Request-ID':operation.requestId}:{},signal:controller.signal});
   // A static server has no OCR endpoint. Continue to the local/browser reader.
   if([404,405,501,503].includes(response.status))continue;
   let result;try{result=await response.json();}catch{throw Error('The document reader returned an invalid response. Reload and retry.');}
   if(!response.ok||result.success===false)throw Error(result.error||'The document reader could not read this file.');
   if(typeof result.text!=='string')throw Error('The document reader returned no document text.');
   return remember({...result,metadata:result.metadata||{},warnings:result.warnings||[]});
  }catch(error){
   checkRead();
   if(error.name==='AbortError')throw Error('The document reached the reading time limit. Use a smaller file and retry.');
   // Do not silently repeat an interrupted upload in slower browser OCR.
   if(error instanceof TypeError&&sameOrigin)throw Error('The reader connection was interrupted. Your draft is kept; retry the read.');
   if(!(error instanceof TypeError))throw error;
  }finally{posting=false;clearTimeout(timer);clearTimeout(pollTimer);pollAbort?.abort();}
 }
 if(endpoints.length)warnings.push('The document service is unavailable; the browser reader was used.');
 let worker=null,pdf=null,stage='Reading scanned text…',floor=0,span=90;
 async function recognize(input,psm='3'){
  checkRead();clearTimeout(readerRuntime.idle);
  readerRuntime.logger=info=>{if(info.status==='recognizing text')progress(stage,Math.min(98,Math.round(floor+info.progress*span)));};
  if(!readerRuntime.promise){
   readerRuntime.promise=(async()=>{
    await loadReaderScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    const ready=await Tesseract.createWorker('eng',1,{logger:info=>readerRuntime.logger?.(info)});if(operation?.cancelled){await ready.terminate();checkRead();}readerRuntime.worker=ready;return ready;
   })();
  }
  const workerPromise=readerRuntime.promise;try{worker=await workerPromise;}catch(error){if(readerRuntime.promise===workerPromise)readerRuntime.promise=null;throw error;}
  checkRead();await worker.setParameters({preserve_interword_spaces:'1',tessedit_pageseg_mode:psm,user_defined_dpi:'240'});
  return (await worker.recognize(input,{rotateAuto:true},{text:true})).data;
 }
 function score(text){const words=String(text).match(/[\p{L}\p{N}]+/gu)||[];return words.length+new Set(words.map(w=>w.toLocaleLowerCase())).size*.2+(parseCorrespondence(text).signatory?20:0);}
 async function imageCanvas(blob){
  const url=URL.createObjectURL(blob);
  try{const img=new Image();img.src=url;await img.decode();const scale=Math.min(Math.max(1,1600/img.naturalWidth),3,3000/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);return canvas;}
  finally{URL.revokeObjectURL(url);}
 }

 async function readPage(canvas){
  const first=await recognize(canvas,'3');let chosen=first,text=first.text||'';
  if((text.match(/\S+/g)||[]).length<12||Number(first.confidence??100)<65){
   const alternate=await recognize(canvas,'6');
   if(score(alternate.text||'')>score(text)){chosen=alternate;text=alternate.text||'';}
   if(!parseCorrespondence(text).signatory&&parseCorrespondence(alternate.text||'').signatory)text=mergeDocumentText(text,alternate.text);
  }
  const lines=text.split(/\r?\n/),signatureHint=lines.some(line=>/^(?:(?:very\s+)?(?:yours\s+)?(?:sincerely|respectfully|faithfully|truly)|signed(?:\s+by)?|signatory|submitted\s+by|prepared\s+by|approved\s+by)\b/i.test(line))||lines.slice(Math.floor(lines.length*.55)).some(line=>/\b(?:officer|director|chief|mayor|governor|secretary|manager|president|chairperson|coordinator|principal|engineer)\b/i.test(line));
  const senderFields=parseCorrespondence(text);
  if(text&&!senderFields.signatory&&!senderFields.signatoryCandidates.length&&signatureHint){
   const marker=chosen.lines?.find(line=>/^(?:(?:very\s+)?(?:yours\s+)?(?:sincerely|respectfully|faithfully|truly)|signed|submitted|prepared|approved)\b/i.test(line.text||''));
   const top=Math.max(0,marker?.bbox?.y0!=null?marker.bbox.y0-30:Math.floor(canvas.height*.45));
   const crop=document.createElement('canvas');crop.width=canvas.width;crop.height=canvas.height-top;const ctx=crop.getContext('2d');ctx.drawImage(canvas,0,top,canvas.width,crop.height,0,0,canvas.width,crop.height);
   const data=ctx.getImageData(0,0,crop.width,crop.height);
   for(let i=0;i<data.data.length;i+=4){const r=data.data[i],g=data.data[i+1],b=data.data[i+2];if(b>r*1.25&&b>g*1.18&&b-r>12)data.data[i]=data.data[i+1]=data.data[i+2]=255;}
   ctx.putImageData(data,0,0);
   try{const recovered=await recognize(crop,'6');if(parseCorrespondence(recovered.text||'').signatory)text=mergeDocumentText(text,recovered.text);}finally{crop.width=crop.height=0;}
  }
  if(Number(chosen.confidence??100)<65&&!warnings.includes('Some scanned text has low confidence. Review the detected fields.'))warnings.push('Some scanned text has low confidence. Review the detected fields.');
  return text;
 }
 function pdfNeedsOcr(lib,ops,items,native,page){
  if(native.trim().length<40||native.includes('\ufffd'))return true;
  const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
  let matrix=[1,0,0,1,0,0];const stack=[],images=[],view=page.view,area=Math.max(1,(view[2]-view[0])*(view[3]-view[1]));
  for(let i=0;i<ops.fnArray.length;i++){
   const op=ops.fnArray[i],args=ops.argsArray[i];
   if(op===lib.OPS.save)stack.push([...matrix]);
   else if(op===lib.OPS.restore)matrix=stack.pop()||[1,0,0,1,0,0];
   else if(op===lib.OPS.transform)matrix=multiply(matrix,args);
   else if(op===lib.OPS.paintFormXObjectBegin){stack.push([...matrix]);if(args[0])matrix=multiply(matrix,args[0]);}
   else if(op===lib.OPS.paintFormXObjectEnd)matrix=stack.pop()||[1,0,0,1,0,0];
   else if([lib.OPS.paintImageXObject,lib.OPS.paintInlineImageXObject,lib.OPS.paintImageMaskXObject].includes(op)){
    if(Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2])/area<=.10)continue;
    const points=[[0,0],[1,0],[0,1],[1,1]].map(([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]]);
    images.push([Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]);
   }else if([lib.OPS.paintImageXObjectRepeat,lib.OPS.paintImageMaskXObjectRepeat,lib.OPS.paintInlineImageXObjectGroup,lib.OPS.paintImageMaskXObjectGroup].filter(Number.isInteger).includes(op))return true;
  }
  return images.some(([x0,y0,x1,y1])=>{
   let coverage=0;const bands=new Set();
   for(const item of items){if(!item.str?.trim())continue;const [x,y]=[item.transform[4],item.transform[5]],width=Math.abs(item.width||0),height=Math.abs(item.height||0),overlap=Math.max(0,Math.min(x1,x+width)-Math.max(x0,x))*Math.max(0,Math.min(y1,y+height)-Math.max(y0,y));if(overlap){coverage+=overlap;bands.add(Math.min(2,Math.floor((y+height/2-y0)/Math.max(1,y1-y0)*3)));}}
   return coverage/Math.max(1,(x1-x0)*(y1-y0))<.015||bands.size<2;
  });
 }
 async function archiveText(extension){
  await loadReaderScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');const zip=await JSZip.loadAsync(await source.arrayBuffer()),names=Object.keys(zip.files),parts=[];
  const xml=data=>new DOMParser().parseFromString(data,'application/xml');
  const nodes=(root,name)=>Array.from(root.getElementsByTagNameNS('*',name));
  const text=doc=>nodes(doc,'p').map(p=>nodes(p,'t').map(t=>t.textContent).join('')).filter(Boolean).join('\n');
  if(extension==='docx'){
   const selected=[...names.filter(n=>/^word\/header\d+\.xml$/.test(n)).sort(),'word/document.xml',...names.filter(n=>/^word\/(?:footer\d+|footnotes|endnotes)\.xml$/.test(n)).sort()];
   for(const name of selected)if(zip.file(name))parts.push(text(xml(await zip.file(name).async('string'))));
  }else if(extension==='pptx'){
   const selected=names.filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/(\d+)\.xml$/)[1])-Number(b.match(/(\d+)\.xml$/)[1]));
   for(const name of [...selected,...names.filter(n=>/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))])parts.push(text(xml(await zip.file(name).async('string'))));
  }else{
   const shared=zip.file('xl/sharedStrings.xml')?nodes(xml(await zip.file('xl/sharedStrings.xml').async('string')),'si').map(si=>nodes(si,'t').map(t=>t.textContent).join('')):[];
   for(const name of names.filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()){
    const doc=xml(await zip.file(name).async('string'));parts.push(nodes(doc,'row').map(row=>nodes(row,'c').map(cell=>{const value=nodes(cell,'v')[0]?.textContent||'';return cell.getAttribute('t')==='s'?shared[Number(value)]||'':cell.getAttribute('t')==='inlineStr'?nodes(cell,'t').map(t=>t.textContent).join(''):value;}).join(' | ')).join('\n'));
   }
  }
  const prefix=extension==='docx'?'word/media/':extension==='pptx'?'ppt/media/':'xl/media/';
  for(const name of names.filter(n=>n.startsWith(prefix)&&/\.(png|jpe?g|webp|bmp)$/i.test(n))){
   let canvas;try{canvas=await imageCanvas(new Blob([await zip.file(name).async('uint8array')],{type:attachmentMime(name)}));parts.push(await readPage(canvas));}catch(error){warnings.push('An embedded image could not be read: '+error.message);}finally{if(canvas)canvas.width=canvas.height=0;}
  }
  return parts.filter(s=>s.trim()).join(extension==='docx'?'\n\n':'\n\f\n');
 }
 try{
  const extension=source.name.split('.').pop().toLowerCase();let text='';
  if(/^(txt|csv)$/.test(extension)){
   const bytes=new Uint8Array(await source.arrayBuffer()),encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';text=new TextDecoder(encoding).decode(bytes);
  }else if(/^(docx|pptx|xlsx)$/.test(extension))text=await archiveText(extension);
  else if(extension==='pdf'){
   const lib=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');lib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';pdf=await lib.getDocument({data:await source.arrayBuffer(),isEvalSupported:false}).promise;const pages=[];
   for(let number=1;number<=pdf.numPages;number++){
    stage=`Reading page ${number} of ${pdf.numPages}, including the body and signature…`;floor=(number-1)/pdf.numPages*90;span=90/pdf.numPages;progress(stage,Math.round(floor));
    const page=await pdf.getPage(number),content=await page.getTextContent(),native=pdfTextLines(content.items),ops=await page.getOperatorList();
    let pageText=native;
    if(pdfNeedsOcr(lib,ops,content.items,native,page)){
     const base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(240/72,3000/Math.max(base.width,base.height))}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
     try{await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)'}).promise;const scanned=await readPage(canvas);
      const nativeWords=(native.match(/\S+/g)||[]).length,scanWords=(scanned.match(/\S+/g)||[]).length;
      pageText=nativeWords>=scanWords*.9&&parseCorrespondence(native).signatory?native:mergeDocumentText(scanned,native);
     }catch(error){if(!native.trim())throw error;warnings.push(`Page ${number}: scanned content could not be read; selectable text was kept. ${error.message}`);}
     finally{canvas.width=canvas.height=0;}
    }
    pages.push(pageText);page.cleanup();
   }
   text=pages.join('\n\f\n');
  }else if(/^(tif|tiff)$/.test(extension)){
   await loadReaderScript('https://cdn.jsdelivr.net/npm/pako@1.0.11/dist/pako.min.js');await loadReaderScript('https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js');const bytes=await source.arrayBuffer(),frames=UTIF.decode(bytes),pages=[];
   for(let i=0;i<frames.length;i++){const frame=frames[i];UTIF.decodeImage(bytes,frame);const canvas=document.createElement('canvas');canvas.width=frame.width;canvas.height=frame.height;canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(frame)),frame.width,frame.height),0,0);stage=`Reading image page ${i+1} of ${frames.length}…`;floor=i/frames.length*90;span=90/frames.length;try{pages.push(await readPage(canvas));}finally{canvas.width=canvas.height=0;}}
   text=pages.join('\n\f\n');
  }else if(/^(png|jpe?g|webp|bmp)$/.test(extension)){const canvas=await imageCanvas(source);try{text=await readPage(canvas);}finally{canvas.width=canvas.height=0;}}
  else throw Error('This file type is not supported by the document reader.');
  return remember({text,metadata:{},warnings,pages:text.split('\f').length,engine:'browser-reader'});
 }finally{if(worker&&readerRuntime.worker===worker)readerRuntime.idle=setTimeout(()=>{stopReaderWorker();},60000);readerRuntime.logger=null;await pdf?.destroy();}
}
/* End full-document reader. */

  document.getElementById('cancelMemoOcrBtn').addEventListener('click',cancelDocumentRead);
  async function runMemoOcr(file){
    if(!file||busy||fileBusy||ocrBusy)return;ocrBusy=true;setMemoFieldsBusy(true);const token=++memoOcrToken;memoFormModal.dataset.busy='true';document.getElementById('memoOcrStopControls').hidden=false;runMemoOcrBtn.disabled=true;saveMemoSubmitBtn.disabled=true;formPdfFile.disabled=true;removeAttachmentBtn.disabled=true;
    try{
      setMemoOcrStatus('Reading the document…','working');
      const result=await readWithCancellation(file,(message,pct)=>{setMemoOcrStatus(message,'working');setMemoUploadProgress(pct,message,true);}),text=String(result.text||'').trim();
      if(token!==memoOcrToken)return;if(!text)throw Error('No readable text detected. Enter the fields manually.');
      memoOcrText.value=text;applyMemoFields(text,result.metadata);
      setMemoOcrStatus(`Read ${result.pages||text.split('\f').length} pages in ${((result.durationMs||0)/1000).toFixed(1)}s${result.cacheHit?' · reused result':''}. ${text.length.toLocaleString()} characters. Review the detected fields. ${(result.warnings||[]).join(' ')}`,'success');showToast('Document text extracted. Review the fields before saving.');
    }catch(error){setMemoOcrStatus(error.message,'error');showToast(error.message,'error');}
    finally{document.getElementById('memoOcrStopControls').hidden=true;ocrBusy=false;setMemoFieldsBusy(false);memoFormModal.dataset.busy='false';runMemoOcrBtn.disabled=!selectedMemoFile;saveMemoSubmitBtn.disabled=false;formPdfFile.disabled=false;removeAttachmentBtn.disabled=false;setMemoUploadProgress(0,'',false);M.renderIcons();}
  }
  // =========================================================================
  // 8. FORM & MODAL CONTROLS
  // =========================================================================
  const MAX_MEMO_PDF_SIZE = 10 * 1024 * 1024;

  function formatMemoFileSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 100 * 1024 ? 1 : 0)} KB`;
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }

  function setMemoUploadStatus(message, state = "idle") {
    if (memoUploadStatus) memoUploadStatus.dataset.state = state;
    if (memoUploadStatusText) memoUploadStatusText.textContent = message;
  }

  function setMemoUploadProgress(percent = 0, label = "Preparing document...", visible = true) {
    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    if (memoUploadProgress) {
      memoUploadProgress.hidden = !visible;
      memoUploadProgress.setAttribute("aria-hidden", visible ? "false" : "true");
    }
    if (memoUploadProgressBar) memoUploadProgressBar.style.width = `${safePercent}%`;
    if (memoUploadProgressLabel) memoUploadProgressLabel.textContent = label;
  }

  function setSaveMemoState(isSaving, text = "Save Memorandum") {
    if (!saveMemoSubmitBtn) return;
    saveMemoSubmitBtn.disabled = Boolean(isSaving);
    saveMemoSubmitBtn.classList.toggle("is-saving", Boolean(isSaving));
    saveMemoSubmitBtn.innerHTML = isSaving
      ? '<i data-lucide="loader-2" class="spin-icon"></i><span>Saving...</span>'
      : `<i data-lucide="save"></i><span id="saveMemoSubmitText">${escapeHtml(text)}</span>`;
    if (window.lucide) M.renderIcons();
  }

  function refreshMemoFileCard({ name = "", meta = "", existing = false } = {}) {
    if (!attachedFileInfo) return;

    if (!name) {
      attachedFileInfo.classList.remove("show");
      if (attachedFileName) attachedFileName.textContent = "";
      if (attachedFileMeta) attachedFileMeta.textContent = "";
      if (previewSelectedPdfBtn) previewSelectedPdfBtn.disabled = true;
      return;
    }

    attachedFileInfo.classList.add("show");
    if (attachedFileName) attachedFileName.textContent = name;
    if (attachedFileMeta) attachedFileMeta.textContent = meta || (existing ? "Existing document attachment" : "Document attachment");
    if (previewSelectedPdfBtn) previewSelectedPdfBtn.disabled = false;
    if (attachedFileState) {
      attachedFileState.innerHTML = '<i data-lucide="check-circle-2"></i> Ready';
    }
    if (window.lucide) M.renderIcons();
  }

  function resetMemoAttachmentUi() {
    if (formPdfFile) formPdfFile.value = "";
    if (formExistingPdfBase64) formExistingPdfBase64.value = "";
    selectedMemoFile = null;
    memoOcrToken += 1;memoOcrValues.clear();memoSavedText="";document.getElementById("memoExtractionReview").hidden=true;

    refreshMemoFileCard();
    setMemoUploadProgress(0, "Preparing document...", false);
    setMemoUploadStatus("No document selected yet.", "idle");

    if (memoOcrText) memoOcrText.value = "";
    setMemoOcrStatus("Choose a document to extract memorandum fields.", "ready");

    if (runMemoOcrBtn) {
      runMemoOcrBtn.disabled = true;
      runMemoOcrBtn.innerHTML = '<i data-lucide="scan-text"></i><span>Run OCR</span>';
    }

    if (window.lucide) M.renderIcons();
  }

  function validateMemoPdf(file) {
    if (!file) return "No file was selected.";

    const name = String(file.name || "").toLowerCase();
    const type = String(file.type || "").toLowerCase();
    const looksLikePdf = type === "application/pdf" || name.endsWith(".pdf");

    if (!looksLikePdf && !/\.(png|jpe?g|webp|bmp|tiff?|txt|csv|docx|xlsx|pptx)$/i.test(name)) return "Choose a PDF, image, DOCX or text document.";
    if (!file.size) return "The selected document is empty.";
    if (file.size > MAX_MEMO_PDF_SIZE) return "The document exceeds the 10 MB upload limit.";

    return "";
  }

  function readMemoPdfAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onloadstart = () => {
        setMemoUploadProgress(8, "Preparing document...", true);
      };

      reader.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const pct = Math.max(10, Math.min(92, Math.round((event.loaded / event.total) * 92)));
        setMemoUploadProgress(pct, "Reading document...", true);
      };

      reader.onerror = () => reject(reader.error || new Error("The PDF could not be read."));
      reader.onabort = () => reject(new Error("File reading was cancelled."));
      reader.onload = () => resolve(String(reader.result || ""));
      const types={pdf:"application/pdf",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",bmp:"image/bmp",tif:"image/tiff",tiff:"image/tiff",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",txt:"text/plain",csv:"text/csv",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"};
      reader.readAsDataURL(file.slice(0,file.size,types[file.name.split(".").pop().toLowerCase()]||file.type));
    });
  }

  async function acceptMemoPdf(file) {
    if(busy||ocrBusy||fileBusy)return false;const previous={file:selectedMemoFile,url:formExistingPdfBase64.value,name:attachedFileName.textContent};
    const validationError = validateMemoPdf(file);

    if (validationError) {
      if (formPdfFile) formPdfFile.value = "";
      refreshMemoFileCard({name:attachedFileName.textContent,existing:true});
      setMemoUploadProgress(0, "Preparing document...", false);
      setMemoUploadStatus(validationError, "error");
      if (runMemoOcrBtn) runMemoOcrBtn.disabled = !previous.file;
      showToast(validationError, "error");
      return false;
    }

    if(busy||ocrBusy||fileBusy)return false;fileBusy=true;setMemoFieldsBusy(true);memoOcrToken++;memoFormModal.dataset.busy="true";saveMemoSubmitBtn.disabled=true;
    selectedMemoFile = file;
    setMemoUploadStatus(`Reading ${file.name}...`, "working");
    setMemoUploadProgress(8, "Preparing document...", true);

    try {
      const dataUrl = await readMemoPdfAsDataUrl(file);

      if (!dataUrl.startsWith("data:application/pdf") && !dataUrl.startsWith("data:")) {
        throw new Error("The selected document could not be prepared for preview.");
      }

      if(!safeAttachment(dataUrl))throw new Error("This document cannot be safely previewed. Choose a supported attachment.");
      clearMemoDetection();formExistingPdfBase64.value = dataUrl;
      refreshMemoFileCard({
        name: file.name,
        meta: `${formatMemoFileSize(file.size)} • ${file.name.split(".").pop().toUpperCase()} document`
      });

      setMemoUploadProgress(100, "Document ready", true);
      setMemoUploadStatus("Document attached successfully. You can preview it or run OCR to extract details.", "success");

      if (runMemoOcrBtn) {
        runMemoOcrBtn.disabled = false;
        runMemoOcrBtn.innerHTML = '<i data-lucide="scan-text"></i><span>Run OCR</span>';
      }

      window.setTimeout(() => setMemoUploadProgress(0, "Preparing document...", false), 650);
      if (window.lucide) M.renderIcons();

      setMemoOcrStatus('Document ready. Run OCR to detect memorandum fields.','ready');
      return true;
    } catch (error) {
      console.error("PDF preparation error:", error);
      if (formPdfFile) formPdfFile.value = "";
      formExistingPdfBase64.value=previous.url;selectedMemoFile=previous.file;refreshMemoFileCard(previous.url?{name:previous.name,existing:true}:{});
      setMemoUploadProgress(0, "Preparing document...", false);
      setMemoUploadStatus(error.message || "Failed to prepare the selected PDF.", "error");
      showToast(error.message || "Failed to prepare the selected PDF.", "error");
      return false;
    }finally{fileBusy=false;setMemoFieldsBusy(false);memoFormModal.dataset.busy="false";saveMemoSubmitBtn.disabled=false;}
  }

  function resetForm() {
    memoForm.reset();memoManualFields.clear();memoOcrValues.clear();memoSavedText="";setMemoFieldsBusy(false);
    memoDocId.value = "";
    modalFormTitle.textContent = "Issue Office Memorandum";
    formDate.value=M.today();const prefix=`MEMO-${new Date().getFullYear()}-`;const highest=Math.max(0,...rawMemos.map(m=>String(m.memoNo||"").startsWith(prefix)?Number(String(m.memoNo).slice(prefix.length))||0:0));formControlNo.value=prefix+String(highest+1).padStart(3,"0");
    generatedMemoNumber=formControlNo.value;generatedMemoDate=formDate.value;resetMemoAttachmentUi();
    setSaveMemoState(false, "Save Memorandum");
  }

  function setMemoFormModalOpen(open){if(busy||ocrBusy||fileBusy)return;(open?M.openModal:M.closeModal)('memoFormModal');if(open){const body=memoFormModal.querySelector('.memo-form-body');if(body)body.scrollTop=0;}}

  if (openCreateModalBtn) {
    openCreateModalBtn.addEventListener("click", () => {
      if(busy||ocrBusy||fileBusy)return;resetForm();
      setMemoFormModalOpen(true);
      window.setTimeout(() => formControlNo?.focus(), 80);
    });
  }

  if (closeFormModalBtn) {
    closeFormModalBtn.addEventListener("click", () => setMemoFormModalOpen(false));
  }

  if (cancelFormModalBtn) {
    cancelFormModalBtn.addEventListener("click", () => setMemoFormModalOpen(false));
  }

  memoFormModal?.addEventListener("click", (event) => {
    if (event.target === memoFormModal) setMemoFormModalOpen(false);
  });



  function openEditModal(memo) {
    if(busy||ocrBusy||fileBusy)return;resetForm();
    modalFormTitle.textContent = "Update Office Memorandum";
    memoDocId.value = memo.id;
    formControlNo.value = memo.memoNo || "";
    formDate.value = memo.date || "";
    formAddressedTo.value = memo.addressedTo || "";
    formSubject.value = memo.subject || memo.title || "";
    formIssuedBy.value = memo.issuedBy || "";
    const notes=splitMemoNotes(memo.remarks);formRemarks.value=notes.notes;memoOcrText.value=notes.text;memoSavedText=notes.text;generatedMemoNumber=generatedMemoDate="";
    formIsPinned.checked = Boolean(memo.isPinned);

    if (memo.pdfUrl) {
      formExistingPdfBase64.value = memo.pdfUrl;
      refreshMemoFileCard({
        name: memo.pdfFileName || "Attached_Document.pdf",
        meta: "Existing document attachment",
        existing: true
      });
      selectedMemoFile = null;
      if (runMemoOcrBtn) runMemoOcrBtn.disabled = true;
      setMemoUploadStatus("Existing attachment loaded. Choose a new document to replace it.", "success");
      setMemoOcrStatus("Existing attachment loaded. Choose a new document to extract its text again.", "ready");
    }

    setSaveMemoState(false, "Update Memorandum");
    setMemoFormModalOpen(true);
    window.setTimeout(() => formControlNo?.focus(), 80);
  }

  if (formPdfFile) {
    formPdfFile.addEventListener("change", async (event) => {
      const file = event.target.files?.[0] || null;
      if (file) await acceptMemoPdf(file);
    });
  }

  if (fileDropzone) {
    ["dragenter", "dragover"].forEach((eventName) => {
      fileDropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        fileDropzone.classList.add("drag-active");
      });
    });

    ["dragleave", "dragend"].forEach((eventName) => {
      fileDropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        fileDropzone.classList.remove("drag-active");
      });
    });

    fileDropzone.addEventListener("drop", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      fileDropzone.classList.remove("drag-active");

      const files = Array.from(event.dataTransfer?.files || []);
      const file = files[0] || null;

      if (!file) {
        setMemoUploadStatus("No file was dropped.", "error");
        return;
      }

      if (files.length > 1) {
        showToast("Only one document can be attached at a time.", "error");
      }

      await acceptMemoPdf(file);
    });

    fileDropzone.addEventListener('click',event=>{if(event.target===formPdfFile||busy||ocrBusy||fileBusy)return;formPdfFile.click();});
    fileDropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if(!busy&&!ocrBusy&&!fileBusy)formPdfFile?.click();
      }
    });
  }

  if (runMemoOcrBtn) {
    runMemoOcrBtn.addEventListener("click", async () => {
      if (!selectedMemoFile) {
        showToast("Choose a document before running OCR.", "error");
        return;
      }
      await runMemoOcr(selectedMemoFile);
    });
  }

  if(previewSelectedPdfBtn)previewSelectedPdfBtn.onclick=()=>{
    if(fileBusy||ocrBusy||busy)return;if(!formExistingPdfBase64.value){showToast('Attach a document before opening the preview.','warning');return;}
    returnToEditor=true;openPdfViewer({memoNo:formControlNo.value.trim(),subject:formSubject.value.trim()||'Unsaved attachment',pdfUrl:formExistingPdfBase64.value,pdfFileName:attachedFileName.textContent});
  };
  viewPdfModal.addEventListener('pgenro:modal-close',()=>{cleanupMemoViewer();if(returnToEditor){returnToEditor=false;M.openModal('memoFormModal');}});
  if (removeAttachmentBtn) {
    removeAttachmentBtn.addEventListener("click", () => {
      if(busy||ocrBusy||fileBusy)return;resetMemoAttachmentUi();
      showToast("Document attachment removed.");
    });
  }

  // Submit Handler
  if (memoForm) {
    memoForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if(busy||fileBusy||ocrBusy)return;if(!online){showToast("Refresh successfully before saving memos.","error");return;}

      if (!memoForm.checkValidity()) {
        memoForm.reportValidity();
        setMemoUploadStatus("Complete the required memorandum details before saving.", "error");
        showToast("Please complete all required memorandum fields.", "error");
        return;
      }

      for(const input of [formControlNo,formDate,formAddressedTo,formSubject])if(!input.value.trim()){input.focus();showToast("Complete the required memorandum details.","warning");return;}
      if(parseMemoDate(formDate.value)!==formDate.value){formDate.focus();showToast("Enter a valid issue date.","warning");return;}
      const docId = memoDocId.value.trim();
      const normalizedControlNo = formControlNo.value.trim().toLowerCase();
      const duplicate = rawMemos.some((memo) =>
        String(memo.id) !== docId &&
        String(memo.memoNo || "").trim().toLowerCase() === normalizedControlNo
      );

      if (duplicate) {
        formControlNo.focus();
        showToast("That control number is already in the memorandum registry.", "error");
        return;
      }

      const hasPdf = Boolean(formExistingPdfBase64.value);
      const payload = {
        memoNo: formControlNo.value.trim(),
        date: formDate.value,
        addressedTo: formAddressedTo.value.trim(),
        subject: formSubject.value.trim(),
        title: formSubject.value.trim(),
        issuedBy: formIssuedBy.value.trim(),
        remarks: formRemarks.value.trim()+(memoOcrText.value.trim()?`\n\nExtracted document text:\n${memoOcrText.value.trim()}`:""),
        isPinned: formIsPinned.checked,
        pdfUrl: hasPdf ? formExistingPdfBase64.value : "",
        pdfFileName: hasPdf ? (attachedFileName.textContent || "Memorandum.pdf") : "",
        updatedAt: new Date().toISOString()
      };

      if(rawMemos.some(m=>String(m.id)!==docId&&String(m.memoNo||'').trim().toLowerCase()===payload.memoNo.toLowerCase())){showToast('Control number already exists. Choose a unique number.','warning');formControlNo.focus();return;}
      if(hasPdf&&!safeAttachment(formExistingPdfBase64.value)){showToast("The attachment address or type is invalid.","error");return;}
      busy=true;setMemoFieldsBusy(true);memoFormModal.dataset.busy="true";setSaveMemoState(true);

      let uploadedUrl='';
      try {
        if(selectedMemoFile){const uploaded=await window.PGENRO_API.uploadDocument(selectedMemoFile,'office_memos');payload.pdfUrl=uploaded.url;uploadedUrl=uploaded.url;}
        if(!docId)payload.createdAt=new Date().toISOString();
        const saved=await M.write('office_memos',payload,docId||null);rawMemos=docId?rawMemos.map(m=>m.id===docId?{...saved,id:String(saved.id)}:m):[{...saved,id:String(saved.id)},...rawMemos];
        M.storage.set('pgenro_office_memos',rawMemos);M.observeRecords('office memos',rawMemos);applyFiltersAndRender();calculateKpis();M.audit(docId?'EDIT_RECORD':'ADD_RECORD',`Memo ${payload.memoNo}`);showToast(docId?'Memorandum updated.':'Memorandum issued.');
        busy=false;memoFormModal.dataset.busy='false';
        setMemoFormModalOpen(false);
      } catch (error) {
        // Keep the attachment if a network interruption left the save result
        // unknown. A structured database rejection confirms a rollback.
        if(uploadedUrl&&/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(error.code||''))window.PGENRO_API.removeDocument(uploadedUrl).catch(()=>{});
        console.error("Save error:", error);
        showToast(`Failed to save directive: ${error.message || "Unknown error"}`, "error");
      } finally {
        busy=false;setMemoFieldsBusy(false);memoFormModal.dataset.busy="false";
        setSaveMemoState(false, docId ? "Update Memorandum" : "Save Memorandum");
      }
    });
  }

  // =========================================================================
  // 9. DELETE MODAL HANDLER
  // =========================================================================
  if (closeDeleteModalBtn) closeDeleteModalBtn.addEventListener("click", () => M.closeModal("deleteConfirmModal"));
  if (cancelDeleteBtn) cancelDeleteBtn.addEventListener("click", () => M.closeModal("deleteConfirmModal"));

  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener("click", async () => {
      if(!deleteTargetId||busy)return;if(!online){showToast('Refresh successfully before deleting memos.','warning');return;}
      busy=true;deleteConfirmModal.dataset.busy='true';confirmDeleteBtn.disabled=true;
      try{await M.remove('office_memos',[deleteTargetId]);selectedMemoIds.delete(deleteTargetId);rawMemos=rawMemos.filter(m=>m.id!==deleteTargetId);M.storage.set('pgenro_office_memos',rawMemos);applyFiltersAndRender();calculateKpis();M.audit('DELETE_RECORD',`Memo ${deleteTargetId}`);deleteTargetId=null;deleteConfirmModal.dataset.busy='false';M.closeModal('deleteConfirmModal');showToast('Memorandum deleted.');}
      catch(error){showToast(error.message,'error');}
      finally{busy=false;deleteConfirmModal.dataset.busy='false';confirmDeleteBtn.disabled=false;}
    });
  }

  // =========================================================================
  // 10. PDF PREVIEW MODAL
  // =========================================================================
  function safeAttachment(value){
    const raw=String(value||'').trim();if(!raw)return '';
    if(/^data:(?:application\/(?:pdf|vnd\.openxmlformats-officedocument\.(?:wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|octet-stream)|image\/(?:png|jpeg|webp|bmp|tiff)|text\/(?:plain|csv))(?:;[^,]*)?,/i.test(raw))return raw;
    try{const url=new URL(raw,location.href);if(['https:','http:','blob:'].includes(url.protocol))return url.href;}catch{}return '';
  }
  // Render pages ourselves: Chrome's native PDF plugin cannot run in a sandboxed iframe.
  const memoPreview = {generation:0,renderVersion:0,renderPromise:Promise.resolve(),renderTask:null,
    pdfTask:null,pdf:null,abort:null,blobUrl:'',page:1,resizeTimer:null};
  let memoPdfLibraryPromise = null;
  function loadMemoPdfLibrary(){
    if(!memoPdfLibraryPromise){
      memoPdfLibraryPromise=import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs').then(lib=>{
        lib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
        return lib;
      }).catch(error=>{memoPdfLibraryPromise=null;throw error;});
    }
    return memoPdfLibraryPromise;
  }
  function memoPreviewIsCurrent(generation){
    return generation===memoPreview.generation&&viewPdfModal.classList.contains('open');
  }
  function cleanupMemoViewer(){
    memoPreview.generation++;memoPreview.renderVersion++;
    clearTimeout(memoPreview.resizeTimer);
    memoPreview.abort?.abort();memoPreview.abort=null;
    memoPreview.renderTask?.cancel();memoPreview.renderTask=null;
    const task=memoPreview.pdfTask;
    memoPreview.pdfTask=null;memoPreview.pdf=null;
    if(task){try{Promise.resolve(task.destroy()).catch(()=>{});}catch{}}
    if(memoPreview.blobUrl){URL.revokeObjectURL(memoPreview.blobUrl);memoPreview.blobUrl='';}
    for(const link of [downloadPdfBtn,openPdfNewTabBtn]){link.hidden=true;link.removeAttribute('href');}
    memoAttachmentImage.onload=null;memoAttachmentImage.onerror=null;memoAttachmentImage.removeAttribute('src');
    memoAttachmentText.textContent='';memoPdfCanvas.width=0;memoPdfCanvas.height=0;
    memoPdfToolbar.hidden=true;memoPdfStage.hidden=true;memoPdfStage.setAttribute('aria-busy','false');
    memoPdfCanvas.hidden=true;memoAttachmentImage.hidden=true;memoAttachmentText.hidden=true;
    memoPdfRenderStatus.textContent='';memoPdfZoom.value='fit';memoPreview.page=1;
  }
  function showMemoPreviewState(title,message,state=''){
    memoPdfToolbar.hidden=true;memoPdfStage.hidden=true;
    adminNoPdfState.classList.remove('hidden');adminNoPdfState.dataset.state=state;
    adminNoPdfState.querySelector('h3').textContent=title;
    adminNoPdfState.querySelector('p').textContent=message;
  }
  function setMemoAttachmentLinks(url,filename){
    downloadPdfBtn.href=url;downloadPdfBtn.download=filename;downloadPdfBtn.hidden=false;
    // Remote servers may ignore the download attribute. Keep the registry page open.
    if(/^https?:/i.test(url)){downloadPdfBtn.target='_blank';downloadPdfBtn.rel='noopener noreferrer';}
    else downloadPdfBtn.removeAttribute('target');
    openPdfNewTabBtn.href=url;openPdfNewTabBtn.hidden=false;
  }
  function memoPreviewTimeout(promise,milliseconds,message){
    let timer;
    return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),milliseconds);})])
      .finally(()=>clearTimeout(timer));
  }
  async function readMemoPreviewBlob(url,signal){
    const resolved=await window.PGENRO_API.getDocumentUrl(url);const response=await fetch(resolved,{signal});
    if(!response.ok)throw new Error('The attachment could not be retrieved.');
    const limit=20*1024*1024;
    if(Number(response.headers.get('Content-Length'))>limit)throw new Error('This attachment is larger than the 20 MB preview limit.');
    const blob=await response.blob();
    if(blob.size>limit)throw new Error('This attachment is larger than the 20 MB preview limit.');
    if(!blob.size)throw new Error('This attachment is empty.');
    return blob;
  }
  function renderMemoPdfPage(){
    if(!memoPreview.pdf)return;
    const generation=memoPreview.generation,version=++memoPreview.renderVersion;
    const documentPdf=memoPreview.pdf,pageNumber=memoPreview.page;
    memoPreview.renderTask?.cancel();
    const previous=memoPreview.renderPromise;
    memoPdfPageLabel.textContent=`Page ${pageNumber} of ${documentPdf.numPages}`;
    memoPdfPrevPage.disabled=pageNumber<=1;memoPdfNextPage.disabled=pageNumber>=documentPdf.numPages;
    memoPdfRenderStatus.textContent='Rendering page…';memoPdfStage.setAttribute('aria-busy','true');
    memoPreview.renderPromise=(async()=>{
      await previous.catch(()=>{});
      if(!memoPreviewIsCurrent(generation)||version!==memoPreview.renderVersion)return;
      const page=await documentPdf.getPage(pageNumber);
      if(!memoPreviewIsCurrent(generation)||version!==memoPreview.renderVersion)return;
      const base=page.getViewport({scale:1});
      const style=getComputedStyle(memoPdfStage);
      const available=Math.max(100,memoPdfStage.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight));
      const scale=memoPdfZoom.value==='fit'?available/base.width:Number(memoPdfZoom.value);
      const viewport=page.getViewport({scale});
      // Keep large scans crisp without allocating an unbounded canvas.
      const ratio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(16000000/(viewport.width*viewport.height)));
      memoPdfCanvas.width=Math.max(1,Math.floor(viewport.width*ratio));
      memoPdfCanvas.height=Math.max(1,Math.floor(viewport.height*ratio));
      memoPdfCanvas.style.width=`${viewport.width}px`;memoPdfCanvas.style.height=`${viewport.height}px`;
      memoPdfCanvas.setAttribute('aria-label',`PDF page ${pageNumber} of ${documentPdf.numPages}`);
      memoPdfCanvas.hidden=false;memoPdfStage.scrollTop=0;memoPdfStage.scrollLeft=0;
      const task=page.render({canvasContext:memoPdfCanvas.getContext('2d'),viewport,
        transform:ratio===1?null:[ratio,0,0,ratio,0,0]});
      memoPreview.renderTask=task;
      try{await task.promise;}finally{if(memoPreview.renderTask===task)memoPreview.renderTask=null;}
      if(!memoPreviewIsCurrent(generation)||version!==memoPreview.renderVersion)return;
      memoPdfRenderStatus.textContent=`${Math.round(scale*100)}%`;
      memoPdfStage.setAttribute('aria-busy','false');
    })().catch(error=>{
      if(!memoPreviewIsCurrent(generation)||version!==memoPreview.renderVersion||error.name==='RenderingCancelledException')return;
      memoPdfStage.setAttribute('aria-busy','false');
      showMemoPreviewState('Page preview unavailable','Use Open in new tab or Download Document to view this PDF.','error');
    });
  }
  async function loadMemoPreview(url,filename,generation){
    const controller=new AbortController();memoPreview.abort=controller;
    try{
      const source=await memoPreviewTimeout(readMemoPreviewBlob(url,controller.signal),20000,'The attachment took too long to load.');
      if(!memoPreviewIsCurrent(generation))return;
      const bytes=new Uint8Array(await source.arrayBuffer());
      if(!memoPreviewIsCurrent(generation))return;
      const header=new TextDecoder('ascii').decode(bytes.subarray(0,1024));
      const isPdf=header.includes('%PDF-')||source.type.split(';')[0]==='application/pdf'||/\.pdf$/i.test(filename);
      const imageType=/^image\/(?:png|jpeg|webp|bmp|tiff)$/i.test(source.type.split(';')[0]);
      const textType=/^text\/(?:plain|csv)$/i.test(source.type.split(';')[0]);
      const type=isPdf?'application/pdf':imageType?source.type:textType?'text/plain;charset=utf-8':'application/octet-stream';
      // A Blob URL supports Chrome downloads/new tabs; top-level data: navigation is blocked.
      const blob=new Blob([bytes],{type});
      memoPreview.blobUrl=URL.createObjectURL(blob);
      setMemoAttachmentLinks(memoPreview.blobUrl,filename);
      if(isPdf){
        const lib=await memoPreviewTimeout(loadMemoPdfLibrary(),15000,'The PDF renderer is unavailable.');
        if(!memoPreviewIsCurrent(generation))return;
        const task=lib.getDocument({data:bytes,isEvalSupported:false});memoPreview.pdfTask=task;
        const pdf=await memoPreviewTimeout(task.promise,20000,'The PDF took too long to open.');
        if(!memoPreviewIsCurrent(generation))return;
        memoPreview.pdf=pdf;memoPreview.page=1;
        adminNoPdfState.classList.add('hidden');memoPdfToolbar.hidden=false;memoPdfStage.hidden=false;
        renderMemoPdfPage();
      }else if(imageType){
        memoAttachmentImage.onload=()=>{
          if(!memoPreviewIsCurrent(generation))return;
          adminNoPdfState.classList.add('hidden');memoPdfStage.hidden=false;memoAttachmentImage.hidden=false;
        };
        memoAttachmentImage.onerror=()=>{
          if(memoPreviewIsCurrent(generation))showMemoPreviewState('Image preview unavailable','Use Open in new tab or Download Document to view this attachment.','error');
        };
        memoAttachmentImage.src=memoPreview.blobUrl;
      }else if(textType){
        const text=await blob.slice(0,1024*1024).text();
        if(!memoPreviewIsCurrent(generation))return;
        memoAttachmentText.textContent=text+(blob.size>1024*1024?'\n\n[Preview limited to 1 MB. Download Document to read the complete file.]':'');
        adminNoPdfState.classList.add('hidden');memoPdfStage.hidden=false;memoAttachmentText.hidden=false;
      }else{
        showMemoPreviewState('Download this attachment','Use Download Document to view this file in its compatible application.');
      }
    }catch(error){
      if(!memoPreviewIsCurrent(generation))return;
      controller.abort();
      const task=memoPreview.pdfTask;memoPreview.pdfTask=null;memoPreview.pdf=null;
      if(task){try{Promise.resolve(task.destroy()).catch(()=>{});}catch{}}
      let message;
      if(error.name==='PasswordException')message='This PDF requires a password. Use Open in new tab or Download Document to open it.';
      else if(memoPreview.blobUrl)message='The PDF could not be previewed. Use Open in new tab or Download Document to open the file.';
      else if(openPdfNewTabBtn.hidden)message='The attachment could not be read. Select or upload the original file again.';
      else if(/20 MB/.test(error.message))message=error.message+' Use Open in new tab or Download Document to view the file.';
      else message='The attachment could not be loaded. Use Open in new tab or Download Document, and check that its link is still accessible.';
      showMemoPreviewState('Preview unavailable',message,'error');
    }finally{if(memoPreview.abort===controller)memoPreview.abort=null;}
  }
  function openPdfViewer(memo){
    if(!M.canStartAction())return;
    const url=safeAttachment(memo.pdfUrl);
    if(memo.pdfUrl&&!url){returnToEditor=false;showToast('The attachment address or file type is invalid.','error');return;}
    cleanupMemoViewer();
    const filename=String(memo.pdfFileName||'Memorandum.pdf').replace(/[\\/\u0000-\u001f\u007f]/g,'_');
    viewPdfTitle.textContent=memo.memoNo?`Directive ${memo.memoNo}`:'Directive Viewer';
    viewPdfSubtitle.textContent=memo.subject||memo.title||'Office Directive';
    showMemoPreviewState(url?'Loading attachment…':'No attachment',url?'Preparing the document preview.':'No electronic attachment on this memorandum.');
    M.openModal('viewPdfModal');
    if(!url)return;
    // A remote link remains usable if its server disallows cross-origin preview requests.
    if(/^https?:/i.test(url)||/^blob:/i.test(url))setMemoAttachmentLinks(url,filename);
    void loadMemoPreview(url,filename,memoPreview.generation);
  }
  memoPdfPrevPage.addEventListener('click',()=>{if(memoPreview.pdf&&memoPreview.page>1){memoPreview.page--;renderMemoPdfPage();}});
  memoPdfNextPage.addEventListener('click',()=>{if(memoPreview.pdf&&memoPreview.page<memoPreview.pdf.numPages){memoPreview.page++;renderMemoPdfPage();}});
  memoPdfZoom.addEventListener('change',renderMemoPdfPage);
  memoPdfStage.addEventListener('keydown',event=>{
    if(!memoPreview.pdf||event.altKey||event.ctrlKey||event.metaKey)return;
    if(event.key==='ArrowLeft'){event.preventDefault();memoPdfPrevPage.click();}
    if(event.key==='ArrowRight'){event.preventDefault();memoPdfNextPage.click();}
  });
  window.addEventListener('resize',()=>{
    clearTimeout(memoPreview.resizeTimer);
    if(memoPreview.pdf&&memoPdfZoom.value==='fit')memoPreview.resizeTimer=setTimeout(renderMemoPdfPage,150);
  });
  window.addEventListener('pagehide',cleanupMemoViewer);

  if (closeViewPdfBtn) closeViewPdfBtn.addEventListener("click", () => M.closeModal("viewPdfModal"));
  if (dismissViewPdfBtn) dismissViewPdfBtn.addEventListener("click", () => M.closeModal("viewPdfModal"));

  // =========================================================================
  // 11. SEARCH, SHORTCUTS & SELECT ALL
  // =========================================================================
  if (tableFilterInput) tableFilterInput.addEventListener("input",()=>{globalSearchInput.value=tableFilterInput.value;applyFiltersAndRender();});
  if (globalSearchInput) globalSearchInput.addEventListener("input",()=>{tableFilterInput.value=globalSearchInput.value;applyFiltersAndRender();});
  if (pinnedFilterSelect) pinnedFilterSelect.addEventListener("change", applyFiltersAndRender);
  if (attachmentFilterSelect) attachmentFilterSelect.addEventListener("change", applyFiltersAndRender);

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (tableFilterInput) tableFilterInput.focus();
    }
  });

  selectAllCheckbox.addEventListener('change',()=>{for(const m of filteredMemos.slice((currentPage-1)*rowsPerPage,currentPage*rowsPerPage))selectAllCheckbox.checked?selectedMemoIds.add(m.id):selectedMemoIds.delete(m.id);renderTable();});
  memoTableBody.addEventListener('change',e=>{if(!e.target.matches('.row-checkbox'))return;e.target.checked?selectedMemoIds.add(e.target.value):selectedMemoIds.delete(e.target.value);updateMemoSelection();});
  document.getElementById('clearMemoSelectionBtn').onclick=()=>{selectedMemoIds.clear();renderTable();};
  function clearMemoFilters(){tableFilterInput.value=globalSearchInput.value='';pinnedFilterSelect.value=attachmentFilterSelect.value='all';document.getElementById('memoMonthFilter').value='';}
  document.getElementById('clearMemoFiltersBtn').onclick=()=>{clearMemoFilters();document.getElementById('memoSortSelect').value='pinned';applyFiltersAndRender();};
  document.getElementById('memoMonthFilter').addEventListener('change',()=>applyFiltersAndRender());
  document.getElementById('memoSortSelect').addEventListener('change',()=>applyFiltersAndRender());
  document.getElementById('memoMonthlyChart').addEventListener('click',event=>{const button=event.target.closest('[data-memo-month]');if(!button)return;const input=document.getElementById('memoMonthFilter');input.value=input.value===button.dataset.memoMonth?'':button.dataset.memoMonth;applyFiltersAndRender();});
  function useMemoKpi(card){
    if(!M.canStartAction())return;clearMemoFilters();
    if(card.dataset.memoKpi==='pinned')pinnedFilterSelect.value='pinned';
    if(card.dataset.memoKpi==='attached')attachmentFilterSelect.value='with_pdf';
    if(card.dataset.memoKpi==='month')document.getElementById('memoMonthFilter').value=M.today().slice(0,7);
    applyFiltersAndRender();
  }
  document.querySelectorAll('[data-memo-kpi]').forEach(card=>{card.addEventListener('click',()=>useMemoKpi(card));card.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();useMemoKpi(card);}});});
  exportCsvBtn.onclick=()=>{
    const rows=selectedMemoIds.size?rawMemos.filter(m=>selectedMemoIds.has(m.id)):filteredMemos;
    if(!rows.length){showToast('No memos to export.','warning');return;}
    M.csv([['Control No','Date','Addressed To','Subject','Signatory','Remarks','Pinned','Attachment'],...rows.map(m=>[m.memoNo,m.date,m.addressedTo,m.subject||m.title,m.issuedBy,splitMemoNotes(m.remarks).notes,m.isPinned?'Yes':'No',m.pdfUrl?'Yes':'No'])],`PGENRO_Office_Memos_${M.today()}.csv`);M.audit('EXPORT_RECORDS',`${rows.length} memos exported`);showToast('CSV exported.');
  };

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Initial Sync
  listenToMemos();
});


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

/* ===== PGENRO DEPTH MOTION · page-owned, short animations only ===== */
(() => {
  'use strict';
  function initDepthWorkspace() {
    const body = document.body;
    if (!body?.classList.contains('depth-workspace') || body.dataset.depthReady) return;
    body.dataset.depthReady = 'true';
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    document.querySelectorAll('main .kpi-card, main .stat-card, main .metric-card, main .module-control-card')
      .forEach(card => card.classList.add('depth-tilt'));
    let observer;
    function configure() {
      observer?.disconnect();
      body.classList.toggle('depth-motion-paused', document.hidden || reduce.matches);
      if (reduce.matches) {
        document.querySelectorAll('.depth-entered').forEach(el => el.classList.remove('depth-entered'));
        return;
      }
      if (!('IntersectionObserver' in window)) return;
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          if (body.dataset.pageTransition === 'entering') { observer.unobserve(el); return; }
          el.classList.add('depth-entered');
          el.addEventListener('animationend', event => {
            if (event.target === el) el.classList.remove('depth-entered');
          }, {once: true});
          observer.unobserve(el);
        });
      }, {threshold: .04});
      document.querySelectorAll('.main-content > section, .main-content > .card, .main-content > .panel, .content-shell > section, .settings-panel.active')
        .forEach((el, index) => {
          if (el.dataset.depthSeen) return;
          el.dataset.depthSeen = 'true';
          el.style.setProperty('--depth-delay', `${Math.min(index, 3) * 40}ms`);
          observer.observe(el);
        });
    }
    configure();
    reduce.addEventListener?.('change', configure);
    document.addEventListener('visibilitychange', () => body.classList.toggle('depth-motion-paused', document.hidden || reduce.matches));
    window.addEventListener('pagehide', () => observer?.disconnect());
    window.addEventListener('pageshow', event => { if (event.persisted) configure(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDepthWorkspace, {once: true});
  else initDepthWorkspace();
})();
/* ===== END PGENRO DEPTH MOTION ===== */

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

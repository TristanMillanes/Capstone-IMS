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



/* ===== Page module ===== */
/**
 * PGENRO IMS — User Management Controller
 * Manages Account Authentication users and administrator-controlled PGENRO profiles.
 * Reads a protected Supabase registry; account changes use the admin-users Edge Function.
 */
(() => {
  'use strict';
  const M=window.PGENRO_Module;let saving=false,acting=false,loadVersion=0,channel=null,adminId=null;
  const $ = id => document.getElementById(id);
  let authSubscription = null, connecting = false, realtimeTimer = null, authVersion = 0, reconnectRequested = false;
  const els = {};
  const state = {
    users: [],
    filtered: [],
    selected: new Set(),
    page: 1,
    pageSize: 8,
    editingId: null,
    db: null,
    online: false,
    loading: false,
    error: ''
  };
  // Remove the older unscoped directory cache; users are loaded after authorization.
  try { localStorage.removeItem('pgenro_admin_users_cache'); } catch {}
  document.addEventListener('DOMContentLoaded', init, { once: true });
  function init() {
    cacheElements();
    bindShell();
    bindFilters();
    bindActions();
    window.addEventListener('pagehide', event => {
      if (event.persisted) return;
      loadVersion++;
      clearTimeout(realtimeTimer);
      if (channel) state.db?.removeChannel(channel);
      authSubscription?.unsubscribe();
    });
    window.addEventListener('pageshow', event => { if (event.persisted) connectDatabase(); });
    connectDatabase();
    renderIcons();
  }
  function cacheElements() {
    [
      'sidebar','sidebarCollapseBtn','mobileMenuBtn','profileMenu','profileBtn',
      'globalSearchInput','exportUsersBtn','openAddUserModalBtn','statTotalUsers',
      'statTotalAdmins','statSuspendedUsers','userSearchInput','roleFilterSelect',
      'divisionFilterSelect','statusFilterSelect','bulkDeleteBtn','selectAllCheckbox',
      'userTableBody','tableRangeText','userModal','modalTitle','modalSub',
      'closeUserModalBtn','userForm','userIdInput','fullNameInput','usernameInput',
      'emailInput','passRequiredStar','passwordInput','positionInput','contactInput','divisionSelect','roleSelect',
      'statusSelect','cancelModalBtn','saveUserBtn','toast','toastMessage','statPendingRequests',
      'sidebarPendingAccBadge','sidebarOpenServicesBadge'
    ].forEach(id => els[id] = $(id));
  }
  function bindShell() {
    // Shared navigation/profile controls are centralized in the page-owned admin shell below.
    els.globalSearchInput?.addEventListener('input', () => {
      if (els.userSearchInput) els.userSearchInput.value = els.globalSearchInput.value;
      state.page = 1;
      applyFilters();
    });
  }
  function bindFilters() {
    [els.userSearchInput, els.roleFilterSelect, els.divisionFilterSelect, els.statusFilterSelect]
      .filter(Boolean)
      .forEach(el => el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => {
        if(el===els.userSearchInput&&els.globalSearchInput)els.globalSearchInput.value=el.value;
        state.page = 1;
        state.selected.clear();
        applyFilters();
      }));
  }
  function bindActions() {
    $('refreshUsersBtn')?.addEventListener('click', async () => {
      if (connecting || state.loading) return;
      await connectDatabase(true);
    });
    els.openAddUserModalBtn?.addEventListener('click', () => openModal());
    els.closeUserModalBtn?.addEventListener('click', closeModal);
    els.cancelModalBtn?.addEventListener('click', closeModal);
    els.userModal?.addEventListener('click', e => { if (e.target === els.userModal) closeModal(); });
    els.userForm?.addEventListener('submit', saveUser);
    els.exportUsersBtn?.addEventListener('click', exportCsv);
    els.bulkDeleteBtn?.addEventListener('click', deleteSelected);
    els.selectAllCheckbox?.addEventListener('change', toggleSelectAll);
    els.userTableBody?.addEventListener('click', handleTableAction);
    els.userTableBody?.addEventListener('change', handleRowSelection);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && els.userModal?.classList.contains('open')) closeModal();
    });
  }
  function getClient() {
    const existing = M.client();
    if (existing) return existing;
    if (typeof window.supabase?.createClient !== 'function') {
      throw Error('Supabase could not load. Check your connection and refresh.');
    }
    // Public project configuration supplied with this system; reuse the shared
    // client/session when present. Never put a service-role key in this file.
    const config = window.PGENRO_SUPABASE || {};
    window.pgenroSupabase = window.supabase.createClient(
      config.url || 'https://zssrxubajhqryrwijyzm.supabase.co',
      config.publishableKey || 'sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP',
      { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } }
    );
    return window.pgenroSupabase;
  }
  function directoryError(error) {
    if (['PGRST202','42883','42P01','42703'].includes(error?.code)) {
      return 'User directory setup is incomplete. Run the supplied Supabase schema, then refresh.';
    }
    if (error?.code === '42501') return 'Active Super Admin access is required for User Management.';
    return error?.message || 'The user directory could not load. Please refresh.';
  }
  function clearDirectory() {
    authVersion++;
    loadVersion++;
    state.users = []; state.filtered = []; state.selected.clear();
    state.page = 1; state.online = false; state.loading = false; adminId = null;
    if (els.statPendingRequests) els.statPendingRequests.textContent = '—';
    state.error = 'Sign in with an active administrator account.';
    if (channel) { state.db?.removeChannel(channel); channel = null; }
    applyFilters();
  }
  async function refreshUsers() {
    if (!state.db || !adminId) return false;
    const version = ++loadVersion;
    state.loading = true; state.error = ''; render();
    try {
      const rows = []; let offset = 0;
      while (true) {
        const response = await state.db.rpc('pgenro_admin_list_users', { p_offset: offset, p_limit: 500 });
        if (response.error) throw response.error;
        if (version !== loadVersion) return false;
        if (!Array.isArray(response.data)) throw Error('The directory returned an invalid response.');
        rows.push(...response.data);
        if (response.data.length < 500) break;
        offset += response.data.length;
      }
      if (version !== loadVersion) return false;
      state.users = [...new Map(rows.map(row => {
        const user = normalizeUser(row.user_id || row.id, row);
        return [user.id, user];
      })).values()].sort(sortUsers);
      state.online = true;
      state.selected = new Set([...state.selected].filter(id => state.users.some(user => user.id === id)));
      ensureDivisionOptions();
      M.observeRecords('user accounts', state.users);
      return true;
    } catch (error) {
      if (version !== loadVersion) return false;
      state.online = false;
      state.error = directoryError(error);
      // A revoked session must not retain another account's directory.
      if (error?.code === '42501') { state.users = []; state.selected.clear(); adminId = null; }
      showToast(state.error, 'error');
      return false;
    } finally {
      if (version === loadVersion) { state.loading = false; applyFilters(); }
    }
  }
  async function refreshPending() {
    const actor = adminId;
    if (!actor) return;
    try {
      const response = await state.db.rpc('pgenro_admin_pending_count');
      if (actor === adminId && els.statPendingRequests) els.statPendingRequests.textContent = response.error ? '—' : String(response.data ?? 0);
    } catch { if (actor === adminId && els.statPendingRequests) els.statPendingRequests.textContent = '—'; }
  }
  async function connectDatabase(notify = false) {
    if (connecting) return;
    let generation = authVersion;
    connecting = true; state.loading = true; state.error = ''; render();
    try {
      const db = getClient();
      const session = await db.auth.getUser();
      if (generation !== authVersion) return;
      if (session.error || !session.data?.user) {
        clearDirectory();
        throw Error('Sign in with an active administrator account.');
      }
      const user = session.data.user;
      if (adminId && adminId !== user.id) { clearDirectory(); generation = authVersion; }
      const authorized = await db.rpc('pgenro_is_admin');
      if (generation !== authVersion) return;
      if (authorized.error) throw authorized.error;
      if (authorized.data !== true) {
        clearDirectory();
        throw Object.assign(Error('Active Super Admin access is required for User Management.'), { code: '42501' });
      }
      adminId = user.id; state.db = db;
      if (!authSubscription) {
        const registration = db.auth.onAuthStateChange((_event, next) => {
          // Keep asynchronous Supabase work outside the Auth callback's lock.
          if (!next?.user || (adminId && next.user.id !== adminId)) {
            clearDirectory();
            if (next?.user) {
              if (connecting) reconnectRequested = true;
              else setTimeout(() => connectDatabase(), 0);
            }
          }
        });
        authSubscription = registration.data.subscription;
      }
      const loaded = await refreshUsers();
      if (generation !== authVersion) return;
      if (loaded) {
        await refreshPending();
        if (generation !== authVersion) return;
        if (notify) showToast('User registry refreshed.');
        if (!channel && typeof db.channel === 'function') {
          const refresh = () => {
            clearTimeout(realtimeTimer);
            realtimeTimer = setTimeout(() => { if (adminId) refreshUsers(); }, 180);
          };
          channel = db.channel('admin-user-management')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, refresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'access_requests' }, () => refreshPending())
            .subscribe();
        }
      }
    } catch (error) {
      state.online = false; state.error = directoryError(error);
      showToast(state.error, 'error');
    } finally {
      connecting = false; state.loading = false; applyFilters();
      if (reconnectRequested) { reconnectRequested = false; setTimeout(() => connectDatabase(), 0); }
    }
  }
  async function invoke(action, payload) {
    if (!state.online || !adminId || !state.db) throw Error('Refresh and authorize the user registry before changing accounts.');
    const generation = authVersion;
    const session = await state.db.auth.getSession();
    if (generation !== authVersion) throw Error('Your session changed. Refresh the user registry.');
    const token = session.data?.session?.access_token;
    if (session.error || !token) { clearDirectory(); throw Error('Your session expired. Sign in again.'); }
    const response = await state.db.functions.invoke(window.PGENRO_ADMIN_FUNCTION || 'admin-users', {
      body: { action, ...payload }, headers: { Authorization: `Bearer ${token}` }
    });
    if (generation !== authVersion) throw Error('Your session changed. Refresh the user registry.');
    if (response.error) {
      let body = null;
      try { body = await response.error.context?.json(); } catch {}
      const status = response.error.context?.status;
      if (status === 401 || status === 403) clearDirectory();
      if (status === 404) throw Error('Deploy the supplied admin-users account service before changing accounts.');
      throw Error(body?.error || body?.message || response.error.message || 'The account service could not complete this action.');
    }
    const result = response.data;
    if (!result || result.success !== true) throw Error(result?.error || 'The account service did not confirm this action.');
    return result;
  }
  function canonicalRole(value) {
    const role = String(value || '').trim().toLowerCase().replace(/_/g, ' ');
    if (['admin','administrator','superadmin','super admin'].includes(role)) return 'Super Admin';
    if (role === 'division head') return 'Division Head';
    return 'System Staff';
  }
  function canonicalStatus(raw) {
    const value = String(raw.status || '').trim().toLowerCase();
    if (['active','approved','enabled'].includes(value)) return 'Active';
    if (['suspended','banned'].includes(value)) return 'Suspended';
    if (value) return 'Inactive';
    return raw.is_active === false || raw.isActive === false ? 'Inactive' : 'Active';
  }
  function ensureDivisionOptions() {
    for (const select of [els.divisionSelect, els.divisionFilterSelect]) {
      if (!select) continue;
      for (const name of new Set(state.users.map(user => user.division))) {
        if (![...select.options].some(option => option.value === name)) select.add(new Option(name, name));
      }
    }
  }
  function normalizeUser(id, raw = {}) {
    return {
      id: String(raw.user_id || raw.id || id),
      fullName: raw.full_name || raw.fullName || raw.name || 'Unnamed Personnel',
      username: raw.username || (raw.email ? String(raw.email).split('@')[0] : ''),
      email: raw.email || '',
      division: raw.division || 'Unassigned',
      role: canonicalRole(raw.role),
      status: canonicalStatus(raw),
      isActive: canonicalStatus(raw) === 'Active',
      lastLogin: raw.last_login || raw.lastLogin || 'Never',
      contact: raw.contact || '',
      position: raw.position || raw.designation || '',
      createdAt: raw.created_at || raw.createdAt || '',
      updatedAt: raw.updated_at || raw.updatedAt || '',
      accountType: raw.account_type || raw.accountType || (/admin/i.test(raw.role || '') ? 'Administrator' : 'Standard User')
    };
  }
  function sortUsers(a, b) {
    const adminA = /admin/i.test(a.role) ? 0 : 1;
    const adminB = /admin/i.test(b.role) ? 0 : 1;
    return adminA - adminB || a.fullName.localeCompare(b.fullName);
  }
  function applyFilters() {
    const q = (els.userSearchInput?.value || els.globalSearchInput?.value || '').trim().toLowerCase();
    const role = els.roleFilterSelect?.value || 'ALL';
    const division = els.divisionFilterSelect?.value || 'ALL';
    const status = els.statusFilterSelect?.value || 'ALL';
    state.filtered = state.users.filter(user => {
      const haystack = [user.id, user.fullName, user.username, user.email, user.division, user.role, user.position, user.contact].join(' ').toLowerCase();
      return (!q || q.split(/\s+/).every(word => haystack.includes(word))) &&
        (role === 'ALL' || user.role === role) &&
        (division === 'ALL' || user.division === division) &&
        (status === 'ALL' || user.status === status);
    });
    const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;
    render();
  }
  function render() {
    updateStats();
    renderTable();
    updateSelectionControls();
    renderIcons();
  }
  function updateStats() {
    if (els.statTotalUsers) els.statTotalUsers.textContent = state.users.length;
    if (els.statTotalAdmins) els.statTotalAdmins.textContent = state.users.filter(u => /admin/i.test(u.role)&&/^(active|approved)$/i.test(u.status)).length;
    if (els.statSuspendedUsers) els.statSuspendedUsers.textContent = state.users.filter(u => /inactive|suspended/i.test(u.status)).length;
  }
  function renderTable() {
    if (!els.userTableBody) return;
    const total = state.filtered.length;
    const start = (state.page - 1) * state.pageSize;
    const pageRows = state.filtered.slice(start, start + state.pageSize);
    if (!pageRows.length) {
      const title = state.loading ? 'Loading personnel accounts…' : state.error ? 'User directory unavailable' : 'No personnel accounts found';
      const detail = state.loading ? 'Please wait while accounts are retrieved.' : state.error || (state.users.length ? 'Try changing the current filters.' : 'No Supabase Auth accounts are registered.');
      els.userTableBody.innerHTML = `<tr><td colspan="7"><div class="admin-empty-state"><i data-lucide="users-round"></i><strong>${html(title)}</strong><span>${html(detail)}</span></div></td></tr>`;
    } else {
      els.userTableBody.innerHTML = pageRows.map(userRow).join('');
    }
    const shownStart = total ? start + 1 : 0;
    const shownEnd = Math.min(start + pageRows.length, total);
    if (els.tableRangeText) els.tableRangeText.textContent = `Showing ${shownStart} to ${shownEnd} of ${total} Personnel Accounts`;
    renderPager(total);
  }
  function userRow(user) {
    const selected = state.selected.has(user.id);
    const disabled = !state.online || acting || saving || state.loading ? 'disabled' : '';
    const selfDisabled = user.id === adminId ? 'disabled' : disabled;
    const initials = getInitials(user.fullName);
    const statusClass = /^(active|approved)$/i.test(user.status) ? 'active' : /suspend/i.test(user.status) ? 'suspended' : 'inactive';
    const roleClass = /super admin/i.test(user.role) ? 'super-admin' : /division head/i.test(user.role) ? 'division-head' : 'system-staff';
    return `<tr data-user-id="${attr(user.id)}">
      <td><input type="checkbox" class="row-select" data-id="${attr(user.id)}" ${disabled} ${selected ? 'checked' : ''} aria-label="Select ${attr(user.fullName)}"></td>
      <td><div class="user-cell"><div class="avatar-circle">${html(initials)}</div><div><strong>${html(user.fullName)}</strong><small>${html(user.email || user.username || 'No email')}</small></div></div></td>
      <td><span class="division-tag">${html(user.division)}</span>${user.position ? `<small>${html(user.position)}</small>` : ''}</td>
      <td><span class="role-badge-pill ${roleClass}">${html(user.role)}</span></td>
      <td><span class="status-badge-dot ${statusClass}"><span class="status-dot"></span>${html(user.status)}</span></td>
      <td>${formatLastLogin(user.lastLogin)}</td>
      <td style="text-align:right"><div class="action-buttons">
        <button class="btn-icon-action" data-action="edit" data-id="${attr(user.id)}" ${disabled} title="Edit account" aria-label="Edit ${attr(user.fullName)}"><i data-lucide="pencil"></i></button>
        <button class="btn-icon-action" data-action="toggle" data-id="${attr(user.id)}" ${selfDisabled} title="${/^(active|approved)$/i.test(user.status) ? 'Suspend' : 'Activate'} account" aria-label="Toggle ${attr(user.fullName)} status"><i data-lucide="${/^(active|approved)$/i.test(user.status) ? 'user-x' : 'user-check'}"></i></button>
        <button class="btn-icon-action delete" data-action="delete" data-id="${attr(user.id)}" ${selfDisabled} title="Delete account" aria-label="Delete ${attr(user.fullName)}"><i data-lucide="trash-2"></i></button>
      </div></td>
    </tr>`;
  }
  function renderPager(total) {
    const old = document.querySelector('.table-footer .pagination');
    if (!old) return;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    old.innerHTML = `<button class="page-btn" data-page="prev" ${state.page <= 1 ? 'disabled' : ''} aria-label="Previous page">&laquo;</button><button class="page-btn active" aria-current="page">${state.page} / ${pages}</button><button class="page-btn" data-page="next" ${state.page >= pages ? 'disabled' : ''} aria-label="Next page">&raquo;</button>`;
    old.querySelector('[data-page="prev"]')?.addEventListener('click', () => { state.page--; render(); });
    old.querySelector('[data-page="next"]')?.addEventListener('click', () => { state.page++; render(); });
  }
  function updateSelectionControls() {
    const visibleIds = state.filtered.slice((state.page - 1) * state.pageSize, state.page * state.pageSize).map(u => u.id);
    const blocked = !state.online || acting || saving || state.loading;
    if (els.openAddUserModalBtn) els.openAddUserModalBtn.disabled = blocked;
    if (els.exportUsersBtn) els.exportUsersBtn.disabled = !state.online || state.loading;
    if ($('refreshUsersBtn')) $('refreshUsersBtn').disabled = state.loading || acting || saving;
    els.userTableBody?.setAttribute('aria-busy', String(state.loading));
    if (els.selectAllCheckbox) {
      els.selectAllCheckbox.disabled = blocked;
      const count = visibleIds.filter(id => state.selected.has(id)).length;
      els.selectAllCheckbox.checked = !!visibleIds.length && count === visibleIds.length;
      els.selectAllCheckbox.indeterminate = count > 0 && count < visibleIds.length;
    }
    if (els.bulkDeleteBtn) {
      els.bulkDeleteBtn.disabled = blocked || ![...state.selected].some(id => id !== adminId);
      els.bulkDeleteBtn.innerHTML = `<i data-lucide="trash-2"></i> ${state.selected.size ? `Delete Selected (${state.selected.size})` : 'Delete Selected'}`;
    }
  }
  function toggleSelectAll() {
    const visible = state.filtered.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    visible.forEach(u => els.selectAllCheckbox.checked ? state.selected.add(u.id) : state.selected.delete(u.id));
    render();
  }
  function handleRowSelection(e) {
    const cb = e.target.closest('.row-select');
    if (!cb) return;
    cb.checked ? state.selected.add(cb.dataset.id) : state.selected.delete(cb.dataset.id);
    updateSelectionControls();
    renderIcons();
  }
  function handleTableAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled || !state.online || acting || saving) return;
    const user = state.users.find(u => u.id === btn.dataset.id);
    if (!user) return;
    if (btn.dataset.action === 'edit') openModal(user);
    if (btn.dataset.action === 'toggle') toggleStatus(user);
    if (btn.dataset.action === 'delete') deleteUser(user);
  }
  function openModal(user = null) {
    if(saving || acting || !state.online)return;state.editingId = user?.id || null;
    if (els.userIdInput) els.userIdInput.value = user?.id || '';
    if (els.fullNameInput) els.fullNameInput.value = user?.fullName || '';
    if (els.usernameInput) els.usernameInput.value = user?.username || '';
    if (els.emailInput) els.emailInput.value = user?.email || '';
    if (els.passwordInput) {
      els.passwordInput.value = '';
      els.passwordInput.required = !user;
      els.passwordInput.placeholder = user ? 'Leave blank to keep current password' : 'Minimum 8 characters';
    }
    if (els.passRequiredStar) els.passRequiredStar.style.display = user ? 'none' : '';
    if (els.positionInput) els.positionInput.value = user?.position || '';
    if (els.contactInput) els.contactInput.value = user?.contact || '';
    if (els.divisionSelect) els.divisionSelect.value = user?.division || '';
    if (els.roleSelect) els.roleSelect.value = user?.role || 'System Staff';
    if (els.statusSelect) els.statusSelect.value = ['Active','Inactive','Suspended'].includes(user?.status) ? user.status : 'Active';
    if (els.roleSelect) els.roleSelect.disabled = user?.id === adminId;
    if (els.statusSelect) els.statusSelect.disabled = user?.id === adminId;
    if (els.modalTitle) els.modalTitle.textContent = user ? 'Edit User Account' : 'Add New User Account';
    if (els.modalSub) els.modalSub.textContent = user ? 'Update personnel profile, division, role, and account status.' : 'Configure personnel credentials and access permissions.';
    if (els.saveUserBtn) els.saveUserBtn.innerHTML = `<i data-lucide="save"></i>${user ? 'Save Changes' : 'Create Account'}`;
    M.openModal('userModal');
    els.fullNameInput?.focus({preventScroll:true});
    renderIcons();
  }
  function closeModal(){if(saving)return;M.closeModal('userModal');state.editingId=null;els.userForm?.reset();}
  async function saveUser(e) {
    e.preventDefault();
    if(saving)return;
    if (!els.userForm?.reportValidity()) return;
    const isEdit = Boolean(state.editingId);
    const password = els.passwordInput?.value || '';
    if ((!isEdit || password) && password.length < 8) {
      showToast('Password must contain at least 8 characters.', 'warning');
      els.passwordInput?.focus();
      return;
    }
    const userInput = {
      fullName: els.fullNameInput.value.trim(),
      username: els.usernameInput.value.trim(),
      email: els.emailInput.value.trim().toLowerCase(),
      password: password || undefined,
      division: els.divisionSelect.value,
      role: els.roleSelect.value,
      status: els.statusSelect.value,
      position: els.positionInput?.value.trim() || '',
      contact: els.contactInput?.value.trim() || ''
    };
    if (!/^[a-zA-Z0-9_.-]{1,60}$/.test(userInput.username)) { showToast('Username must be 1–60 letters, numbers, dots, underscores or hyphens.', 'warning'); return; }
    if(state.users.some(u=>u.id!==state.editingId&&(u.email.toLowerCase()===userInput.email||u.username.toLowerCase()===userInput.username.toLowerCase()))){showToast('Email or username already exists.','warning');return;}
    setSaving(true);
    try {
      const result = await invoke(isEdit ? 'update' : 'create', isEdit
        ? { userId: state.editingId, user: userInput }
        : { user: userInput });
      const returned=result.user||{};const id=returned.user_id||returned.id||state.editingId;if(!id)throw Error('The administrator service did not confirm the created account. Refresh before trying again.');
      const saved = normalizeUser(id,{...userInput,...returned});
      upsertLocal(saved);
      setSaving(false);closeModal();M.audit(isEdit?'EDIT_USER':'CREATE_USER',`Account ${userInput.email}`);
      showToast(isEdit ? 'User account updated in Supabase.' : 'Supabase user account created.');
    } catch (err) {
      console.error(err);
      await refreshUsers();
      showToast(`Unable to save account: ${err.message || 'Unknown error'}`, 'error');
    } finally {
      setSaving(false);
    }
  }
  function upsertLocal(user) {
    const idx = state.users.findIndex(u => u.id === user.id);
    if (idx >= 0) state.users[idx] = user; else state.users.push(user);
    state.users.sort(sortUsers);
    
    applyFilters();
  }
  async function toggleStatus(user) {
    if(acting)return;if(user.id===adminId){showToast('Use another administrator to change your own access.','warning');return;}
    const active = /^(active|approved)$/i.test(user.status);
    const next = active ? 'Suspended' : 'Active';
    if (!confirm(`${active ? 'Suspend' : 'Activate'} ${user.fullName}'s account?`)) return;
    acting=true;render();
    try {
      const result = await invoke('set_status', {
        userId: user.id,
        status: next
      });
      upsertLocal(normalizeUser(user.id, result.user || { ...user, status: next, is_active: !active }));
      showToast(`${user.fullName} is now ${next}.`);
    } catch (err) {
      await refreshUsers();
      showToast(`Unable to update status: ${err.message}`, 'error');
    }finally{acting=false;render();}
  }
  async function deleteUser(user) {
    if(acting)return;if(user.id===adminId){showToast('You cannot delete the currently signed-in administrator.','warning');return;}
    if (!confirm(`Delete ${user.fullName}'s Account Authentication account and PGENRO profile? This cannot be undone.`)) return;
    acting=true;render();
    try {
      await invoke('delete', { userId: user.id });
      state.users = state.users.filter(u => u.id !== user.id);
      state.selected.delete(user.id);
      
      applyFilters();
      showToast('User account permanently removed.');
    } catch (err) {
      await refreshUsers();
      showToast(`Unable to delete account: ${err.message}`, 'error');
    }finally{acting=false;render();}
  }
  async function deleteSelected(){
    if(acting)return;const users=state.users.filter(u=>state.selected.has(u.id)&&u.id!==adminId);if(!users.length)return;
    if(!confirm(`Permanently delete ${users.length} selected accounts?`))return;
    acting=true;render();const removed=new Set(),errors=[];
    try{for(const user of users){try{await invoke('delete',{userId:user.id});removed.add(user.id);}catch(error){errors.push(`${user.fullName}: ${error.message}`);}}
      state.users=state.users.filter(u=>!removed.has(u.id));removed.forEach(id=>state.selected.delete(id));applyFilters();
      if(removed.size)showToast(`${removed.size} accounts removed.`);if(errors.length)showToast(`${errors.length} failed. ${errors[0]}`,'error');M.audit('DELETE_USERS',`${removed.size} accounts removed`);
    }finally{acting=false;render();}
  }
  function exportCsv() {
    const rows = state.filtered;
    if (!rows.length) return showToast('There are no user records to export.', 'warning');
    const headers = ['Full Name','Username','Email','Division','Role','Status','Position','Last Login'];
    const data = rows.map(u => [u.fullName,u.username,u.email,u.division,u.role,u.status,u.position || '',formatCsvDate(u.lastLogin)]);
    M.csv([headers,...data],`PGENRO_User_Registry_${M.today()}.csv`);
    showToast(`Exported ${rows.length} user record${rows.length === 1 ? '' : 's'}.`);
  }
  function setSaving(value) {
    saving=value;if(els.userModal)els.userModal.dataset.busy=String(value);
    render();
    if (!els.saveUserBtn) return;
    els.saveUserBtn.disabled = saving;
    els.saveUserBtn.innerHTML = saving ? '<span class="spinner"></span> Saving...' : '<i data-lucide="save"></i> Save Account';
    renderIcons();
  }
  const showToast=M.toast;
  function getInitials(name) {
    return String(name || 'U').split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0]).join('').toUpperCase();
  }
  function formatLastLogin(value) {
    if (!value || value === 'Never') return '<span class="text-muted">Never</span>';
    const d = typeof value === 'number' ? new Date(value) : new Date(value);
    if (Number.isNaN(d.getTime())) return html(String(value));
    return `<strong>${html(d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }))}</strong><small>${html(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</small>`;
  }
  function formatCsvDate(value) {
    if (!value || value === 'Never') return 'Never';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  }
  function html(v) { return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function attr(v) { return html(v); }
  function renderIcons() { M.renderIcons(); }
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

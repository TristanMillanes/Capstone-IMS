/* User Management access and persistent role fix, 11 October 2026. */
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

    $('logoutBtn')?.addEventListener('click',async event => {
      event.preventDefault();
      if (typeof window.PGENRO_API?.signOut !== 'function') {
        toast('Sign out is unavailable. Reload the page and try again.','error');
        return;
      }
      await window.PGENRO_API.signOut();
    });

  }

  // ICON_MAP is inserted while packaging, from the existing local Lucide subset.

  const icons = {"badge":[["path",{"d":"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"}]],"check":[["path",{"d":"M20 6 9 17l-5-5"}]],"clock":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 6v6l4 2"}]],"contact":[["path",{"d":"M16 2v2"}],["path",{"d":"M7 22v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"}],["path",{"d":"M8 2v2"}],["circle",{"cx":"12","cy":"11","r":"3"}],["rect",{"x":"3","y":"4","width":"18","height":"18","rx":"2"}]],"database":[["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3"}],["path",{"d":"M3 5V19A9 3 0 0 0 21 19V5"}],["path",{"d":"M3 12A9 3 0 0 0 21 12"}]],"database-backup":[["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3"}],["path",{"d":"M3 12a9 3 0 0 0 5 2.69"}],["path",{"d":"M21 9.3V5"}],["path",{"d":"M3 5v14a9 3 0 0 0 6.47 2.88"}],["path",{"d":"M12 12v4h4"}],["path",{"d":"M13 20a5 5 0 0 0 9-3 4.5 4.5 0 0 0-4.5-4.5c-1.33 0-2.54.54-3.41 1.41L12 16"}]],"download":[["path",{"d":"M12 15V3"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["path",{"d":"m7 10 5 5 5-5"}]],"file-check-2":[["path",{"d":"M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v6"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"m14 20 2 2 4-4"}]],"file-search":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["circle",{"cx":"11.5","cy":"14.5","r":"2.5"}],["path",{"d":"M13.3 16.3 15 18"}]],"file-text":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M10 9H8"}],["path",{"d":"M16 13H8"}],["path",{"d":"M16 17H8"}]],"info":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 16v-4"}],["path",{"d":"M12 8h.01"}]],"menu":[["path",{"d":"M4 5h16"}],["path",{"d":"M4 12h16"}],["path",{"d":"M4 19h16"}]],"panel-left-close":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M9 3v18"}],["path",{"d":"m16 15-3-3 3-3"}]],"panel-left-open":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M9 3v18"}],["path",{"d":"m14 9 3 3-3 3"}]],"pencil":[["path",{"d":"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}],["path",{"d":"m15 5 4 4"}]],"refresh-cw":[["path",{"d":"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{"d":"M21 3v5h-5"}],["path",{"d":"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{"d":"M8 16H3v5"}]],"route":[["circle",{"cx":"6","cy":"19","r":"3"}],["path",{"d":"M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"}],["circle",{"cx":"18","cy":"5","r":"3"}]],"rows-3":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M21 9H3"}],["path",{"d":"M21 15H3"}]],"save":[["path",{"d":"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"}],["path",{"d":"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"}],["path",{"d":"M7 3v4a1 1 0 0 0 1 1h7"}]],"search":[["path",{"d":"m21 21-4.34-4.34"}],["circle",{"cx":"11","cy":"11","r":"8"}]],"send":[["path",{"d":"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"}],["path",{"d":"m21.854 2.147-10.94 10.939"}]],"settings":[["path",{"d":"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"shield-alert":[["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{"d":"M12 8v4"}],["path",{"d":"M12 16h.01"}]],"shield-check":[["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{"d":"m9 12 2 2 4-4"}]],"table":[["path",{"d":"M12 3v18"}],["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M3 9h18"}],["path",{"d":"M3 15h18"}]],"tag":[["path",{"d":"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"}],["circle",{"cx":"7.5","cy":"7.5","r":".5","fill":"currentColor"}]],"trash-2":[["path",{"d":"M10 11v6"}],["path",{"d":"M14 11v6"}],["path",{"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{"d":"M3 6h18"}],["path",{"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]],"user":[["path",{"d":"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"}],["circle",{"cx":"12","cy":"7","r":"4"}]],"user-check":[["path",{"d":"m16 11 2 2 4-4"}],["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"user-cog":[["path",{"d":"M10 15H6a4 4 0 0 0-4 4v2"}],["path",{"d":"m14.305 16.53.923-.382"}],["path",{"d":"m15.228 13.852-.923-.383"}],["path",{"d":"m16.852 12.228-.383-.923"}],["path",{"d":"m16.852 17.772-.383.924"}],["path",{"d":"m19.148 12.228.383-.923"}],["path",{"d":"m19.53 18.696-.382-.924"}],["path",{"d":"m20.772 13.852.924-.383"}],["path",{"d":"m20.772 16.148.924.383"}],["circle",{"cx":"18","cy":"15","r":"3"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"user-plus":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}],["line",{"x1":"19","x2":"19","y1":"8","y2":"14"}],["line",{"x1":"22","x2":"16","y1":"11","y2":"11"}]],"user-round":[["circle",{"cx":"12","cy":"8","r":"5"}],["path",{"d":"M20 21a8 8 0 0 0-16 0"}]],"user-x":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}],["line",{"x1":"17","x2":"22","y1":"8","y2":"13"}],["line",{"x1":"22","x2":"17","y1":"8","y2":"13"}]],"users":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["path",{"d":"M16 3.128a4 4 0 0 1 0 7.744"}],["path",{"d":"M22 21v-2a4 4 0 0 0-3-3.87"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"users-round":[["path",{"d":"M18 21a8 8 0 0 0-16 0"}],["circle",{"cx":"10","cy":"8","r":"5"}],["path",{"d":"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"}]],"x":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],"sun":[["circle",{"cx":"12","cy":"12","r":"4"}],["path",{"d":"M12 2v2"}],["path",{"d":"M12 20v2"}],["path",{"d":"m4.93 4.93 1.41 1.41"}],["path",{"d":"m17.66 17.66 1.41 1.41"}],["path",{"d":"M2 12h2"}],["path",{"d":"M20 12h2"}],["path",{"d":"m6.34 17.66-1.41 1.41"}],["path",{"d":"m19.07 4.93-1.41 1.41"}]],"moon":[["path",{"d":"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"}]],"columns-3":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M9 3v18"}],["path",{"d":"M15 3v18"}]],"inbox":[["polyline",{"points":"22 12 16 12 14 15 10 15 8 12 2 12"}],["path",{"d":"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"}]]};

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
 * PGENRO IMS â€” User Management Controller
 * Manages Account Authentication users and administrator-controlled PGENRO profiles.
 * Reads a protected Supabase registry; account changes use the admin-users Edge Function.
 */
(() => {
  'use strict';
  const M=window.PGENRO_Module;let saving=false,acting=false,loadVersion=0,channel=null,adminId=null;
  const $ = id => document.getElementById(id);
  let authSubscription = null, connecting = false, realtimeTimer = null, authVersion = 0, reconnectRequested = false, accessTimer = null;
  let accountServiceReadyUntil = 0;
  const els = {};
  const state = {
    users: [],
    filtered: [],
    selected: new Set(),
    page: 1,
    pageSize: 8,
    editingId: null,
    editingSnapshot: null,
    pending: 0,
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
      clearInterval(accessTimer);
      if (channel) state.db?.removeChannel(channel);
      authSubscription?.unsubscribe();
    });
    window.addEventListener('pageshow', event => { if (event.persisted) connectDatabase(); });
    window.addEventListener('focus', verifyCurrentAccess);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) verifyCurrentAccess(); });
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
      'sidebarPendingAccBadge','sidebarOpenServicesBadge','roleChangeHelp','userManagementFeedback'
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
    const existing = M?.client?.();
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
  // This page owns its session bridge so an older shared Super Admin gate
  // cannot override the live database Admin/User check for this module.
  window.PGENRO_API = {
    async signOut(options = {}) {
      if (options.confirm !== false && options.ask !== false && typeof window.PGENRO_ConfirmLogout === 'function') {
        const confirmed = await window.PGENRO_ConfirmLogout(); if (!confirmed) return false;
      }
      try {
        const result = await getClient().auth.signOut(); if (result?.error) throw result.error;
        try { for (const storage of [localStorage, sessionStorage]) storage.removeItem('pgenro_current_user'); } catch {}
        location.replace('../User/login.html'); return true;
      } catch {
        window.dispatchEvent(new Event('pgenro:logout-error'));
        return false;
      }
    }
  };
  function directoryError(error) {
    if (['PGRST202','PGRST204','42883','42P01','42703','42804'].includes(error?.code)) {
      return 'Run the entire UserManagement_Admin_Role_Fix.sql in Supabase SQL Editor, then refresh this page.';
    }
    if (error?.code === '40001') return 'This account changed while you were editing it. Reopen it and review the current values.';
    if (error?.code === '23505') return 'Email or username already belongs to another account.';
    return error?.message || 'The user directory could not load. Please refresh.';
  }
  function feedback(message = '', tone = 'error') {
    const panel = els.userManagementFeedback;
    if (!panel) return;
    panel.textContent = message; panel.dataset.tone = tone; panel.hidden = !message;
  }
  function clearDirectory(message = 'Sign in with an active Admin account.') {
    authVersion++; loadVersion++;
    state.users = []; state.filtered = []; state.selected.clear();
    state.page = 1; state.online = false; state.loading = false; adminId = null;
    state.editingSnapshot = null; state.editingId = null; state.pending = 0;
    setSaving(false); acting = false;
    if (els.statPendingRequests) els.statPendingRequests.textContent = 'â€”';
    state.error = message; feedback(message);
    document.body.dataset.directoryState = 'unavailable';
    clearInterval(accessTimer); accessTimer = null;
    if (channel) { state.db?.removeChannel(channel); channel = null; }
    document.querySelectorAll('.modal-overlay.open,.modal-backdrop.open,.admin-modal.open').forEach(modal => {
      modal.dataset.busy = 'false'; M.closeModal(modal.id);
    });
    els.userForm?.reset(); applyFilters();
  }
  async function readCurrentAccess() {
    const identity = await state.db.auth.getUser();
    if (identity.error || !identity.data?.user) {
      throw Object.assign(Error('Your session expired. Sign in again.'), { code: 'UM_SIGN_IN' });
    }
    const response = await state.db.rpc('pgenro_um_context');
    if (response.error) throw response.error;
    const context = response.data;
    if (!context || typeof context.authorized !== 'boolean') throw Error('The access service returned an invalid response. Run the updated SQL patch.');
    if (!context.authorized) {
      const reason = context.reason || 'INACTIVE';
      const message = reason === 'PROFILE_MISSING' ? 'Your Auth account has no PGENRO profile. Run the updated SQL patch, then have an Admin review your account.'
        : reason === 'USER' ? 'Your account uses the User workspace.' : 'Your account is inactive or suspended.';
      throw Object.assign(Error(message), { code: `UM_${reason}` });
    }
    if (String(context.profile?.user_id) !== String(identity.data.user.id)) throw Error('The access response does not match your current account.');
    return { user: identity.data.user, profile: context.profile };
  }
  function handleAccessFailure(error) {
    clearDirectory(directoryError(error));
    if (error?.code === 'UM_SIGN_IN') location.replace('../User/login.html');
    else if (error?.code === 'UM_USER') location.replace('../User/homepage.html');
  }
  async function verifyCurrentAccess() {
    if (!state.db || !adminId || connecting) return;
    const generation = authVersion;
    try {
      const access = await readCurrentAccess();
      if (generation !== authVersion) return;
      if (access.user.id !== adminId) { clearDirectory('Checking the new accountâ€™s access.'); await connectDatabase(); }
    } catch (error) { if (generation === authVersion) handleAccessFailure(error); }
  }
  async function refreshUsers() {
    if (!state.db || !adminId) return false;
    const version = ++loadVersion;
    state.loading = true; state.error = ''; render();
    try {
      const rows = []; let offset = 0;
      while (true) {
        const response = await state.db.rpc('pgenro_um_directory', { p_offset: offset, p_limit: 500 });
        if (response.error) throw response.error;
        if (version !== loadVersion) return false;
        const page = response.data;
        if (!page || !Array.isArray(page.items) || page.offset !== offset || !Number.isFinite(page.total)) throw Error('The directory returned an invalid response. Run the updated SQL patch.');
        rows.push(...page.items);
        state.pending = Number(page.pending) || 0;
        if (!page.hasMore) break;
        if (!page.items.length) throw Error('The directory could not continue pagination. Refresh before making changes.');
        offset += page.items.length;
      }
      if (version !== loadVersion) return false;
      state.users = [...new Map(rows.map(row => {
        const user = normalizeUser(row.user_id || row.id, row); return [user.id, user];
      })).values()].sort(sortUsers);
      state.online = true;
      state.selected = new Set([...state.selected].filter(id => state.users.some(user => user.id === id && id !== adminId)));
      ensureDivisionOptions(); feedback();
      if (els.statPendingRequests) els.statPendingRequests.textContent = String(state.pending);
      M.observeRecords('user accounts', state.users);
      return true;
    } catch (error) {
      if (version !== loadVersion) return false;
      state.users = []; state.filtered = []; state.selected.clear(); state.online = false;
      state.error = directoryError(error); feedback(state.error);
      if (error?.code === '42501') clearDirectory(state.error);
      return false;
    } finally { if (version === loadVersion) { state.loading = false; applyFilters(); } }
  }
  async function refreshPending() {
    const actor = adminId; if (!actor) return;
    try {
      const response = await state.db.rpc('pgenro_um_directory', { p_offset: 0, p_limit: 1 });
      if (actor !== adminId) return;
      if (response.error?.code === '42501') { clearDirectory(directoryError(response.error)); return; }
      if (els.statPendingRequests) els.statPendingRequests.textContent = response.error ? 'â€”' : String(response.data?.pending ?? 0);
    } catch { if (actor === adminId && els.statPendingRequests) els.statPendingRequests.textContent = 'â€”'; }
  }
  async function connectDatabase(notify = false) {
    if (connecting) return;
    let generation = authVersion;
    connecting = true; state.loading = true; state.error = ''; render();
    document.body.dataset.directoryState = 'loading';
    try {
      state.db = getClient(); const db = state.db;
      if (!authSubscription) {
        const registration = db.auth.onAuthStateChange((event, next) => {
          if (event === 'INITIAL_SESSION') return;
          if (!next?.user) { clearDirectory(); location.replace('../User/login.html'); return; }
          if (adminId && next.user.id !== adminId) clearDirectory('Checking the new accountâ€™s access.');
          if (connecting) reconnectRequested = true; else setTimeout(() => connectDatabase(), 0);
        });
        authSubscription = registration.data?.subscription;
      }
      const access = await readCurrentAccess();
      if (generation !== authVersion) return;
      const { user, profile } = access;
      if (adminId && adminId !== user.id) { clearDirectory(); generation = authVersion; }
      adminId = user.id;
      const loaded = await refreshUsers();
      if (generation !== authVersion) return;
      if (loaded) {
        document.body.dataset.directoryState = 'ready';
        if ($('dropdownUserRole')) $('dropdownUserRole').textContent = 'Admin';
        if ($('dropdownUserName')) $('dropdownUserName').textContent = profile.full_name || profile.username || user.email || 'Admin';
        if ($('dropdownUserEmail')) $('dropdownUserEmail').textContent = user.email || '';
        if (!accessTimer) accessTimer = setInterval(verifyCurrentAccess, 30000);
        if (notify) showToast('User registry refreshed.');
        if (!channel && typeof db.channel === 'function') {
          const refresh = () => { clearTimeout(realtimeTimer); realtimeTimer = setTimeout(async () => {
            await verifyCurrentAccess(); if (adminId) await refreshUsers();
          }, 180); };
          channel = db.channel('admin-user-management')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, refresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'access_requests' }, () => refreshPending()).subscribe();
        }
      } else if (generation === authVersion) clearDirectory(state.error || 'Unable to load the user directory.');
    } catch (error) { handleAccessFailure(error); }
    finally {
      connecting = false; state.loading = false; applyFilters();
      if (reconnectRequested) { reconnectRequested = false; setTimeout(() => connectDatabase(), 0); }
    }
  }
  function accountServiceName() {
    const name = window.PGENRO_ADMIN_FUNCTION || 'admin-users';
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw Error('The account service name is invalid. Use admin-users.');
    return name;
  }
  function accountConnectionError() {
    accountServiceReadyUntil = 0;
    return Error(`Could not reach ${accountServiceName()}. Deploy the supplied Supabase Edge Function and check the website origin/CORS and network connection. Refresh the directory before retrying; this request was not confirmed.`);
  }
  async function checkAccountService() {
    if (Date.now() < accountServiceReadyUntil) return;
    const projectUrl = state.db?.supabaseUrl || window.PGENRO_SUPABASE?.url || 'https://zssrxubajhqryrwijyzm.supabase.co';
    const url = `${String(projectUrl).replace(/\/+$/, '')}/functions/v1/${accountServiceName()}`;
    let response;
    // A simple GET exposes a missing function without sending account data or
    // replaying a mutation when the browser blocks a CORS preflight response.
    try { response = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store' }); }
    catch { throw accountConnectionError(); }
    if (response.status === 404) throw Error(`The ${accountServiceName()} Edge Function is not deployed in this Supabase project. Deploy supabase/functions/admin-users/index.ts before creating accounts, changing credentials or suspending/activating users.`);
    // Older deployed versions have no health route but do return readable
    // HTTP responses. Keep them compatible; mutation authorization is intact.
    if ([401,403,405].includes(response.status)) { accountServiceReadyUntil = Date.now() + 30000; return; }
    let result;
    try { result = await response.json(); } catch { throw accountConnectionError(); }
    if (!response.ok || result?.success !== true || result?.service !== 'admin-users') {
      throw Error(result?.error || 'The account service is unavailable. Redeploy the supplied admin-users Edge Function.');
    }
    accountServiceReadyUntil = Date.now() + 30000;
  }
  async function invoke(action, payload) {
    if (!state.online || !adminId || !state.db) throw Error('Refresh and authorize the user registry before changing accounts.');
    const generation = authVersion;
    try { await readCurrentAccess(); } catch (error) { handleAccessFailure(error); throw error; }
    if (generation !== authVersion) throw Error('Your session changed. Refresh the user registry.');
    const session = await state.db.auth.getSession();
    if (generation !== authVersion) throw Error('Your session changed. Refresh the user registry.');
    const token = session.data?.session?.access_token;
    if (session.error || !token) { clearDirectory(); throw Error('Your session expired. Sign in again.'); }
    await checkAccountService();
    if (generation !== authVersion) throw Error('Your session changed. Refresh the user registry.');
    let response;
    try {
      response = await state.db.functions.invoke(accountServiceName(), {
        body: { action, ...payload }, headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      if (/fetch|network|Failed to send|Load failed/i.test(error?.message || '')) throw accountConnectionError();
      throw error;
    }
    if (generation !== authVersion) throw Error('Your session changed. Refresh the user registry.');
    if (response.error) {
      let body = null;
      try { body = await response.error.context?.json(); } catch {}
      const status = response.error.context?.status;
      if (!status && (response.error.name === 'FunctionsFetchError' || /Failed to send|Failed to fetch|NetworkError|Load failed/i.test(response.error.message || ''))) throw accountConnectionError();
      if (status === 401 || status === 403) {
        try { await readCurrentAccess(); } catch (error) { handleAccessFailure(error); throw error; }
        throw Error(`The admin-users service rejected this request: ${body?.error || body?.message || response.error.message}. Check its Admin/User authorization and JWT configuration; your database Admin access is still valid.`);
      }
      if (status === 404 && (!body?.error && !body?.message || /function.*not found/i.test(body?.message || body?.error || ''))) throw Error('Deploy the existing admin-users Edge Function to create/delete Auth accounts or change email/password/status.');
      throw Error(body?.error || body?.message || response.error.message || 'The account service could not complete this action.');
    }
    const result = response.data;
    if (!result || (result.success !== true && result.ok !== true)) throw Error(result?.error || 'The account service did not confirm this action.');
    if (result.warnings?.length) showToast(result.warnings.join(' '), 'warning');
    return result;
  }
  function canonicalRole(value) {
    return String(value || '').trim().toLowerCase() === 'admin' ? 'Admin' : 'User';
  }
  function canonicalStatus(raw) {
    const value = String(raw.status || '').trim().toLowerCase();
    if (['active','approved','enabled'].includes(value)) return 'Active';
    if (['suspended','banned'].includes(value)) return 'Suspended';
    if (value === 'pending') return 'Pending';
    if (value === 'rejected') return 'Rejected';
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
      const title = state.loading ? 'Loading personnel accountsâ€¦' : state.error ? 'User directory unavailable' : 'No personnel accounts found';
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
    const roleClass = user.role === 'Admin' ? 'admin' : 'user';
    return `<tr data-user-id="${attr(user.id)}">
      <td><input type="checkbox" class="row-select" data-id="${attr(user.id)}" ${selfDisabled} ${selected ? 'checked' : ''} aria-label="Select ${attr(user.fullName)}"></td>
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
    const visibleIds = state.filtered.slice((state.page - 1) * state.pageSize, state.page * state.pageSize).filter(u => u.id !== adminId).map(u => u.id);
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
    visible.filter(u => u.id !== adminId).forEach(u => els.selectAllCheckbox.checked ? state.selected.add(u.id) : state.selected.delete(u.id));
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
    state.editingSnapshot = user ? { ...user } : null;
    if (els.roleChangeHelp) els.roleChangeHelp.textContent = user?.id === adminId ? 'Use another Admin to change your own access role.' : 'Choose the final Admin or User role. Save Changes applies it to the account.';
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
    if (els.roleSelect) els.roleSelect.value = user?.role || 'User';
    if (els.statusSelect) els.statusSelect.value = ['Active','Inactive','Suspended','Pending','Rejected'].includes(user?.status) ? user.status : 'Active';
    // Pending/Rejected are existing review states. Keeping that state does not
    // invoke the account service or silently approve the registration.
    const awaitingReview = ['Pending','Rejected'].includes(user?.status);
    if (els.statusSelect) [...els.statusSelect.options].forEach(option => {
      if (['Pending','Rejected'].includes(option.value)) {
        option.disabled = option.value !== user?.status;
        option.hidden = option.disabled;
      }
    });
    if (els.emailInput) els.emailInput.disabled = awaitingReview;
    if (els.passwordInput) els.passwordInput.disabled = awaitingReview;
    if (awaitingReview && els.roleChangeHelp) els.roleChangeHelp.textContent = `This account is ${user.status}. Role/profile edits preserve that status. Choose Active to approve access before changing credentials.`;
    if (els.roleSelect) els.roleSelect.disabled = user?.id === adminId;
    if (els.statusSelect) els.statusSelect.disabled = user?.id === adminId;
    if (els.modalTitle) els.modalTitle.textContent = user ? 'Edit User Account' : 'Add New User Account';
    if (els.modalSub) els.modalSub.textContent = user ? 'Update personnel profile, division, role, and account status.' : 'Configure personnel credentials and access permissions.';
    if (els.saveUserBtn) els.saveUserBtn.innerHTML = `<i data-lucide="save"></i>${user ? 'Save Changes' : 'Create Account'}`;
    M.openModal('userModal');
    els.fullNameInput?.focus({preventScroll:true});
    renderIcons();
  }
  function closeModal(){if(saving)return;M.closeModal('userModal');state.editingId=null;state.editingSnapshot=null;els.userForm?.reset();}
  async function saveUser(e) {
    e.preventDefault();
    if(saving)return;
    if (!els.userForm?.reportValidity()) return;
    const editingId = state.editingId, original = state.editingSnapshot;
    const isEdit = Boolean(editingId);
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
    if (!/^[a-zA-Z0-9_.-]{1,60}$/.test(userInput.username)) { showToast('Username must be 1â€“60 letters, numbers, dots, underscores or hyphens.', 'warning'); return; }
    if(state.users.some(u=>u.id!==state.editingId&&(u.email.toLowerCase()===userInput.email||u.username.toLowerCase()===userInput.username.toLowerCase()))){showToast('Email or username already exists.','warning');return;}
    if (!['Admin','User'].includes(userInput.role)) { showToast('Choose Admin or User.', 'warning'); return; }
    setSaving(true); feedback();
    const generation = authVersion;
    let committed = false;
    try {
      let result;
      if (isEdit) {
        if (!original) throw Error('Reopen this account before saving.');
        let expectedVersion = original.updatedAt || null;
        const credentialOrStatusChange = userInput.email !== original.email.toLowerCase() || Boolean(password) || userInput.status !== original.status;
        if (credentialOrStatusChange) {
          const changed = await invoke('update', { userId: editingId, user: userInput });
          expectedVersion = changed.user?.updated_at || changed.user?.updatedAt || null;
        }
        if (generation !== authVersion) throw Error('Your session changed. Refresh the user registry.');
        const response = await state.db.rpc('pgenro_um_save_profile', {
          p_user_id: editingId,
          p_changes: { full_name: userInput.fullName, username: userInput.username, division: userInput.division,
            role: userInput.role, position: userInput.position, contact: userInput.contact },
          p_expected_updated_at: expectedVersion
        });
        if (response.error) throw response.error;
        result = response.data;
      } else result = await invoke('create', { user: userInput });
      if (generation !== authVersion) throw Error('Your session changed. Refresh the user registry.');
      if (!result || (result.success !== true && result.ok !== true)) throw Error(result?.error || 'The server did not confirm the saved account.');
      const returned = result.user;
      if (!returned || !(returned.user_id || returned.id) || returned.role !== userInput.role ||
          (isEdit && String(returned.user_id || returned.id) !== editingId)) {
        throw Error('The server did not confirm the selected role. Refresh and verify this account before retrying.');
      }
      const saved = normalizeUser(returned.user_id || returned.id, returned);
      committed = true; upsertLocal(saved);
      setSaving(false); closeModal();
      M.audit(isEdit ? 'EDIT_USER' : 'CREATE_USER', `Account ${saved.email || saved.username}; role ${saved.role}`);
      const loaded = await refreshUsers();
      if (generation !== authVersion) return;
      if (!loaded) {
        feedback(`Account saved as ${saved.role}. The directory could not refresh; use Refresh to reload it.`, 'error');
        showToast('Account saved. Refresh the directory to verify the latest list.', 'warning'); return;
      }
      const confirmed = state.users.find(user => user.id === saved.id);
      if (!confirmed || confirmed.role !== userInput.role) throw Error('The saved role changed again or the account is no longer present. Reopen the current record.');
      feedback(isEdit ? `Account updated. Saved role: ${confirmed.role}.` : `Account created. Saved role: ${confirmed.role}.`, 'success');
      showToast(isEdit ? `Changes saved in Supabase. Role: ${confirmed.role}.` : 'Supabase user account created.');
    } catch (error) {
      if (generation !== authVersion) return;
      if (error?.code === '42501') { await verifyCurrentAccess(); if (generation !== authVersion) return; }
      await refreshUsers();
      const message = `${committed ? 'Account was saved; verify the current record' : 'Unable to save account'}: ${directoryError(error)}`;
      feedback(message); showToast(message, 'error');
    } finally { setSaving(false); }
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
      if (!await refreshUsers()) throw Error('The service responded, but the directory could not confirm the saved status. Refresh before retrying.');
      const confirmed = state.users.find(item => item.id === user.id);
      if (!confirmed || confirmed.status !== next) throw Error('The saved account status does not match the requested status. Check the admin-users service.');
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
      if (!await refreshUsers()) throw Error('The service responded, but deletion could not be verified. Refresh before retrying.');
      if (state.users.some(item => item.id === user.id)) throw Error('The account still exists. Check the admin-users deletion service.');
      state.selected.delete(user.id); applyFilters(); showToast('User account permanently removed.');
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
      if (!await refreshUsers()) { showToast('Deletion requests completed, but the directory could not refresh. Reload before retrying.', 'warning'); return; }
      for (const id of [...removed]) if (state.users.some(user => user.id === id)) { removed.delete(id); errors.push('An account still exists after the deletion response.'); }
      removed.forEach(id=>state.selected.delete(id));applyFilters();
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
  const previousDisabled = new Map();
  function setSaving(value) {
    saving = value;
    if (els.userModal) els.userModal.dataset.busy = String(value);
    els.userForm?.querySelectorAll('input,select,button').forEach(control => {
      if (value) { if (!previousDisabled.has(control)) previousDisabled.set(control, control.disabled); control.disabled = true; }
      else if (previousDisabled.has(control)) { control.disabled = previousDisabled.get(control); previousDisabled.delete(control); }
    });
    render();
    if (!els.saveUserBtn) return;
    els.saveUserBtn.disabled = value;
    els.saveUserBtn.innerHTML = value ? '<span class="spinner"></span> Saving...' : '<i data-lucide="save"></i> Save Account';
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

      results.innerHTML = matches.length ? matches.map(a => `<a class="workspace-jump-result" href="${M.escape(a.href)}">${a.icon}<span><strong>${M.escape(a.name)}</strong><small>${M.escape(a.group)}</small></span><span class="workspace-jump-arrow" aria-hidden="true">â†—</span></a>`).join('') : '<p class="workspace-jump-empty">No matching module. Try â€œmemoâ€, â€œinventoryâ€, or â€œusersâ€.</p>';

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

        const busy = surface.dataset.busy === 'true'; dialog.setAttribute('aria-busy',String(busy)); status.hidden = !busy; status.textContent = busy ? 'Workingâ€¦ Please wait before making more changes.' : '';

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

      controls.innerHTML = `<span>Scroll to see all columns</span><div><button type="button" aria-controls="${region.id}" aria-label="Scroll table left">â†</button><button type="button" aria-controls="${region.id}" aria-label="Scroll table right">â†’</button></div>`;

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

/* ===== PGENRO SLIDE NAVIGATION AND LOGOUT Â· module-owned presentation ===== */
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
      dialog.querySelector('[data-workspace-logout-confirm] span').textContent = value ? 'Logging outâ€¦' : 'Yes, log out';
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
          <p id="workspaceLogoutDescription">Youâ€™ll need to sign in again to access your records and office modules.</p>
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
    if(status==='loading')list.append(element('p','module-notification-empty','Loading notificationsâ€¦'));
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
    const closeBtn=element('button','module-notification-close','Ã—');closeBtn.type='button';closeBtn.setAttribute('aria-label','Close notifications');closeBtn.onclick=()=>{close();button.focus();};top.append(heading,closeBtn);
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

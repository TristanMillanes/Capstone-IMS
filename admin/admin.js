/* Module-owned runtime. Kept inside each module; no extra shared file required. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const storage = {
    get(key, fallback = null) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  // Append-only dashboard/module audit writer. The audit page owns querying and display.
  let auditColumns = null, auditShape = null;
  async function audit(action, details, options = {}) {
    const db = client();
    const profile = storage.get('pgenro_current_user', {}) || {};
    let actor = null;
    try { actor = (await db?.auth?.getSession?.())?.data?.session?.user || null; } catch {}
    const id = uuid(), timestamp = new Date().toISOString();
    const normalized = String(action || 'SYSTEM_ACTIVITY').trim().toUpperCase().replace(/\s+/g, '_');
    const event = {
      id, eventId: id, timestamp, created_at: timestamp, createdAt: timestamp,
      userId: actor?.id || profile.id || profile.userId || null,
      userEmail: actor?.email || profile.email || '',
      userName: profile.fullName || profile.full_name || profile.name || actor?.user_metadata?.full_name || 'System operator',
      role: profile.role || 'Admin', activity: normalized, action: normalized,
      actionType: normalized === 'LOGIN' ? 'login' : normalized === 'LOGOUT' ? 'logout' : 'activity',
      module: options.module || document.title.split('|')[1]?.trim() || 'Admin Dashboard',
      details: String(details || 'Activity recorded.'), ipAddress: options.ipAddress || 'Not captured', sessionStatus: options.status || 'Success'
    };
    const cached = storage.get('pgenro_audit_log_fallback', []);
    storage.set('pgenro_audit_log_fallback', [event, ...(Array.isArray(cached) ? cached : [])].slice(0, 500));
    window.dispatchEvent(new CustomEvent('pgenro:audit-recorded', { detail: event }));
    if (!db) return event;
    try {
      if (auditShape === null) {
        const probe = await db.from('audit_logs').select('*').limit(1);
        if (probe.error) throw probe.error;
        auditColumns = probe.data?.[0] ? new Set(Object.keys(probe.data[0])) : null;
        if (auditColumns) auditShape = auditColumns.has('data');
        else {
          const shape = await db.from('audit_logs').select('data').limit(1);
          auditShape = !shape.error;
        }
      }
      if (auditShape) {
        const result = await db.from('audit_logs').insert({ id, data: event });
        if (result.error) throw result.error;
      } else {
        const flat = { ...event, user_id: event.userId, user_email: event.userEmail, user_name: event.userName,
          action_type: event.actionType, ip_address: event.ipAddress, session_status: event.sessionStatus, status: event.sessionStatus,
          metadata: event, description: event.details, email: event.userEmail };
        const payload = auditColumns ? Object.fromEntries(Object.entries(flat).filter(([key]) => auditColumns.has(key))) : flat;
        // Empty flat tables cannot reveal column names. Omit only columns explicitly rejected by PostgREST.
        for (let attempt = 0; attempt <= Object.keys(flat).length; attempt++) {
          const result = await db.from('audit_logs').insert(payload);
          if (!result.error) { auditColumns = new Set(Object.keys(payload)); break; }
          const message = String(result.error.message || '');
          const missing = message.match(/Could not find the '([^']+)' column/i)?.[1]
            || message.match(/column "([^"]+)".*does not exist/i)?.[1];
          if (!missing || !(missing in payload)) throw result.error;
          delete payload[missing];
          if (!Object.keys(payload).length || attempt === Object.keys(flat).length) throw result.error;
        }
      }
      event.remoteSaved = true;
    } catch (error) {
      event.remoteSaved = false;
      console.warn('Audit event retained in this browser:', error.message || 'Audit table unavailable');
    }
    return event;
  }

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
    // The existing authentication gateway owns logout when available.
    if (!window.PGENRO_API?.signOut) $('logoutBtn')?.addEventListener('click', async () => {
      const confirmed = window.PGENRO_ConfirmLogout ? await window.PGENRO_ConfirmLogout() : confirm('Log out of your workspace?');
      if (!confirmed) return;
      try {
        await audit('LOGOUT', 'Operator signed out of the administrative workspace.');
        const result = await client()?.auth?.signOut?.(); if(result?.error) throw result.error;
        try { localStorage.removeItem('pgenro_current_user'); sessionStorage.removeItem('pgenro_current_user'); } catch {}
        location.href = '../User/login.html';
      } catch { window.dispatchEvent(new Event('pgenro:logout-error')); toast('Sign out failed. Please try again.', 'error'); }
    });
  }
  // ICON_MAP is inserted while packaging, from the existing local Lucide subset.
  const icons = {"activity":[["path",{"d":"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"}]],"alert-circle":[["circle",{"cx":"12","cy":"12","r":"10"}],["line",{"x1":"12","x2":"12","y1":"8","y2":"12"}],["line",{"x1":"12","x2":"12.01","y1":"16","y2":"16"}]],"alert-triangle":[["path",{"d":"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}],["path",{"d":"M12 9v4"}],["path",{"d":"M12 17h.01"}]],"archive":[["rect",{"width":"20","height":"5","x":"2","y":"3","rx":"1"}],["path",{"d":"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"}],["path",{"d":"M10 12h4"}]],"archive-restore":[["rect",{"width":"20","height":"5","x":"2","y":"3","rx":"1"}],["path",{"d":"M4 8v11a2 2 0 0 0 2 2h2"}],["path",{"d":"M20 8v11a2 2 0 0 1-2 2h-2"}],["path",{"d":"m9 15 3-3 3 3"}],["path",{"d":"M12 12v9"}]],"arrow-left-right":[["path",{"d":"M8 3 4 7l4 4"}],["path",{"d":"M4 7h16"}],["path",{"d":"m16 21 4-4-4-4"}],["path",{"d":"M20 17H4"}]],"arrow-up-down":[["path",{"d":"m21 16-4 4-4-4"}],["path",{"d":"M17 20V4"}],["path",{"d":"m3 8 4-4 4 4"}],["path",{"d":"M7 4v16"}]],"arrow-up-right":[["path",{"d":"M7 7h10v10"}],["path",{"d":"M7 17 17 7"}]],"award":[["path",{"d":"m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"}],["circle",{"cx":"12","cy":"8","r":"6"}]],"badge":[["path",{"d":"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"}]],"badge-check":[["path",{"d":"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"}],["path",{"d":"m9 12 2 2 4-4"}]],"bar-chart-3":[["path",{"d":"M3 3v16a2 2 0 0 0 2 2h16"}],["path",{"d":"M18 17V9"}],["path",{"d":"M13 17V5"}],["path",{"d":"M8 17v-3"}]],"boxes":[["path",{"d":"M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"}],["path",{"d":"m7 16.5-4.74-2.85"}],["path",{"d":"m7 16.5 5-3"}],["path",{"d":"M7 16.5v5.17"}],["path",{"d":"M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"}],["path",{"d":"m17 16.5-5-3"}],["path",{"d":"m17 16.5 4.74-2.85"}],["path",{"d":"M17 16.5v5.17"}],["path",{"d":"M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"}],["path",{"d":"M12 8 7.26 5.15"}],["path",{"d":"m12 8 4.74-2.85"}],["path",{"d":"M12 13.5V8"}]],"briefcase":[["path",{"d":"M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"}],["rect",{"width":"20","height":"14","x":"2","y":"6","rx":"2"}]],"briefcase-business":[["path",{"d":"M12 12h.01"}],["path",{"d":"M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"}],["path",{"d":"M22 13a18.15 18.15 0 0 1-20 0"}],["rect",{"width":"20","height":"14","x":"2","y":"6","rx":"2"}]],"building-2":[["path",{"d":"M10 12h4"}],["path",{"d":"M10 8h4"}],["path",{"d":"M14 21v-3a2 2 0 0 0-4 0v3"}],["path",{"d":"M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"}],["path",{"d":"M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"}]],"calendar":[["path",{"d":"M8 2v4"}],["path",{"d":"M16 2v4"}],["rect",{"width":"18","height":"18","x":"3","y":"4","rx":"2"}],["path",{"d":"M3 10h18"}]],"calendar-arrow-down":[["path",{"d":"m14 18 4 4 4-4"}],["path",{"d":"M16 2v4"}],["path",{"d":"M18 14v8"}],["path",{"d":"M21 11.354V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7.343"}],["path",{"d":"M3 10h18"}],["path",{"d":"M8 2v4"}]],"calendar-arrow-up":[["path",{"d":"m14 18 4-4 4 4"}],["path",{"d":"M16 2v4"}],["path",{"d":"M18 22v-8"}],["path",{"d":"M21 11.343V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9"}],["path",{"d":"M3 10h18"}],["path",{"d":"M8 2v4"}]],"calendar-clock":[["path",{"d":"M16 14v2.2l1.6 1"}],["path",{"d":"M16 2v4"}],["path",{"d":"M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"}],["path",{"d":"M3 10h5"}],["path",{"d":"M8 2v4"}],["circle",{"cx":"16","cy":"16","r":"6"}]],"calendar-days":[["path",{"d":"M8 2v4"}],["path",{"d":"M16 2v4"}],["rect",{"width":"18","height":"18","x":"3","y":"4","rx":"2"}],["path",{"d":"M3 10h18"}],["path",{"d":"M8 14h.01"}],["path",{"d":"M12 14h.01"}],["path",{"d":"M16 14h.01"}],["path",{"d":"M8 18h.01"}],["path",{"d":"M12 18h.01"}],["path",{"d":"M16 18h.01"}]],"calendar-off":[["path",{"d":"M4.2 4.2A2 2 0 0 0 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 1.82-1.18"}],["path",{"d":"M21 15.5V6a2 2 0 0 0-2-2H9.5"}],["path",{"d":"M16 2v4"}],["path",{"d":"M3 10h7"}],["path",{"d":"M21 10h-5.5"}],["path",{"d":"m2 2 20 20"}]],"calendar-range":[["rect",{"width":"18","height":"18","x":"3","y":"4","rx":"2"}],["path",{"d":"M16 2v4"}],["path",{"d":"M3 10h18"}],["path",{"d":"M8 2v4"}],["path",{"d":"M17 14h-6"}],["path",{"d":"M13 18H7"}],["path",{"d":"M7 14h.01"}],["path",{"d":"M17 18h.01"}]],"car-front":[["path",{"d":"m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8"}],["path",{"d":"M7 14h.01"}],["path",{"d":"M17 14h.01"}],["rect",{"width":"18","height":"8","x":"3","y":"10","rx":"2"}],["path",{"d":"M5 18v2"}],["path",{"d":"M19 18v2"}]],"chart-no-axes-combined":[["path",{"d":"M12 16v5"}],["path",{"d":"M16 14v7"}],["path",{"d":"M20 10v11"}],["path",{"d":"m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15"}],["path",{"d":"M4 18v3"}],["path",{"d":"M8 14v7"}]],"check":[["path",{"d":"M20 6 9 17l-5-5"}]],"check-circle-2":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m9 12 2 2 4-4"}]],"chevron-left":[["path",{"d":"m15 18-6-6 6-6"}]],"chevron-right":[["path",{"d":"m9 18 6-6-6-6"}]],"circle-check":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m9 12 2 2 4-4"}]],"circle-dot":[["circle",{"cx":"12","cy":"12","r":"10"}],["circle",{"cx":"12","cy":"12","r":"1"}]],"clipboard-check":[["rect",{"width":"8","height":"4","x":"8","y":"2","rx":"1","ry":"1"}],["path",{"d":"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"}],["path",{"d":"m9 14 2 2 4-4"}]],"clipboard-list":[["rect",{"width":"8","height":"4","x":"8","y":"2","rx":"1","ry":"1"}],["path",{"d":"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"}],["path",{"d":"M12 11h4"}],["path",{"d":"M12 16h4"}],["path",{"d":"M8 11h.01"}],["path",{"d":"M8 16h.01"}]],"clipboard-pen-line":[["rect",{"width":"8","height":"4","x":"8","y":"2","rx":"1"}],["path",{"d":"M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-.5"}],["path",{"d":"M16 4h2a2 2 0 0 1 1.73 1"}],["path",{"d":"M8 18h1"}],["path",{"d":"M21.378 12.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"}]],"clock":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 6v6l4 2"}]],"clock-3":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 6v6h4"}]],"cloud":[["path",{"d":"M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"}]],"coins":[["path",{"d":"M13.744 17.736a6 6 0 1 1-7.48-7.48"}],["path",{"d":"M15 6h1v4"}],["path",{"d":"m6.134 14.768.866-.5 2 3.464"}],["circle",{"cx":"16","cy":"8","r":"6"}]],"contact":[["path",{"d":"M16 2v2"}],["path",{"d":"M7 22v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"}],["path",{"d":"M8 2v2"}],["circle",{"cx":"12","cy":"11","r":"3"}],["rect",{"x":"3","y":"4","width":"18","height":"18","rx":"2"}]],"database":[["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3"}],["path",{"d":"M3 5V19A9 3 0 0 0 21 19V5"}],["path",{"d":"M3 12A9 3 0 0 0 21 12"}]],"database-backup":[["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3"}],["path",{"d":"M3 12a9 3 0 0 0 5 2.69"}],["path",{"d":"M21 9.3V5"}],["path",{"d":"M3 5v14a9 3 0 0 0 6.47 2.88"}],["path",{"d":"M12 12v4h4"}],["path",{"d":"M13 20a5 5 0 0 0 9-3 4.5 4.5 0 0 0-4.5-4.5c-1.33 0-2.54.54-3.41 1.41L12 16"}]],"download":[["path",{"d":"M12 15V3"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["path",{"d":"m7 10 5 5 5-5"}]],"external-link":[["path",{"d":"M15 3h6v6"}],["path",{"d":"M10 14 21 3"}],["path",{"d":"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"}]],"eye":[["path",{"d":"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"file-badge":[["path",{"d":"M13 22h5a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v3.3"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"m7.69 16.479 1.29 4.88a.5.5 0 0 1-.698.591l-1.843-.849a1 1 0 0 0-.879.001l-1.846.85a.5.5 0 0 1-.692-.593l1.29-4.88"}],["circle",{"cx":"6","cy":"14","r":"3"}]],"file-check":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"m9 15 2 2 4-4"}]],"file-check-2":[["path",{"d":"M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v6"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"m14 20 2 2 4-4"}]],"file-plus-2":[["path",{"d":"M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M14 19h6"}],["path",{"d":"M17 16v6"}]],"file-spreadsheet":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M8 13h2"}],["path",{"d":"M14 13h2"}],["path",{"d":"M8 17h2"}],["path",{"d":"M14 17h2"}]],"file-text":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M10 9H8"}],["path",{"d":"M16 13H8"}],["path",{"d":"M16 17H8"}]],"file-up":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M12 12v6"}],["path",{"d":"m15 15-3-3-3 3"}]],"file-x-2":[["path",{"d":"M11 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"m15 17 5 5"}],["path",{"d":"m20 17-5 5"}]],"files":[["path",{"d":"M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"}],["path",{"d":"M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z"}],["path",{"d":"M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1"}]],"flag":[["path",{"d":"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"}]],"hash":[["line",{"x1":"4","x2":"20","y1":"9","y2":"9"}],["line",{"x1":"4","x2":"20","y1":"15","y2":"15"}],["line",{"x1":"10","x2":"8","y1":"3","y2":"21"}],["line",{"x1":"16","x2":"14","y1":"3","y2":"21"}]],"id-card":[["path",{"d":"M16 10h2"}],["path",{"d":"M16 14h2"}],["path",{"d":"M6.17 15a3 3 0 0 1 5.66 0"}],["circle",{"cx":"9","cy":"11","r":"2"}],["rect",{"x":"2","y":"5","width":"20","height":"14","rx":"2"}]],"info":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 16v-4"}],["path",{"d":"M12 8h.01"}]],"landmark":[["path",{"d":"M10 18v-7"}],["path",{"d":"M11.12 2.198a2 2 0 0 1 1.76.006l7.866 3.847c.476.233.31.949-.22.949H3.474c-.53 0-.695-.716-.22-.949z"}],["path",{"d":"M14 18v-7"}],["path",{"d":"M18 18v-7"}],["path",{"d":"M3 22h18"}],["path",{"d":"M6 18v-7"}]],"layers":[["path",{"d":"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"}],["path",{"d":"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"}],["path",{"d":"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"}]],"layers-3":[["path",{"d":"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"}],["path",{"d":"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"}],["path",{"d":"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"}]],"layout-dashboard":[["rect",{"width":"7","height":"9","x":"3","y":"3","rx":"1"}],["rect",{"width":"7","height":"5","x":"14","y":"3","rx":"1"}],["rect",{"width":"7","height":"9","x":"14","y":"12","rx":"1"}],["rect",{"width":"7","height":"5","x":"3","y":"16","rx":"1"}]],"lightbulb":[["path",{"d":"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"}],["path",{"d":"M9 18h6"}],["path",{"d":"M10 22h4"}]],"list-filter":[["path",{"d":"M2 5h20"}],["path",{"d":"M6 12h12"}],["path",{"d":"M9 19h6"}]],"list-filter-x":[["path",{"d":"M3 5h18M6 12h9M9 19h3M17 16l5 5M22 16l-5 5"}]],"log-out":[["path",{"d":"m16 17 5-5-5-5"}],["path",{"d":"M21 12H9"}],["path",{"d":"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"}]],"map-pin":[["path",{"d":"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"}],["circle",{"cx":"12","cy":"10","r":"3"}]],"map-pinned":[["path",{"d":"M18 8c0 3.613-3.869 7.429-5.393 8.795a1 1 0 0 1-1.214 0C9.87 15.429 6 11.613 6 8a6 6 0 0 1 12 0"}],["circle",{"cx":"12","cy":"8","r":"2"}],["path",{"d":"M8.714 14h-3.71a1 1 0 0 0-.948.683l-2.004 6A1 1 0 0 0 3 22h18a1 1 0 0 0 .948-1.316l-2-6a1 1 0 0 0-.949-.684h-3.712"}]],"menu":[["path",{"d":"M4 5h16"}],["path",{"d":"M4 12h16"}],["path",{"d":"M4 19h16"}]],"package":[["path",{"d":"M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"}],["path",{"d":"M12 22V12"}],["polyline",{"points":"3.29 7 12 12 20.71 7"}],["path",{"d":"m7.5 4.27 9 5.15"}]],"package-search":[["path",{"d":"M12 22V12"}],["path",{"d":"M20.27 18.27 22 20"}],["path",{"d":"M21 10.498V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.729l7 4a2 2 0 0 0 2 .001l.98-.559"}],["path",{"d":"M3.29 7 12 12l8.71-5"}],["path",{"d":"m7.5 4.27 8.997 5.148"}],["circle",{"cx":"18.5","cy":"16.5","r":"2.5"}]],"paperclip":[["path",{"d":"m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"}]],"pencil":[["path",{"d":"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}],["path",{"d":"m15 5 4 4"}]],"philippine-peso":[["path",{"d":"M20 11H4"}],["path",{"d":"M20 7H4"}],["path",{"d":"M7 21V4a1 1 0 0 1 1-1h4a1 1 0 0 1 0 12H7"}]],"phone":[["path",{"d":"M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"}]],"pin":[["path",{"d":"M12 17v5"}],["path",{"d":"M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"}]],"plus":[["path",{"d":"M5 12h14"}],["path",{"d":"M12 5v14"}]],"plus-circle":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M8 12h8"}],["path",{"d":"M12 8v8"}]],"printer":[["path",{"d":"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"}],["path",{"d":"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"}],["rect",{"x":"6","y":"14","width":"12","height":"8","rx":"1"}]],"receipt-text":[["path",{"d":"M13 16H8"}],["path",{"d":"M14 8H8"}],["path",{"d":"M16 12H8"}],["path",{"d":"M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"}]],"refresh-cw":[["path",{"d":"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{"d":"M21 3v5h-5"}],["path",{"d":"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{"d":"M8 16H3v5"}]],"rotate-ccw":[["path",{"d":"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}],["path",{"d":"M3 3v5h5"}]],"route":[["circle",{"cx":"6","cy":"19","r":"3"}],["path",{"d":"M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"}],["circle",{"cx":"18","cy":"5","r":"3"}]],"rows-3":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M21 9H3"}],["path",{"d":"M21 15H3"}]],"save":[["path",{"d":"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"}],["path",{"d":"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"}],["path",{"d":"M7 3v4a1 1 0 0 0 1 1h7"}]],"scan-text":[["path",{"d":"M3 7V5a2 2 0 0 1 2-2h2"}],["path",{"d":"M17 3h2a2 2 0 0 1 2 2v2"}],["path",{"d":"M21 17v2a2 2 0 0 1-2 2h-2"}],["path",{"d":"M7 21H5a2 2 0 0 1-2-2v-2"}],["path",{"d":"M7 8h8"}],["path",{"d":"M7 12h10"}],["path",{"d":"M7 16h6"}]],"search":[["path",{"d":"m21 21-4.34-4.34"}],["circle",{"cx":"11","cy":"11","r":"8"}]],"search-x":[["path",{"d":"m13.5 8.5-5 5"}],["path",{"d":"m8.5 8.5 5 5"}],["circle",{"cx":"11","cy":"11","r":"8"}],["path",{"d":"m21 21-4.3-4.3"}]],"send":[["path",{"d":"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"}],["path",{"d":"m21.854 2.147-10.94 10.939"}]],"settings":[["path",{"d":"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"shield-alert":[["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{"d":"M12 8v4"}],["path",{"d":"M12 16h.01"}]],"shield-check":[["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{"d":"m9 12 2 2 4-4"}]],"shirt":[["path",{"d":"M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"}]],"square-pen":[["path",{"d":"M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"}],["path",{"d":"M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"}]],"table":[["path",{"d":"M12 3v18"}],["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M3 9h18"}],["path",{"d":"M3 15h18"}]],"tag":[["path",{"d":"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"}],["circle",{"cx":"7.5","cy":"7.5","r":".5","fill":"currentColor"}]],"tags":[["path",{"d":"M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 6 9.172V3a1 1 0 0 1 1-1z"}],["path",{"d":"M2 7v6.172a2 2 0 0 0 .586 1.414l6.71 6.71a2.4 2.4 0 0 0 3.191.193"}],["circle",{"cx":"10.5","cy":"6.5","r":".5","fill":"currentColor"}]],"trash-2":[["path",{"d":"M10 11v6"}],["path",{"d":"M14 11v6"}],["path",{"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{"d":"M3 6h18"}],["path",{"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]],"trending-up":[["path",{"d":"M16 7h6v6"}],["path",{"d":"m22 7-8.5 8.5-5-5L2 17"}]],"upload":[["path",{"d":"M12 3v12"}],["path",{"d":"m17 8-5-5-5 5"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}]],"upload-cloud":[["path",{"d":"M12 13v8"}],["path",{"d":"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"}],["path",{"d":"m8 17 4-4 4 4"}]],"user":[["path",{"d":"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"}],["circle",{"cx":"12","cy":"7","r":"4"}]],"user-check":[["path",{"d":"m16 11 2 2 4-4"}],["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"user-cog":[["path",{"d":"M10 15H6a4 4 0 0 0-4 4v2"}],["path",{"d":"m14.305 16.53.923-.382"}],["path",{"d":"m15.228 13.852-.923-.383"}],["path",{"d":"m16.852 12.228-.383-.923"}],["path",{"d":"m16.852 17.772-.383.924"}],["path",{"d":"m19.148 12.228.383-.923"}],["path",{"d":"m19.53 18.696-.382-.924"}],["path",{"d":"m20.772 13.852.924-.383"}],["path",{"d":"m20.772 16.148.924.383"}],["circle",{"cx":"18","cy":"15","r":"3"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"user-plus":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}],["line",{"x1":"19","x2":"19","y1":"8","y2":"14"}],["line",{"x1":"22","x2":"16","y1":"11","y2":"11"}]],"user-round":[["circle",{"cx":"12","cy":"8","r":"5"}],["path",{"d":"M20 21a8 8 0 0 0-16 0"}]],"user-round-check":[["path",{"d":"M2 21a8 8 0 0 1 13.292-6"}],["circle",{"cx":"10","cy":"8","r":"5"}],["path",{"d":"m16 19 2 2 4-4"}]],"users":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["path",{"d":"M16 3.128a4 4 0 0 1 0 7.744"}],["path",{"d":"M22 21v-2a4 4 0 0 0-3-3.87"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"users-round":[["path",{"d":"M18 21a8 8 0 0 0-16 0"}],["circle",{"cx":"10","cy":"8","r":"5"}],["path",{"d":"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"}]],"wallet-cards":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2"}],["path",{"d":"M3 11h3c.8 0 1.6.3 2.1.9l1.1.9c1.6 1.6 4.1 1.6 5.7 0l1.1-.9c.5-.5 1.3-.9 2.1-.9H21"}]],"wrench":[["path",{"d":"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"}]],"x":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],"x-circle":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m15 9-6 6"}],["path",{"d":"m9 9 6 6"}]],"sun":[["circle",{"cx":"12","cy":"12","r":"4"}],["path",{"d":"M12 2v2"}],["path",{"d":"M12 20v2"}],["path",{"d":"m4.93 4.93 1.41 1.41"}],["path",{"d":"m17.66 17.66 1.41 1.41"}],["path",{"d":"M2 12h2"}],["path",{"d":"M20 12h2"}],["path",{"d":"m6.34 17.66-1.41 1.41"}],["path",{"d":"m19.07 4.93-1.41 1.41"}]],"moon":[["path",{"d":"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"}]]};
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
        ...row,
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
      if (!batch.length || typeof response.count === "number" && offset >= response.count || typeof response.count !== "number" && batch.length < batchSize) break;
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

  const renderIcons = () => window.PGENRO_Module.renderIcons();

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
    { key: "communications", label: "Communications", table: "communications", href: "admincommunication.html", color: "#4b9da7" },
    { key: "memos", label: "Office Memos", table: "office_memos", href: "officememo-admin.html", color: "#278560" },
    { key: "travel", label: "Travel Orders", table: "travel_orders", href: "travelOR-admin.html", color: "#8b7ac7" },
    { key: "visitors", label: "Visitors", table: "visitors", href: "visitors-admin.html", color: "#c79b46" },
    { key: "services", label: "Service Requests", table: "service_requests", href: "serviceAdmin.html", color: "#ce7d78" },
    { key: "ics", label: "ICS Property Slips", table: "ics_records", href: "ics-admin.html", color: "#7caa9f" }
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

  let memosList = [];
  let analyticsRange = "90";
  let lastAnalyticsModel = null;
  const analyticsDayMs = 86400000;
  let analyticsFrame = null;
  function scheduleAnalytics() {
    if (analyticsFrame !== null) return;
    analyticsFrame = setTimeout(() => {
      analyticsFrame = null;
      updateChartsAndAnalytics();
    }, 120);
  }

  /* --------------------------------------------------------------------------
     3. PROFILE & USER PREFERENCES
     -------------------------------------------------------------------------- */
  function updateProfileUI(profile = {}) {
    const name = profile.fullName || profile.full_name || profile.name || profile.displayName || "PGENRO Admin";
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
    document.body.classList.toggle("hide-db-status", prefs.showDb === false);
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

  // Recording stays available on the dashboard; reading and inspecting belong to Audit Trail.
  const auditDate = row => {
    const day = recordDay(row, 'memos'); return day === null ? new Date(0) : new Date(day * analyticsDayMs);
  };
  const logAudit = (action, details, options) => window.PGENRO_Module.audit(action, details, options);
  window.PGENRO_AUDIT = { log: logAudit };

  /* --------------------------------------------------------------------------
     6. DATA ANALYTICS & CHART CONTROLLERS (WITH EXPANDED ACCURACY)
     -------------------------------------------------------------------------- */
  const officeDateFormat=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'});
  const moduleDateFields = {
    communications: ['receivedDate', 'received_date', 'date_received', 'dateReceived', 'sentDate', 'sent_date', 'date_sent', 'letterDate', 'docDate', 'document_date'],
    memos: ['memoDate', 'memo_date', 'dateIssued', 'date_issued', 'issuedDate', 'issued_date'],
    travel: ['departureDate', 'departure_date', 'travelDate', 'travel_date', 'date_from', 'dateFrom', 'start_date', 'startDate'],
    visitors: ['visitDate', 'visit_date', 'dateVisited', 'date_visited', 'time_in', 'timeIn', 'check_in', 'checkIn'],
    services: ['requestDate', 'request_date', 'date_requested', 'dateRequested'],
    ics: ['dateIssued', 'date_issued', 'issuedDate', 'issued_date', 'icsDate', 'ics_date']
  };
  function recordDay(row, key) {
    const fields = [...(moduleDateFields[key] || []), 'date', 'created_at', 'createdAt', 'timestamp'];
    for (const field of fields) {
      const raw = row?.[field];
      if (raw === null || raw === undefined || raw === '') continue;
      let date;
      if (typeof raw?.toDate === 'function') date = raw.toDate();
      else if (raw instanceof Date) date = raw;
      else if (typeof raw === 'number') date = new Date(raw > 1e11 ? raw : raw * 1000);
      else if (typeof raw === 'string') {
        const text = raw.trim();
        if (/^\d{1,2}:\d{2}/.test(text)) continue; // A time alone is not an activity date.
        const plain = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (plain) {
          const [year, month, day] = plain.slice(1).map(Number);
          const stamp = new Date(Date.UTC(year, month - 1, day));
          if (stamp.getUTCFullYear() !== year || stamp.getUTCMonth() !== month - 1 || stamp.getUTCDate() !== day) continue;
          return Math.floor(stamp.getTime() / analyticsDayMs);
        }
        date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:/.test(text) ? text.replace(' ', 'T') : text);
      }
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) continue;
      // The office reports in Philippine calendar days, including UTC timestamps near midnight.
      const parts = officeDateFormat.formatToParts(date);
      const part = type => Number(parts.find(p => p.type === type)?.value);
      return Math.floor(Date.UTC(part('year'), part('month') - 1, part('day')) / analyticsDayMs);
    }
    return null;
  }

  function serviceBucket(row) {
    const s = String(row?.status || row?.serviceStatus || row?.service_status || "").trim().toLowerCase();
    if (/archive/.test(s)) return "archived";
    if (/^(complete|completed|closed|resolved|done)$/.test(s)) return "completed";
    if (/progress|ongoing|processing/.test(s)) return "progress";
    if (/pending|open|new|for review/.test(s)) return "pending";
    return "other";
  }

  function stockSummary(rows) {
    const res = { out: 0, low: 0, healthy: 0, unknown: 0 };
    for (const r of rows || []) {
      const quantity = r.quantity ?? r.qty ?? r.stock ?? r.current_stock;
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
    const today = recordDay({ timestamp: now }, '');
    const reportingYear = new Date(today * analyticsDayMs).getUTCFullYear();
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

    const start = range === "all" ? earliest : range === "year" ? Math.floor(Date.UTC(reportingYear, 0, 1) / analyticsDayMs) : today - (range === "30" ? 29 : 89);
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
    for (let day = start; day <= today; day = bucketType === 'month'
      ? Math.floor(Date.UTC(new Date(day * analyticsDayMs).getUTCFullYear(), new Date(day * analyticsDayMs).getUTCMonth() + 1, 1) / analyticsDayMs)
      : day + (bucketType === 'week' ? 7 : 1)) {
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
      const division = String(emp.division || emp.division_name || emp.department || emp.section || emp.office || "Unassigned").trim() || "Unassigned";
      divisionCounts[division] = (divisionCounts[division] || 0) + 1;
    });

    // Direction categories are mutually exclusive. Action required is a separate metric.
    const commBreakdown = { incoming: 0, outgoing: 0, internal: 0, unclassified: 0, actionRequired: 0 };
    const commRows = (sources.communications?.rows || []).filter((comm) => {
      const day = recordDay(comm, "communications");
      return day !== null && day >= start && day <= today;
    });
    commRows.forEach((comm) => {
      const type = String(comm.direction || comm.communicationType || comm.communication_type || comm.flow || comm.type || comm.documentType || comm.document_type || "").trim().toLowerCase();
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

  // Each canvas owns one chart and one dedicated, bounded resize container.
  const chartInstances = new Map();
  const chartFailures = new Set();
  const chartTheme = () => document.documentElement.dataset.theme === "dark"
    ? { text: "#a9c6bb", grid: "#294b3e", surface: "#142c23", total: "#ecf7f1", tip: "#071c14" }
    : { text: "#71857a", grid: "#e8efe9", surface: "#ffffff", total: "#163d2b", tip: "#163d2b" };

  const doughnutTotal = {
    id: "pgenroDoughnutTotal",
    afterDraw(chart) {
      if (chart.config.type !== "doughnut" || !chart.chartArea) return;
      const arc = chart.getDatasetMeta(0).data[0];
      if (!arc || arc.innerRadius < 28) return;
      const total = chart.data.datasets[0].data.reduce((sum, n, i) =>
        sum + (chart.getDataVisibility(i) ? Number(n) || 0 : 0), 0);
      const ctx = chart.ctx, theme = chartTheme();
      ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = theme.total;
      ctx.font = `750 ${Math.min(31, arc.innerRadius * .49)}px Inter, system-ui, sans-serif`;
      ctx.fillText(new Intl.NumberFormat("en-PH", { notation: total >= 10000 ? "compact" : "standard" }).format(total), arc.x, arc.y - 6);
      ctx.fillStyle = theme.text; ctx.font = "600 9px Inter, system-ui, sans-serif";
      const filtered = chart.data.labels.some((_, index) => !chart.getDataVisibility(index));
      ctx.fillText(filtered ? "VISIBLE RECORDS" : "TOTAL RECORDS", arc.x, arc.y + 17); ctx.restore();
    }
  };

  function chartOptions({ horizontal = false, doughnut = false, legend = false } = {}) {
    const theme = chartTheme();
    // Fresh nested options for every instance prevent Chart.js mutation leaking across charts.
    const result = {
      responsive: true, maintainAspectRatio: false, resizeDelay: 0,
      animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 220 },
      font: { family: "Inter, system-ui, sans-serif" },
      interaction: { mode: doughnut ? "nearest" : "index", intersect: doughnut, axis: horizontal ? "y" : "x" },
      layout: { padding: { top: 8, bottom: 2, left: 0, right: 8 } },
      plugins: {
        legend: { display: legend, position: "bottom", labels: { color: theme.text, usePointStyle: true, pointStyle: "circle", boxWidth: 7, boxHeight: 7, padding: 13, font: { family: "Inter, system-ui, sans-serif", size: 10 } } },
        tooltip: { backgroundColor: theme.tip, titleColor: "#fff", bodyColor: "#ddefe4", padding: 12, cornerRadius: 10, displayColors: true,
          callbacks: { label(context) {
            const value = doughnut ? context.parsed : horizontal ? context.parsed.x : context.parsed.y;
            return `${context.dataset.label || context.label}: ${Number(value || 0).toLocaleString("en-PH")}`;
          } }
        }
      }
    };
    if (doughnut) { result.cutout = "74%"; return result; }
    result.indexAxis = horizontal ? "y" : "x";
    const numbers = { beginAtZero: true, suggestedMax: 1, border: { display: false }, grid: { color: theme.grid, drawTicks: false }, ticks: { precision: 0, padding: 8, color: theme.text, font: { size: 10 } } };
    const labels = { border: { display: false }, grid: { display: false }, ticks: { autoSkip: !horizontal, maxRotation: 0, maxTicksLimit: horizontal ? 24 : 8, padding: 8, color: theme.text, font: { size: 10 } } };
    result.scales = horizontal ? { x: numbers, y: labels } : { x: labels, y: numbers };
    return result;
  }

  function lineArea(context) {
    const { chart } = context, area = chart.chartArea;
    if (!area) return "#27856018";
    const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    gradient.addColorStop(0, "#27856036"); gradient.addColorStop(1, "#27856000"); return gradient;
  }

  function chartConfig(id) {
    if (id === "monthlyChart") return {
      type: "line", data: { labels: [], datasets: [
        { label: "Documents & ICS", borderColor: "#278560", backgroundColor: lineArea, fill: true },
        { label: "Travel orders", borderColor: "#8b7ac7" },
        { label: "Visitors", borderColor: "#c79b46" },
        { label: "Service requests", borderColor: "#ce7d78" }
      ].map(ds => ({ ...ds, data: [], tension: .25, borderWidth: 2.3, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 12 })) },
      options: chartOptions({ legend: true })
    };
    const donut = ["categoryChart", "commChart"].includes(id);
    const labels = id === "categoryChart" ? activityModules.map(m => m.label)
      : id === "commChart" ? ["Incoming", "Outgoing", "Internal", "Unclassified"]
      : id === "statusChart" ? ["Completed", "In progress", "Pending", "Archived", "Other"] : [];
    const colors = id === "categoryChart" ? activityModules.map(m => m.color)
      : id === "commChart" ? ["#4b9da7", "#278560", "#8b7ac7", "#c79b46"]
      : id === "statusChart" ? ["#278560", "#4b9da7", "#c79b46", "#94a3b8", "#b8c2bc"]
      : ["#278560", "#4b9da7", "#8b7ac7", "#c79b46", "#ce7d78", "#7caa9f"];
    return {
      type: donut ? "doughnut" : "bar",
      data: { labels, datasets: [{ label: id === "personnelChart" ? "Personnel" : "Records", data: [], backgroundColor: colors,
        borderColor: chartTheme().surface, borderWidth: donut ? 3 : 0, borderRadius: donut ? 5 : 6, borderSkipped: false, maxBarThickness: 23, spacing: donut ? 2 : 0 }] },
      options: chartOptions({ doughnut: donut, horizontal: !donut, legend: donut }),
      plugins: donut ? [doughnutTotal] : []
    };
  }

  function initCharts() {
    if (typeof window.Chart !== "function") return;
    for (const id of ["monthlyChart", "categoryChart", "statusChart", "personnelChart", "commChart"]) {
      const canvas = $(id);
      if (!canvas || chartInstances.has(id) || chartFailures.has(id)) continue;
      canvas.hidden = false;
      canvas.parentElement.querySelector(".native-chart")?.remove();
      try {
        window.Chart.getChart?.(canvas)?.destroy();
        chartInstances.set(id, new window.Chart(canvas, chartConfig(id)));
      } catch (error) {
        window.Chart.getChart?.(canvas)?.destroy();
        chartFailures.add(id);
        console.warn(`Chart ${id} uses its accessible fallback:`, error.message);
      }
    }
  }

  function updateDashboardCharts(model) {
    initCharts();
    for (const [id, chart] of chartInstances) {
      const horizontal = ["statusChart", "personnelChart"].includes(id);
      const doughnut = ["categoryChart", "commChart"].includes(id);
      chart.options = chartOptions({ horizontal, doughnut, legend: doughnut || id === "monthlyChart" });
      if (id === "monthlyChart") {
        chart.data.labels = model.buckets.map(b => b.label);
        ["documents", "travel", "visitors", "services"].forEach((key, i) => { chart.data.datasets[i].data = model.buckets.map(b => b[key]); });
      } else if (id === "categoryChart") chart.data.datasets[0].data = model.breakdown.map(m => m.current);
      else if (id === "statusChart") chart.data.datasets[0].data = Object.values(model.serviceStatuses);
      else if (id === "commChart") chart.data.datasets[0].data = ["incoming", "outgoing", "internal", "unclassified"].map(key => model.commBreakdown[key]);
      else {
        const divisions = Object.entries(model.divisionCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        chart.data.labels = divisions.map(([label]) => label);
        chart.data.datasets[0].data = divisions.map(([, value]) => value);
        chart.canvas.parentElement.style.height = `${Math.max(240, divisions.length * 33 + 32)}px`;
        chart.options.scales.y.ticks.callback = function(value) {
          const text = String(this.getLabelForValue(value));
          return text.length > 28 ? `${text.slice(0, 27)}…` : text;
        };
      }
      if (doughnut) chart.data.datasets[0].borderColor = chartTheme().surface;
      // Realtime bursts and appearance changes must not queue five new animations.
      chart.update("none");
    }
  }

  const chartAppearanceObserver = new MutationObserver(scheduleAnalytics);
  chartAppearanceObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.addEventListener("pageshow", event => { if (event.persisted) { chartInstances.forEach(chart => chart.resize()); scheduleAnalytics(); } });
  window.addEventListener("pagehide", event => {
    if (event.persisted) return;
    clearTimeout(analyticsFrame);
    chartAppearanceObserver.disconnect();
    chartInstances.forEach(chart => chart.destroy()); chartInstances.clear();
  });

  function updateChartsAndAnalytics() {
    const model = buildAnalyticsModel(analyticsSources, analyticsRange);
    lastAnalyticsModel = model;

    const startDateStr = new Date(model.start * analyticsDayMs).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    const endDateStr = new Date(model.end * analyticsDayMs).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    setText("analyticsPeriodLabel", `${startDateStr} – ${endDateStr}`);

    const liveCount = Object.values(analyticsSources).filter((s) => s.source === "live").length;
    const pill = $("analyticsSourceStatus");
    if (pill) {
      pill.hidden = false;
      const cachedCount = Object.values(analyticsSources).filter((s) => s.source === "cache").length;
      pill.textContent = liveCount > 0 ? `${liveCount} live · ${cachedCount} cached modules` : cachedCount ? `${cachedCount} cached modules` : "Data unavailable";
      pill.dataset.state = liveCount === 10 ? "live" : liveCount > 0 ? "partial" : "unavailable";
    }

    setText("analyticsVolume", model.availableCount ? model.total : "—");
    setText("analyticsVolumeChange", !model.availableCount ? "Awaiting module data" : model.previous
      ? `${model.total >= model.previous ? '+' : ''}${((model.total - model.previous) / model.previous * 100).toFixed(1)}% vs preceding period`
      : model.total ? 'New activity vs preceding period' : 'No dated activity in this period');
    setText("analyticsCompletion", model.completion !== null ? `${model.completion.toFixed(1)}%` : "—");
    setText("analyticsCompletionDetail", model.serviceAvailable ? `${model.serviceStatuses.completed} of ${model.serviceTotal} completed` : "Awaiting service data");
    setText("analyticsBacklog", model.serviceAvailable ? model.openRequests : "—");
    setText("analyticsBacklogDetail", model.serviceAvailable ? `${model.agedRequests} open 7+ days` : "Awaiting service data");
    setText("analyticsStockAlerts", model.stockAvailable ? model.stock.out + model.stock.low : "—");
    setText("analyticsStockDetail", model.stockAvailable ? `${model.stock.out} out of stock · ${model.stock.low} low stock` : "Awaiting inventory");

    updateDashboardCharts(model);

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
    if ($("analyticsDataNote")) $("analyticsDataNote").textContent = `${model.missingDates} records without explicit timestamps were omitted from historical date aggregation.`;
    if ($("exportAnalyticsBtn")) $("exportAnalyticsBtn").disabled = !model.availableCount;
  }

  // Native, dependency-free charts keep cached dashboards usable if the CDN fails.
  function nativeChart(canvasId, entries, trend = false) {
    const canvas = $(canvasId);
    if (!canvas) return;
    let container = canvas.parentElement.querySelector(".native-chart");
    if (chartInstances.has(canvasId)) {
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
      const colors = ["#278560", "#8b7ac7", "#c79b46", "#ce7d78"];
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
    container.innerHTML = entries.map((entry) => `<div class="native-chart-row"><div><span>${escapeHTML(entry.label)}</span><strong>${entry.value.toLocaleString()}</strong></div><div class="native-chart-track"><div class="native-chart-fill" style="width:${entry.value / maximum * 100}%;background:${entry.color || "#278560"}"></div></div></div>`).join("");
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
    nativeChart("commChart", ["incoming", "outgoing", "internal", "unclassified"].map((key, i) => ({ label: key[0].toUpperCase() + key.slice(1), value: model.commBreakdown[key], color: ["#4b9da7", "#278560", "#6366f1", "#f59e0b"][i] })));
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
      ...m.breakdown.map((mod) => [mod.label, mod.available ? mod.current : "Unavailable", mod.available ? mod.previous : "Unavailable", m.total ? ((mod.current / m.total) * 100).toFixed(1) : 0]),
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
          const rows = Array.isArray(parsed) ? parsed : parsed?.rows || parsed?.data || parsed?.records || parsed?.items;
          if (Array.isArray(rows)) {
            captureRows(modKey, rows, "cache");
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
      { name: "Security Audit Trail", href: "audittrail-admin.html", icon: "shield-alert" },
      { name: "System Backup & Recovery", href: "backup-admin.html", icon: "database-backup" },
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

  function showToast(message, type = "success") { window.PGENRO_Module.toast(message,type); }

  /* --------------------------------------------------------------------------
     10. INITIALIZATION & DOM EVENT BINDINGS
     -------------------------------------------------------------------------- */
  function initializeDashboard() {
    // Existing module menus and bookmarks can still point at the old dashboard audit anchor.
    const routeAuditAnchor = () => {
      const destination = {'#audit':'audittrail-admin.html','#backup':'backup-admin.html'}[location.hash];
      if (!destination) return false;
      location.replace(destination); return true;
    };
    if (routeAuditAnchor()) return;
    window.addEventListener('hashchange', routeAuditAnchor);
    // 1. Initialize Profile & Cache
    const localUser = safeJson(localStore.getItem("pgenro_current_user"), null);
    if (localUser) updateProfileUI(localUser);

    applyPreferences();
    loadLocalModuleCaches();

    // 2. Initialize Charts & Database
    updateChartsAndAnalytics();
    initDatabaseSync();
    logAudit("PAGE_VISIT", "Opened the administrator dashboard.", { module: "Admin Dashboard" });
    window.addEventListener("storage", () => {
      applyPreferences(); loadLocalModuleCaches();
    });
    window.addEventListener("offline", () => {
      Object.values(analyticsSources).forEach((source) => { if (source.source === "live") source.source = "stale"; });
      updateConnectionStatus(); scheduleAnalytics();
    });
    window.addEventListener("online", updateConnectionStatus);

    $('refreshAnalyticsBtn')?.addEventListener('click', () => {
      $('refreshAnalyticsBtn').disabled = true;
      subscriptions.forEach(ref => ref.off()); subscriptions.length = 0;
      loadLocalModuleCaches(); initDatabaseSync(); scheduleAnalytics();
      setTimeout(() => { if ($('refreshAnalyticsBtn')) $('refreshAnalyticsBtn').disabled = false; }, 900);
    });
    // 3. Command Palette
    setupCommandPalette();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        $("searchPaletteDropdown")?.classList.remove("open");
        $("globalSearchInput")?.setAttribute("aria-expanded", "false");
      }
    });

    // 8. Analytics Period & Export
    $("analyticsPeriod")?.addEventListener("change", (e) => {
      analyticsRange = e.target.value;
      updateChartsAndAnalytics();
    });
    $("exportAnalyticsBtn")?.addEventListener("click", exportAnalyticsToCSV);

    // 10. Workspace Preferences
    $("compactModeToggle")?.addEventListener("change", savePreferences);
    $("showDbStatusToggle")?.addEventListener("change", savePreferences);
    $("resetAdminPrefsBtn")?.addEventListener("click", () => {
      localStore.removeItem(preferenceKey);
      applyPreferences();
      showToast("Workspace preferences reset to default.");
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


/* Appearance and navigation belong to this page; no extra shared UI script. */
(() => {
  'use strict';
  function init() {
    const M = window.PGENRO_Module;
    const $ = id => document.getElementById(id);
    const setTheme = (value, remember = false) => {
      const theme = value === 'dark' ? 'dark' : 'light';
      document.documentElement.dataset.theme = theme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d2119' : '#f4f7f5');
      if (remember) { try { localStorage.setItem('pgenro_admin_theme', theme); } catch {} }
      const button = $('appearanceThemeBtn');
      if (button) {
        button.setAttribute('aria-pressed', String(theme === 'dark'));
        button.setAttribute('aria-label', theme === 'dark' ? 'Switch to light appearance' : 'Switch to dark appearance');
        button.title = button.getAttribute('aria-label');
        const icon = document.createElement('i'); icon.dataset.lucide = theme === 'dark' ? 'sun' : 'moon'; button.replaceChildren(icon);
      }
      if ($('appearanceThemeSelect')) $('appearanceThemeSelect').value = theme;
      M.renderIcons();
    };
    setTheme(document.documentElement.dataset.theme);
    $('appearanceThemeBtn')?.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true));
    $('appearanceThemeSelect')?.addEventListener('change', event => setTheme(event.target.value, true));
    window.addEventListener('storage', event => {
      if (event.key === 'pgenro_admin_theme') setTheme(event.newValue);
      if (event.key === 'pgenro_admin_preferences') document.body.classList.toggle('compact-mode', Boolean(M.storage.get(event.key, {}).compact));
    });
    const syncProfile = () => {
      const name = $('dropdownUserName')?.textContent?.trim() || 'PGENRO Admin';
      document.querySelectorAll('.profile-button-name').forEach(el => { el.textContent = name; });
      const role = $('dropdownUserRole')?.textContent?.trim() || 'Administrator';
      document.querySelectorAll('.profile-button-role').forEach(el => { el.textContent = role; });
    };
    const observer = new MutationObserver(syncProfile);
    if ($('profileDropdown')) observer.observe($('profileDropdown'), { childList: true, subtree: true, characterData: true });
    syncProfile();
    window.addEventListener('pagehide', event => { if (!event.persisted) observer.disconnect(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
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

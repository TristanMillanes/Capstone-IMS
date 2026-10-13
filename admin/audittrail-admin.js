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
      if(offset===0 && typeof response.count==='number')total=response.count;
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
    mobile?.addEventListener('click',() => { const open = !sidebar.classList.contains('mobile-open'); if (!open) return closeMobile(); sidebar.inert = false; sidebar.classList.add('mobile-open'); backdrop?.classList.add('active'); backdrop?.setAttribute('aria-hidden','false'); document.body.classList.add('mobile-nav-open'); mobile.setAttribute('aria-expanded','true'); sidebar.querySelector('.admin-sidebar-close, a')?.focus({preventScroll:true}); });
    backdrop?.addEventListener('click',() => {closeMobile();mobile?.focus();});
    sidebar?.querySelectorAll('a').forEach(a => { a.title = a.textContent.trim(); a.addEventListener('click',closeMobile); });
    const navigationMedia=matchMedia('(max-width:900px)');navigationMedia.addEventListener('change',sync); window.addEventListener('storage',event => {if(event.key === 'pgenro_admin_sidebar') sync();}); sync();
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
  const icons = {"activity":[["path",{"d":"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"}]],"arrow-left-right":[["path",{"d":"M8 3 4 7l4 4"}],["path",{"d":"M4 7h16"}],["path",{"d":"m16 21 4-4-4-4"}],["path",{"d":"M20 17H4"}]],"arrow-up-right":[["path",{"d":"M7 7h10v10"}],["path",{"d":"M7 17 17 7"}]],"boxes":[["path",{"d":"M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"}],["path",{"d":"m7 16.5-4.74-2.85"}],["path",{"d":"m7 16.5 5-3"}],["path",{"d":"M7 16.5v5.17"}],["path",{"d":"M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"}],["path",{"d":"m17 16.5-5-3"}],["path",{"d":"m17 16.5 4.74-2.85"}],["path",{"d":"M17 16.5v5.17"}],["path",{"d":"M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"}],["path",{"d":"M12 8 7.26 5.15"}],["path",{"d":"m12 8 4.74-2.85"}],["path",{"d":"M12 13.5V8"}]],"briefcase":[["path",{"d":"M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"}],["rect",{"width":"20","height":"14","x":"2","y":"6","rx":"2"}]],"calendar":[["path",{"d":"M8 2v4"}],["path",{"d":"M16 2v4"}],["rect",{"width":"18","height":"18","x":"3","y":"4","rx":"2"}],["path",{"d":"M3 10h18"}]],"clipboard-check":[["rect",{"width":"8","height":"4","x":"8","y":"2","rx":"1","ry":"1"}],["path",{"d":"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"}],["path",{"d":"m9 14 2 2 4-4"}]],"clock":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 6v6l4 2"}]],"clock-3":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 6v6h4"}]],"database":[["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3"}],["path",{"d":"M3 5V19A9 3 0 0 0 21 19V5"}],["path",{"d":"M3 12A9 3 0 0 0 21 12"}]],"database-backup":[["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3"}],["path",{"d":"M3 12a9 3 0 0 0 5 2.69"}],["path",{"d":"M21 9.3V5"}],["path",{"d":"M3 5v14a9 3 0 0 0 6.47 2.88"}],["path",{"d":"M12 12v4h4"}],["path",{"d":"M13 20a5 5 0 0 0 9-3 4.5 4.5 0 0 0-4.5-4.5c-1.33 0-2.54.54-3.41 1.41L12 16"}]],"download":[["path",{"d":"M12 15V3"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["path",{"d":"m7 10 5 5 5-5"}]],"file-check-2":[["path",{"d":"M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v6"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"m14 20 2 2 4-4"}]],"file-text":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M10 9H8"}],["path",{"d":"M16 13H8"}],["path",{"d":"M16 17H8"}]],"layout-dashboard":[["rect",{"width":"7","height":"9","x":"3","y":"3","rx":"1"}],["rect",{"width":"7","height":"5","x":"14","y":"3","rx":"1"}],["rect",{"width":"7","height":"9","x":"14","y":"12","rx":"1"}],["rect",{"width":"7","height":"5","x":"3","y":"16","rx":"1"}]],"menu":[["path",{"d":"M4 5h16"}],["path",{"d":"M4 12h16"}],["path",{"d":"M4 19h16"}]],"refresh-cw":[["path",{"d":"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{"d":"M21 3v5h-5"}],["path",{"d":"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{"d":"M8 16H3v5"}]],"rotate-ccw":[["path",{"d":"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}],["path",{"d":"M3 3v5h5"}]],"search":[["path",{"d":"m21 21-4.34-4.34"}],["circle",{"cx":"11","cy":"11","r":"8"}]],"settings":[["path",{"d":"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"shield-alert":[["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{"d":"M12 8v4"}],["path",{"d":"M12 16h.01"}]],"table":[["path",{"d":"M12 3v18"}],["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M3 9h18"}],["path",{"d":"M3 15h18"}]],"user":[["path",{"d":"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"}],["circle",{"cx":"12","cy":"7","r":"4"}]],"user-cog":[["path",{"d":"M10 15H6a4 4 0 0 0-4 4v2"}],["path",{"d":"m14.305 16.53.923-.382"}],["path",{"d":"m15.228 13.852-.923-.383"}],["path",{"d":"m16.852 12.228-.383-.923"}],["path",{"d":"m16.852 17.772-.383.924"}],["path",{"d":"m19.148 12.228.383-.923"}],["path",{"d":"m19.53 18.696-.382-.924"}],["path",{"d":"m20.772 13.852.924-.383"}],["path",{"d":"m20.772 16.148.924.383"}],["circle",{"cx":"18","cy":"15","r":"3"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"user-plus":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}],["line",{"x1":"19","x2":"19","y1":"8","y2":"14"}],["line",{"x1":"22","x2":"16","y1":"11","y2":"11"}]],"users":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["path",{"d":"M16 3.128a4 4 0 0 1 0 7.744"}],["path",{"d":"M22 21v-2a4 4 0 0 0-3-3.87"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"users-round":[["path",{"d":"M18 21a8 8 0 0 0-16 0"}],["circle",{"cx":"10","cy":"8","r":"5"}],["path",{"d":"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"}]],"wrench":[["path",{"d":"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"}]],"x":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],"sun":[["circle",{"cx":"12","cy":"12","r":"4"}],["path",{"d":"M12 2v2"}],["path",{"d":"M12 20v2"}],["path",{"d":"m4.93 4.93 1.41 1.41"}],["path",{"d":"m17.66 17.66 1.41 1.41"}],["path",{"d":"M2 12h2"}],["path",{"d":"M20 12h2"}],["path",{"d":"m6.34 17.66-1.41 1.41"}],["path",{"d":"m19.07 4.93-1.41 1.41"}]],"moon":[["path",{"d":"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"}]]};
  const aliases = {'eye':'search','pencil':'file-text','save':'file-check-2','cloud-upload':'file-up','plus-circle':'user-plus','database':'database-backup','hash':'file-text','files':'file-text','folder-open':'briefcase','file-search':'search','scan-text':'file-text','paperclip':'file-text','trash':'trash-2','shield-check':'shield-alert','calendar-days':'calendar','clock-3':'clock','contact':'user-round','building-2':'briefcase','printer':'file-text','file-spreadsheet':'file-text'};
  function renderIcons(root = document) {
    root.querySelectorAll('i[data-lucide]').forEach(el => {
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

/* PGENRO Audit Trail — querying, filters, pagination and inspection live in this module. */
(() => {
  'use strict';
  if (window.PGENRO_AUDIT_PAGE_INITIALIZED) return;
  window.PGENRO_AUDIT_PAGE_INITIALIZED = true;
  const M = window.PGENRO_Module, $ = id => document.getElementById(id);
  const escapeHTML = M.escape, renderIcons = M.renderIcons;
  const localKey = 'pgenro_audit_log_fallback';
  const text = value => value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  let remoteRows = [], allRows = [], filteredRows = [], selected = new Set(), rowsById = new Map();
  const mobileAudit = matchMedia('(max-width:700px)');
  let page = 1, pageSize = mobileAudit.matches ? 10 : 25, printing = false, reading = false, queued = false, disposed = false;
  let remoteLoaded = false, feedStatus = 'loading', readError = '', updatedAt = null, channel = null;
  let refreshTimer = 0, searchTimer = 0;
  const timestamp = raw => {
    if (raw == null || raw === '') return null;
    const date = typeof raw === 'number' ? new Date(raw > 1e11 ? raw : raw * 1000) : new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const calendarFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' });
  const eventFormat = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const dayKey = date => {
    if(!date)return '';const parts=calendarFormat.formatToParts(date);
    const value=type=>parts.find(part=>part.type===type)?.value||'';
    return `${value('year')}-${value('month')}-${value('day')}`;
  };
  const formatTime = date => date ? eventFormat.format(date) : 'Not recorded';
  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const data = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : {};
    const metadata = raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? raw.metadata : {};
    const row = { ...metadata, ...raw, ...data };
    const date = [row.timestamp, row.createdAt, row.created_at, row.date].map(timestamp).find(Boolean) || null;
    const action = text(row.activity || row.action || row.event || row.event_type || 'SYSTEM_ACTIVITY');
    const actionType = text(row.actionType || row.action_type).toLowerCase();
    const type = ['login', 'logout', 'activity'].includes(actionType) ? actionType
      : /(^|[\s_])(login|sign[\s_]?in|signed[\s_]?in|signin)($|[\s_])/i.test(action) ? 'login'
      : /(^|[\s_])(logout|sign[\s_]?out|signed[\s_]?out|signout)($|[\s_])/i.test(action) ? 'logout' : 'activity';
    const status = text(row.sessionStatus || row.session_status || row.status || row.result || 'Recorded');
    const flagged = /fail|error|denied|blocked|reject|unauthori[sz]ed/i.test(status);
    const success = !flagged && /^(success|successful|ok|completed|allowed)$/i.test(status.trim());
    const email = text(row.userEmail || row.user_email || row.actor_email || row.email || row.user?.email || '');
    const name = text(row.userName || row.user_name || row.actor_name || row.fullName || row.full_name || row.user?.name || email || 'System operator');
    const details = text(row.details || row.description || row.message || 'No additional details recorded.');
    const key = text(row.eventId || row.event_id || raw.id || row.id || `${date?.getTime() || ''}|${email}|${action}|${details}`);
    const normalized = { key, date, action, type, status, flagged, success, email, name, details,
      module: text(row.module || row.module_name || row.origin || 'System'),
      role: text(row.role || row.user_role || row.division || 'Not recorded'),
      ip: text(row.ipAddress || row.ip_address || row.ip || 'Not captured'),
      userId: text(row.userId || row.user_id || row.actor_id || '') };
    normalized.day = dayKey(date); normalized.displayTime = formatTime(date);
    normalized.searchText = [normalized.displayTime, name, email, action, details, normalized.module, normalized.role, normalized.ip, status, normalized.userId].join(' ').toLowerCase();
    return normalized;
  }

  function mergeRows() {
    const local = M.storage.get(localKey, []);
    const unique = new Map();
    // Prefer the server event when the same ID is retained in the local fallback.
    for (const raw of [...remoteRows, ...(Array.isArray(local) ? local : [])]) {
      const row = normalize(raw); if (row && !unique.has(row.key)) unique.set(row.key, row);
    }
    allRows = [...unique.values()].sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0) || a.key.localeCompare(b.key));
    rowsById = new Map(allRows.map(row => [row.key,row]));
    const select = $('auditModuleFilter'), prior = select.value;
    select.innerHTML = '<option value="all">All modules</option>' + [...new Set(allRows.map(row => row.module))].sort().map(module => `<option value="${escapeHTML(module)}">${escapeHTML(module)}</option>`).join('');
    select.value = [...select.options].some(option => option.value === prior) ? prior : 'all';
    applyFilters(); updateFeedStatus();
  }
  function updateFeedStatus() {
    const local = M.storage.get(localKey, []);
    const status = $('auditSourceStatus');
    status.dataset.state = feedStatus === 'live' ? 'live' : remoteLoaded ? 'partial' : 'unavailable';
    status.textContent = feedStatus === 'loading' ? 'Loading activity…' : feedStatus === 'live' ? 'Supabase activity loaded'
      : remoteLoaded ? 'Last loaded activity · sync unavailable' : !M.client() ? 'Browser activity only' : 'Supabase activity unavailable';
    $('auditDataNote').textContent = remoteLoaded
      ? `${remoteRows.length.toLocaleString()} accessible Supabase events · ${Array.isArray(local) ? local.length : 0} events retained in this browser. Matching IDs are shown once. ${feedStatus === 'live' ? '' : 'The last loaded server records are retained until refresh succeeds.'}`
      : `Showing activity retained in this browser. ${readError || 'Connect to the existing Supabase project to load server audit records.'}`;
    $('auditUpdatedAt').textContent = updatedAt ? `Last loaded ${formatTime(updatedAt)} PHT` : 'Server records have not been loaded';
    if ($('dbStatusText')) $('dbStatusText').textContent = remoteLoaded ? 'Audit records loaded' : 'Awaiting audit data';
  }
  function applyFilters() {
    const query = $('tableSearchInput').value.trim().toLowerCase();
    const type = $('auditTypeFilter').value, module = $('auditModuleFilter').value, status = $('auditStatusFilter').value;
    const from = $('auditDateFrom').value, to = $('auditDateTo').value;
    const invalid = Boolean(from && to && from > to);
    $('auditFilterError').hidden = !invalid;
    $('auditFilterError').textContent = invalid ? 'The end date must be on or after the start date.' : '';
    filteredRows = invalid ? [] : allRows.filter(row => {
      if (type !== 'all' && type !== row.type) return false;
      if (module !== 'all' && module !== row.module) return false;
      if (status === 'flagged' && !row.flagged || status === 'success' && !row.success || status === 'other' && (row.flagged || row.success)) return false;
      const day = row.day;
      if (from && (!day || day < from) || to && (!day || day > to)) return false;
      return !query || row.searchText.includes(query);
    });
    const ids = new Set(filteredRows.map(row => row.key));
    selected = new Set([...selected].filter(id => ids.has(id)));
    const today = dayKey(new Date());
    $('auditTotal').textContent = filteredRows.length.toLocaleString('en-PH');
    $('auditToday').textContent = filteredRows.filter(row => row.day === today).length.toLocaleString('en-PH');
    $('auditUsers').textContent = new Set(filteredRows.map(row => row.userId || row.email || (row.name !== 'System operator' ? row.name : '')).filter(Boolean)).size.toLocaleString('en-PH');
    $('auditFlagged').textContent = filteredRows.filter(row => row.flagged).length.toLocaleString('en-PH');
    $('auditTotalDetail').textContent = filteredRows.length === allRows.length ? 'Across loaded activity' : `of ${allRows.length.toLocaleString()} loaded events`;
    renderRows();
  }
  function renderRows() {
    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    page = Math.max(1, Math.min(page, totalPages));
    const start = (page - 1) * pageSize, rows = filteredRows.slice(start, start + pageSize);
    const useList = mobileAudit.matches && !printing;
    const target = useList ? $('auditMobileList') : $('auditTableBody');
    const inactive = useList ? $('auditTableBody') : $('auditMobileList');
    inactive.replaceChildren();
    const tableMarkup = row => {
      const initials = row.name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
      return `<tr data-audit-id="${escapeHTML(row.key)}" class="${selected.has(row.key) ? 'is-selected' : ''}">
        <td class="audit-select-cell"><input type="checkbox" class="row-checkbox" data-id="${escapeHTML(row.key)}" ${selected.has(row.key) ? 'checked' : ''} aria-label="Select ${escapeHTML(row.action.replaceAll('_', ' '))} event"/></td>
        <td class="audit-time">${escapeHTML(row.displayTime)}</td>
        <td><div class="user-cell"><span class="avatar-sm" aria-hidden="true">${escapeHTML(initials)}</span><span><strong>${escapeHTML(row.name)}</strong><small>${escapeHTML(row.email || 'Email not recorded')}</small></span></div></td>
        <td><span class="audit-event-tag ${row.type}">${escapeHTML(row.action.replaceAll('_', ' '))}</span></td>
        <td class="audit-action-detail"><span>${escapeHTML(row.details)}</span><small class="audit-source">${escapeHTML(row.module)}</small></td>
        <td><span class="table-tag">${escapeHTML(row.role)}</span></td><td class="font-mono">${escapeHTML(row.ip)}</td>
        <td><span class="badge-status ${row.flagged ? 'urgent' : row.success ? 'success' : 'neutral'}"><span class="dot"></span>${escapeHTML(row.status)}</span></td>
        <td><button class="icon-btn-sm audit-inspect-btn" type="button" data-inspect="${escapeHTML(row.key)}" aria-label="Inspect ${escapeHTML(row.action.replaceAll('_', ' '))} event"><i data-lucide="arrow-up-right"></i></button></td>
      </tr>`;
    };
    const mobileMarkup = row => `<article role="listitem" class="audit-event-card ${selected.has(row.key)?'is-selected':''}" data-audit-id="${escapeHTML(row.key)}">
      <div class="audit-event-card-top"><label class="audit-event-check"><input type="checkbox" class="row-checkbox" data-id="${escapeHTML(row.key)}" ${selected.has(row.key)?'checked':''}/><span class="sr-only">Select ${escapeHTML(row.name)} ${escapeHTML(row.action.replaceAll('_',' '))} event</span></label><span class="audit-event-tag ${row.type}">${escapeHTML(row.action.replaceAll('_',' '))}</span><span class="badge-status ${row.flagged?'urgent':row.success?'success':'neutral'}"><span class="dot"></span>${escapeHTML(row.status)}</span></div>
      <time class="audit-card-time" ${row.date?`datetime="${row.date.toISOString()}"`:''}>${escapeHTML(row.displayTime)}${row.date?' PHT':''}</time>
      <strong class="audit-card-name">${escapeHTML(row.name)}</strong><span class="audit-card-email">${escapeHTML(row.email||'Email not recorded')}</span>
      <p class="audit-card-detail">${escapeHTML(row.details)}</p>
      <div class="audit-card-footer"><span>${escapeHTML(row.module)}</span><button class="btn btn-ghost btn-sm audit-inspect-btn" type="button" data-inspect="${escapeHTML(row.key)}" aria-label="Inspect ${escapeHTML(row.action.replaceAll('_',' '))} event">View details<i data-lucide="arrow-up-right"></i></button></div>
    </article>`;
    const title = feedStatus==='loading'&&!allRows.length?'Loading recorded activity…':allRows.length?'No matching activity':'No audit activity available';
    const help = allRows.length?'Try another search or reset the filters.':'Recorded events will appear here when they are available.';
    target.innerHTML = rows.length ? rows.map(useList?mobileMarkup:tableMarkup).join('')
      : useList ? `<div class="audit-mobile-empty"><strong>${title}</strong><p>${help}</p></div>` : `<tr><td colspan="9" class="empty-table-cell"><strong>${title}</strong><span>${help}</span></td></tr>`;
    renderIcons(target);
    $('tablePaginationInfo').textContent = rows.length ? `Showing ${start + 1}–${start + rows.length} of ${filteredRows.length.toLocaleString()} events` : 'Showing 0 events';
    const pages = [...new Set([1,page-1,page,page+1,totalPages].filter(n=>n>=1&&n<=totalPages))].sort((a,b)=>a-b);
    let previous = 0;
    const middle = pages.map(n => { const gap = previous && n - previous > 1 ? '<span class="audit-page-gap" aria-hidden="true">…</span>' : ''; previous = n; return `${gap}<button class="audit-page-btn ${n === page ? 'active' : ''}" type="button" data-page="${n}" ${n === page ? 'aria-current="page"' : ''}>${n}</button>`; }).join('');
    $('auditPaginationControls').innerHTML = `<button type="button" class="audit-page-btn" data-step="-1" ${page === 1 ? 'disabled' : ''} aria-label="Previous audit page">‹</button>${middle}<button type="button" class="audit-page-btn" data-step="1" ${page === totalPages ? 'disabled' : ''} aria-label="Next audit page">›</button>`;
    syncSelection();
  }
  function syncSelection() {
    const boxes = [...document.querySelectorAll('.row-checkbox')];
    boxes.forEach(box=>{box.checked=selected.has(box.dataset.id);box.closest('[data-audit-id]')?.classList.toggle('is-selected',box.checked);});
    const checked = boxes.filter(box=>box.checked).length, allChecked=boxes.length>0&&checked===boxes.length;
    $('selectAllRows').checked = allChecked;
    $('selectAllRows').indeterminate = checked>0&&checked<boxes.length;
    $('selectAllRows').disabled = !boxes.length;
    $('selectAuditPageBtn').disabled = !boxes.length;
    $('selectAuditPageBtn').textContent = allChecked ? 'Clear page' : 'Select page';
    $('selectAuditPageBtn').setAttribute('aria-pressed',String(allChecked));
    $('auditSelectionBar').hidden = !selected.size;
    $('auditSelectionCount').textContent = `${selected.size} selected`;
    $('exportCsvBtn').disabled = !filteredRows.length;
    const exportText = selected.size?`Export ${selected.size} selected`:'Export CSV';
    if($('exportCsvBtn').dataset.label!==exportText){
      $('exportCsvBtn').dataset.label=exportText;
      $('exportCsvBtn').innerHTML = `<i data-lucide="download"></i>${exportText}`;
      renderIcons($('exportCsvBtn'));
    }
  }
  function inspect(row) {
    const fields = { modalEventTitle: row.action.replaceAll('_', ' '), modalEventTime: `${formatTime(row.date)}${row.date ? ' PHT' : ''}`, modalEventStatus: row.status,
      modalEventUser: `${row.name}${row.email ? ` (${row.email})` : ''}`, modalEventRole: row.role, modalEventIp: row.ip, modalEventModule: row.module, modalEventAction: row.action, modalEventDetails: row.details };
    Object.entries(fields).forEach(([id, value]) => { $(id).textContent = value; });
    M.openModal('auditDetailModal');
  }
  async function readRemote() {
    const db = M.client(); if (!db) throw new Error('Supabase client is unavailable.');
    const rows = []; let offset = 0, ordered = true, total = null;
    while (!disposed) {
      let query = offset === 0 ? db.from('audit_logs').select('*', { count: 'exact' }) : db.from('audit_logs').select('*');
      if (ordered) query = query.order('id', { ascending: true });
      const response = await query.range(offset, offset + 499);
      if (response.error) {
        if (ordered && (response.error.code === '42703' || /column.*id.*does not exist/i.test(response.error.message || ''))) { ordered = false; continue; }
        throw response.error;
      }
      if(offset===0 && typeof response.count==='number')total=response.count;
      const batch = response.data || []; rows.push(...batch); offset += batch.length;
      if (!batch.length || total!==null && offset>=total || total===null && batch.length<500) break;
    }
    return rows;
  }
  async function refresh() {
    if (disposed) return;
    if (reading) { queued = true; return; }
    reading = true; $('refreshAuditBtn').disabled = true; $('auditTable').setAttribute('aria-busy', 'true');
    try {
      if (!navigator.onLine) throw new Error('You are offline; server activity cannot be refreshed.');
      const rows = await readRemote();
      if (disposed) return;
      remoteRows = rows; remoteLoaded = true; feedStatus = 'live'; readError = ''; updatedAt = new Date();
    } catch (error) {
      if (disposed) return;
      feedStatus = remoteLoaded ? 'stale' : 'unavailable';
      readError = /permission|row.level|denied/i.test(error.message || '') ? 'This session cannot read the audit table. Check the existing admin audit permissions.'
        : /does not exist|schema cache/i.test(error.message || '') ? 'The audit table is unavailable in the connected project.' : error.message || 'The audit feed could not be loaded.';
    } finally {
      reading = false;
      if (!disposed) { $('refreshAuditBtn').disabled = false; $('auditTable').setAttribute('aria-busy', 'false'); mergeRows(); }
      if (queued && !disposed) { queued = false; scheduleRefresh(); }
    }
  }
  function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 300); }
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
      { name: "Workspace Preferences", href: "admin.html#settings", icon: "settings" }
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


  function init() {
    document.body.classList.toggle('compact-mode', Boolean(M.storage.get('pgenro_admin_preferences', {}).compact));
    const user = M.storage.get('pgenro_current_user', {});
    if ($('dropdownUserRole')) $('dropdownUserRole').textContent = user.role || 'Administrator';
    $('auditPageSize').value=String(pageSize);
    setupCommandPalette(); mergeRows(); refresh();
    $('auditFilterForm').addEventListener('submit', event => event.preventDefault());
    $('tableSearchInput').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page = 1; applyFilters(); }, 140); });
    for (const id of ['auditTypeFilter', 'auditModuleFilter', 'auditStatusFilter', 'auditDateFrom', 'auditDateTo']) $(id).addEventListener('change', () => { clearTimeout(searchTimer); page = 1; applyFilters(); });
    $('resetAuditFiltersBtn').addEventListener('click', () => { clearTimeout(searchTimer); $('auditFilterForm').reset(); page = 1; applyFilters(); });
    $('auditPageSize').addEventListener('change', event => { pageSize = Number(event.target.value); page = 1; renderRows(); });
    $('refreshAuditBtn').addEventListener('click', refresh);
    $('auditPaginationControls').addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button || button.disabled) return;
      page = button.dataset.page ? Number(button.dataset.page) : page + Number(button.dataset.step); renderRows(); $('auditScrollBox').scrollTop = 0;
      const focus = button.dataset.step ? $('auditPaginationControls').querySelector(`[data-step="${button.dataset.step}"]`) : $('auditPaginationControls').querySelector(`[data-page="${page}"]`);
      (focus?.disabled ? $('auditPaginationControls').querySelector('[aria-current="page"]') : focus)?.focus({ preventScroll: true });
    });
    for(const id of ['auditTableBody','auditMobileList']) $(id).addEventListener('click', event => {
      if (event.target.closest('input,label')) return;
      const id = event.target.closest('[data-audit-id]')?.dataset.auditId;
      const row = rowsById.get(id); if (row) inspect(row);
    });
    for(const id of ['auditTableBody','auditMobileList']) $(id).addEventListener('change', event => {
      const box = event.target.closest('.row-checkbox'); if (!box) return;
      if (box.checked) selected.add(box.dataset.id); else selected.delete(box.dataset.id);
      syncSelection();
    });
    function selectPage(checked) {
      document.querySelectorAll('.row-checkbox').forEach(box=>{if(checked)selected.add(box.dataset.id);else selected.delete(box.dataset.id);});
      syncSelection();
    }
    $('selectAllRows').addEventListener('change',event=>selectPage(event.target.checked));
    $('selectAuditPageBtn').addEventListener('click',()=>{
      const boxes=[...document.querySelectorAll('.row-checkbox')];selectPage(!boxes.length||!boxes.every(box=>box.checked));
    });
    mobileAudit.addEventListener('change',renderRows);
    window.addEventListener('beforeprint',()=>{printing=true;renderRows();});
    window.addEventListener('afterprint',()=>{printing=false;renderRows();});
    $('clearAuditSelectionBtn').addEventListener('click', () => { selected.clear(); renderRows(); });
    $('exportCsvBtn').addEventListener('click', () => {
      clearTimeout(searchTimer); applyFilters();
      const rows = selected.size ? filteredRows.filter(row => selected.has(row.key)) : [...filteredRows];
      if (!rows.length) return M.toast('No matching events to export.', 'warning');
      M.csv([['Timestamp (ISO)', 'Operator', 'Email', 'Action', 'Details', 'Module', 'Role / Division', 'IP Address', 'Status'], ...rows.map(row => [row.date?.toISOString() || '', row.name, row.email, row.action, row.details, row.module, row.role, row.ip, row.status])], `PGENRO_Audit_Trail_${dayKey(new Date())}.csv`);
      M.audit('EXPORT_AUDIT_CSV', `Exported ${rows.length} matching audit events.`, { module: 'Audit Trail' });
      M.toast(`Exported ${rows.length} audit events.`);
    });
    for (const id of ['closeAuditModalBtn', 'closeAuditModalBtn2']) $(id).addEventListener('click', () => M.closeModal('auditDetailModal'));
    window.addEventListener('storage', event => { if (event.key === localKey) mergeRows(); });
    window.addEventListener('pgenro:audit-recorded', mergeRows);
    window.addEventListener('offline', () => { feedStatus = remoteLoaded ? 'stale' : 'unavailable'; readError = 'You are offline.'; updateFeedStatus(); });
    window.addEventListener('online', scheduleRefresh);
    window.addEventListener('pageshow', event => { if (event.persisted) { mergeRows(); scheduleRefresh(); } });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRefresh(); });
    const db = M.client();
    if (db?.channel) {
      channel = db.channel(`admin-audit-${M.uuid()}`).on('postgres_changes', { event: '*', schema: 'public', table: 'audit_logs' }, scheduleRefresh).subscribe(status => {
        if (status === 'SUBSCRIBED') scheduleRefresh();
        else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status) && !disposed) { feedStatus = remoteLoaded ? 'stale' : 'unavailable'; updateFeedStatus(); }
      });
    }
    M.audit('PAGE_VISIT', 'Opened the Audit Trail module.', { module: 'Audit Trail' });
    renderIcons();
  }
  window.PGENRO_AUDIT = { log: M.audit, refresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    disposed = true; clearTimeout(refreshTimer); clearTimeout(searchTimer);mobileAudit.removeEventListener('change',renderRows);
    if (channel) M.client()?.removeChannel(channel);
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
    document.querySelectorAll('.table-responsive,.analytics-table-scroll,.table-scroll,.audit-scroll-box').forEach((region,index) => {
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
    const viewport=window.visualViewport, left=viewport?.offsetLeft||0, top=viewport?.offsetTop||0;
    const vw=viewport?.width||innerWidth, vh=viewport?.height||innerHeight;
    const rect=button.getBoundingClientRect(), width=Math.max(0,Math.min(390,vw-24));
    const x=Math.max(left+12,Math.min(rect.right-width,left+vw-width-12));
    const y=Math.max(top+12,Math.min(rect.bottom+10,top+vh-120));
    panel.style.width=`${width}px`;panel.style.left=`${x}px`;panel.style.right='auto';panel.style.top=`${y}px`;
    panel.style.maxHeight=`${Math.max(72,top+vh-y-12)}px`;
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
    let positionFrame=0;const fitPanel=()=>{if(panel.hidden||positionFrame)return;positionFrame=requestAnimationFrame(()=>{positionFrame=0;position();});};
    window.addEventListener('resize',fitPanel,{passive:true});
    window.visualViewport?.addEventListener('resize',fitPanel,{passive:true});
    window.visualViewport?.addEventListener('scroll',fitPanel,{passive:true});
    window.addEventListener('focus',scheduleRefresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleRefresh();});
    window.addEventListener('pageshow',event=>{if(event.persisted)scheduleRefresh();});
    render();db=window.pgenroSupabase||window.PGENRO_DB?.client;
    if(!db){status='unavailable';render();return;}
    db.auth.getUser().then(result=>attachSession(result.data?.user)).catch(()=>attachSession(null));
    const subscription=db.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>attachSession(session?.user),0);});authSubscription=subscription.data?.subscription;
    timer=setInterval(()=>{if(!document.hidden&&navigator.onLine)refresh();},60000);
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

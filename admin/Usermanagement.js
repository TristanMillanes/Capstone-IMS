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
  const icons = {"panel-left-close":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M9 3v18"}],["path",{"d":"m16 15-3-3 3-3"}]],"layout-dashboard":[["rect",{"width":"7","height":"9","x":"3","y":"3","rx":"1"}],["rect",{"width":"7","height":"5","x":"14","y":"3","rx":"1"}],["rect",{"width":"7","height":"9","x":"14","y":"12","rx":"1"}],["rect",{"width":"7","height":"5","x":"3","y":"16","rx":"1"}]],"arrow-left-right":[["path",{"d":"M8 3 4 7l4 4"}],["path",{"d":"M4 7h16"}],["path",{"d":"m16 21 4-4-4-4"}],["path",{"d":"M20 17H4"}]],"briefcase":[["path",{"d":"M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"}],["rect",{"width":"20","height":"14","x":"2","y":"6","rx":"2"}]],"file-text":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M10 9H8"}],["path",{"d":"M16 13H8"}],["path",{"d":"M16 17H8"}]],"users-round":[["path",{"d":"M18 21a8 8 0 0 0-16 0"}],["circle",{"cx":"10","cy":"8","r":"5"}],["path",{"d":"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"}]],"boxes":[["path",{"d":"M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"}],["path",{"d":"m7 16.5-4.74-2.85"}],["path",{"d":"m7 16.5 5-3"}],["path",{"d":"M7 16.5v5.17"}],["path",{"d":"M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"}],["path",{"d":"m17 16.5-5-3"}],["path",{"d":"m17 16.5 4.74-2.85"}],["path",{"d":"M17 16.5v5.17"}],["path",{"d":"M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"}],["path",{"d":"M12 8 7.26 5.15"}],["path",{"d":"m12 8 4.74-2.85"}],["path",{"d":"M12 13.5V8"}]],"clipboard-check":[["rect",{"width":"8","height":"4","x":"8","y":"2","rx":"1","ry":"1"}],["path",{"d":"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"}],["path",{"d":"m9 14 2 2 4-4"}]],"wrench":[["path",{"d":"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"}]],"file-check-2":[["path",{"d":"M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v6"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"m14 20 2 2 4-4"}]],"user-cog":[["path",{"d":"M10 15H6a4 4 0 0 0-4 4v2"}],["path",{"d":"m14.305 16.53.923-.382"}],["path",{"d":"m15.228 13.852-.923-.383"}],["path",{"d":"m16.852 12.228-.383-.923"}],["path",{"d":"m16.852 17.772-.383.924"}],["path",{"d":"m19.148 12.228.383-.923"}],["path",{"d":"m19.53 18.696-.382-.924"}],["path",{"d":"m20.772 13.852.924-.383"}],["path",{"d":"m20.772 16.148.924.383"}],["circle",{"cx":"18","cy":"15","r":"3"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"user-plus":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}],["line",{"x1":"19","x2":"19","y1":"8","y2":"14"}],["line",{"x1":"22","x2":"16","y1":"11","y2":"11"}]],"shield-alert":[["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{"d":"M12 8v4"}],["path",{"d":"M12 16h.01"}]],"database-backup":[["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3"}],["path",{"d":"M3 12a9 3 0 0 0 5 2.69"}],["path",{"d":"M21 9.3V5"}],["path",{"d":"M3 5v14a9 3 0 0 0 6.47 2.88"}],["path",{"d":"M12 12v4h4"}],["path",{"d":"M13 20a5 5 0 0 0 9-3 4.5 4.5 0 0 0-4.5-4.5c-1.33 0-2.54.54-3.41 1.41L12 16"}]],"settings":[["path",{"d":"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"menu":[["path",{"d":"M4 5h16"}],["path",{"d":"M4 12h16"}],["path",{"d":"M4 19h16"}]],"search":[["path",{"d":"m21 21-4.34-4.34"}],["circle",{"cx":"11","cy":"11","r":"8"}]],"bell":[["path",{"d":"M10.268 21a2 2 0 0 0 3.464 0"}],["path",{"d":"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"}]],"user-round":[["circle",{"cx":"12","cy":"8","r":"5"}],["path",{"d":"M20 21a8 8 0 0 0-16 0"}]],"users":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["path",{"d":"M16 3.128a4 4 0 0 1 0 7.744"}],["path",{"d":"M22 21v-2a4 4 0 0 0-3-3.87"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"user-check":[["path",{"d":"m16 11 2 2 4-4"}],["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}]],"log-out":[["path",{"d":"m16 17 5-5-5-5"}],["path",{"d":"M21 12H9"}],["path",{"d":"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"}]],"chevron-right":[["path",{"d":"m9 18 6-6-6-6"}]],"trending-up":[["path",{"d":"M16 7h6v6"}],["path",{"d":"m22 7-8.5 8.5-5-5L2 17"}]],"alert-circle":[["circle",{"cx":"12","cy":"12","r":"10"}],["line",{"x1":"12","x2":"12","y1":"8","y2":"12"}],["line",{"x1":"12","x2":"12.01","y1":"16","y2":"16"}]],"check-circle-2":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m9 12 2 2 4-4"}]],"alert-triangle":[["path",{"d":"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}],["path",{"d":"M12 9v4"}],["path",{"d":"M12 17h.01"}]],"chart-no-axes-combined":[["path",{"d":"M12 16v5"}],["path",{"d":"M16 14v7"}],["path",{"d":"M20 10v11"}],["path",{"d":"m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15"}],["path",{"d":"M4 18v3"}],["path",{"d":"M8 14v7"}]],"download":[["path",{"d":"M12 15V3"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["path",{"d":"m7 10 5 5 5-5"}]],"activity":[["path",{"d":"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"}]],"circle-check":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m9 12 2 2 4-4"}]],"clock-3":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 6v6h4"}]],"package-search":[["path",{"d":"M12 22V12"}],["path",{"d":"M20.27 18.27 22 20"}],["path",{"d":"M21 10.498V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.729l7 4a2 2 0 0 0 2 .001l.98-.559"}],["path",{"d":"M3.29 7 12 12l8.71-5"}],["path",{"d":"m7.5 4.27 8.997 5.148"}],["circle",{"cx":"18.5","cy":"16.5","r":"2.5"}]],"lightbulb":[["path",{"d":"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"}],["path",{"d":"M9 18h6"}],["path",{"d":"M10 22h4"}]],"upload":[["path",{"d":"M12 3v12"}],["path",{"d":"m17 8-5-5-5 5"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}]],"file-up":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M12 12v6"}],["path",{"d":"m15 15-3-3-3 3"}]],"info":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 16v-4"}],["path",{"d":"M12 8h.01"}]],"rotate-ccw":[["path",{"d":"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}],["path",{"d":"M3 3v5h5"}]],"x":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],"external-link":[["path",{"d":"M15 3h6v6"}],["path",{"d":"M10 14 21 3"}],["path",{"d":"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"}]]};
  const aliases = {'eye':'search','pencil':'file-text','save':'file-check-2','cloud-upload':'file-up','plus-circle':'user-plus','database':'database-backup','hash':'file-text','files':'file-text','folder-open':'briefcase','file-search':'search','scan-text':'file-text','paperclip':'file-text','trash':'trash-2','shield-check':'shield-alert','calendar-days':'calendar','clock-3':'clock','contact':'user-round','building-2':'briefcase','printer':'file-text','file-spreadsheet':'file-text'};
  Object.assign(icons,{'trash-2':[['path',{d:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'}]],'calendar':[['rect',{x:3,y:5,width:18,height:16,rx:2}],['path',{d:'M16 3v4M8 3v4M3 11h18'}]],'clock':[['circle',{cx:12,cy:12,r:9}],['path',{d:'M12 7v5l3 2'}]],'refresh-cw':[['path',{d:'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M18 18A8 8 0 0 1 5 16'}]],'pencil':[['path',{d:'m16 3 5 5-12 12-6 1 1-6ZM14 5l5 5'}]],'eye':[['path',{d:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z'}],['circle',{cx:12,cy:12,r:3}]],'printer':[['path',{d:'M7 8V3h10v5M7 17H4V8h16v9h-3M7 13h10v8H7Z'}]],'arrow-down-left':[['path',{d:'M17 7 7 17M7 7v10h10'}]],'arrow-up-right':[['path',{d:'M7 17 17 7M7 7h10v10'}]]});
  function renderIcons() { document.querySelectorAll('i[data-lucide]').forEach(el => { const name=el.dataset.lucide; const nodes=icons[name]||icons[aliases[name]]||icons['file-text']; const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [k,v] of Object.entries({viewBox:'0 0 24 24',width:20,height:20,fill:'none',stroke:'currentColor','stroke-width':1.8,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(k,v);svg.setAttribute('class',`lucide lucide-${name} ${el.className}`);for(const [tag,attrs]of nodes){const node=document.createElementNS(svg.namespaceURI,tag);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,v);svg.append(node);}el.replaceWith(svg); }); }
  const canStartAction = () => !document.querySelector('.modal-overlay.open[data-busy="true"],.modal-backdrop.open[data-busy="true"],.admin-modal.open[data-busy="true"]');
  window.PGENRO_Module = {canStartAction,storage,escape,uuid,today,toast,csv,openModal,closeModal,observeRecords,renderIcons,read,write,remove,audit,client,unwrap};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initShell,{once:true});else initShell();
})();

/* ===== Page module ===== */
/**
 * PGENRO IMS — User Management Controller
 * Manages Account Authentication users and administrator-controlled PGENRO profiles.
 * Uses a local read-only cache fallback if Supabase is temporarily unavailable.
 */
(() => {
  'use strict';
  const M=window.PGENRO_Module;let saving=false,acting=false,loadVersion=0,channel=null,adminId=null;

  const $ = id => document.getElementById(id);
  const supabase = M.client();
  const PGENRO_API = window.PGENRO_API;

  const els = {};
  const state = {
    users: [],
    filtered: [],
    selected: new Set(),
    page: 1,
    pageSize: 8,
    editingId: null,
    db: null,
    online: false
  };

  const CACHE_KEY = 'pgenro_admin_users_cache';

  document.addEventListener('DOMContentLoaded', init, { once: true });

  function init() {
    cacheElements();
    bindShell();
    bindFilters();
    bindActions();
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

  async function refreshUsers(){
    const version=++loadVersion;
    try{const data=await M.read('profiles');if(version!==loadVersion)return false;state.users=data.map(r=>normalizeUser(r.user_id||r.id,r)).sort(sortUsers);state.online=true;state.selected=new Set([...state.selected].filter(id=>state.users.some(u=>u.id===id)));persistCache();M.observeRecords('user accounts',state.users);applyFilters();return true;}
    catch(error){if(version!==loadVersion)return false;state.online=false;render();showToast(error.message||'User registry could not refresh.','error');return false;}
  }
  async function refreshPending(){try{const rows=await M.read('access_requests');if(els.statPendingRequests)els.statPendingRequests.textContent=rows.filter(r=>/^(pending)$/i.test(r.status||'Pending')).length;}catch{if(els.statPendingRequests)els.statPendingRequests.textContent='—';}}
  async function connectDatabase(){
    loadCache();applyFilters();
    try{
      if(!supabase||!PGENRO_API?.requireAdmin)throw Error('Administrator service is unavailable.');
      const profile=await PGENRO_API.requireAdmin();if(!profile)throw Error('Administrator authorization required.');adminId=String(profile.user_id||profile.authUser?.id||'');state.db=supabase;
      await refreshUsers();await refreshPending();
      channel=supabase.channel('admin-user-management').on('postgres_changes',{event:'*',schema:'public',table:'profiles'},refreshUsers).on('postgres_changes',{event:'*',schema:'public',table:'access_requests'},refreshPending).subscribe();
    }catch(error){state.online=false;render();showToast(error.message,'error');}
    $('refreshUsersBtn').onclick=async()=>{if(!state.db){await connectDatabase();return;}$('refreshUsersBtn').disabled=true;try{if(await refreshUsers())showToast('User registry refreshed.');await refreshPending();}finally{$('refreshUsersBtn').disabled=false;}};
    window.addEventListener('pagehide',(event)=>{if(event.persisted)return;loadVersion++;if(channel)supabase?.removeChannel(channel);});
  }
  async function invoke(action,payload){
    if(!state.online||!PGENRO_API?.invokeAdmin)throw Error('Refresh and authorize the user registry before changing accounts.');
    const result=await PGENRO_API.invokeAdmin(action,payload);
    if(result?.error||result?.success===false)throw Error(result.error?.message||result.message||'The administrator service rejected this action.');
    return result||{};
  }

  function snapshotToUsers(value) {
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value).map(([id, raw]) => normalizeUser(id, raw)).sort(sortUsers);
  }

  function normalizeUser(id, raw = {}) {
    return {
      id: String(raw.user_id || raw.id || id),
      fullName: raw.full_name || raw.fullName || raw.name || 'Unnamed Personnel',
      username: raw.username || (raw.email ? String(raw.email).split('@')[0] : ''),
      email: raw.email || '',
      division: raw.division || 'Unassigned',
      role: raw.role || 'System Staff',
      status: raw.status || (raw.is_active ? 'Active' : 'Inactive'),
      isActive: raw.is_active === true,
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

  function loadCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
      if (Array.isArray(cached)) state.users = cached.map(u => normalizeUser(u.id || uid(), u)).sort(sortUsers);
    } catch { state.users = []; }
  }

  function persistCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(state.users)); } catch {}
  }

  function applyFilters() {
    const q = (els.userSearchInput?.value || els.globalSearchInput?.value || '').trim().toLowerCase();
    const role = els.roleFilterSelect?.value || 'ALL';
    const division = els.divisionFilterSelect?.value || 'ALL';
    const status = els.statusFilterSelect?.value || 'ALL';

    state.filtered = state.users.filter(user => {
      const haystack = [user.fullName, user.username, user.email, user.division, user.role, user.position].join(' ').toLowerCase();
      return (!q || haystack.includes(q)) &&
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
      els.userTableBody.innerHTML = `<tr><td colspan="7"><div class="admin-empty-state"><i data-lucide="users-round"></i><strong>No personnel accounts found</strong><span>${state.users.length ? 'Try changing the current filters.' : 'Approved personnel accounts will appear here.'}</span></div></td></tr>`;
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
    const initials = getInitials(user.fullName);
    const statusClass = /^(active|approved)$/i.test(user.status) ? 'active' : /suspend/i.test(user.status) ? 'suspended' : 'inactive';
    const roleClass = /super admin/i.test(user.role) ? 'super-admin' : /division head/i.test(user.role) ? 'division-head' : 'system-staff';
    return `<tr data-user-id="${attr(user.id)}">
      <td><input type="checkbox" class="row-select" data-id="${attr(user.id)}" ${selected ? 'checked' : ''} aria-label="Select ${attr(user.fullName)}"></td>
      <td><div class="user-cell"><div class="avatar-circle">${html(initials)}</div><div><strong>${html(user.fullName)}</strong><small>${html(user.email || user.username || 'No email')}</small></div></div></td>
      <td><span class="division-tag">${html(user.division)}</span>${user.position ? `<small>${html(user.position)}</small>` : ''}</td>
      <td><span class="role-badge-pill ${roleClass}">${html(user.role)}</span></td>
      <td><span class="status-badge-dot ${statusClass}"><span class="status-dot"></span>${html(user.status)}</span></td>
      <td>${formatLastLogin(user.lastLogin)}</td>
      <td style="text-align:right"><div class="action-buttons">
        <button class="btn-icon-action" data-action="edit" data-id="${attr(user.id)}" title="Edit account" aria-label="Edit ${attr(user.fullName)}"><i data-lucide="pencil"></i></button>
        <button class="btn-icon-action" data-action="toggle" data-id="${attr(user.id)}" title="${/^(active|approved)$/i.test(user.status) ? 'Suspend' : 'Activate'} account" aria-label="Toggle ${attr(user.fullName)} status"><i data-lucide="${/^(active|approved)$/i.test(user.status) ? 'user-x' : 'user-check'}"></i></button>
        <button class="btn-icon-action delete" data-action="delete" data-id="${attr(user.id)}" title="Delete account" aria-label="Delete ${attr(user.fullName)}"><i data-lucide="trash-2"></i></button>
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
    if (els.selectAllCheckbox) {
      const count = visibleIds.filter(id => state.selected.has(id)).length;
      els.selectAllCheckbox.checked = !!visibleIds.length && count === visibleIds.length;
      els.selectAllCheckbox.indeterminate = count > 0 && count < visibleIds.length;
    }
    if (els.bulkDeleteBtn) {
      els.bulkDeleteBtn.disabled = !state.online || acting || state.selected.size === 0;
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
    if (!btn) return;
    const user = state.users.find(u => u.id === btn.dataset.id);
    if (!user) return;
    if (btn.dataset.action === 'edit') openModal(user);
    if (btn.dataset.action === 'toggle') toggleStatus(user);
    if (btn.dataset.action === 'delete') deleteUser(user);
  }

  function openModal(user = null) {
    if(saving)return;state.editingId = user?.id || null;
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
      showToast(isEdit ? 'User account updated in Supabase.' : 'Account Authentication user created.');
    } catch (err) {
      console.error(err);
      showToast(`Unable to save account: ${err.message || 'Unknown error'}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function writeUser(user) {
    const payload = {
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      division: user.division,
      role: user.role,
      status: user.status,
      position: user.position || '',
      contact: user.contact || ''
    };
    const result = await invoke('update', { userId: user.id, user: payload });
    return normalizeUser(user.id, result.user || user);
  }

  async function syncAccessRegistry() {
    // Supabase Edge Function keeps Auth, profiles, users and admin registries synchronized.
  }

  async function removeAccessRegistryByEmail() {
    // Account deletion is centralized in the Supabase Edge Function.
  }

  function upsertLocal(user) {
    const idx = state.users.findIndex(u => u.id === user.id);
    if (idx >= 0) state.users[idx] = user; else state.users.push(user);
    state.users.sort(sortUsers);
    persistCache();
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
      persistCache();
      applyFilters();
      showToast('User account permanently removed.');
    } catch (err) {
      showToast(`Unable to delete account: ${err.message}`, 'error');
    }finally{acting=false;render();}
  }

  async function deleteSelected(){
    if(acting)return;const users=state.users.filter(u=>state.selected.has(u.id)&&u.id!==adminId);if(!users.length)return;
    if(!confirm(`Permanently delete ${users.length} selected accounts?`))return;
    acting=true;render();const removed=new Set(),errors=[];
    try{for(const user of users){try{await invoke('delete',{userId:user.id});removed.add(user.id);}catch(error){errors.push(`${user.fullName}: ${error.message}`);}}
      state.users=state.users.filter(u=>!removed.has(u.id));removed.forEach(id=>state.selected.delete(id));persistCache();applyFilters();
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
    saving=value;els.userModal.dataset.busy=String(value);
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
  function csvCell(v) { return `"${String(v ?? '').replace(/"/g, '""')}"`; }
  function uid() { return `USR-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`; }
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

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
      const saved=await M.write('ics_records',data,id||null);
      state.records=id?state.records.map(r=>String(r.id)===id?saved:r):[saved,...state.records];updateKpis();populateFilters();applyFilters();M.storage.set('pgenro_ics_records',state.records);M.observeRecords('ICS slips',state.records);
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
        <td><div class="record-primary">${escapeHtml(r.accountablePerson||'---')}</div><div class="record-secondary">${escapeHtml(r.division||'')}</div></td>
        <td>${escapeHtml(formatDate(r.dateAcquired))}</td><td><span class="status-badge ${status==='Archived'?'archived':'active'}">${escapeHtml(status)}</span></td>
        <td><div class="row-actions"><button class="row-btn" type="button" title="View" data-action="view" data-id="${escapeHtml(r.id)}"><i data-lucide="eye"></i></button><button class="row-btn edit" type="button" title="Edit" data-action="edit" data-id="${escapeHtml(r.id)}"><i data-lucide="square-pen"></i></button><button class="row-btn delete" type="button" title="Delete" data-action="delete" data-id="${escapeHtml(r.id)}"><i data-lucide="trash-2"></i></button></div></td>
      </tr>`;
    }).join('');
    if($('recordCounter')) $('recordCounter').textContent=`Showing ${records.length.toLocaleString()} of ${state.records.length.toLocaleString()} records`; refreshIcons();
  }
  function applyFilters(){ renderTable(getFilteredRecords()); }

  async function loadRecords(){
    const version=++loadVersion;
    try{const rows=await M.read('ics_records');if(version!==loadVersion)return false;state.records=rows;sortRecords();setDatabaseStatus(true);M.storage.set('pgenro_ics_records',rows);M.observeRecords('ICS slips',rows);updateKpis();populateFilters();applyFilters();return true;}
    catch(error){if(version!==loadVersion)return false;setDatabaseStatus(false);const cached=M.storage.get('pgenro_ics_records',[]);if(!state.records.length&&Array.isArray(cached))state.records=cached;updateKpis();populateFilters();applyFilters();toast(error.message||'ICS registry could not refresh.','error');return false;}
  }
  function attachRealtime(){loadRecords();if(M.client())channel=M.client().channel('admin-ics').on('postgres_changes',{event:'*',schema:'public',table:'ics_records'},loadRecords).subscribe();$('refreshIcsBtn').onclick=async()=>{$('refreshIcsBtn').disabled=true;try{if(await loadRecords())toast('ICS registry refreshed.');}finally{$('refreshIcsBtn').disabled=false;}};}

  /* View modal */
  function setText(id,value){ if($(id)) $(id).textContent=value; }
  function openView(record){
    state.activeRecordId=record.id; const total=record.totalValue!=null?(Number(record.totalValue)||0):(Number(record.quantity)||0)*(Number(record.unitCost)||0);
    setText('viewTitle',record.controlNo||'ICS Record Details'); setText('viewArticle',record.article||'---'); setText('viewDescription',record.itemDescription||'---'); setText('viewControlNo',record.controlNo||'---'); setText('viewIcsNo',record.icsNo||'---'); setText('viewAccountCode',record.accountCode||'---'); setText('viewEntryNo',record.entryNo||'---'); setText('viewSerialNo',record.serialNo||'---'); setText('viewItemNo',record.itemNo||'---'); setText('viewQty',formatNumber(record.quantity||0)); setText('viewUnit',record.unit||'unit'); setText('viewUnitCost',formatMoney(record.unitCost)); setText('viewTotalValue',formatMoney(total)); setText('viewDateAcquired',formatDate(record.dateAcquired)); setText('viewPrNo',record.prNo||'---'); setText('viewPrDate',formatDate(record.prDate)); setText('viewFundCluster',record.fundCluster||'---'); setText('viewAccountable',record.accountablePerson||'---'); setText('viewDivision',record.division||'---'); setText('viewRemarks',record.remarks||'No remarks.');
    const status=record.status||'Active', badge=$('viewStatus'); if(badge){ badge.textContent=status; badge.className=`status-badge ${status==='Archived'?'archived':'active'}`; }
    setModalOpen(viewModal,true);
  }
  function closeView(){ setModalOpen(viewModal,false); state.activeRecordId=null; }
  function activeRecord(){ return state.records.find(r=>r.id===state.activeRecordId) || null; }

  async function deleteRecord(record){
    if(!record) return; if(!state.dbReady||!state.db){ toast('Database is not connected. Delete is unavailable.','error'); return; }
    const label=record.controlNo||record.icsNo||record.id; if(!confirm(`Delete ICS record "${label}"?\n\nThis permanently removes the record.`)) return;
    try{ await M.remove('ics_records',[record.id]);state.records=state.records.filter(r=>String(r.id)!==String(record.id));M.storage.set('pgenro_ics_records',state.records);updateKpis();populateFilters();applyFilters();if(viewModal.classList.contains('open'))closeView();M.audit('DELETE_RECORD',`ICS ${label}`);toast('ICS record deleted.'); }
    catch(err){ console.error('Delete ICS error:',err); toast(`Delete failed${err?.message?': '+err.message:'.'}`,'error'); }
  }

  function bindRegistry(){
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
    const headers=['Control No.','ICS No.','Entry No.','Account Code','Article','Item Description','Serial No.','Item / Inventory No.','Unit','Quantity','Unit Cost','Total Value','Date Acquired','PR No.','PR Date','Fund Cluster','Person Accountable','Division / Unit','Status','Remarks'];
    const rows=list.map(r=>[r.controlNo,r.icsNo,r.entryNo,r.accountCode,r.article,r.itemDescription,r.serialNo,r.itemNo,r.unit,r.quantity,r.unitCost,r.totalValue!=null?r.totalValue:(Number(r.quantity)||0)*(Number(r.unitCost)||0),r.dateAcquired,r.prNo,r.prDate,r.fundCluster,r.accountablePerson,r.division,r.status||'Active',r.remarks]);
    M.csv([headers,...rows],`PGENRO_ICS_${M.today()}.csv`);M.audit('EXPORT_RECORDS',`${list.length} ICS records exported`);toast('CSV export generated.');
  }

  function printRecord(record){
    const qty=Number(record.quantity||0), cost=Number(record.unitCost||0), total=record.totalValue!=null?(Number(record.totalValue)||0):qty*cost, w=window.open('','_blank','width=1100,height=850');
    if(!w){ toast('Please allow pop-ups to print this ICS record.','warning'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>ICS - ${escapeHtml(record.icsNo||record.controlNo||'Record')}</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0}.sheet{border:1px solid #111;padding:16px}.appendix{text-align:right;font-size:11px;font-weight:700}.header{text-align:center}.header h1{font-size:22px;margin:3px 0}.agency{font-weight:700;font-size:13px}.sub{font-size:10px}.meta{display:grid;grid-template-columns:1fr 1fr;margin-top:14px;border-left:1px solid #111;border-top:1px solid #111}.meta div{padding:7px;border-right:1px solid #111;border-bottom:1px solid #111;font-size:10px}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border:1px solid #111;padding:7px;font-size:10px;vertical-align:top}th{background:#eee}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:70px;margin-top:42px}.line{height:28px;border-bottom:1px solid #111;text-align:center}.sig{text-align:center;font-size:10px;margin-top:4px}.remarks{margin-top:10px;font-size:10px}</style></head><body><div class="sheet"><div class="appendix">Appendix 59</div><div class="header"><h1>INVENTORY CUSTODIAN SLIP</h1><div class="agency">PROVINCIAL GOVERNMENT ENVIRONMENT &amp; NATURAL RESOURCES OFFICE (PGENRO)</div><div class="sub">Republic of the Philippines</div></div><div class="meta"><div><b>Control No.:</b> ${escapeHtml(record.controlNo||'---')}</div><div><b>ICS No.:</b> ${escapeHtml(record.icsNo||'---')}</div><div><b>Account Code:</b> ${escapeHtml(record.accountCode||'---')}</div><div><b>Fund Cluster:</b> ${escapeHtml(record.fundCluster||'General Fund (01)')}</div></div><table><thead><tr><th>Qty</th><th>Unit</th><th>Unit Cost</th><th>Total Value</th><th>Article / Description / Serial</th><th>Inventory No.</th><th>Date Acquired</th></tr></thead><tbody><tr><td>${escapeHtml(formatNumber(qty))}</td><td>${escapeHtml(record.unit||'unit')}</td><td>${formatMoney(cost)}</td><td>${formatMoney(total)}</td><td><b>${escapeHtml(record.article||'')}</b><br>${escapeHtml(record.itemDescription||'')}<br>Serial: ${escapeHtml(record.serialNo||'---')}</td><td>${escapeHtml(record.itemNo||'---')}</td><td>${escapeHtml(formatDate(record.dateAcquired))}</td></tr></tbody></table><div class="remarks"><b>Person Accountable:</b> ${escapeHtml(record.accountablePerson||'---')} &nbsp; <b>Division:</b> ${escapeHtml(record.division||'---')}<br><br><b>Remarks:</b> ${escapeHtml(record.remarks||'None')}</div><div class="signatures"><div><div class="line"></div><div class="sig"><b>PGENRO PROPERTY CUSTODIAN</b><br>Supply &amp; Property Management Unit</div></div><div><div class="line"></div><div class="sig"><b>${escapeHtml(record.accountablePerson||'ACCOUNTABLE OFFICER')}</b><br>Signature over Printed Name</div></div></div></div><script>window.onload=()=>window.print()<\/script></body></html>`); w.document.close();
  }

  function bindKeyboard(){
    document.addEventListener('keydown',(e)=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){ e.preventDefault(); ($('icsSearchInput')||$('globalSearchInput'))?.focus(); return; }
      if(e.key==='Escape'){ if(editorModal?.classList.contains('open')) closeEditor(); else if(viewModal?.classList.contains('open')) closeView(); $('profileMenu')?.classList.remove('open'); }
    });
  }

  function init(){
    refreshIcons(); bindForm(); bindRegistry(); bindKeyboard(); initDatabase(); updateTotals(); updateRemarksCounter(); updateProgress(); attachRealtime();
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

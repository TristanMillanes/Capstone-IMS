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

(() => {


(() => {
/* ===== Page module ===== */
/* ============================================================
   SHARED SUPABASE CONFIGURATION
   Configure credentials once in ../shared/supabase.js
   ============================================================ */
const M=window.PGENRO_Module;
const supabase = M.client();
let loadVersion=0;let filteredOrders=[];let saving=false;const changing=new Set();
const isSupabaseConfigured = !!supabase && window.PGENRO_SUPABASE?.configured !== false;

// Helpers
const $ = (id) => document.getElementById(id);

let travelOrders = [];
let editingId = null;
let currentViewingId = null;

// Read-only cache of live travel orders for temporary connection loss.
const TRAVEL_CACHE = "pgenro_admin_travel_orders_live_cache_v2";
let dbOnline = false;
function requireLiveDatabase() {
  if (isSupabaseConfigured && dbOnline) return true;
  toast("Database unavailable. Reconnect before changing travel orders.", "error");
  return false;
}

// Document Ready Initialization
document.addEventListener("DOMContentLoaded", async () => {
  M.renderIcons();
  bindUIEvents();

  if (isSupabaseConfigured) {
    await loadTravelOrders();
    const channel = supabase.channel("travel-orders-admin-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "travel_orders" }, loadTravelOrders)
      .subscribe();
    window.addEventListener("pagehide",(event)=>{if(event.persisted)return;loadVersion++;supabase.removeChannel(channel);});
  } else {
    setStatus(false, "Database offline • Cached records are read-only");
    loadFromLocalStorage();
  }
});

function loadFromLocalStorage() {
  try {
    const cached = JSON.parse(localStorage.getItem(TRAVEL_CACHE) || "[]");
    travelOrders = Array.isArray(cached) && cached.length ? cached : travelOrders;
  } catch { /* Keep records already loaded into memory. */ }
  render();
}

function saveToLocalStorage() {
  try { localStorage.setItem(TRAVEL_CACHE, JSON.stringify(travelOrders)); }
  catch { /* Browser storage may be disabled. */ }
}

// Event Bindings
function bindUIEvents() {
  // Sidebar and profile controls live in this page script.

  // Top action buttons
  $("addOrderBtn").onclick = () => openOrderModal();
  $("exportBtn").onclick = exportCSV;
  $("printDocBtn").onclick = () => window.print();

  $("refreshBtn").onclick = async () => {
    const button = $("refreshBtn");
    const original = button.innerHTML;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.innerHTML = '<i data-lucide="loader-circle" class="spin"></i>';
    M.renderIcons();
    try {
      if (isSupabaseConfigured) await loadTravelOrders();
      else loadFromLocalStorage();
      toast(dbOnline ? "Travel orders refreshed" : "Database unavailable; showing cached records only", dbOnline ? "success" : "warning");
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.innerHTML = original;
      M.renderIcons();
    }
  };

  // Form submission
  $("orderForm").onsubmit = saveTravelOrder;

  // Search & Filters
  $("searchInput").oninput = () => { $("globalSearchInput").value=$("searchInput").value;render(); };
  $("globalSearchInput").oninput = () => {
    $("searchInput").value = $("globalSearchInput").value;
    render();
  };
  $("filterStatus").onchange = render;
  $("filterType").onchange = render;
  $("filterSort").onchange = render;
  $("clearFiltersBtn")?.addEventListener("click", () => {
    $("searchInput").value = "";
    $("globalSearchInput").value = "";
    $("filterStatus").value = "";
    $("filterType").value = "";
    $("filterSort").value = "newest";
    render();
    toast("Registry filters cleared.", "success");
  });

  // Live form UX
  const liveFields = [
    "torNo", "travelerName", "travelerDept", "destination",
    "departureDate", "returnDate", "travelType", "travelStatus",
    "purpose", "remarks"
  ];
  liveFields.forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
      el.classList.remove("field-invalid");
      updateTravelFormUX();
    });
  });
  $("departureDate")?.addEventListener("change", syncReturnDateMinimum);
  $("returnDate")?.addEventListener("change", updateTravelFormUX);

  // Modal dismiss buttons
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.onclick = () => closeModal(btn.dataset.close);
  });
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) closeModal(backdrop.id);
    });
  });

  // Keyboard Shortcuts (Ctrl/Cmd + K & Esc)
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
  if(saving)return;
      $("globalSearchInput").focus();
    }
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.open").forEach((m) => closeModal(m.id));
    }
  });
}

// Supabase Loader
async function loadTravelOrders() {
 const version=++loadVersion;
 try {
  const data=await M.read('travel_orders');if(version!==loadVersion)return false;
  travelOrders=data.map(normalizeTravelOrder);dbOnline=true;saveToLocalStorage();M.observeRecords('travel orders',travelOrders);render();setStatus(true);return true;
 }catch(error){if(version!==loadVersion)return false;dbOnline=false;setStatus(false);toast(error.message||'Unable to refresh travel orders.','error');loadFromLocalStorage();return false;}
}
function setStatus(online){
 $('addOrderBtn').disabled=!online;
 document.querySelectorAll('#travelOrderBody [data-edit],#travelOrderBody [data-delete],#travelOrderBody [data-status]').forEach(b=>b.disabled=!online);
}

function normalizeTravelOrder(record) {
  return {
    ...record,
    tor_no: record.tor_no || record.torNo || record.toNumber || record.controlNo || '',
    traveler_name: record.traveler_name || record.travelerName || record.employeeName || record.traveler || '',
    travel_type: record.travel_type || record.travelType || record.type || 'Official',
    departure_date: record.departure_date || record.startDate || record.dateFrom || '',
    return_date: record.return_date || record.endDate || record.dateTo || '',
    created_at: record.created_at || record.createdAt || '',
    updated_at: record.updated_at || record.updatedAt || ''
  };
}

// Table & Metrics Renderer
function render() {
  const search = $("searchInput").value.trim().toLowerCase();
  const filterStat = $("filterStatus").value;
  const filterType = $("filterType").value;
  const sort = $("filterSort").value;

  let rows = travelOrders.filter((tor) => {
    const query = `${tor.tor_no || ""} ${tor.traveler_name || ""} ${tor.destination || ""} ${tor.purpose || ""} ${tor.transportation || ""} ${tor.department || ""}`.toLowerCase();
    const matchesSearch = !search || query.includes(search);
    const matchesStat = !filterStat || tor.status === filterStat;
    const matchesType = !filterType || tor.travel_type === filterType;

    return matchesSearch && matchesStat && matchesType;
  });

  // Sorting
  rows.sort((a, b) => {
    if (sort === "date-asc") return new Date(a.departure_date) - new Date(b.departure_date);
    if (sort === "date-desc") return new Date(b.departure_date) - new Date(a.departure_date);
    if (sort === "traveler") return (a.traveler_name || "").localeCompare(b.traveler_name || "");
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });

  filteredOrders=rows;
  const tbody = $("travelOrderBody");
  tbody.innerHTML = rows.length
    ? rows.map(rowHTML).join("")
    : `<tr><td colspan="8" class="empty">No travel order records found matching criteria.</td></tr>`;

  // Attach dynamic button handlers
  tbody.querySelectorAll("[data-print]").forEach((b) => (b.onclick = () => openPrintModal(b.dataset.print)));
  tbody.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openOrderModal(b.dataset.edit)));
  tbody.querySelectorAll("[data-delete]").forEach((b) => (b.onclick = () => deleteOrder(b.dataset.delete)));
  tbody.querySelectorAll("[data-status]").forEach((b) => (b.onclick = () => quickStatusCycle(b.dataset.status)));
  if (!dbOnline) tbody.querySelectorAll("[data-edit], [data-delete], [data-status]").forEach(b => { b.disabled = true; });

  // KPI calculations
  const total = travelOrders.length;
  const pending = travelOrders.filter((t) => t.status === "Pending").length;
  const approved = travelOrders.filter((t) => t.status === "Approved").length;
  const completed = travelOrders.filter((t) => t.status === "Completed").length;

  $("metricTotal").textContent = total.toLocaleString();
  $("metricPending").textContent = pending.toLocaleString();
  $("metricApproved").textContent = approved.toLocaleString();
  $("metricCompleted").textContent = completed.toLocaleString();
  $("recordCounter").textContent = `Showing ${rows.length} of ${total} Orders`;
  updateRegistryFilterState(rows.length, total);

  M.renderIcons();
}

function rowHTML(tor) {
  const status = tor.status || "Pending";
  const statusClass = status.toLowerCase();

  // Format dates: e.g. "Sep 08 – Sep 11, 2026"
  const dep = tor.departure_date ? new Date(`${tor.departure_date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
  const ret = tor.return_date ? new Date(`${tor.return_date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
  const dateFormatted = `${dep} – ${ret}`;

  return `<tr>
    <td data-label="TOR No."><span class="tor-badge">${escapeHTML(tor.tor_no || "—")}</span></td>
    <td data-label="Traveler & Office">
      <div class="traveler-cell">
        <span class="traveler-name">${escapeHTML(tor.traveler_name || "—")}</span>
        <span class="traveler-sub">${escapeHTML(tor.traveler_position || "Staff")} &bull; ${escapeHTML(tor.department || "PGENRO")}</span>
      </div>
    </td>
    <td data-label="Destination & Purpose">
      <span class="dest-text">${escapeHTML(tor.destination || "—")}</span>
      <span class="purpose-text" title="${escapeHTML(tor.purpose || "Official Mission")}">${escapeHTML(tor.purpose || "Official Mission")}</span>
    </td>
    <td data-label="Travel Schedule"><b>${dateFormatted}</b></td>
    <td data-label="Travel Type"><span class="type-tag">${escapeHTML(tor.travel_type || "Official")}</span></td>
    <td data-label="Transportation"><small style="font-weight:700; color:var(--slate-700);">${escapeHTML(tor.transportation || "Official")}</small></td>
    <td data-label="Status">
      <button class="badge ${statusClass}" title="Click to advance workflow status" data-status="${escapeHTML(tor.id)}" style="cursor:pointer; border:none;">
        ${escapeHTML(status)}
      </button>
    </td>
    <td data-label="Actions">
      <div class="actions">
        <button class="action print" type="button" aria-label="View and print ${escapeHTML(tor.tor_no || "travel order")}" title="View & Print Official Travel Order" data-print="${escapeHTML(tor.id)}"><i data-lucide="printer"></i></button>
        <button class="action approve" type="button" aria-label="Advance status for ${escapeHTML(tor.tor_no || "travel order")}" title="Advance Status" data-status="${escapeHTML(tor.id)}"><i data-lucide="check"></i></button>
        <button class="action" type="button" aria-label="Edit ${escapeHTML(tor.tor_no || "travel order")}" title="Edit Travel Order" data-edit="${escapeHTML(tor.id)}"><i data-lucide="pencil"></i></button>
        <button class="action delete" type="button" aria-label="Delete ${escapeHTML(tor.tor_no || "travel order")}" title="Delete Travel Order" data-delete="${escapeHTML(tor.id)}"><i data-lucide="trash-2"></i></button>
      </div>
    </td>
  </tr>`;
}

function updateRegistryFilterState(visibleCount = 0, totalCount = travelOrders.length) {
  const parts = [];
  const query = $("searchInput")?.value.trim();
  const status = $("filterStatus")?.value;
  const type = $("filterType")?.value;
  const sort = $("filterSort")?.value || "newest";

  if (query) parts.push(`Search: “${query}”`);
  if (status) parts.push(status);
  if (type) parts.push(type);
  if (sort !== "newest") {
    const labels = { "date-asc": "Earliest departure", "date-desc": "Latest departure", traveler: "Traveler A–Z" };
    parts.push(labels[sort] || sort);
  }

  const target = $("activeFilterText");
  if (target) target.textContent = parts.length
    ? `${visibleCount} result${visibleCount === 1 ? "" : "s"} • ${parts.join(" • ")}`
    : `Showing all ${totalCount} travel order${totalCount === 1 ? "" : "s"}`;

  const sync = $("registrySyncText");
  if (sync) sync.textContent = dbOnline ? "Records updated" : "Offline • cached records (read-only)";
}

function formatTravelDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function generateNextTorNo() {
  const year = new Date().getFullYear();
  const prefix = `TOR-${year}-`;
  const used = travelOrders
    .map((row) => String(row.tor_no || ""))
    .filter((value) => value.startsWith(prefix))
    .map((value) => Number(value.slice(prefix.length)))
    .filter(Number.isFinite);
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

function syncReturnDateMinimum() {
  const departure = $("departureDate")?.value || "";
  const ret = $("returnDate");
  if (!ret) return;
  ret.min = departure;
  if (departure && ret.value && ret.value < departure) ret.value = departure;
  updateTravelFormUX();
}

function updateTravelFormUX() {
  const purpose = $("purpose");
  const remarks = $("remarks");
  if ($("purposeCounter") && purpose) $("purposeCounter").textContent = `${purpose.value.length} / ${purpose.maxLength || 600}`;
  if ($("remarksCounter") && remarks) $("remarksCounter").textContent = `${remarks.value.length} / ${remarks.maxLength || 500}`;

  const dep = $("departureDate")?.value || "";
  const ret = $("returnDate")?.value || "";
  const durationStrip = $("tripDurationStrip");
  const durationText = $("tripDurationText");
  const rangeText = $("tripDateRangeText");
  let schedule = "—";

  if (dep && ret) {
    const start = new Date(`${dep}T00:00:00Z`);
    const end = new Date(`${ret}T00:00:00Z`);
    const days = Math.floor((end - start) / 86400000) + 1;
    const invalid = days < 1;
    durationStrip?.classList.toggle("invalid", invalid);
    if (durationText) durationText.textContent = invalid ? "Return date must be on or after departure" : `${days} day${days === 1 ? "" : "s"} official travel`;
    if (rangeText) rangeText.textContent = `${formatTravelDate(dep)} → ${formatTravelDate(ret)}`;
    if (!invalid) schedule = `${formatTravelDate(dep)} – ${formatTravelDate(ret)}`;
  } else {
    durationStrip?.classList.remove("invalid");
    if (durationText) durationText.textContent = "Travel period not complete";
    if (rangeText) rangeText.textContent = "Select departure and return dates.";
  }

  const summaryValues = {
    summaryTorNo: $("torNo")?.value.trim() || "—",
    summaryTraveler: $("travelerName")?.value.trim() || "—",
    summaryDept: $("travelerDept")?.value.trim() || "—",
    summaryDestination: $("destination")?.value.trim() || "—",
    summarySchedule: schedule,
    summaryType: $("travelType")?.value || "Official Business",
    summaryStatus: $("travelStatus")?.selectedOptions?.[0]?.textContent || "Pending Review"
  };
  Object.entries(summaryValues).forEach(([id, value]) => { if ($(id)) $(id).textContent = value; });
  const statusRow = $("summaryStatus")?.closest(".summary-status-row");
  if (statusRow) statusRow.dataset.status = $("travelStatus")?.value || "Pending";
}

function markFieldInvalid(id, message) {
  const field = $(id);
  if (!field) return;
  field.classList.add("field-invalid");
  field.focus({ preventScroll: true });
  field.scrollIntoView({ behavior: "smooth", block: "center" });
  toast(message, "error");
}

// Add or Edit Modal
function openOrderModal(id = null) {
      if (!M.canStartAction()) return;
  editingId = id;
  $("orderForm").reset();
  $("orderDbId").value = id || "";
  document.querySelectorAll("#orderForm .field-invalid").forEach((field) => field.classList.remove("field-invalid"));

  if (id) {
    const tor = travelOrders.find((x) => String(x.id) === String(id));
    if (!tor) return;
    $("orderModalTitle").textContent = "Edit Travel Order";
    $("torNo").value = tor.tor_no || "";
    $("travelerName").value = tor.traveler_name || "";
    $("travelerPosition").value = tor.traveler_position || "";
    $("travelerDept").value = tor.department || "";
    $("travelType").value = tor.travel_type || "Official Business";
    $("travelStatus").value = tor.status || "Pending";
    $("destination").value = tor.destination || "";
    $("departureDate").value = tor.departure_date || "";
    $("returnDate").value = tor.return_date || "";
    $("transportation").value = tor.transportation || "";
    $("purpose").value = tor.purpose || "";
    $("perDiem").value = tor.per_diem || "";
    $("fundSource").value = tor.fund_source || "";
    $("approverName").value = tor.approver || "Provincial Environment & Natural Resources Officer";
    $("remarks").value = tor.remarks || "";
  } else {
    $("orderModalTitle").textContent = "Create Travel Order";
    $("torNo").value = generateNextTorNo();
    $("travelStatus").value = "Pending";
    $("travelType").value = "Official Business";
    $("approverName").value = "Provincial Environment & Natural Resources Officer";
    const today = new Date();
    $("departureDate").value = today.toISOString().slice(0, 10);
    const tomorrow = new Date(today.getTime() + 86400000);
    $("returnDate").value = tomorrow.toISOString().slice(0, 10);
  }

  syncReturnDateMinimum();
  updateTravelFormUX();
  openModal("orderModal");
  const body = document.querySelector("#orderModal .travel-order-modal-body");
  if (body) body.scrollTop = 0;
  $("torNo")?.focus({preventScroll:true});
}

async function saveTravelOrder(e) {
  e.preventDefault();
  const form = $("orderForm");
  const saveButton = $("saveOrderBtn");

  document.querySelectorAll("#orderForm .field-invalid").forEach((field) => field.classList.remove("field-invalid"));

  const payload = {
    tor_no: $("torNo").value.trim(),
    traveler_name: $("travelerName").value.trim(),
    traveler_position: $("travelerPosition").value.trim(),
    department: $("travelerDept").value.trim(),
    travel_type: $("travelType").value,
    status: $("travelStatus").value,
    destination: $("destination").value.trim(),
    departure_date: $("departureDate").value,
    return_date: $("returnDate").value,
    transportation: $("transportation").value.trim(),
    purpose: $("purpose").value.trim(),
    per_diem: $("perDiem").value.trim(),
    fund_source: $("fundSource").value.trim(),
    approver: $("approverName").value.trim(),
    remarks: $("remarks").value.trim(),
    updated_at: new Date().toISOString()
  };

  const required = [
    ["torNo", payload.tor_no, "Enter the official Travel Order number."],
    ["travelerName", payload.traveler_name, "Enter the traveler or personnel name."],
    ["travelerPosition", payload.traveler_position, "Enter the traveler’s position or designation."],
    ["travelerDept", payload.department, "Enter the division or operating unit."],
    ["destination", payload.destination, "Enter the destination or official station."],
    ["departureDate", payload.departure_date, "Select the departure date."],
    ["returnDate", payload.return_date, "Select the return date."],
    ["transportation", payload.transportation, "Enter the transportation or vehicle."],
    ["purpose", payload.purpose, "Describe the specific purpose of travel."]
  ];
  const missing = required.find(([, value]) => !value);
  if (missing) return markFieldInvalid(missing[0], missing[2]);

  if (!form.checkValidity()) {
    const invalid = form.querySelector(":invalid");
    if (invalid?.id) return markFieldInvalid(invalid.id, "Please review the highlighted required field.");
    return toast("Please review the required fields.", "error");
  }

  if (payload.return_date < payload.departure_date) {
    return markFieldInvalid("returnDate", "Return date cannot be earlier than the departure date.");
  }

  const duplicate = travelOrders.find((row) =>
    String(row.tor_no || "").trim().toLowerCase() === payload.tor_no.toLowerCase() &&
    String(row.id) !== String(editingId || "")
  );
  if (duplicate) return markFieldInvalid("torNo", `Travel Order ${payload.tor_no} already exists.`);

  const originalButtonHtml = saveButton.innerHTML;
  saving=true; $('orderModal').dataset.busy='true';
  saveButton.disabled = true;
  saveButton.setAttribute("aria-busy", "true");
  saveButton.innerHTML = '<i data-lucide="loader-circle" class="spin"></i><span>Saving...</span>';
  M.renderIcons();

  try {
    if (!requireLiveDatabase()) return;
    const id=editingId;
    if(!id)payload.created_at=new Date().toISOString();
    const saved=await M.write('travel_orders',payload,id);
    travelOrders=id?travelOrders.map(r=>String(r.id)===String(id)?saved:r):[saved,...travelOrders];
    saveToLocalStorage();M.observeRecords('travel orders',travelOrders);render();
    $('orderModal').dataset.busy='false';closeModal('orderModal');
    toast(`Travel order ${id?'updated':'created'} successfully.`);
  } catch (error) {
    console.error("Travel order save failed:", error);
    toast(error?.message || "Unable to save the travel order. Please try again.", "error");
  } finally {
    saving=false;$("orderModal").dataset.busy="false";
    saveButton.disabled = false;
    saveButton.removeAttribute("aria-busy");
    saveButton.innerHTML = originalButtonHtml;
    M.renderIcons();
  }
}

// Cycle Status (Quick Approval workflow)
async function quickStatusCycle(id) {
  const tor = travelOrders.find((x) => String(x.id) === String(id));
  if (!tor) return;

  const order = ["Pending", "Approved", "Completed", "Disapproved"];
  const nextIndex = (order.indexOf(tor.status) + 1) % order.length;
  const newStatus = order[nextIndex];

  if (!requireLiveDatabase()||changing.has(id)||!confirm(`Change ${tor.tor_no} from ${tor.status} to ${newStatus}?`)) return;
  try {
    if(changing.has(id))return;changing.add(id);
    const saved=await M.write("travel_orders",{status:newStatus},id);
    travelOrders=travelOrders.map(r=>String(r.id)===String(id)?saved:r);saveToLocalStorage();render();
    if (await loadTravelOrders()) toast(`${tor.tor_no} status changed to ${newStatus}.`, "success");
  } catch (error) { toast(error?.message || "Could not update status.", "error"); }finally{changing.delete(id);}
}

async function deleteOrder(id) {
  const tor = travelOrders.find((x) => String(x.id) === String(id));
  if (!tor || !confirm(`Delete Travel Order "${tor.tor_no}" for ${tor.traveler_name}?`)) return;

  if (!requireLiveDatabase()) return;
  try {
    if(changing.has(id))return;changing.add(id);
    await M.remove("travel_orders",[id]);
    travelOrders=travelOrders.filter(r=>String(r.id)!==String(id));saveToLocalStorage();render();
    if (await loadTravelOrders()) toast("Travel order deleted.", "success");
  } catch (error) { toast(error?.message || "Could not delete travel order.", "error"); }finally{changing.delete(id);}
}

// Print Modal Preparation
function openPrintModal(id) {
      if (!M.canStartAction()) return;
  currentViewingId = id;
  const tor = travelOrders.find((x) => String(x.id) === String(id));
  if (!tor) return;

  const dep = tor.departure_date ? new Date(`${tor.departure_date}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—";
  const ret = tor.return_date ? new Date(`${tor.return_date}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—";

  $("p_torNo").textContent = tor.tor_no || "TOR-2026-000";
  $("p_dateFiled").textContent = new Date(tor.created_at || Date.now()).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  $("p_traveler").textContent = tor.traveler_name || "—";
  $("p_position").textContent = tor.traveler_position || "—";
  $("p_dept").textContent = tor.department || "PGENRO";
  $("p_destination").textContent = tor.destination || "—";
  $("p_dates").textContent = `${dep} to ${ret}`;
  $("p_purpose").textContent = tor.purpose || "Official Mission";
  $("p_perDiem").textContent = tor.per_diem || "Pursuant to Executive Order 77 & COA Auditing Rules";
  $("p_transport").textContent = tor.transportation || "Official Government Conveyance";
  $("p_funds").textContent = tor.fund_source || "PGENRO Budgetary Allocation";
  $("p_remarks").textContent = tor.remarks || "Submit Certificate of Appearance upon return.";
  $("p_approver").textContent = (tor.approver || "PROVINCIAL ENR OFFICER").toUpperCase();

  openModal("printModal");
}

// Export CSV
function exportCSV() {
  if (!filteredOrders.length) return toast("No travel orders to export.", "error");

  const headers = [
    "TOR No",
    "Traveler Name",
    "Position",
    "Department",
    "Travel Type",
    "Destination",
    "Departure Date",
    "Return Date",
    "Transportation",
    "Purpose",
    "Status",
    "Approver"
  ];

  const rows = filteredOrders.map((t) => [
    t.tor_no,
    t.traveler_name,
    t.traveler_position,
    t.department,
    t.travel_type,
    t.destination,
    t.departure_date,
    t.return_date,
    t.transportation,
    t.purpose,
    t.status,
    t.approver
  ]);

  M.csv([headers,...rows],`pgenro_travel_orders_${M.today()}.csv`);
  toast('Matching travel orders exported.');
}

// Modal Helpers
const openModal=M.openModal,closeModal=M.closeModal,toast=M.toast;

function escapeHTML(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[c])
  );
}


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

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

/* ============================================================================
   PGENRO IMS — VISITORS ADMIN CONTROLLER
   Full Realtime Synchronization, Supabase Integration & Direct Admin Parity
   ============================================================================ */

(() => {
  "use strict";
  const M=window.PGENRO_Module;let online=false,saving=false,changing=false,channel=null;

  document.addEventListener("DOMContentLoaded", () => {
    if (window.lucide) {
      M.renderIcons();
    }

    const $ = (id) => document.getElementById(id);
    const body = document.body;
    const VISITORS_TABLE = "visitors";
    const rowsPerPage = 10;

    // Route storage through the shared Supabase client
    const supabaseClient = window.pgenroSupabase || window.PGENRO_DB?.client || null;

    const els = {
      sidebar: $("sidebar"),
      overlay: $("overlay"),
      mobileMenuBtn: $("mobileMenuBtn"),
      sidebarCollapseBtn: $("sidebarCollapseBtn"),
      globalSearchInput: $("globalSearchInput"),
      profileMenu: $("profileMenu"),
      profileBtn: $("profileBtn"),
      profileDropdown: $("profileDropdown"),
      notificationsBtn: $("notificationsBtn"),
      notificationDropdown: $("notificationDropdown"),
      logoutBtn: $("logoutBtn"),
      todayDateStr: $("todayDateStr"),
      visitorSearch: $("visitorSearch"),
      purposeFilter: $("purposeFilter"),
      statusFilter: $("statusFilter"),
      visitorTableBody: $("visitorTableBody"),
      emptyState: $("emptyState"),
      summaryTotal: $("summaryTotal"),
      summaryToday: $("summaryToday"),
      summaryInside: $("summaryInside"),
      summaryCompletedToday: $("summaryCompletedToday"),
      resetFiltersBtn: $("resetFiltersBtn"),
      detailDrawer: $("detailDrawer"),
      closeDrawerBtn: $("closeDrawerBtn"),
      toggleCheckoutBtn: $("toggleCheckoutBtn"),
      printPassBtn: $("printPassBtn"),
      editVisitorBtn: $("editVisitorBtn"),
      deleteVisitorBtn: $("deleteVisitorBtn"),
      prevPageBtn: $("prevPageBtn"),
      nextPageBtn: $("nextPageBtn"),
      pageIndicator: $("pageIndicator"),
      showingCountText: $("showingCountText"),
      exportCsvBtn: $("exportCsvBtn"),
      refreshBtn: $("refreshBtn"),
      addVisitorBtn: $("addVisitorBtn"),
      visitorModalBackdrop: $("visitorModalBackdrop"),
      visitorModalTitle: $("visitorModalTitle"),
      closeVisitorModalBtn: $("closeVisitorModalBtn"),
      cancelVisitorModalBtn: $("cancelVisitorModalBtn"),
      visitorAdminForm: $("visitorAdminForm"),
      visitorId: $("visitorId"),
      fullName: $("fullName"),
      contact: $("contact"),
      address: $("address"),
      personToVisit: $("personToVisit"),
      purposeCategory: $("purposeCategory"),
      otherPurposeSpecific: $("otherPurposeSpecific"),
      visitorNotesCount: $("visitorNotesCount"),
      saveVisitorSubmitBtn: $("saveVisitorSubmitBtn"),
      saveVisitorSubmitText: $("saveVisitorSubmitText"),
      adminToast: $("adminToast"),
      dbStatusDot: $("dbStatusDot"),
      dbStatusText: $("dbStatusText"),
      notificationList: $("notificationList"),
      notifBadgeCount: $("notifBadgeCount"),
      notifPing: $("notifPing"),
      visitorLiveText: $("visitorLiveText"),
      registryResultCount: $("registryResultCount"),
      filterStateText: $("filterStateText")
    };

    let visitors = [];
    let selectedVisitor = null;
    let activeDateFilter = "all";
    let currentPage = 1;
    let syncTimer = null;
    let syncInFlight = false,syncQueued=false;
    let toastTimer = null;

    const escapeHTML = (value) => String(value ?? "").replace(/[&<>'"]/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[c]));

    const getLocalDateKey = (date = new Date()) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };

    const parseDateKey = (value) => {
      if (!value) return null;
      const normalized = String(value).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
      const [y, m, d] = normalized.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      return Number.isNaN(date.getTime()) ? null : date;
    };

    const dateString = (date = new Date()) => date.toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric"
    });

    const timeString = (date = new Date()) => date.toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit"
    });

    const toast=M.toast;
    function setDatabaseStatus(value){online=value;}
    function logSystemAudit(action,details){M.audit(action,details);}

    function normalizeStatus(status, timeOut) {
      const value = String(status || "").trim().toLowerCase();
      if (["completed", "checked_out", "checked-out", "signed out", "departed", "closed"].includes(value)) return "completed";
      if (!value && timeOut) return "completed";
      return "inside";
    }

    function normalizeVisitor(row) {
      const timeInISO = row.time_in || row.timeIn || row.created_at || null;
      const timeOutISO = row.time_out || row.timeOut || null;
      const parsedTimeIn = timeInISO ? new Date(timeInISO) : null;
      const fallbackDateKey = parsedTimeIn && !Number.isNaN(parsedTimeIn.getTime()) ? getLocalDateKey(parsedTimeIn) : "";
      const dateKey = row.visit_date ? String(row.visit_date).slice(0, 10) : fallbackDateKey;

      return {
        _id: row.id ?? row._id ?? "",
        fullName: row.full_name ?? row.fullName ?? "",
        contact: row.contact ?? "",
        address: row.address ?? "",
        personToVisit: row.person_to_visit ?? row.personToVisit ?? "",
        purposeCategory: row.purpose_category ?? row.purposeCategory ?? "",
        otherPurposeSpecific: row.other_purpose_specific ?? row.otherPurposeSpecific ?? "",
        dateKey,
        date: dateKey ? dateString(parseDateKey(dateKey) || new Date()) : "Today",
        time: timeInISO ? timeString(new Date(timeInISO)) : "",
        timestamp: timeInISO ? new Date(timeInISO).getTime() || 0 : 0,
        status: normalizeStatus(row.status, timeOutISO),
        timeOut: timeOutISO ? timeString(new Date(timeOutISO)) : null,
        timeInISO,
        timeOutISO
      };
    }

    function isInside(visitor) {
      return (visitor?.status || "inside") === "inside";
    }

    function getInitials(name) {
      const parts = String(name || "Guest").trim().split(/\s+/).filter(Boolean).slice(0, 2);
      return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "JD";
    }

    function isWithinCurrentWeek(dateKey) {
      const date = parseDateKey(dateKey);
      if (!date) return false;
      const now = new Date();
      const firstDayOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
      firstDayOfWeek.setHours(0, 0, 0, 0);
      const tomorrow=new Date();tomorrow.setHours(24,0,0,0);return date>=firstDayOfWeek&&date<tomorrow;
    }

    function getFilteredVisitors() {
      const search = String(els.visitorSearch?.value || "").trim().toLowerCase();
      const purpose = els.purposeFilter?.value || "all";
      const status = els.statusFilter?.value || "all";
      const todayKey = getLocalDateKey();

      return visitors.filter((visitor) => {
        const haystack = [
          visitor.fullName,
          visitor.contact,
          visitor.address,
          visitor.personToVisit,
          visitor.purposeCategory,
          visitor.otherPurposeSpecific
        ].join(" ").toLowerCase();

        if (search && !haystack.includes(search)) return false;
        if (purpose !== "all" && visitor.purposeCategory !== purpose) return false;
        if (status !== "all" && visitor.status !== status) return false;

        if (activeDateFilter === "today" && visitor.dateKey !== todayKey) return false;
        if (activeDateFilter === "week" && !isWithinCurrentWeek(visitor.dateKey)) return false;

        return true;
      }).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    function updateMetrics() {
      const todayKey = getLocalDateKey();
      const todayVisitors = visitors.filter((v) => v.dateKey === todayKey);

      if (els.summaryTotal) els.summaryTotal.textContent = visitors.length;
      if (els.summaryToday) els.summaryToday.textContent = todayVisitors.length;
      if (els.summaryInside) els.summaryInside.textContent = visitors.filter(isInside).length;
      if (els.summaryCompletedToday) els.summaryCompletedToday.textContent = visitors.filter(v=>!isInside(v)&&v.timeOutISO&&getLocalDateKey(new Date(v.timeOutISO))===todayKey).length;
      if (els.todayDateStr) els.todayDateStr.textContent = dateString();
    }

    function updateFilterMeta(total) {
      if (els.registryResultCount) {
        els.registryResultCount.textContent = `${total} ${total === 1 ? "record" : "records"}`;
      }

      const activeParts = [];
      const search = String(els.visitorSearch?.value || "").trim();
      if (search) activeParts.push("Search");
      if ((els.purposeFilter?.value || "all") !== "all") activeParts.push("Purpose");
      if ((els.statusFilter?.value || "all") !== "all") activeParts.push("Status");
      if (activeDateFilter !== "all") activeParts.push(activeDateFilter === "today" ? "Today" : "This week");

      if (els.filterStateText) {
        els.filterStateText.innerHTML = `<i data-lucide="list-filter"></i> ${activeParts.length ? `${activeParts.length} active filter${activeParts.length > 1 ? "s" : ""}` : "All records"}`;
      }
      if (els.resetFiltersBtn) els.resetFiltersBtn.disabled = activeParts.length === 0;
    }

    function renderTable(list) {
      if (!els.visitorTableBody) return;
      els.visitorTableBody.replaceChildren();

      const total = list.length;
      updateFilterMeta(total);
      const pages = Math.max(1, Math.ceil(total / rowsPerPage));
      currentPage = Math.min(Math.max(currentPage, 1), pages);
      const start = (currentPage - 1) * rowsPerPage;
      const rows = list.slice(start, start + rowsPerPage);

      if (els.showingCountText) {
        els.showingCountText.textContent = total ? `Showing ${start + 1}–${Math.min(start + rowsPerPage, total)} of ${total} entries` : "Showing 0 entries";
      }
      if (els.pageIndicator) els.pageIndicator.textContent = `${currentPage} / ${pages}`;
      if (els.prevPageBtn) els.prevPageBtn.disabled = currentPage <= 1;
      if (els.nextPageBtn) els.nextPageBtn.disabled = currentPage >= pages;
      els.emptyState?.classList.toggle("hidden", rows.length > 0);

      const fragment = document.createDocumentFragment();
      rows.forEach((v) => {
        const tr = document.createElement("tr");
        const active = isInside(v);
        const code = v._id ? `VIS-${String(v._id).replace(/-/g, "").slice(0, 8).toUpperCase()}` : "VISITOR";

        tr.innerHTML = `
          <td data-label="Visitor">
            <div class="user-cell">
              <div class="avatar-sm">${escapeHTML(getInitials(v.fullName))}</div>
              <div>
                <strong>${escapeHTML(v.fullName || "Guest")}</strong>
                <small class="font-mono">${escapeHTML(code)}</small>
              </div>
            </div>
          </td>
          <td data-label="Contact & origin">
            <div>
              <strong>${escapeHTML(v.contact || "None")}</strong>
              <small class="text-muted" style="display:block;">${escapeHTML(v.address || "Unspecified")}</small>
            </div>
          </td>
          <td data-label="Host / office">
            <span class="dept-pill"><i data-lucide="building-2"></i><span>${escapeHTML(v.personToVisit || "Staff")}</span></span>
          </td>
          <td data-label="Purpose">
            <span class="table-tag">${escapeHTML(v.purposeCategory || "General Inquiry")}</span>
          </td>
          <td data-label="Check-in">
            <div>
              <strong>${escapeHTML(v.time || "--:--")}</strong>
              <small class="text-muted" style="display:block;">${escapeHTML(v.date || "Today")}</small>
            </div>
          </td>
          <td data-label="Status">
            <span class="badge-status ${active ? "success" : "info"}">
              <span class="dot"></span> ${active ? "In Building" : "Departed"}
            </span>
          </td>
          <td data-label="Manage" style="text-align: right;">
            <button class="btn btn-secondary btn-sm btn-view-row" type="button"><i data-lucide="eye"></i> Inspect</button>
          </td>
        `;

        tr.tabIndex = 0;
        tr.setAttribute("role", "button");
        tr.setAttribute("aria-label", `Inspect visitor ${v.fullName || "record"}`);
        tr.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openDrawer(v);
          }
        });
        tr.addEventListener("click", () => openDrawer(v));
        tr.querySelector(".btn-view-row")?.addEventListener("click", (e) => {
          e.stopPropagation();
          openDrawer(v);
        });
        fragment.appendChild(tr);
      });

      els.visitorTableBody.appendChild(fragment);
      M.renderIcons();
    }

    function render() {
      updateMetrics();
      renderTable(getFilteredVisitors());
    }

    function openDrawer(visitor) {
      if (!visitor) return;
      selectedVisitor = visitor;

      $("drawerName").textContent = visitor.fullName || "Guest Details";
      $("drawerFullname").textContent = visitor.fullName || "—";
      $("drawerAvatar").textContent = getInitials(visitor.fullName);
      $("drawerContact").textContent = visitor.contact || "—";
      $("drawerAddress").textContent = visitor.address || "—";
      $("drawerPerson").textContent = visitor.personToVisit || "—";
      $("drawerPurpose").textContent = [visitor.purposeCategory, visitor.otherPurposeSpecific].filter(Boolean).join(" — ") || "—";
      $("drawerTimeIn").textContent = visitor.time || "—";
      $("drawerDate").textContent = visitor.date || "—";
      $("drawerTimeOut").textContent = visitor.timeOut || "Still Inside";

      const inside = isInside(visitor);
      const badge = $("drawerStatusBadge");
      badge.textContent = inside ? "In Building" : "Departed";
      badge.className = `badge-status ${inside ? "success" : "info"}`;

      els.toggleCheckoutBtn.innerHTML = inside ? '<i data-lucide="log-out"></i> Log Departure' : '<i data-lucide="rotate-ccw"></i> Re-open Visit';
      M.openModal('detailDrawer');M.renderIcons();
    }
    function closeDrawer(){if(changing)return;M.closeModal('detailDrawer');selectedVisitor=null;}

    function updateVisitorNotesCount() {
      if (!els.visitorNotesCount || !els.otherPurposeSpecific) return;
      els.visitorNotesCount.textContent = `${els.otherPurposeSpecific.value.length} / 300`;
    }

    function setVisitorSaveBusy(busy) {
      if (!els.saveVisitorSubmitBtn) return;
      els.saveVisitorSubmitBtn.disabled = Boolean(busy);
      if (els.saveVisitorSubmitText) {
        els.saveVisitorSubmitText.textContent = busy ? "Saving..." : "Save Record";
      }
      const iconName = busy ? "loader-2" : "save";
      els.saveVisitorSubmitBtn.querySelector("svg")?.remove();
      els.saveVisitorSubmitBtn.insertAdjacentHTML("afterbegin", `<i data-lucide="${iconName}" class="${busy ? "visitor-save-spinner" : ""}"></i>`);
      M.renderIcons();
    }

    function openVisitorModal(mode, visitor = null) {
      if(saving)return;els.visitorAdminForm.reset();M.closeModal("detailDrawer");
      setVisitorSaveBusy(false);
      if (mode === "edit" && visitor) {
        els.visitorModalTitle.textContent = "Edit Visitor Record";
        els.visitorId.value = visitor._id;
        els.fullName.value = visitor.fullName;
        els.contact.value = visitor.contact;
        els.address.value = visitor.address;
        els.personToVisit.value = visitor.personToVisit;
        els.purposeCategory.value = visitor.purposeCategory;
        els.otherPurposeSpecific.value = visitor.otherPurposeSpecific;
      } else {
        els.visitorModalTitle.textContent = "New Visitor Registration";
        els.visitorId.value = "";
      }
      updateVisitorNotesCount();
      M.openModal('visitorModalBackdrop');els.fullName?.focus({preventScroll:true});
    }
    function closeVisitorModal(){if(saving)return;M.closeModal('visitorModalBackdrop');setVisitorSaveBusy(false);}

    function applySavedVisitor(saved){
      const row=normalizeVisitor(saved),index=visitors.findIndex(v=>String(v._id)===String(row._id));if(index>=0)visitors[index]=row;else visitors.unshift(row);
      const cache=M.storage.get('pgenro_visitors',[]),rows=Array.isArray(cache)?cache:[];M.storage.set('pgenro_visitors',[saved,...rows.filter(r=>String(r.id)!==String(saved.id))]);M.observeRecords('visitors',visitors.map(v=>({id:v._id})));render();
    }
    async function saveVisitor(event) {
      event.preventDefault();
      if(saving||!els.visitorAdminForm.reportValidity())return;if(!online){toast("Refresh successfully before changing visitor records.","error");return;}
      const existingId = els.visitorId.value.trim();
      const fullName = els.fullName.value.trim();
      const contact = els.contact.value.trim();
      const address = els.address.value.trim();
      const personToVisit = els.personToVisit.value.trim();
      const purposeCategory = els.purposeCategory.value;
      const otherPurposeSpecific = els.otherPurposeSpecific.value.trim();

      if (!fullName || !contact || !address || !personToVisit || !purposeCategory) {
        toast("Please fill in all required fields.");
        return;
      }

      const payload = {
        full_name: fullName,
        contact,
        address,
        person_to_visit: personToVisit,
        purpose_category: purposeCategory,
        other_purpose_specific: otherPurposeSpecific
      };

      saving=true;els.visitorModalBackdrop.dataset.busy="true";setVisitorSaveBusy(true);
      try {
        if (existingId) {
          applySavedVisitor(await M.write(VISITORS_TABLE,payload,existingId));
          logSystemAudit("UPDATE_VISITOR", `Updated visitor details for ${fullName}`);
          toast("Record updated successfully.");
        } else {
          payload.visit_date = getLocalDateKey();
          payload.time_in = new Date().toISOString();
          payload.status = "inside";
          applySavedVisitor(await M.write(VISITORS_TABLE,payload));
          logSystemAudit("ADD_VISITOR", `Registered new visitor pass for ${fullName}`);
          toast("Visitor registered successfully.");
        }
        saving=false;els.visitorModalBackdrop.dataset.busy="false";closeVisitorModal();
        loadVisitors({ silent: true });
      } catch (err) {
        console.error("Save failed:", err);
        toast("Error saving record: " + (err.message || "Network issue"));
      } finally {
        saving=false;els.visitorModalBackdrop.dataset.busy="false";
        setVisitorSaveBusy(false);
      }
    }

    async function toggleCheckout() {
      if (!selectedVisitor?._id||changing) return;if(!online){toast("Refresh before changing visitor records.","error");return;}
      const inside = isInside(selectedVisitor);
      const patch = {
        status: inside ? "completed" : "inside",
        time_out: inside ? new Date().toISOString() : null
      };

      try {
        applySavedVisitor(await M.write(VISITORS_TABLE,patch,selectedVisitor._id));
        logSystemAudit(inside ? "VISITOR_DEPARTURE" : "VISITOR_REOPEN", `Marked ${selectedVisitor.fullName} as ${inside ? "Departed" : "Inside"}`);
        toast(inside ? "Departure logged." : "Visit reopened.");
        changing=false;els.detailDrawer.dataset.busy="false";closeDrawer();
        loadVisitors({ silent: true });
      } catch (err) {
        toast("Status change failed: " + err.message,"error");
      }finally{changing=false;els.detailDrawer.dataset.busy="false";}
    }

    async function deleteVisitor() {
      if (!selectedVisitor?._id||changing) return;if(!online){toast("Refresh before changing visitor records.","error");return;}
      if (!confirm(`Delete visitor record for ${selectedVisitor.fullName}?`)) return;

      changing=true;els.detailDrawer.dataset.busy="true";
      try {
        await M.remove(VISITORS_TABLE,[selectedVisitor._id]);visitors=visitors.filter(v=>String(v._id)!==String(selectedVisitor._id));M.storage.set('pgenro_visitors',M.storage.get('pgenro_visitors',[]).filter(v=>String(v.id)!==String(selectedVisitor._id)));render();
        logSystemAudit("DELETE_VISITOR", `Removed visitor record for ${selectedVisitor.fullName}`);
        toast("Visitor record removed.");
        changing=false;els.detailDrawer.dataset.busy="false";closeDrawer();
        loadVisitors({ silent: true });
      } catch (err) {
        toast("Delete failed: " + err.message,"error");
      }finally{changing=false;els.detailDrawer.dataset.busy="false";}
    }

    function printVisitorPass() {
      if (!selectedVisitor) return;

      const code = selectedVisitor._id ? `VIS-${String(selectedVisitor._id).replace(/-/g, "").slice(0, 8).toUpperCase()}` : "VISITOR";

      let printBox = document.getElementById("printableVisitorPass");
      if (!printBox) {
        printBox = document.createElement("div");
        printBox.id = "printableVisitorPass";
        document.body.appendChild(printBox);
      }

      printBox.innerHTML = `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 20px auto; border: 2px solid #059669; padding: 24px; border-radius: 8px;">
          <div style="text-align: center; border-bottom: 2px solid #059669; padding-bottom: 12px; margin-bottom: 14px;">
            <h2 style="margin: 0; font-size: 16px; color: #064e3b; text-transform: uppercase;">Provincial Government Environment and Natural Resources Office</h2>
            <h3 style="margin: 4px 0 0; font-size: 13px; color: #059669;">VISITOR GATE PASS</h3>
            <span style="display: block; font-family: monospace; font-size: 12px; margin-top: 4px; font-weight: bold;">${escapeHTML(code)}</span>
          </div>

          <table style="width: 100%; border-collapse: collapse; font-size: 12px; line-height: 1.6;">
            <tr><td style="width: 35%; font-weight: bold;">Visitor Name:</td><td>${escapeHTML(selectedVisitor.fullName)}</td></tr>
            <tr><td style="font-weight: bold;">Contact No:</td><td>${escapeHTML(selectedVisitor.contact)}</td></tr>
            <tr><td style="font-weight: bold;">Affiliation / Origin:</td><td>${escapeHTML(selectedVisitor.address)}</td></tr>
            <tr><td style="font-weight: bold;">Host Office:</td><td>${escapeHTML(selectedVisitor.personToVisit)}</td></tr>
            <tr><td style="font-weight: bold;">Purpose:</td><td>${escapeHTML(selectedVisitor.purposeCategory)}</td></tr>
            <tr><td style="font-weight: bold;">Date & Time In:</td><td>${escapeHTML(selectedVisitor.date)} — ${escapeHTML(selectedVisitor.time)}</td></tr>
          </table>

          <div style="margin-top: 28px; display: flex; justify-content: space-between; font-size: 11px;">
            <div style="text-align: center; width: 45%;">
              <div style="border-bottom: 1px solid #000; height: 35px;"></div>
              <span style="display: block; margin-top: 4px;">Visitor's Signature</span>
            </div>
            <div style="text-align: center; width: 45%;">
              <div style="border-bottom: 1px solid #000; height: 35px;"></div>
              <span style="display: block; margin-top: 4px;">Duty Security Officer</span>
            </div>
          </div>
        </div>
      `;

      M.audit("PRINT_VISITOR",`Visitor pass ${selectedVisitor.fullName}`);window.addEventListener("afterprint",()=>document.getElementById("printableVisitorPass")?.remove(),{once:true});window.print();
    }

    function exportCsv() {
      const list = getFilteredVisitors();
      if (!list.length) return toast("No records match the current filter.");
      const rows = [
        ["Full Name", "Contact", "Address", "Host / Department", "Purpose", "Date", "Status"],
        ...list.map((v) => [v.fullName, v.contact, v.address, v.personToVisit, v.purposeCategory, v.date, isInside(v) ? "Inside" : "Completed"])
      ];
      M.csv(rows,`PGENRO_Visitors_${M.today()}.csv`);
      toast(`Exported ${list.length} records.`);
    }

    async function loadVisitors({ silent = false } = {}) {
      if(syncInFlight){syncQueued=true;return;}
      syncInFlight = true;

      const refreshOriginal = els.refreshBtn?.innerHTML || "";
      if (!silent && els.refreshBtn) {
        els.refreshBtn.disabled = true;
        els.refreshBtn.innerHTML = '<i data-lucide="loader-2" class="spin-icon"></i><span>Syncing</span>';
        M.renderIcons();
      }

      try {
        if (!supabaseClient) throw new Error("Supabase client unavailable");
        const data=await M.read(VISITORS_TABLE);

        visitors = (data || []).map(normalizeVisitor);M.storage.set("pgenro_visitors",data);M.observeRecords("visitors",data);
        if(els.purposeFilter){const chosen=els.purposeFilter.value,choices=new Set([...els.purposeFilter.options].map(o=>o.value).filter(v=>v!=='all'));visitors.forEach(v=>{if(v.purposeCategory)choices.add(v.purposeCategory);});[...els.purposeCategory.options].forEach(o=>{if(o.value)choices.add(o.value);});els.purposeFilter.innerHTML='<option value="all">All Purpose Categories</option>'+[...choices].sort().map(v=>`<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join('');els.purposeFilter.value=choices.has(chosen)?chosen:'all';}
        setDatabaseStatus(true);
        render();
        if (!silent) toast("Records synchronized.");
      } catch (err) {
        console.warn("Visitors sync fallback:", err);
        setDatabaseStatus(false);const cache=M.storage.get("pgenro_visitors",[]);if(!visitors.length&&Array.isArray(cache))visitors=cache.map(normalizeVisitor);render();if(!silent)toast(err.message||"Visitors could not refresh.","error");
      } finally {
        syncInFlight=false;if(syncQueued){syncQueued=false;queueMicrotask(()=>loadVisitors({silent:true}));}
        if (!silent && els.refreshBtn) {
          els.refreshBtn.disabled = false;
          els.refreshBtn.innerHTML = refreshOriginal || '<i data-lucide="refresh-cw"></i><span>Sync Data</span>';
          M.renderIcons();
        }
      }
    }

    // Filtering & Dialog Events
    els.visitorSearch?.addEventListener("input", () => {if(els.globalSearchInput)els.globalSearchInput.value=els.visitorSearch.value;currentPage = 1; render(); });
    els.globalSearchInput?.addEventListener("input", (e) => {
      if (els.visitorSearch) els.visitorSearch.value = e.target.value;
      currentPage = 1;
      render();
    });

    els.purposeFilter?.addEventListener("change", () => { currentPage = 1; render(); });
    els.statusFilter?.addEventListener("change", () => { currentPage = 1; render(); });
    els.resetFiltersBtn?.addEventListener("click", () => {
      if (els.visitorSearch) els.visitorSearch.value = "";
      if (els.globalSearchInput) els.globalSearchInput.value = "";
      if (els.purposeFilter) els.purposeFilter.value = "all";
      if (els.statusFilter) els.statusFilter.value = "all";
      activeDateFilter = "all";
      document.querySelectorAll(".date-chip").forEach((c) => c.classList.toggle("active", c.dataset.range === "all"));
      currentPage = 1;
      render();
      toast("Filters reset.");
    });

    document.querySelectorAll(".date-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        document.querySelectorAll(".date-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        activeDateFilter = chip.dataset.range || "all";
        currentPage = 1;
        render();
      });
    });

    els.addVisitorBtn?.addEventListener("click", () => openVisitorModal("add"));
    els.closeDrawerBtn?.addEventListener("click", closeDrawer);
    els.closeVisitorModalBtn?.addEventListener("click", closeVisitorModal);
    els.cancelVisitorModalBtn?.addEventListener("click", closeVisitorModal);
    els.visitorAdminForm?.addEventListener("submit", saveVisitor);
    els.otherPurposeSpecific?.addEventListener("input", updateVisitorNotesCount);
    els.visitorModalBackdrop?.addEventListener("click", (event) => {
      if (event.target === els.visitorModalBackdrop) closeVisitorModal();
    });
    els.toggleCheckoutBtn?.addEventListener("click", toggleCheckout);
    els.deleteVisitorBtn?.addEventListener("click", deleteVisitor);
    els.printPassBtn?.addEventListener("click", printVisitorPass);
    els.exportCsvBtn?.addEventListener("click", exportCsv);
    els.refreshBtn?.addEventListener("click", () => loadVisitors({ silent: false }));
    els.editVisitorBtn?.addEventListener("click", () => selectedVisitor && openVisitorModal("edit", selectedVisitor));
    els.prevPageBtn?.addEventListener("click", () => { if (currentPage > 1) { currentPage--; render(); } });
    els.nextPageBtn?.addEventListener("click", () => { currentPage++; render(); });
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeDrawer();closeVisitorModal();}});
    // Start sync and initial load
    loadVisitors({ silent: true });
    if(supabaseClient)channel=supabaseClient.channel('admin-visitors').on('postgres_changes',{event:'*',schema:'public',table:VISITORS_TABLE},()=>loadVisitors({silent:true})).subscribe();
    window.addEventListener('pagehide',(event)=>{if(event.persisted)return;clearInterval(syncTimer);if(channel)supabaseClient?.removeChannel(channel);});
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

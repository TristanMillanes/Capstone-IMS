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
    const inline=$('communicationInlineNotice');
    if(inline&&$('encodingModal')?.classList.contains('open')){inline.textContent=message;inline.dataset.type=type;inline.hidden=false;return;}
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
  const communicationTypeKeys = ['type','communicationType','communication_type','direction','recordType','record_type','commType','comm_type'];
  const communicationFormats = new Map();
  let preferredCommunicationFormat = 'title';
  const normalizeCommunicationType = value => /^(?:incoming|outgoing)$/i.test(String(value ?? '').trim())
    ? (String(value).trim().toLowerCase()==='incoming'?'Incoming':'Outgoing') : '';
  function formatCommunicationType(value,format){
    const type=normalizeCommunicationType(value);
    return format==='lower'?type.toLowerCase():format==='upper'?type.toUpperCase():type;
  }
  function rememberCommunicationFormats(rows){
    for(const row of rows)for(const key of communicationTypeKeys){
      if(!normalizeCommunicationType(row[key]))continue;
      const raw=String(row[key]).trim(),format=raw===raw.toLowerCase()?'lower':raw===raw.toUpperCase()?'upper':'title';
      if(!communicationFormats.has(key))communicationFormats.set(key,format);
    }
    preferredCommunicationFormat=communicationFormats.get('type')||communicationFormats.values().next().value||preferredCommunicationFormat;
  }
  const client = () => window.pgenroSupabase || window.PGENRO_DB?.client || null;
  // Presentation starts independently; database actions still wait for the gateway.
  let backendPromise, backendAnnounced = false;
  function announceBackend() {
    if (!backendAnnounced && client()) { backendAnnounced = true; queueMicrotask(() => window.dispatchEvent(new Event('pgenro:backend-ready'))); }
  }
  function waitForBackend() {
    if (client()) { announceBackend(); return Promise.resolve('live'); }
    const gateway = document.getElementById('communicationSupabaseGateway');
    if (!gateway) return Promise.resolve('local');
    if (backendPromise) return backendPromise;
    backendPromise = new Promise(resolve => {
      let settled = false, poll;
      const finish = state => { if (!settled) { settled = true; clearTimeout(poll); clearTimeout(deadline); resolve(state); } };
      const check = () => {
        if (client()) {
          finish('live');
          announceBackend();
        } else if (gateway.dataset.loadState === 'error') finish('unavailable');
        else if (!settled) { clearTimeout(poll); poll = setTimeout(check, 100); }
      };
      const deadline = setTimeout(() => finish('unavailable'), 8000);
      gateway.addEventListener('load', () => { check(); setTimeout(check, 100); });
      gateway.addEventListener('error', check);
      window.addEventListener('pgenro:backend-loaded', check);
      window.addEventListener('focus', check);
      window.addEventListener('pagehide', event => { if (!event.persisted) finish('unavailable'); });
      check();
    });
    return backendPromise;
  }
  const unwrap = (row,table=null) => {
    if(!row.data||typeof row.data!=='object'||Array.isArray(row.data))return row;
    const base={...row.data,id:row.id,created_at:row.created_at ?? row.data.created_at,updated_at:row.updated_at ?? row.data.updated_at};
    if(table!=='communications')return base;
    // Hybrid tables retain older records in real columns. Read them alongside
    // JSON, including the control number returned by the database trigger.
    const {data,...columns}=row,out={...columns,...base};
    const names={type:'type',controlNo:'control_no',docType:'document_type',date:'date',status:'status',office:'office',subject:'subject',actionTaken:'action_taken',remarks:'remarks',ocrText:'ocr_text',fileName:'file_name',fileSize:'file_size',fileUrl:'drive_link'};
    for(const[key,column]of Object.entries(names))if(row[column]!=null&&(out[key]==null||key==='type'||key==='controlNo'))out[key]=row[column];
    return out;
  };
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
    const result=rows.map(row=>unwrap(row,table));
    if(table==='communications')rememberCommunicationFormats(result);
    return result;
  }
  function communicationData(payload,format=null) {
    const out = {...payload};
    // JSON records from previous releases use different direction keys.
    // Keep all supported keys synchronized; document and MIME types stay separate.
    const raw = communicationTypeKeys.map(key => normalizeCommunicationType(out[key])).find(Boolean);
    if (raw) {
      for (const key of communicationTypeKeys) out[key] = formatCommunicationType(raw,format||communicationFormats.get(key)||preferredCommunicationFormat);
    }
    const canonical = {
      controlNo:['controlNo','control_no','control_number'],
      docType:['docType','documentType','document_type','doc_type'],
      date:['date','receivedDate','date_received'],
      office:['office','receivedFrom','received_from','recipient_office'],
      subject:['subject','particulars'],actionTaken:['actionTaken','action_taken'],
      ocrText:['ocrText','ocr_text'],fileName:['fileName','file_name'],
      fileType:['fileType','file_type'],attachmentId:['attachmentId','attachment_id'],
      fileUrl:['fileUrl','file_url','attachment_url','driveLink','drive_link']
    };
    for (const [key,names] of Object.entries(canonical)) {
      const name = names.find(name => Object.hasOwn(out,name));
      if (name) out[key] = out[name];
    }
    return out;
  }
  async function write(table, payload, id = null, options = {}) {
    await window.PGENRO_API?.requireAdmin?.();
    const sb = client(); if (!sb) throw new Error('Database client is unavailable.');
    if (table === 'communications' && wrapped.get(table)) payload = communicationData(payload);
    let body = wrapped.get(table) ? {data:payload} : payload;
    if (id && wrapped.get(table)) {
      const existing = await sb.from(table).select('data').eq('id',id).limit(1);
      if (existing.error) throw existing.error;
      if (!existing.data?.length) throw new Error('This record is no longer available. Refresh before saving.');
      body = {data:{...(existing.data[0].data || {}), ...payload}};
    }
    if (table === 'communications' && wrapped.get(table)) body.data = communicationData(body.data);
    if (!id && wrapped.get(table)) body = {id:uuid(), ...body};
    if (!id && options.insertId) body = {...body,id:options.insertId};
    if(table==='communications'&&!wrapped.get(table))body=Object.fromEntries(Object.entries(body).map(([key,value])=>
      [key,communicationTypeKeys.includes(key)&&normalizeCommunicationType(value)?formatCommunicationType(value,communicationFormats.get(key)||preferredCommunicationFormat):value]));
    let response;
    const attempted=new Set();
    for(const format of [null,'lower','title','upper']){
      if(table!=='communications'&&attempted.size)break;
      const data=wrapped.get(table)?body.data:body;
      if(format){
        if(wrapped.get(table))body={...body,data:communicationData(data,format)};
        else body=Object.fromEntries(Object.entries(body).map(([key,value])=>[key,communicationTypeKeys.includes(key)&&normalizeCommunicationType(value)?formatCommunicationType(value,format):value]));
      }
      const current=wrapped.get(table)?body.data:body;
      const signature=JSON.stringify(communicationTypeKeys.map(key=>current[key]));
      if(attempted.has(signature))continue;
      attempted.add(signature);
      response=await (id ? sb.from(table).update(body).eq('id',id) : sb.from(table).insert(body)).select('*');
      if(!response.error){
        if(table==='communications'){
          for(const key of communicationTypeKeys)if(normalizeCommunicationType(current[key])){
            const value=String(current[key]);communicationFormats.set(key,value===value.toLowerCase()?'lower':value===value.toUpperCase()?'upper':'title');
          }
          rememberCommunicationFormats([]);
        }
        break;
      }
      // Only a confirmed direction validation rejection can try another casing.
      // Network, permissions, duplicate numbers and other errors are returned unchanged.
      const error=response.error,detail=[error.message,error.details,error.hint].filter(Boolean).join(' ');
      const directionRejected=['22P02','23514','P0001','22023'].includes(error.code)&&
        /(?:communication[s]?|comm|record)[_\s-]*type|(?:communication[s]?[_\s-]*)?direction|invalid[^.]*incoming[^.]*outgoing/i.test(detail);
      if(table!=='communications'||!directionRejected)throw error;
    }
    if(response?.error)throw response.error;
    if (!response.data?.length) throw new Error('The record was not saved or is not accessible. Check your database permissions.');
    return unwrap(response.data[0],table);
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
    renderIcons(); observeIcons(); renderNotifications();
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
      try { if(await waitForBackend()==='unavailable')throw new Error('Database connection unavailable.');if(client()){const result=await client().auth.signOut();if(result?.error)throw result.error;} try{localStorage.removeItem('pgenro_current_user');sessionStorage.removeItem('pgenro_current_user');}catch{} location.href='../User/login.html'; }catch{toast('Sign out failed. Please try again.','error');}
    });
  }
  // ICON_MAP is inserted while packaging, from the existing local Lucide subset.
  const icons = {"activity":[["path",{"d":"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"}]],"alert-circle":[["circle",{"cx":"12","cy":"12","r":"10"}],["line",{"x1":"12","x2":"12","y1":"8","y2":"12"}],["line",{"x1":"12","x2":"12.01","y1":"16","y2":"16"}]],"archive":[["rect",{"width":"20","height":"5","x":"2","y":"3","rx":"1"}],["path",{"d":"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"}],["path",{"d":"M10 12h4"}]],"arrow-down-left":[["path",{"d":"M17 7 7 17"}],["path",{"d":"M17 17H7V7"}]],"arrow-up-right":[["path",{"d":"M7 7h10v10"}],["path",{"d":"M7 17 17 7"}]],"badge":[["path",{"d":"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"}]],"briefcase":[["path",{"d":"M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"}],["rect",{"width":"20","height":"14","x":"2","y":"6","rx":"2"}]],"check":[["path",{"d":"M20 6 9 17l-5-5"}]],"check-circle-2":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m9 12 2 2 4-4"}]],"clock":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 6v6l4 2"}]],"cloud-upload":[["path",{"d":"M12 13v8"}],["path",{"d":"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"}],["path",{"d":"m8 17 4-4 4 4"}]],"contact":[["path",{"d":"M16 2v2"}],["path",{"d":"M7 22v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"}],["path",{"d":"M8 2v2"}],["circle",{"cx":"12","cy":"11","r":"3"}],["rect",{"x":"3","y":"4","width":"18","height":"18","rx":"2"}]],"database":[["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3"}],["path",{"d":"M3 5V19A9 3 0 0 0 21 19V5"}],["path",{"d":"M3 12A9 3 0 0 0 21 12"}]],"database-backup":[["ellipse",{"cx":"12","cy":"5","rx":"9","ry":"3"}],["path",{"d":"M3 12a9 3 0 0 0 5 2.69"}],["path",{"d":"M21 9.3V5"}],["path",{"d":"M3 5v14a9 3 0 0 0 6.47 2.88"}],["path",{"d":"M12 12v4h4"}],["path",{"d":"M13 20a5 5 0 0 0 9-3 4.5 4.5 0 0 0-4.5-4.5c-1.33 0-2.54.54-3.41 1.41L12 16"}]],"download":[["path",{"d":"M12 15V3"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["path",{"d":"m7 10 5 5 5-5"}]],"external-link":[["path",{"d":"M15 3h6v6"}],["path",{"d":"M10 14 21 3"}],["path",{"d":"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"}]],"eye":[["path",{"d":"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"file-check-2":[["path",{"d":"M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v6"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"m14 20 2 2 4-4"}]],"file-search":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["circle",{"cx":"11.5","cy":"14.5","r":"2.5"}],["path",{"d":"M13.3 16.3 15 18"}]],"file-text":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M10 9H8"}],["path",{"d":"M16 13H8"}],["path",{"d":"M16 17H8"}]],"file-up":[["path",{"d":"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"}],["path",{"d":"M14 2v5a1 1 0 0 0 1 1h5"}],["path",{"d":"M12 12v6"}],["path",{"d":"m15 15-3-3-3 3"}]],"files":[["path",{"d":"M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"}],["path",{"d":"M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z"}],["path",{"d":"M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1"}]],"folder-open":[["path",{"d":"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"}]],"info":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 16v-4"}],["path",{"d":"M12 8h.01"}]],"layers":[["path",{"d":"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"}],["path",{"d":"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"}],["path",{"d":"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"}]],"leaf":[["path",{"d":"M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"}],["path",{"d":"M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"}]],"list-checks":[["path",{"d":"M13 5h8"}],["path",{"d":"M13 12h8"}],["path",{"d":"M13 19h8"}],["path",{"d":"m3 17 2 2 4-4"}],["path",{"d":"m3 7 2 2 4-4"}]],"menu":[["path",{"d":"M4 5h16"}],["path",{"d":"M4 12h16"}],["path",{"d":"M4 19h16"}]],"panel-left-close":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M9 3v18"}],["path",{"d":"m16 15-3-3 3-3"}]],"panel-left-open":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M9 3v18"}],["path",{"d":"m14 9 3 3-3 3"}]],"paperclip":[["path",{"d":"m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"}]],"pencil":[["path",{"d":"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}],["path",{"d":"m15 5 4 4"}]],"plus-circle":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M8 12h8"}],["path",{"d":"M12 8v8"}]],"refresh-cw":[["path",{"d":"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{"d":"M21 3v5h-5"}],["path",{"d":"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{"d":"M8 16H3v5"}]],"rows-3":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M21 9H3"}],["path",{"d":"M21 15H3"}]],"save":[["path",{"d":"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"}],["path",{"d":"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"}],["path",{"d":"M7 3v4a1 1 0 0 0 1 1h7"}]],"scan-text":[["path",{"d":"M3 7V5a2 2 0 0 1 2-2h2"}],["path",{"d":"M17 3h2a2 2 0 0 1 2 2v2"}],["path",{"d":"M21 17v2a2 2 0 0 1-2 2h-2"}],["path",{"d":"M7 21H5a2 2 0 0 1-2-2v-2"}],["path",{"d":"M7 8h8"}],["path",{"d":"M7 12h10"}],["path",{"d":"M7 16h6"}]],"search":[["path",{"d":"m21 21-4.34-4.34"}],["circle",{"cx":"11","cy":"11","r":"8"}]],"send":[["path",{"d":"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"}],["path",{"d":"m21.854 2.147-10.94 10.939"}]],"settings":[["path",{"d":"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"shield-alert":[["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{"d":"M12 8v4"}],["path",{"d":"M12 16h.01"}]],"shield-check":[["path",{"d":"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}],["path",{"d":"m9 12 2 2 4-4"}]],"table":[["path",{"d":"M12 3v18"}],["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M3 9h18"}],["path",{"d":"M3 15h18"}]],"tag":[["path",{"d":"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"}],["circle",{"cx":"7.5","cy":"7.5","r":".5","fill":"currentColor"}]],"trash-2":[["path",{"d":"M10 11v6"}],["path",{"d":"M14 11v6"}],["path",{"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{"d":"M3 6h18"}],["path",{"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]],"upload":[["path",{"d":"M12 3v12"}],["path",{"d":"m17 8-5-5-5 5"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}]],"user":[["path",{"d":"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"}],["circle",{"cx":"12","cy":"7","r":"4"}]],"user-plus":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}],["line",{"x1":"19","x2":"19","y1":"8","y2":"14"}],["line",{"x1":"22","x2":"16","y1":"11","y2":"11"}]],"user-round":[["circle",{"cx":"12","cy":"8","r":"5"}],["path",{"d":"M20 21a8 8 0 0 0-16 0"}]],"x":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],"sun":[["circle",{"cx":"12","cy":"12","r":"4"}],["path",{"d":"M12 2v2"}],["path",{"d":"M12 20v2"}],["path",{"d":"m4.93 4.93 1.41 1.41"}],["path",{"d":"m17.66 17.66 1.41 1.41"}],["path",{"d":"M2 12h2"}],["path",{"d":"M20 12h2"}],["path",{"d":"m6.34 17.66-1.41 1.41"}],["path",{"d":"m19.07 4.93-1.41 1.41"}]],"moon":[["path",{"d":"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"}]],"columns-3":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M9 3v18"}],["path",{"d":"M15 3v18"}]],"inbox":[["polyline",{"points":"22 12 16 12 14 15 10 15 8 12 2 12"}],["path",{"d":"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"}]]};
  const aliases = {'eye':'search','pencil':'file-text','save':'file-check-2','cloud-upload':'file-up','plus-circle':'user-plus','database':'database-backup','hash':'file-text','files':'file-text','folder-open':'briefcase','file-search':'search','scan-text':'file-text','paperclip':'file-text','trash':'trash-2','shield-check':'shield-alert','calendar-days':'calendar','clock-3':'clock','contact':'user-round','building-2':'briefcase','printer':'file-text','file-spreadsheet':'file-text'};
  const renderedIcons = new WeakMap();
  const iconSelector = 'i[data-lucide],span[data-lucide],svg[data-lucide]';
  function renderIcons(root = document, options = {}) {
    if (!root?.querySelectorAll) root = document;
    const elements = [...(root.matches?.(iconSelector) ? [root] : []), ...root.querySelectorAll(iconSelector)];
    for (const el of elements) {
      const name = String(el.getAttribute('data-lucide') || '').trim();
      if (renderedIcons.get(el) === name && el.childElementCount && !options.attrs) continue;
      const nodes = icons[name] || icons[aliases[name]] || icons['file-text'];
      const isSvg = el.namespaceURI === 'http://www.w3.org/2000/svg' && el.localName === 'svg';
      const svg = isSvg ? el : document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const original = Object.fromEntries([...el.attributes].map(attr => [attr.name, attr.value]));
      const attrs = { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', ...options.attrs, ...original };
      // Keep IDs, data attributes, labels and dimensions used by other controls.
      if ((original['aria-label'] || original['aria-labelledby']) && !original['aria-hidden']) { delete attrs['aria-hidden']; attrs.role ||= 'img'; }
      for (const [key, value] of Object.entries(attrs)) svg.setAttribute(key, value);
      const classes = String(original.class || '').split(/\s+/).filter(value => value && value !== 'lucide' && !/^lucide-/.test(value));
      svg.setAttribute('class', ['lucide', 'lucide-' + name, ...classes, options.attrs?.class || ''].filter(Boolean).join(' '));
      svg.setAttribute('data-lucide', name);
      svg.replaceChildren();
      for (const [tag, attributes] of nodes) {
        const node = document.createElementNS(svg.namespaceURI, tag);
        for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
        svg.append(node);
      }
      renderedIcons.set(svg, name);
      if (!isSvg) el.replaceWith(svg);
    }
  }
  let iconObserver;
  function observeIcons() {
    if (iconObserver || !document.body || typeof MutationObserver !== 'function') return;
    iconObserver = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') renderIcons(record.target);
        else {
          if (record.target.matches?.(iconSelector) && !record.target.childElementCount) renderIcons(record.target);
          for (const node of record.addedNodes) if (node.nodeType === 1) renderIcons(node);
        }
      }
    });
    iconObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-lucide'] });
  }
  // Older page scripts can still call lucide.createIcons without a CDN dependency.
  window.lucide ||= {};
  window.lucide.createIcons ||= (options = {}) => renderIcons(options.root || document, options);
  const canStartAction = () => !document.querySelector('.modal-overlay.open[data-busy="true"],.modal-backdrop.open[data-busy="true"],.admin-modal.open[data-busy="true"]');
  window.PGENRO_Module = {canStartAction,normalizeCommunicationType,storage,escape,uuid,today,toast,csv,openModal,closeModal,observeRecords,renderIcons,read,write,remove,audit,client,unwrap,waitForBackend};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initShell,{once:true});else initShell();
})();

(() => {


/* Communications controller: independent from the Employee module. */
(() => {
 'use strict';
 const init = async () => {
  const M = window.PGENRO_Module, $ = id => document.getElementById(id), esc = M.escape;
  const table = 'communications', cacheKey = 'pgenro_communications';
  let records=[], selected=new Set(), page=1, direction='All', editing=null, file=null, attachment=null, previewUrl=null, busy=false, mode='loading', generation=0, ocrGeneration=0;
  const size=10;
  const fieldInputs={type:'typeSelect',controlNo:'controlNoInput',docType:'docTypeSelect',date:'dateInput',office:'officeInput',subject:'subjectInput',actionTaken:'actionTakenInput',remarks:'remarksInput',status:'statusSelect',ocrText:'ocrTextInput'};
  const aliases={type:['type','communicationType','communication_type','direction','recordType','record_type','commType','comm_type'],controlNo:['controlNo','control_no','control_number'],docType:['docType','documentType','document_type','doc_type'],date:['date','receivedDate','date_received'],office:['office','receivedFrom','received_from','recipient_office'],subject:['subject','particulars'],actionTaken:['actionTaken','action_taken'],remarks:['remarks'],status:['status'],ocrText:['ocrText','ocr_text'],fileName:['fileName','file_name'],fileType:['fileType','file_type'],attachmentId:['attachmentId','attachment_id'],fileUrl:['fileUrl','file_url','attachment_url','driveLink','drive_link']};
  const fields={};
  const routeJournalKey='pgenro_memo_routes';
  let routeCommitted=false,remoteAttachmentRemoved=false,detectedMemo=false;
  let memoRegistryRows=M.storage.get('pgenro_office_memos',[]);
  function newMemoControlNo(){const prefix=`MEMO-${new Date().getFullYear()}-`;const highest=Math.max(0,...(Array.isArray(memoRegistryRows)?memoRegistryRows:[]).map(m=>String(m.memoNo||m.controlNo||'').startsWith(prefix)?Number(String(m.memoNo||m.controlNo).slice(prefix.length))||0:0));return prefix+String(highest+1).padStart(5,'0');}
  const commOcrValues=new Map(),commManualFields=new Set();
  const ocrFormIds=new Set([...Object.values(fieldInputs),'memoRecipientInput','memoIssuerInput']);
  const readerClientId=M.uuid().replace(/[^A-Za-z0-9_-]/g,'');
  let ocrTask=null,pendingRead=null,ocrActive=false,lastOcrForm=null;
  const memoInputs={memoNo:'controlNoInput',date:'dateInput',addressedTo:'memoRecipientInput',issuedBy:'memoIssuerInput',subject:'subjectInput'};
  for(const id of ocrFormIds)$(id).addEventListener('input',()=>{delete $(id).dataset.senderSelection;commManualFields.add(id);setFieldState(id,'edited','Your manual edit is kept.');});
  const isMemo=()=>$('docTypeSelect').value==='Memorandum';
  function updateDestination() {
   const memo=isMemo();
   $('documentDestination').textContent=memo?'Save destination: Office Memos. Review the memo details below. Attachments: maximum 10 MB.':'Save destination: Communications.';
   $('documentDestination').classList.toggle('is-memo',memo);
   $('memoRecipientGroup').hidden=$('memoIssuerGroup').hidden=!memo;
   $('memoRecipientInput').required=memo;
   $('officeInput').required=!memo;
   $('officeRequiredMark').hidden=memo;
   $('officeFieldLabel').textContent=memo?'Sender / signatory':$('typeSelect').value==='Outgoing'?'Recipient office':'Received from';
   $('officeInput').placeholder=$('typeSelect').value==='Outgoing'?'Person or office receiving this communication':'Originating person or printed signatory';
   $('dateFieldLabel').textContent=memo?'Date issued':$('typeSelect').value==='Outgoing'?'Date released':'Date received';
   $('controlFieldLabel').textContent=memo?'Memo number':'Control number';
   if(!editing&&memo&&(!$('controlNoInput').value||$('controlNoInput').value===newControlNo()))$('controlNoInput').value=newMemoControlNo();
   if(!memo&&!$('controlNoInput').value)$('controlNoInput').value=newControlNo();
   $('saveRecordBtn').querySelector('span').textContent=routeCommitted?'Finish Move to Office Memos':memo?'Save to Office Memos':editing?'Save Changes':'Save Record';
  }
  $('docTypeSelect').addEventListener('change',()=>{detectedMemo=false;updateDestination();});
/* Sender detection reads every page, including signature blocks. */
function primaryDocumentPages(rawText='') {
 const pages=String(rawText||'').replace(/\r/g,'').split('\f');
 const boundary=pages.findIndex((page,i)=>i&&page.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,6).some(s=>/^(?:ANNEX|APPENDIX|ATTACHMENT|ENCLOSURE)(?:\s+[A-Z0-9IVX.-]+)?\s*[:.â€”-]?$/i.test(s)));
 return boundary<0?pages:pages.slice(0,boundary);
}
const correspondenceClosing=/^(?:(?:very\s+)?(?:yours\s+)?(?:sincerely|respectfully|faithfully|truly)(?:\s+(?:yours|submitted))?|yours\s+(?:truly|faithfully|sincerely|respectfully)|best\s+regards|kind\s+regards|regards|cordially|lubos\s+na\s+gumagalang|sumasainyo|thank\s+you(?:\s+very\s+much)?|for\s+your\s+(?:compliance|information(?:\s+and\s+(?:appropriate\s+action|compliance|guidance))?|guidance(?:\s+and\s+(?:compliance|appropriate\s+action))?))\s*[,.:!]?$/i;
const correspondenceRole=/\b(?:PGDH|PGENRO|ENRO|OIC|officer|director|chief|mayor|governor|administrator|supervisor|manager|secretary|secretariat|convener|convenor|focal\s+person|head|president|chairperson|chairman|coordinator|principal|teacher|engineer|treasurer|representative|proprietor|owner|student|applicant|dean|professor|specialist|staff|assistant|councilor|registrar|librarian|consultant|aide|clerk|accountant|auditor|analyst|superintendent|rector|pastor|lawyer|pangulo|kalihim|tagapangulo|kagawad|kapitan|punong\s+barangay)\b|^[A-Z]{2,}[#?]?(?:[-/][A-Z]{2,})+$/i;
const correspondenceLabel=/^(?:signed(?:\s+by)?|signatory|written\s+by|authored\s+by|issued\s+by|notice\s+from|convened\s+by|submitted\s+by|prepared\s+by|approved\s+by|noted\s+by|certified\s+by|recommending\s+approval|respectfully\s+submitted\s+by|name\s+of\s+(?:sender|signatory)|nilagdaan\s+ni|inihanda\s+ni|inaprubahan\s+ni)\s*[:\uff1a-]?\s*(.*)$/i;
const correspondenceBody=/^(?:DEAR|GREETINGS|SIR|MADAM|MA'AM|TO\s+WHOM|PLEASE|KINDLY|THIS\s+(?:IS|HAS|WILL|REFERS)|WE\s+(?:ARE|WILL|WOULD|REQUEST)|I\s+(?:AM|WOULD)|YOU\s+ARE|THE\s+UNDERSIGNED|IN\s+(?:LIGHT\s+OF|CONNECTION\s+WITH)|PURSUANT\s+TO|FOR\s+YOUR\s+(?:INFORMATION|COMPLIANCE)|SINCERELY|RESPECTFULLY|MAGANDANG\s+(?:ARAW|UMAGA|HAPON)|MAHAL\s+NA|MANGYARING|PAKIUSAP|KAMI\s+(?:AY|PO)|AKO\s+(?:AY|PO)|KAUGNAY|LUBOS\s+NA\s+GUMAGALANG)\b/i;
const tidyCorrespondence=s=>String(s||'').normalize('NFC').replace(/\s+/g,' ').trim();
/* Printed sender detection. Kept inside this module to match OCR.py. */
const senderFields='RECEIVED\\s+FROM|FROM|SENDER|MULA(?:\\s+(?:KAY|SA))?|SENT\\s+BY|ORIGINATOR|ORIGINATED\\s+BY|AUTHOR|AUTHORED\\s+BY|WRITTEN\\s+BY|ISSUED\\s+BY|NOTICE\\s+FROM|CONVENED\\s+BY|TRANSMITTED\\s+BY|ENDORSED\\s+BY|REQUESTED\\s+BY';
const senderField=new RegExp(`^(?:${senderFields})(?:\\s*[:ï¼š;â€“â€”-]\\s*|[ \\t]+)(.*)$`,'i');
const senderBare=new RegExp(`^(?:${senderFields})\\s*[:ï¼š;]?$`,'i');
const senderMark=/^(?:\(\s*(?:s\.?g\.?d\.?|signed|signature)\s*\)|s\.?g\.?d\.?|\/s\/|e[- ]?signed(?:\s+by)?|digitally\s+signed\s+by|signed\s+(?:by|electronically\s+by)|signature\s+(?:over\s+printed\s+name|of)|printed\s+name|pangalan\s+at\s+lagda|nilagdaan\s+ni)\s*[:ï¼š,â€“â€”-]?\s*(.*)$/i;
const senderContact=/^(?:TEL(?:EPHONE)?|PHONE|CONTACT|MOBILE|FAX|WWW\.|E-?MAIL|PAGE\b|REV\.?\s+NO|DOCUMENT\s+CODE)|@|https?:\/\//i;
const senderNonName=/\b(?:national|environment|natural|resources|college|school|university|institute|institution|foundation|corporation|company|association|cooperative|agency|committee|secretariat|team|unit|bureau|commission|authority|republic|province|provincial|municipal|regional|district|government|office|department|division|subject|memorandum|notice|meeting|report|document|reference|control|end|signature|remarks|status|dear|thank|please|request|hereby|attached|enclosed|address|telephone|email|contact|mobile|fax|street|road|avenue|barangay|brgy|city|municipality|center|centre|metro|disaster|risk|management|operations|services|council|members|participants|personnel|regards|copy|cc|page|for|to|from|education|health|planning|workshop|agenda|attendance|schedule|venue|date|time|location|activity|program|event|safety|training|session|annual|quarterly|project|inc|ltd|everyone|see|you|all|welcome|regards|regarding|compliance|information|attention)\b/i;
const senderTitles='Mr|Mrs|Ms|Miss|Dr|Dra|Atty|Attorney|Engr|Engineer|EnP|Hon|Prof|Professor|Rev|Fr|Bro|Sis|Gov|Governor|Mayor|Dir|Director|Capt|Col|Gen|Lt|Major';
const senderCredentials='Ph\\.?D\\.?|Ed\\.?D\\.?|DPA|DMD|M\\.?D\\.?|MBA|MPA|MAEd|MSc|MA|MS|CPA|RN|LPT|RGC|RMT|RPh|RCE|RME|REE|CESO(?:\\s+[IVX]+)?|EnP|LLB|JD';
const senderHeaderLabels='SUBJECT(?:\\s+MATTER)?|SUBJ(?:EC[TIL1]|\\.)?|SUB3ECT|RE|REGARDING|PAKSA|ADDRESSED\\s+TO|MEMORANDUM\\s+FOR|RECIPIENT(?:\\s+OFFICE)?|RECEIVED\\s+FROM|SENDER|FROM|MULA(?:\\s+(?:KAY|SA))?|PARA(?:\\s+(?:KAY|SA))?|ISSUED\\s+BY|ISSUING\\s+OFFICE|ORIGINATING\\s+OFFICE|SIGNATORY|DATE\\s+(?:RECEIVED|RELEASED|ISSUED)|(?:RECEIVED|RELEASED)\\s+DATE|DATED|DATE|TO|T0|FOR|PETSA|THROUGH|THRU|CC|ATTACHMENTS?|ENCLOSURES?|(?:DOCUMENT\\s+)?(?:CONTROL|TRACKING)(?:\\s*(?:NO\\.?|NUMBER|#))?|REFERENCE(?:\\s+(?:NO\\.?|NUMBER))?|REF(?:\\.?\\s*(?:NO\\.?|NUMBER))?|DOCUMENT\\s+TYPE|COMMUNICATION\\s+TYPE|DIRECTION|STATUS|ACTION\\s+TAKEN|DATE\\s+FORWARDED|REMARKS';
const senderHeaderField=new RegExp(`^(${senderHeaderLabels})\\s*(?:[:ï¼š;]|[â€“â€”-])\\s*(.*)$`,'i');
const senderHeaderBare=new RegExp(`^(?:${senderHeaderLabels})\\s*[:ï¼š;]?\\s*$`,'i');
const senderMemoHeading=/^(?:[A-Z][A-Z0-9&./-]*\s+){0,6}(?:MEMORANDUM|MEM0RANDUM|MEMO)(?:\s+(?:ORDER|CIRCULAR))?(?:\s+(?:N[O0]\.?|NUMBER|FOR|SERIES)\b.*|\s*[:#.-]?\s*\d.*)?$/i;
function splitSignatureNameRole(value) {
 const s=tidyCorrespondence(value),paren=s.match(/\s*\(([^()]*)\)\s*$/);
 const labelledRole=s.match(/^([^:ï¼š]{2,65})\s*[:ï¼š]\s*(.+)$/);if(labelledRole&&correspondenceRole.test(labelledRole[1]))return [labelledRole[2].trim(),labelledRole[1].trim()];
 if(paren&&correspondenceRole.test(paren[1]))return [s.slice(0,paren.index).trim(),paren[1].trim()];
 const separators=[...s.matchAll(/\s*[|,]\s*|\s+[-â€“â€”]\s+/g)];
 for(let i=0;i<separators.length;i++){
  const m=separators[i],end=separators[i+1]?.index??s.length,start=m.index+m[0].length;
  if(correspondenceRole.test(s.slice(start,end)))return [s.slice(0,m.index).trim(),s.slice(start).trim()];
 }
 const trailingRole=s.match(/\s+(?:(?:Acting|Assistant|Deputy|Municipal|Provincial|City|Regional|District|Division|Department|Administrative|School|General|Executive|Senior|Junior)\s+)*(?:PGDH(?:[-/][A-Z]+)?|PGENRO|ENRO|OIC|Officer|Director|Chief|Manager|Mayor|Governor|President|Secretary|Chairperson|Chairman|Coordinator|Principal|Superintendent|Engineer|Treasurer|Administrator|Clerk|Aide|Registrar|Librarian|Head)\b/i);
 if(trailingRole&&s.slice(0,trailingRole.index).trim().split(/\s+/).length>=2)return [s.slice(0,trailingRole.index).trim(),s.slice(trailingRole.index).trim()];
 return [s,''];
}
function senderNameKey(value) {
 return String(value).replace(new RegExp(`^(?:(?:${senderTitles})\\.?\\s+)+`,'i'),'').replace(new RegExp(`,?\\s+(?:${senderCredentials})(?:[,\\s].*)?$`,'i'),'').normalize('NFC').toLocaleLowerCase().replace(/[^\p{L}\p{N}_]/gu,'');
}
function senderInkSpacing(value) {
 // Keep readable letters; restore only the boundary before a middle initial.
 return value.replace(/(?<=\p{L})\s*[?*|_~]+\s*(?=[A-Z]\.\s*\p{L})/gu,' ');
}
function printedSenderName(value,contextual=false) {
 let s=tidyCorrespondence(value),mark=s.match(senderMark);if(mark)s=mark[1];
 s=s.replace(/^by\s*:\s*/i,'').replace(/^[|:_\-\s"â€œâ€]+|[|:_\-\s"â€œâ€]+$/g,'');
 [s]=splitSignatureNameRole(s);const inkCleanup=contextual&&senderInkSpacing(s)!==s;if(contextual)s=senderInkSpacing(s);s=s.replace(new RegExp(`^(${senderTitles})\\.(?=\\p{L})`,'iu'),'$1. ');
 if(s.length<4||s.length>120||/[\d@:/;!?()]/.test(s)||correspondenceBody.test(s)||correspondenceClosing.test(s))return '';
 let base=s.replace(new RegExp(`^(?:(?:${senderTitles})\\.?\\s+)+`,'i'),'').replace(new RegExp(`,?\\s+(?:${senderCredentials})(?:[,\\s].*)?$`,'i'),'');
 if(senderNonName.test(base)||correspondenceRole.test(base))return '';
 const words=base.replace(/,/g,' ').trim().split(/\s+/),particles=new Set(['de','del','dela','la','las','los','da','dos','di','du','van','von','bin','al','y','san','santa']),suffixes=new Set(['jr','sr','ii','iii','iv','v']);
 if(words.length<2||words.length>9)return '';
 const particle=w=>particles.has(w.toLocaleLowerCase().replace(/\./g,''))||suffixes.has(w.toLocaleLowerCase().replace(/\./g,''));
 // Mixed lowercase debris is not a reliable printed name. Keep uniformly lowercase labeled names.
 if((!contextual||inkCleanup||base!==base.toLocaleLowerCase())&&words.some(w=>!particle(w)&&!/^\p{Lu}/u.test(w)))return '';
 const lengths=words.map(w=>(w.match(/\p{L}/gu)||[]).length),substantive=words.map((w,i)=>particle(w)?-1:i).filter(i=>i>=0);
 const initials=substantive.length&&lengths[substantive.at(-1)]>1&&substantive.slice(0,-1).every(i=>lengths[i]===1);
 if(substantive.length<2||(substantive.filter(i=>lengths[i]>1).length<2&&!initials)||words.some(w=>!/^[\p{L}.'â€™-]+$/u.test(w)))return '';
 return s.replace(/\.{2,}/g,'.').replace(/(?<=\s)([A-Z])(?=\s)/g,'$1.');
}
function senderEntries(rawText) {
 rawText=String(rawText||'').replace(/^((?:(?:very\s+)?(?:yours\s+)?(?:sincerely|respectfully|faithfully|truly)(?:\s+(?:yours|submitted))?|yours\s+(?:truly|faithfully|sincerely|respectfully)|best\s+regards|kind\s+regards|lubos\s+na\s+gumagalang))[,.:][ \t]+(?=\p{L})/gimu,'$1,\n');
 const entries=[];let excluded=false;
 for(const [p,page] of primaryDocumentPages(rawText).entries()){
  page.split('\n').forEach((raw,line)=>{
   raw=raw.replace(new RegExp(`[ \\t]{2,}(?=(?:${senderHeaderLabels}|${senderFields})\\s*[:ï¼š;])`,'gi'),'\n');
   for(const cell of raw.split('\n')){
    if(/^\s*(?:CC\s*:|COPY\s+(?:TO|FURNISHED)|ANNEX\b|APPENDIX\b|ATTACHMENTS?\s*:|ENCLOSURES?\s*:)/i.test(cell))excluded=true;
    const text=tidyCorrespondence(cell);if(text)entries.push({text,raw:cell.trim(),page:p+1,line:line+1,excluded});
   }
  });
 }
 return entries;
}
function senderBodyLine(value) {
 if(correspondenceClosing.test(value)||senderHeaderField.test(value)||senderHeaderBare.test(value)||correspondenceLabel.test(value)||senderMark.test(value))return false;
 if(correspondenceBody.test(value))return true;
 const words=value.split(/\s+/);return Boolean(((words.length>=6&&/[.!?]$/.test(value))||words.length>=10)&&/\p{Ll}/u.test(value)&&!correspondenceRole.test(value));
}
function scanPrintedSignatories(rawText='',signatureRegion=false) {
 const entries=senderEntries(rawText),candidates=[],consumed=new Set();
 const firstBody=entries.findIndex(e=>senderBodyLine(e.text)),greeting=entries.findIndex(e=>/^DEAR\b|^(?:SIR|MADAM|MA.AM)\s*[:,]/i.test(e.text));
 const compact=entries.length>0&&entries.length<=6&&!entries.some(e=>senderHeaderField.test(e.text)||senderHeaderBare.test(e.text)||correspondenceBody.test(e.text)||parseMemoDate(e.text));
 function roleAt(index,step,page){
  const parts=[];
  for(let j=index;step>0?j<index+step*3:j>index+step*3;j+=step){
   if(j<0||j>=entries.length)break;
   const e=entries[j],s=e.text;
   if(e.page!==page||e.excluded||senderHeaderField.test(s)||senderHeaderBare.test(s)||correspondenceLabel.test(s)||senderMark.test(s)||correspondenceBody.test(s)||correspondenceClosing.test(s)||printedSenderName(s)||senderContact.test(s))break;
   if(s.length>120||s.split(/\s+/).length>18||/\d{3}/.test(s)||(s.split(/\s+/).length>7&&/[.!?]$/.test(s)))break;
   if(step>0)parts.push(s);else parts.unshift(s);if(correspondenceRole.test(parts.join(' ')))return parts.join(' ');
  }
  return '';
 }
 function add(name,role,entry,score,kind,evidence,inkCleanup=false){
  const candidate={name,role,page:entry.page,line:entry.line,score,kind,evidence,inkCleanup,confidence:inkCleanup?'low':score>=100?'high':'medium'},key=senderNameKey(name),prior=candidates.find(c=>senderNameKey(c.name)===key);
  if(!prior)candidates.push(candidate);else if(score>prior.score)Object.assign(prior,candidate);
 }
 for(let i=0;i<entries.length;i++){
  const entry=entries[i];if(entry.excluded||consumed.has(i))continue;
  const s=entry.text,field=entry.raw.match(senderField),bare=senderBare.test(s),label=s.match(correspondenceLabel),mark=s.match(senderMark);
  const explicit=Boolean((field||bare)&&(firstBody<0||i<firstBody||/^(?:AUTHOR|AUTHORED|WRITTEN|ISSUED|NOTICE|CONVENED)\b/i.test(s)));
  let anchor=null;
  for(let j=i-1;j>Math.max(-1,i-7);j--){
   const previous=entries[j];if(previous.page!==entry.page||previous.excluded)break;
   if(correspondenceClosing.test(previous.text)||correspondenceLabel.test(previous.text)||senderMark.test(previous.text)){anchor=previous;break;}
   if(printedSenderName(previous.text)||senderHeaderField.test(previous.text)||correspondenceBody.test(previous.text)||previous.text.split(/\s+/).length>18)break;
  }
  const context=Boolean(explicit||label||mark||anchor);let rawName=explicit?(field?.[1]||''):label?label[1]:mark?mark[1]:entry.raw,index=i;
  if((explicit||label||mark)&&!rawName){index=i+1;if(index>=entries.length||entries[index].page!==entry.page||entries[index].excluded||senderHeaderField.test(entries[index].text)||correspondenceLabel.test(entries[index].text))continue;rawName=entries[index].text;}
  if(explicit&&!printedSenderName(rawName,true)){
   for(let probe=index+1;probe<Math.min(entries.length,index+5);probe++){
    const e=entries[probe];if(e.page!==entry.page||e.excluded||senderHeaderField.test(e.text)||senderHeaderBare.test(e.text)||correspondenceBody.test(e.text)||correspondenceClosing.test(e.text)||correspondenceLabel.test(e.text))break;
    if(printedSenderName(e.text,true)){index=probe;rawName=e.text;break;}
   }
  }
  const columns=rawName.split(/[ \t]{2,}|\s+\|\s+/),columnNames=columns.map(part=>printedSenderName(part,context||signatureRegion||(firstBody>=0&&index>firstBody)));
  if(columns.length>1&&columnNames.every(Boolean)&&(context||signatureRegion||(firstBody>=0&&index>firstBody))){columnNames.forEach((columnName,column)=>add(columnName,'',entries[index],explicit?130:anchor?110:78,explicit?'explicit-sender':'footer-name',s,senderInkSpacing(columns[column])!==columns[column]));if(index!==i)consumed.add(index);continue;}
  const [inlineName,inlineRole]=splitSignatureNameRole(rawName),nearbyRole=inlineRole||roleAt(index+1,1,entry.page)||roleAt(index-1,-1,entry.page);
  let name=printedSenderName(rawName,context||Boolean(nearbyRole)||signatureRegion),nextIndex=index+1;
  if(nextIndex<entries.length&&entries[nextIndex].page===entry.page&&!entries[nextIndex].excluded){
   const surname=entries[nextIndex],shortSurname=surname.text.split(/\s+/).length===1||/^(?:DE|DEL|DELA|VAN|VON)\s+\S+$/i.test(surname.text);
   if(shortSurname&&!correspondenceRole.test(surname.text)&&!senderHeaderField.test(surname.text)&&!correspondenceLabel.test(surname.text)&&inlineName.split(/\s+/).length<=3&&roleAt(nextIndex+1,1,entry.page)){
    const joined=printedSenderName(inlineName+' '+surname.text,context);if(joined){name=joined;nextIndex++;consumed.add(index+1);}
   }
  }
  if(!name)continue;
  const role=inlineRole||roleAt(nextIndex,1,entry.page)||roleAt(index-1,-1,entry.page);
  if(!context){
   if((greeting>=0&&index<greeting)||(firstBody>=0&&index<firstBody))continue;
   const laterHeader=entries.slice(nextIndex,nextIndex+8).some(e=>!e.excluded&&e.page===entry.page&&(senderHeaderField.test(e.text)||senderHeaderBare.test(e.text)||senderMemoHeading.test(e.text)||/^NOTICE\s+OF\s+MEETING\b/i.test(e.text)||parseMemoDate(e.text)));
   if(firstBody<0&&laterHeader)continue;
   const previousField=entries.slice(0,index).reverse().find(e=>e.page===entry.page&&(senderHeaderField.test(e.text)||senderHeaderBare.test(e.text))),fieldIndex=entries.indexOf(previousField);
   if(previousField&&/^(?:TO|T0|FOR|PARA|RECIPIENT|ADDRESSED|SUBJECT|SUBJ|PAKSA|THRU|THROUGH|ATTN|ATTENTION)\b/i.test(previousField.text)&&index-fieldIndex<=8&&!entries.slice(fieldIndex+1,index).some(e=>correspondenceBody.test(e.text)||e.text.split(/\s+/).length>6||(/[.!?]$/.test(e.text)&&!printedSenderName(e.text)))&&entry.line-previousField.line<=index-fieldIndex)continue;
  }
  const meaningfulAfter=entries.slice(nextIndex).filter(e=>!e.excluded&&!senderContact.test(e.text)&&!/^[-_=\s]+$/.test(e.text)),contentBefore=(firstBody>=0&&index>firstBody)||entries.slice(0,index).some(e=>senderHeaderField.test(e.text)||senderHeaderBare.test(e.text));
  let score,kind;
  if(explicit){score=130;kind='explicit-sender';}
  else if(label||(mark&&mark[1])||(anchor&&senderMark.test(anchor.text))){score=120;kind='signature';}
  else if(anchor){score=110;kind='signature';}
  else if(role&&(contentBefore||signatureRegion||compact)){score=90;kind='signature';}
  else if((!meaningfulAfter.length||meaningfulAfter.every(e=>printedSenderName(e.text)))&&(contentBefore||signatureRegion||compact)&&!role){score=78;kind='footer-name';}
  else continue;
  const markerText=label?s:anchor?.text||'';
  if(/^(?:prepared|submitted|respectfully\s+submitted|inihanda)\b/i.test(markerText)){score=85;kind='prepared-by';}
  else if(/^(?:noted|certified|recommending)\b/i.test(markerText)){score=55;kind='supporting';}
  else if(/^(?:approved|inaprubahan)\b/i.test(markerText)){score=65;kind='approval';}
  const inkCleanup=senderInkSpacing(inlineName)!==inlineName,proof=[...new Set([explicit||label||mark?s:anchor?.text||'',inkCleanup?inlineName:name,role].filter(Boolean))].join('\n');
  add(name,role,entries[index],score,kind,proof,inkCleanup);if(index!==i)consumed.add(index);
 }
 candidates.sort((a,b)=>b.score-a.score||a.page-b.page||a.line-b.line);
 const eligible=candidates.filter(c=>c.kind!=='supporting'),primary=eligible.filter(c=>eligible[0].score-c.score<10),selected=primary.length===1?primary[0]:null;
 return {entries,candidates,primary,selected,signatory:selected};
}
function parseCorrespondence(rawText='',signatureRegion=false) {
 const header=parseDocumentHeader(rawText),scan=scanPrintedSignatories(rawText,signatureRegion),selected=scan.selected;
 const received=selected?.name||'',proof=selected?.evidence||'',source=selected?.kind||(scan.primary.length?'ambiguous':'missing'),reasons=[];
 let review=Boolean(selected&&(selected.inkCleanup||['footer-name','prepared-by','approval'].includes(source)||selected.score<90));
 if(selected?.inkCleanup)reasons.push('Signature ink affected the spacing of the printed name. Confirm the name against the document.');
 if(selected&&source==='explicit-sender'&&scan.candidates.some(c=>c.kind==='signature'&&senderNameKey(c.name)!==senderNameKey(received))){review=true;reasons.push('The sender field and a printed signatory name differ. Confirm the originating person.');}
 if(source==='ambiguous')reasons.push('Several possible senders were found. Choose the originating person.');
 else if(!received)reasons.push('No readable sender name was identified. A signature alone cannot establish a personâ€™s name.');
 else if(source==='footer-name')reasons.push('An unlabeled printed name was found. Confirm that this person sent the document.');
 else if(['prepared-by','approval'].includes(source))reasons.push(`A ${source==='prepared-by'?'preparer':'approver'} was found. Confirm the originating person.`);
 let recipient=header.addressedTo;
 if(!recipient){
  const lines=String(rawText).split('\f')[0].split('\n').map(tidyCorrespondence),greeting=lines.findIndex(line=>/^Dear\b|^(?:Sir|Madam|Ma.am)\s*[:,]/i.test(line));
  if(greeting>=0){const block=lines.slice(Math.max(0,greeting-8),greeting),start=block.findIndex(line=>printedSenderName(line));if(start>=0&&block.slice(start+1).some(line=>correspondenceRole.test(line)||/\b(?:OFFICE|DEPARTMENT|DIVISION|UNIVERSITY|COLLEGE|SCHOOL)\b/i.test(line)))recipient=block.slice(start).filter(line=>line&&!/^(?:DATE|SUBJECT|FROM|CONTROL)\s*:/i.test(line)).join(' ');}
 }
 return {signatory:received,signatoryRole:selected?.role||'',signatoryCandidates:scan.candidates,receivedFrom:received,receivedFromSource:source,receivedFromNeedsReview:!received||review,senderConfidence:selected?.confidence||'unknown',senderReviewReasons:reasons,sender:header.sender,recipient,
  issuedBy:received||header.issuedBy,issuedBySource:received?source:undefined,fieldEvidence:{receivedFrom:proof},needsReview:(!received||review)?['receivedFrom']:[]};
}

/* End sender detection. */

/* Memo document parser: identical page-owned code in Communications and Office Memos. */
function parseMemoDocument(rawText='') {
 const labels='SUBJECT MATTER|SUBJECT|SUBJ|PAKSA|RE|ADDRESSED TO|MEMORANDUM FOR|ISSUED BY|ISSUING OFFICE|ORIGINATING OFFICE|SIGNATORY|DATE ISSUED|DATE|DATED|TO|T0|FROM|FOR|THROUGH|THRU|CC|ATTACHMENTS?|REFERENCE|REF|CONTROL NO\\.?|REMARKS';
 const normalize=s=>String(s||'').replace(/\u00a0/g,' ').replace(/[\u2013\u2014\u2212]/g,'-').replace(/[\uff1a]/g,':').replace(/[ \t]+/g,' ').trim();
 const text=String(rawText||'').replace(/\r/g,'').split('\f')[0].replace(/\u00a0/g,' ').replace(/[\uff1a]/g,':');
 const lines=text.replace(new RegExp(`[ \\t]{2,}(?=(?:${labels})\\s*:)`,'gi'),'\n').split('\n').map(normalize);
 const labelPattern=new RegExp(`^(${labels})\\s*(?::|[-])\\s*(.*)$`,'i');
 const bodyLine=/^(?:dear\b|sir\b|madam\b|respectfully\b|please\b|kindly\b|you are\b|this (?:is|memo|memorandum)\b|pursuant\b|in (?:connection|view|compliance)\b|for your (?:information|compliance|guidance)\b|\d+\.\s)/i;
 const header=lines.map((line,index)=>({line,index})).filter(x=>x.line).slice(0,60);
 const boundary=header.findIndex(x=>bodyLine.test(x.line)||/^(?:SUBJECT(?: MATTER)?|SUBJ|PAKSA|RE)\s*[:\-]/i.test(x.line));
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
 for(const [key,names] of Object.entries({addressedTo:'TO|T0|FOR|PARA(?: KAY| SA)?|ADDRESSED TO|MEMORANDUM FOR',issuedBy:'FROM|ISSUED BY|ISSUING OFFICE|ORIGINATING OFFICE|SIGNATORY',subject:'SUBJECT|SUBJECT MATTER|SUBJ|PAKSA|RE'})){
  const result=field(names);fields[key]=result.value;evidence[key]=result.line;
 }
 const dateField=field('DATE|DATE ISSUED|DATED',1);
 if(dateField.value){fields.date=parseMemoDate(dateField.value);evidence.date=dateField.line;if(!fields.date)warnings.push('The printed date is invalid or ambiguous. Enter the date manually.');}
 if(!fields.isMemo)warnings.push('A memorandum heading was not detected. Check the document type.');
 for(const [key,label] of [['memoNo','Memo number'],['date','Issue date'],['addressedTo','Recipient'],['subject','Subject'],['issuedBy','Issuing office']])if(!fields[key])warnings.push(`${label} was not detected.`);
 return fields;
}
function parseMemoDate(value='') {
 const months={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12,enero:1,pebrero:2,marso:3,abril:4,mayo:5,hunyo:6,hulyo:7,agosto:8,setyembre:9,septiyembre:9,oktubre:10,nobyembre:11,disyembre:12};
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
function letterheadOffice(lines) {
 lines=lines.map(line=>String(line).trim()).filter(Boolean);
 const generic=/^(?:OFFICE|DEPARTMENT|BUREAU|DIVISION|COMMISSION|AUTHORITY|UNIVERSITY)$/i,offices=[];
 const continuation=line=>line===line.toUpperCase()&&!/^(?:SUBJECT|DATE|FROM|TO|FOR|CONTROL|REPUBLIC|PROVINCE\b|NOTICE|MEETING|MEMORANDUM|MEMO\b|OFFICE\s+ORDER|SPECIAL\s+ORDER|REV\.?\s+NO)/i.test(line)&&!/@|https?:|\d/.test(line);
 for(let i=0;i<lines.length;i++){
  const line=lines[i];if(!/\b(?:OFFICE|DEPARTMENT|BUREAU|DIVISION|COMMISSION|AUTHORITY|UNIVERSITY)\b/i.test(line)||/\b(?:ORDER|MEMORANDUM)\b|@|https?:/i.test(line))continue;
  const parts=[line];
  if(generic.test(line)){for(const previous of lines.slice(Math.max(0,i-2),i).reverse()){if(!continuation(previous))break;parts.unshift(previous);}}
  else if(/\b(?:OF|THE|AND|FOR)$/i.test(line)){for(const following of lines.slice(i+1,i+3)){if(!continuation(following))break;parts.push(following);if(!/\b(?:OF|THE|AND|FOR)$/i.test(following))break;}}
  const value=parts.join(' ');if(!generic.test(value))offices.push(value);
 }
 return offices.at(-1)||'';
}
function parseDocumentHeader(rawText='') {
 const labels='SUBJECT MATTER|SUBJECT|SUBJ|PAKSA|RE|ADDRESSED TO|MEMORANDUM FOR|RECIPIENT OFFICE|RECEIVED FROM|SENDER|ISSUED BY|ISSUING OFFICE|ORIGINATING OFFICE|SIGNATORY|MULA(?: KAY| SA)?|PARA(?: KAY| SA)?|PETSA|DATE RECEIVED|RECEIVED DATE|DATE RELEASED|RELEASED DATE|DATE ISSUED|DATE|DATED|TO|T0|FROM|FOR|THROUGH|THRU|CC|ATTACHMENTS?|REFERENCE(?: NO\\.?| NUMBER)?|REF(?: NO\\.?)?|CONTROL (?:NO\\.?|NUMBER)|REMARKS';
 const labelRe=new RegExp(`^(${labels})\\s*(?::|[\u2013\u2014-])\\s*(.*)$`,'i'),bareRe=new RegExp(`^(?:${labels})\\s*$`,'i');
 const bodyRe=/^(?:magandang (?:araw|umaga|hapon)\b|mahal na\b|mangyaring\b|pakiusap\b|kami (?:ay|po)\b|ako (?:ay|po)\b|kaugnay\b|lubos na gumagalang\b|dear\b|sir\b|madam\b|respectfully\b|sincerely\b|please\b|kindly\b|you are\b|this (?:is|memo|memorandum|office|letter)\b|pursuant\b|in (?:connection|view|compliance|light)\b|for your (?:information|compliance|guidance)\b|we (?:are|would|request)\b|I (?:am|would|respectfully)\b|attached (?:is|are)\b|relative to\b|\d+\.\s)/i;
 const dateLine=/^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|[A-Za-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\.?,?\s+\d{4})\s*$/i;
 const prefix='(?:[A-Z][A-Z0-9&./-]*\\s+){0,6}';
 const memoRe=new RegExp(`^${prefix}(?:OFFICE\\s+)?(?:MEMORANDUM(?:\\s+(?:ORDER|CIRCULAR))?|MEMO)(?:\\s+(?:N[O0]\\.?|NUMBER)\\s*[:#.-]?\\s*[A-Z0-9 /._,-]*|\\s+FOR\\s*:?.*|\\s*[:#.-]?\\s*\\d[\\d /._,-]*)?\\s*$`,'i');
 const types=['Office Order','Special Order','Travel Order','Request Letter','Endorsement Letter','Transmittal Letter','Response Letter','Notice of Meeting','Invitation','Report'];
 let text=String(rawText||'').replace(/\r/g,'').split('\f')[0].replace(/\u00a0/g,' ').replace(/\uff1a/g,':');
 const lines=[];
 text.split('\n').forEach((raw,index)=>{
  raw=raw.replace(/^(?:SUBJECI|SUB3ECT|SUBIECT)\s*(?=[:\-])/i,'SUBJECT').replace(new RegExp(`^(${labels})[ \\t]{2,}(?=[^\\s:\uff1a;\u2013\u2014-])`,'i'),'$1: ');
  raw.split(new RegExp(`[ \\t]{2,}(?=(?:${labels})\\s*:)`,'i')).forEach(line=>lines.push({text:line.replace(/[ \t]+/g,' ').trim(),number:index+1}));
 });
 let header=lines.slice(0,Math.min(100,lines.findIndex(x=>bodyRe.test(x.text))<0?lines.length:lines.findIndex(x=>bodyRe.test(x.text))));
 const subjectIndex=header.findIndex(x=>/^(?:SUBJECT(?: MATTER)?|SUBJ|PAKSA|RE)\s*(?::|[\u2013\u2014-]|$)/i.test(x.text));
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
    if(/^[:\uff1a;|]+$/.test(next)){j++;continue;}
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
  if(number&&/\d/.test(number[1])){const series=numberText.match(/(?:[,;]\s*s\.?\s*|\bseries(?:\s+of)?\s+)(\d{4})\b/i);result.controlNo=number[1]+(series?`, s. ${series[1]}`:'');result.evidence.controlNo=header[heading].number;if(result.isMemo){result.memoNo=result.controlNo;result.evidence.memoNo=header[heading].number;}}
 }
 const printed=field('CONTROL (?:NO\\.?|NUMBER)',1),reference=printed.value?printed:field('REFERENCE(?: NO\\.?| NUMBER)?|REF(?: NO\\.?)?',1);
 if((printed.value||!result.controlNo)&&/^[A-Z0-9][A-Z0-9/._-]*(?:,?\s*s\.?\s*\d{4})?$/i.test(reference.value)){result.controlNo=reference.value;result.evidence.controlNo=reference.line;if(result.isMemo&&!result.memoNo)result.memoNo=reference.value;}
 for(const[key,names]of Object.entries({addressedTo:'TO|T0|FOR|PARA(?: KAY| SA)?|ADDRESSED TO|MEMORANDUM FOR|RECIPIENT OFFICE',issuedBy:'FROM|ISSUED BY|ISSUING OFFICE|ORIGINATING OFFICE|SIGNATORY',sender:'RECEIVED FROM|FROM|MULA(?: KAY| SA)?|SENDER|ORIGINATING OFFICE|ISSUING OFFICE',subject:'SUBJECT|SUBJECT MATTER|SUBJ|PAKSA|RE',signatory:'SIGNATORY'})){
  const f=field(names);result[key]=f.value;result.evidence[key]=f.line;result.fieldEvidence[key]=f.text;
 }
 const explicitSender=result.sender;
 if(!result.sender){
  const firstLabel=header.findIndex(x=>labelRe.test(x.text)||bareRe.test(x.text)),firstDate=header.findIndex(x=>dateLine.test(x.text));
  const top=header.slice(0,Math.min(heading<0?header.length:heading,subjectIndex<0?header.length:subjectIndex,firstLabel<0?header.length:firstLabel,firstDate<0?header.length:firstDate,20));
  const office=letterheadOffice(top.map(x=>x.text));
  if(office){result.sender=office;result.fieldEvidence.sender=office;}
 }
 if(/^(?:OFFICE|DEPARTMENT|BUREAU|DIVISION|COMMISSION|AUTHORITY|UNIVERSITY)$/i.test(result.sender))result.sender='';
 const author=printedHeaderSignatory(rawText);
 if(author.name){result.signatory=author.name;if(!result.issuedBy)result.issuedBy=author.name;}
 for(const[key,names]of Object.entries({date:'DATE|DATE ISSUED|DATED|PETSA',receivedDate:'DATE RECEIVED|RECEIVED DATE',releasedDate:'DATE RELEASED|RELEASED DATE'})){
  const f=field(names,1);if(f.value){result[key]=parseMemoDate(f.value);result.evidence[key]=f.line;result.fieldEvidence[key]=f.text;if(!result[key])result.warnings.push('The printed date is invalid or ambiguous. Enter it manually.');}
 }
 if(!result.evidence.date){const standalone=header.find(x=>dateLine.test(x.text));if(standalone){result.date=parseMemoDate(standalone.text);result.evidence.date=standalone.number;}}
 result.recipient=result.addressedTo;result.sourceOffice=result.sender;result.documentType=result.docType;
 for(const[key,label]of [['memoNo','Memo number'],['date','Issue date'],['addressedTo','Recipient'],['subject','Subject'],['issuedBy','Issuing office']])if(!result[key])result.warnings.push(`${label} was not detected.`);
 result.needsReview=['controlNo','date','addressedTo','subject','sender'].filter(key=>!result[key]);
 return result;
}
function printedHeaderSignatory(rawText='') {
 const signatory=scanPrintedSignatories(rawText).signatory;
 return signatory?{name:signatory.name,line:signatory.line,page:signatory.page}:{name:'',line:null,page:null};
}
function parseLetterDetails(rawText=''){
 const rules={"headings":[["Memorandum",{"pattern":"^(?:OFFICE\\s+)?(?:MEMORANDUM|MEM0RANDUM|MEMO)(?:\\s+(?:ORDER|CIRCULAR))?(?:\\s+(?:N[O0]\\.?|NUMBER|FOR|SERIES)\\b.*|\\s*[:#.-]?\\s*\\d.*)?$","flags":"i"}],["Travel Order",{"pattern":"^(?:REVISED\\s+)?TRAVEL\\s+ORDER(?:\\s+(?:N[O0]\\.?|NUMBER|SERIES)\\b.*|\\s*[:#.-]?\\s*\\d.*)?$","flags":"i"}],["Special Order",{"pattern":"^SPECIAL\\s+ORDER(?:\\s+(?:N[O0]\\.?|NUMBER|SERIES)\\b.*|\\s*[:#.-]?\\s*\\d.*)?$","flags":"i"}],["Office Order",{"pattern":"^(?:OFFICE|ADMINISTRATIVE)\\s+ORDER(?:\\s+(?:N[O0]\\.?|NUMBER|SERIES)\\b.*|\\s*[:#.-]?\\s*\\d.*)?$","flags":"i"}],["Notice of Meeting",{"pattern":"^(?:NOTICE\\s+OF\\s+(?:A\\s+)?MEETING|MEETING\\s+NOTICE)(?:\\s*[:\\-].*)?$","flags":"i"}],["Request Letter",{"pattern":"^(?:REQUEST\\s+LETTER|LETTER\\s+OF\\s+REQUEST)(?:\\s*[:\\-].*)?$","flags":"i"}],["Endorsement Letter",{"pattern":"^(?:ENDORSEMENT(?:\\s+LETTER)?|LETTER\\s+OF\\s+ENDORSEMENT)(?:\\s*[:\\-].*)?$","flags":"i"}],["Transmittal Letter",{"pattern":"^(?:TRANSMITTAL(?:\\s+LETTER)?|LETTER\\s+OF\\s+TRANSMITTAL)(?:\\s*[:\\-].*)?$","flags":"i"}],["Response Letter",{"pattern":"^(?:RESPONSE|REPLY)\\s+LETTER(?:\\s*[:\\-].*)?$","flags":"i"}],["Invitation",{"pattern":"^(?:INVITATION(?:\\s+LETTER)?|LETTER\\s+OF\\s+INVITATION)(?:\\s*[:\\-].*)?$","flags":"i"}],["Report",{"pattern":"^(?:(?:MONTHLY|ANNUAL|ACCOMPLISHMENT|ACTIVITY|INSPECTION|PROGRESS|INCIDENT|NARRATIVE)\\s+){0,2}REPORT(?:\\s*[:\\-].*)?$","flags":"i"}]],"subjectRules":[["Request Letter",{"pattern":"(?:^(?:REQUEST(?:ING)?(?:\\s+(?:FOR|TO))?|APPLICATION\\s+FOR|REQUISITION\\s+FOR|PURCHASE\\s+REQUEST)\\b|\\b(?:EQUIPMENT|SUPPLY|SUPPLIES|FUNDING|ASSISTANCE|PURCHASE|PERMISSION|APPROVAL|DOCUMENT|RECORDS|FINANCIAL|BUDGET|SPONSORSHIP)\\s+REQUEST\\b)","flags":"i"}],["Notice of Meeting",{"pattern":"^(?:NOTICE\\s+OF\\s+(?:A\\s+)?MEETING|MEETING\\s+NOTICE|(?:STAFF|PERSONNEL|COORDINATION|REGULAR|SPECIAL)\\s+MEETING)\\b","flags":"i"}],["Invitation",{"pattern":"^INVITATION\\b","flags":"i"}],["Endorsement Letter",{"pattern":"^ENDORSEMENT\\b","flags":"i"}],["Transmittal Letter",{"pattern":"^(?:TRANSMITTAL\\b|(?:SUBMISSION|FORWARDING)\\s+OF\\b)","flags":"i"}],["Response Letter",{"pattern":"^(?:RESPONSE|REPLY)\\s+TO\\b","flags":"i"}],["Report",{"pattern":"^(?:(?:MONTHLY|ANNUAL|ACCOMPLISHMENT|ACTIVITY|INSPECTION|PROGRESS|INCIDENT|NARRATIVE)\\s+){0,2}REPORT\\b","flags":"i"}]],"bodyRules":[["Response Letter",{"pattern":"\\b(?:in\\s+(?:response|reply)\\s+to|respond(?:ing)?\\s+to|reply(?:ing)?\\s+to)\\b","flags":"i"}],["Invitation",{"pattern":"\\b(?:invite\\s+(?:you|your|the)|inviting\\s+(?:you|your|the)|extend\\s+(?:an?|our)\\s+invitation)\\b","flags":"i"}],["Endorsement Letter",{"pattern":"\\b(?:(?:we|I)\\s+(?:(?:hereby|respectfully)\\s+)?endorse|endorsing\\s+(?:the|this|Mr|Ms|Dr))\\b","flags":"i"}],["Transmittal Letter",{"pattern":"\\b(?:(?:we|I)\\s+(?:(?:hereby|respectfully|are)\\s+)?(?:transmit|forward|submit|transmitting|forwarding|submitting)|herewith\\s+(?:transmitted|submitted|forwarded)|transmittal\\s+of)\\b","flags":"i"}],["Request Letter",{"pattern":"\\b(?:request(?:ing)?\\s+(?:for|to|your|the|a|an|permission|approval|assistance|funding|technical\\s+assistance)|application\\s+for)\\b","flags":"i"}],["Notice of Meeting",{"pattern":"\\b(?:please\\s+be\\s+informed|inform\\s+(?:you|all)|notify\\s+(?:you|all))\\b[^.!?]{0,180}\\bmeeting\\b","flags":"i"}],["Report",{"pattern":"\\b(?:report\\s+on|(?:monthly|annual|accomplishment|activity|inspection|progress|incident)\\s+report)\\b","flags":"i"}]],"subjectLabel":{"pattern":"^(?:SUBJECT(?:\\s+(?:MATTER|OF\\s+(?:THE\\s+)?LETTER))?|SUBJEC[TIL1]|SUB3ECT|SUBJ\\.?|RE|REGARDING|PAKSA)(?:\\s*[:;\\-\u2013\u2014]\\s*|\\s+|$)(.*)$","flags":"i"},"fieldLabel":{"pattern":"^(?:DATE(?:\\s+(?:ISSUED|RECEIVED|RELEASED))?|DATED|TO|T0|FOR|FROM|SENDER|THRU|THROUGH|CC|ATTACHMENTS?|ENCLOSURES?|REFERENCE|REF\\.?|CONTROL(?:\\s+(?:NO\\.?|NUMBER))?|ISSUED\\s+BY|SIGNATORY|REMARKS|N[O0]\\.?|NUMBER)\\s*[:;\\-]","flags":"i"},"salutation":{"pattern":"^(?:DEAR\\b|SIR\\s*[,!:]|MADAM\\s*[,!:]|MA'AM\\s*[,!:]|TO\\s+WHOM\\s+IT\\s+MAY\\s+CONCERN)","flags":"i"},"closing":{"pattern":"^(?:(?:VERY\\s+)?(?:YOURS\\s+)?(?:SINCERELY|RESPECTFULLY|FAITHFULLY|TRULY)|YOURS\\s+(?:TRULY|FAITHFULLY|SINCERELY)|BEST\\s+REGARDS|KIND\\s+REGARDS|LUBOS\\s+NA\\s+GUMAGALANG|SIGNED\\s+BY|PREPARED\\s+BY|APPROVED\\s+BY)\\b","flags":"i"},"body":{"pattern":"^(?:DEAR\\b|GREETINGS\\b|GOOD\\s+(?:DAY|MORNING|AFTERNOON)\\b|PLEASE\\b|KINDLY\\b|WE\\b|I\\s+(?:AM|WOULD|HEREBY|WRITE|RESPECTFULLY)\\b|MAY\\s+(?:WE|I)\\b|THIS\\s+(?:IS|LETTER|REFERS|HAS|WILL)\\b|YOU\\s+ARE\\b|THE\\s+(?:UNDERSIGNED|ATTACHED|PURPOSE)\\b|ATTACHED\\s+(?:IS|ARE|HEREWITH)\\b|IN\\s+(?:CONNECTION|VIEW|LIGHT)\\b|WITH\\s+REFERENCE\\b|PURSUANT\\b|FOR\\s+YOUR\\s+(?:INFORMATION|COMPLIANCE|GUIDANCE)\\b)","flags":"i"},"titlePurpose":{"pattern":"^(?:REQUEST\\s+(?:FOR|TO)|INVITATION\\s+(?:TO|FOR)|ENDORSEMENT\\s+(?:OF|FOR)|TRANSMITTAL\\s+OF|RESPONSE\\s+TO|REPLY\\s+TO|NOTICE\\s+OF\\s+MEETING|(?:MONTHLY|ANNUAL|ACCOMPLISHMENT|ACTIVITY|INSPECTION|PROGRESS|INCIDENT)\\s+REPORT)\\b","flags":"i"}};
 const header=parseDocumentHeader(rawText),first=String(rawText||'').replace(/\r/g,'').split('\f')[0],lines=first.split('\n').map(s=>s.trim());
 const regex=key=>new RegExp(rules[key].pattern,rules[key].flags||'i');
 const greeting=lines.findIndex(line=>regex('salutation').test(line)||/^(?:magandang (?:araw|umaga|hapon)|mahal na)\b/i.test(line));
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
  const sentence=opening.match(/^.*?[.!?](?=\s+[A-Z]|$)/)?.[0]||opening;subject=sentence.length<=240?sentence:sentence.slice(0,240).replace(/\s+\S*$/,'')+'\u2026';subjectSource='body';
 }
 if(!documentType){for(const [type,rule] of rules.headings){if(top.some(line=>new RegExp(rule.pattern,rule.flags).test(line))){documentType=type;documentTypeSource='heading';break;}}}
 if(!documentType&&subjectSource!=='body'){for(const [type,rule] of rules.subjectRules){if(new RegExp(rule.pattern,rule.flags).test(subject)){documentType=type;documentTypeSource='subject';break;}}}
 if(!documentType){for(const [type,rule] of rules.bodyRules){if(new RegExp(rule.pattern,rule.flags).test(opening)){documentType=type;documentTypeSource='body';break;}}}
 if(!documentType&&greeting>=0&&/\b(?:humihiling|hinihiling|pakiusap)\b/i.test(first)){documentType='Request Letter';documentTypeSource='body';}
 if(!documentType&&first.trim()){documentType=greeting>=0?'Letter':'Other Communication';documentTypeSource='fallback';}
 return {subject,subjectSource,documentType,documentTypeSource,isMemo:header.isMemo,needsReview:[...(subjectSource==='body'||!subject?['subject']:[]),...(['body','subject','fallback'].includes(documentTypeSource)?['documentType']:[])]};
}
/* End letter-purpose extraction. */


  function detectMemo(text) {const result=parseDocumentHeader(text);return result.isMemo?result:null;}
  function attachmentMime(name) {
   return ({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',bmp:'image/bmp',tif:'image/tiff',tiff:'image/tiff',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain',csv:'text/csv',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'})[String(name||'').split('.').pop().toLowerCase()];
  }
  async function memoAttachment(prior) {
   const blob=file||(attachment?.id?await attachmentIO('get',attachment.id):null);
   if(blob){
    if(blob.size>10*1024*1024)throw new Error('Office Memos accepts attachments up to 10 MB. Choose a smaller file before saving.');
    const name=file?.name||attachment?.name||prior?.fileName||'document',mime=attachmentMime(name);
    if(!mime)throw new Error('This file type cannot be uploaded to Office Memos.');
    const uploaded=await window.PGENRO_API.uploadDocument(new File([blob],name,{type:mime}),'office_memos');
    return {pdfUrl:uploaded.url,pdfFileName:name,newUpload:true};
   }
   if(attachment?.id)throw new Error('The original attachment is unavailable in this browser. Reattach it before moving this memo.');
   if(prior?.fileUrl&&!remoteAttachmentRemoved){const url=new URL(prior.fileUrl,location.href);if(!['http:','https:'].includes(url.protocol))throw new Error('The attachment address is invalid.');return {pdfUrl:url.href,pdfFileName:prior.fileName||'document'};}
   return {pdfUrl:'',pdfFileName:''};
  }
  async function saveToMemos(payload) {
   if(!M.client())throw new Error('Connect to the database before uploading to Office Memos. Your document is still in this form.');
   const prior=records.find(r=>String(r.id)===String(editing));
   const addressedTo=$('memoRecipientInput').value.trim(),issuedBy=$('memoIssuerInput').value.trim();
   const journal=M.storage.get(routeJournalKey,{}),key=editing?`communication:${editing}`:`memo:${payload.controlNo.toLowerCase()}`;
   const pending=journal[key];
   const memos=await M.read('office_memos');
   let saved=pending?memos.find(m=>String(m.id)===pending.id):null;
   if(!saved){
    if(memos.some(m=>String(m.memoNo||'').trim().toLowerCase()===payload.controlNo.toLowerCase()))throw new Error('This memo number already exists in Office Memos. Use a unique number.');
    const document=await memoAttachment(prior),now=new Date().toISOString();
    const remarks=[payload.remarks,payload.actionTaken?`Action taken: ${payload.actionTaken}`:'',`From Communications (${payload.type}; ${payload.status}).`,payload.ocrText?`Extracted document text:\n${payload.ocrText}`:''].filter(Boolean).join('\n\n');
    const {newUpload,...savedDocument}=document;
    const memo={memoNo:payload.controlNo,date:payload.date,addressedTo,issuedBy,subject:payload.subject,title:payload.subject,remarks,isPinned:false,...savedDocument,createdAt:now,updatedAt:now};
    const id=pending?.id||M.uuid();
    journal[key]={id,memoNo:payload.controlNo,sourceId:editing||null};
    if(!M.storage.set(routeJournalKey,journal)){if(newUpload)window.PGENRO_API.removeDocument(document.pdfUrl).catch(()=>{});throw new Error('Browser storage is unavailable. Enable it before saving so an interrupted upload can be retried safely.');}
    try{saved=await M.write('office_memos',memo,null,{insertId:id});}
    catch(error){
     // A dropped response can follow a successful insert. Delete only after
     // a successful lookup confirms that the journal's destination is absent.
     let absent=false;
     try{const check=await M.client().from('office_memos').select('id').eq('id',id).limit(1);absent=!check.error&&Array.isArray(check.data)&&check.data.length===0;}catch{}
     if(newUpload&&absent)window.PGENRO_API.removeDocument(document.pdfUrl).catch(()=>{});
     throw error;
    }
   }
   routeCommitted=true;
   M.storage.set('pgenro_office_memos',[saved,...memos.filter(m=>String(m.id)!==String(saved.id))]);
   if(editing){
    try{if((await M.read(table)).some(r=>String(r.id)===String(editing)))await M.remove(table,[String(editing)]);}
    catch(error){for(const input of $('communicationForm').querySelectorAll('input,select,textarea'))input.disabled=true;updateDestination();throw new Error(`The memo is saved in Office Memos. The original communication could not be removed: ${error.message} Retry Finish Move; it will reuse the saved memo.`);}
    records=records.filter(r=>String(r.id)!==String(editing));M.storage.set(cacheKey,records);render();
    if(prior?.attachmentId)attachmentIO('delete',prior.attachmentId).catch(()=>{});
   }
   delete journal[key];M.storage.set(routeJournalKey,journal);
   M.audit(editing?'MOVE_RECORD':'ADD_RECORD',`Memo ${saved.memoNo} saved in Office Memos${editing?' from Communications':''}`);
   busy=false;$('encodingModal').dataset.busy='false';M.closeModal('encodingModal');
   location.assign(`officememo-admin.html?memo=${encodeURIComponent(saved.id)}&uploaded=1`);
  }
  function normalize(row) {
   const copy={...row};
   for(const[key,names]of Object.entries(aliases)){
    const actual=key==='type'?names.find(n=>M.normalizeCommunicationType(row[n])):names.find(n=>Object.hasOwn(row,n));
    if(actual){fields[key]??=actual;copy[key]=key==='type'?M.normalizeCommunicationType(row[actual]):row[actual];}
    else if(key==='type')copy.type='';
   }
   return copy;
  }
  function payloadFor(row) {const out={};for(const[key,value]of Object.entries(row))out[fields[key]||key]=value;return out;}
  function filtered() {const q=$('tableSearchInput').value.trim().toLowerCase(),status=$('statusFilter').value;return records.filter(r=>(direction==='All'||r.type===direction)&&(status==='All'||r.status===status)&&(!q||[r.controlNo,r.subject,r.office,r.docType,r.type,r.status,r.remarks].join(' ').toLowerCase().includes(q)));}
  function render() {
   const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/size));page=Math.min(page,pages);const visible=rows.slice((page-1)*size,page*size);
   selected=new Set([...selected].filter(id=>records.some(r=>String(r.id)===id)));
   $('communicationTableBody').innerHTML=visible.length?visible.map(r=>`<tr data-id="${esc(r.id)}" class="${selected.has(String(r.id))?'selected-row':''}">
    <td><input class="row-checkbox" type="checkbox" data-id="${esc(r.id)}" ${selected.has(String(r.id))?'checked':''} aria-label="Select ${esc(r.controlNo)}"></td>
    <td><strong>${esc(r.controlNo||'\u2014')}</strong><span class="employee-sub">${esc(r.type||'\u2014')} \xb7 ${esc(r.docType||'\u2014')}</span></td>
    <td>${esc(r.date||'\u2014')}</td><td class="communication-office">${esc(r.office||'\u2014')}</td><td class="communication-subject">${esc(r.subject||'\u2014')}</td>
    <td>${r.attachmentId||r.fileUrl?`<button class="btn btn-sm btn-secondary" data-action="file" data-id="${esc(r.id)}" title="View attached document"><i data-lucide="paperclip"></i> View file</button><span class="employee-sub">${esc(r.fileName||'Document')}</span>`:'\u2014'}</td>
    <td><span class="badge-status ${r.status==='Pending'?'urgent':'success'}">${esc(r.status||'\u2014')}</span></td>
    <td><div class="actions"><button class="btn-action" data-action="edit" data-id="${esc(r.id)}" aria-label="Edit ${esc(r.controlNo)}" title="Edit record"><i data-lucide="pencil"></i></button><button class="btn-action" data-action="ocr" data-id="${esc(r.id)}" aria-label="View extracted text for ${esc(r.controlNo)}" title="View extracted text"><i data-lucide="file-search"></i></button><button class="btn-action delete" data-action="delete" data-id="${esc(r.id)}" aria-label="Delete ${esc(r.controlNo)}" title="Delete record"><i data-lucide="trash-2"></i></button></div></td></tr>`).join(''):`<tr><td colspan="8" class="empty-table-cell">${records.length?'No records match the current filters.':'No communication records available.'}</td></tr>`;
   $('tablePaginationInfo').textContent=`Showing ${rows.length?(page-1)*size+1:0} to ${Math.min(page*size,rows.length)} of ${rows.length} records`;
   $('commPageLabel').textContent=`Page ${page} of ${pages}`;$('commPrevPage').disabled=page===1;$('commNextPage').disabled=page===pages;
   const checked=visible.filter(r=>selected.has(String(r.id))).length;$('selectAllRows').checked=visible.length>0&&checked===visible.length;$('selectAllRows').indeterminate=checked>0&&checked<visible.length;
   $('bulkSelectionBar').hidden=!selected.size;$('selectedCountText').textContent=`${selected.size} records selected`;
   for(const[id,count]of [['kpiTotalRecords',records.length],['kpiIncomingCount',records.filter(r=>r.type==='Incoming').length],['kpiOutgoingCount',records.filter(r=>r.type==='Outgoing').length],['kpiPendingCount',records.filter(r=>r.status==='Pending').length]])$(id).textContent=count.toLocaleString();
   M.renderIcons();
  }
  async function load() {
   const version=++generation;
   try {
    const connection=await M.waitForBackend();if(version!==generation)return false;
    if(connection==='unavailable'&&!M.client())throw new Error('Database connection unavailable.');
    if(!M.client()){mode='local';const cached=M.storage.get(cacheKey,M.storage.get('communicationRecords',[]));records=(Array.isArray(cached)?cached:[]).map(normalize);}
    else {const rows=await M.read(table);if(version!==generation)return false;mode='live';records=rows.map(normalize);M.storage.set(cacheKey,records);}
    M.observeRecords('communications',records);render();return true;
   }catch(error){if(version!==generation)return false;mode='unavailable';const cached=M.storage.get(cacheKey,[]);records=(Array.isArray(cached)?cached:[]).map(normalize);render();M.toast('Records could not refresh. Cached records are available; saving requires a database connection.','error');return false;}
  }
  function requireWrite() {if(mode==='unavailable'||mode==='loading')throw new Error('Refresh the records successfully before saving changes.');}
  async function persist(payload,id=null) {
   if(Object.hasOwn(payload,'type')){
    const type=M.normalizeCommunicationType(payload.type);
    if(!type)throw new Error('Choose Incoming or Outgoing as the communication type.');
    payload={...payload,type};
   }
   requireWrite();if(mode==='live')return normalize(await M.write(table,payloadFor(payload),id));
   const saved={...(records.find(r=>String(r.id)===String(id))||{}),...payload,id:id||M.uuid()};const next=id?records.map(r=>String(r.id)===String(id)?saved:r):[saved,...records];
   if(!M.storage.set(cacheKey,next))throw new Error('Browser storage is full or unavailable. The record was not saved.');records=next;return saved;
  }
  function newControlNo() {const prefix=`COMM-${new Date().getFullYear()}-`;const highest=Math.max(0,...records.map(r=>String(r.controlNo||'').startsWith(prefix)?Number(String(r.controlNo).slice(prefix.length))||0:0));return prefix+String(highest+1).padStart(5,'0');}
  function releasePreview() {if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}}
  function clearAutoDetectedFields() {
   for(const[id,value]of commOcrValues)if($(id).value===value&&!commManualFields.has(id))$(id).value='';
   commOcrValues.clear();detectedMemo=false;lastOcrMetadata=null;lastOcrWarnings=[];lastOcrForm=null;
   $('communicationMemoReview').hidden=$('communicationOcrReview').hidden=$('ocrSignatoryGroup').hidden=true;
   $('ocrTextInput').value='';commManualFields.delete('ocrTextInput');$('ocrStatsChip').style.display='none';
   for(const id of ocrFormIds)if(!commManualFields.has(id))setFieldState(id,'');
   $('ocrFieldSummary').textContent='Detected fields will appear here after reading.';
   if(!editing){if(!$('dateInput').value&&!commManualFields.has('dateInput'))$('dateInput').value=M.today();if(!$('statusSelect').value&&!commManualFields.has('statusSelect'))$('statusSelect').value='Pending';}
   updateDestination();
  }
  function resetFile(remove=false) {
   ocrGeneration++;pendingRead=null;cancelDocumentRead('removed');file=null;attachment=null;
   if(remove){remoteAttachmentRemoved=true;clearAutoDetectedFields();}
   $('documentFileInput').value='';releasePreview();$('fileNameDisplay').textContent='Choose a document';$('fileMetaDisplay').textContent='PDF, images, Word, Excel, PowerPoint or text \xb7 Max 50 MB';
   $('removeDocumentBtn').style.display='none';$('runOcrBtn').disabled=true;$('filePreviewContainer').style.display='none';$('filePreviewBody').replaceChildren();
   setReaderState('idle','Ready for a document');$('ocrActionSubtext').textContent='Reading starts automatically when you select a file.';
   $('encodingUploadProgressBox').classList.remove('active');$('ocrStopControls').hidden=true;
  }
  function setPreview(blob) {
   releasePreview();previewUrl=URL.createObjectURL(blob);const root=$('filePreviewBody');root.replaceChildren();let node;
   root.classList.toggle('is-text-document',!blob.type.startsWith('image/')&&!(blob.type==='application/pdf'||/\.pdf$/i.test(blob.name||'')));
   if(blob.type.startsWith('image/')){node=document.createElement('img');node.alt='Attached document preview';node.src=previewUrl;}
   else if(blob.type==='application/pdf'||/\.pdf$/i.test(blob.name||'')){
    node=document.createElement('div');node.className='communication-pdf-preview-card';
    const label=document.createElement('p');label.textContent='PDF attachment ready for preview.';
    const button=document.createElement('button');button.type='button';button.className='btn btn-secondary';button.id='previewSelectedDocumentBtn';button.textContent='Preview document';
    button.addEventListener('click',()=>viewFile({previewBlob:blob,fileName:blob.name||'Communication.pdf',fileType:blob.type,controlNo:$('controlNoInput').value,subject:$('subjectInput').value},true));
    node.append(label,button);
   }
   else {node=document.createElement('p');node.textContent='Document attached. Readable text appears below after extraction.';}
   root.append(node);$('filePreviewContainer').style.display='block';$('previewOpenExternalBtn').href=previewUrl;$('previewOpenExternalBtn').style.display='inline-flex';
  }
  async function openEditor(id=null) {
   if(busy)return;pendingRead=null;cancelDocumentRead('closed');routeCommitted=false;remoteAttachmentRemoved=false;detectedMemo=false;commOcrValues.clear();commManualFields.clear();$('communicationMemoReview').hidden=true;$('communicationOcrReview').hidden=true;$('ocrSignatoryGroup').hidden=true;lastOcrMetadata=null;lastOcrWarnings=[];lastOcrForm=null;
   for(const id of ocrFormIds)setFieldState(id,'');$('ocrFieldSummary').textContent='Detected fields will appear here after reading.';$('communicationInlineNotice').hidden=true;
   for(const input of $('communicationForm').querySelectorAll('input,select,textarea'))input.disabled=false;
   $('browseDocumentBtn').disabled=$('removeDocumentBtn').disabled=false;
   editing=id;$('communicationForm').reset();resetFile();$('editIndex').value=id||'';$('modalTitle').textContent=id?'Edit Communication Record':'New Communication Record';$('saveRecordBtn').querySelector('span').textContent=id?'Save Changes':'Save Record';
   const docTypeSelect=$('docTypeSelect');
   docTypeSelect.querySelectorAll('option[data-existing-type]').forEach(option=>option.remove());
   const r=records.find(r=>String(r.id)===String(id));if(r){
    // Keep a stored document category editable even if a newer release renamed it.
    if(r.docType&&![...docTypeSelect.options].some(option=>option.value===r.docType)){
     const option=document.createElement('option');option.value=r.docType;option.textContent=r.docType;option.dataset.existingType='true';docTypeSelect.append(option);
    }
    for(const[key,input]of Object.entries(fieldInputs))$(input).value=r[key]||'';
    attachment=r.attachmentId||r.fileUrl?{id:r.attachmentId||null,name:r.fileName,type:r.fileType}:null;
    if(attachment){
     $('fileNameDisplay').textContent=attachment.name||'Existing attachment';$('fileMetaDisplay').textContent='Previously attached file';$('removeDocumentBtn').style.display='inline-flex';
     const root=$('filePreviewBody');root.classList.add('is-text-document');const button=document.createElement('button');button.type='button';button.className='btn btn-secondary';button.textContent='View existing document';button.addEventListener('click',()=>viewFile(r,true));root.replaceChildren(button);$('filePreviewContainer').style.display='block';
     const remote=safeCommunicationAttachment(r.fileUrl);$('previewOpenExternalBtn').style.display=remote?'inline-flex':'none';if(remote)$('previewOpenExternalBtn').href=remote;
    }
   }
   else {$('dateInput').value=M.today();$('controlNoInput').value=newControlNo();$('typeSelect').value='Incoming';$('statusSelect').value='Pending';}
   const memo=detectMemo(r?.ocrText||'');if(memo){$('memoRecipientInput').value=memo.addressedTo;$('memoIssuerInput').value=memo.issuedBy;}
   const pending=M.storage.get(routeJournalKey,{})[`communication:${id}`];
   if(id&&pending&&M.client())try{
    const saved=(await M.read('office_memos')).find(m=>String(m.id)===pending.id);
    if(saved&&String(editing)===String(id)){
     routeCommitted=true;$('docTypeSelect').value='Memorandum';$('controlNoInput').value=saved.memoNo||'';$('memoRecipientInput').value=saved.addressedTo||'';$('memoIssuerInput').value=saved.issuedBy||'';$('subjectInput').value=saved.subject||'';
     for(const input of $('communicationForm').querySelectorAll('input,select,textarea'))input.disabled=true;
     $('browseDocumentBtn').disabled=$('removeDocumentBtn').disabled=$('runOcrBtn').disabled=true;
     M.toast('This memo is already saved in Office Memos. Finish Move will remove the original communication.','warning');
    }
   }catch{}
   updateDestination();syncOcrControls();M.openModal('encodingModal');
  }
  // IndexedDB retains large attachments without exhausting localStorage.
  let dbPromise;
  function attachmentDB(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const req=indexedDB.open('pgenro_communication_attachments',1);req.onupgradeneeded=()=>req.result.createObjectStore('files');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(new Error('Attachment storage is unavailable.'));});return dbPromise;}
  async function attachmentIO(action,id,value){const db=await attachmentDB();return new Promise((resolve,reject)=>{const tx=db.transaction('files',action==='get'?'readonly':'readwrite');const req=action==='put'?tx.objectStore('files').put(value,id):action==='delete'?tx.objectStore('files').delete(id):tx.objectStore('files').get(id);let result;req.onsuccess=()=>result=req.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(new Error('Could not store the attachment. Browser storage may be full.'));tx.onabort=()=>reject(new Error('Attachment storage was interrupted.'));});}
  function selectDocument(chosen) {
   if(!chosen||busy||routeCommitted)return;if(chosen.size>50*1024*1024){M.toast('Choose a file no larger than 50 MB.','warning');$('documentFileInput').value='';return;}
   if(!chosen.size){M.toast('This file is empty. Choose another document.','warning');$('documentFileInput').value='';return;}
   if(!/\.(pdf|png|jpe?g|webp|bmp|tiff?|docx|txt|csv|xlsx|pptx)$/i.test(chosen.name)){M.toast('Unsupported attachment type.','warning');$('documentFileInput').value='';return;}
   ocrGeneration++;cancelDocumentRead('replaced');clearAutoDetectedFields();
   $('communicationInlineNotice').hidden=true;
   file=chosen;attachment=null;$('fileNameDisplay').textContent=chosen.name;$('fileMetaDisplay').textContent=`${(chosen.size/1024/1024).toFixed(2)} MB \xb7 ${chosen.name.split('.').pop().toUpperCase()}`;
   $('removeDocumentBtn').style.display='inline-flex';setPreview(chosen);scheduleDocumentRead();
  }
  $('documentFileInput').addEventListener('change',()=>selectDocument($('documentFileInput').files[0]));
  const dropZone=$('communicationDropZone');
  dropZone.addEventListener('dragover',event=>{event.preventDefault();if(!busy&&!routeCommitted)dropZone.classList.add('is-dragging');});
  dropZone.addEventListener('dragleave',event=>{if(!dropZone.contains(event.relatedTarget))dropZone.classList.remove('is-dragging');});
  dropZone.addEventListener('drop',event=>{event.preventDefault();dropZone.classList.remove('is-dragging');if(event.dataTransfer.files.length!==1){M.toast('Choose one document at a time.','warning');return;}selectDocument(event.dataTransfer.files[0]);});
  $('browseDocumentBtn').addEventListener('click',()=>$('documentFileInput').click());$('removeDocumentBtn').addEventListener('click',()=>resetFile(true));
  $('communicationForm').addEventListener('submit',async e=>{
   e.preventDefault();if(busy)return;
   if(ocrActive||pendingRead){M.toast('Wait for reading to finish, or select Stop reading before saving.','warning');return;}
   if(!$('communicationForm').reportValidity())return;
   const payload=Object.fromEntries(Object.entries(fieldInputs).map(([k,id])=>[k,$(id).value.trim()]));if(!isMemo()&&records.some(r=>String(r.id)!==String(editing)&&String(r.controlNo||'').trim().toLowerCase()===payload.controlNo.toLowerCase()))return M.toast('This control number already exists. Use a unique number.','warning');
   let newAttachment=null,newRemoteUrl='';const priorAttachment=records.find(r=>String(r.id)===String(editing))?.attachmentId;
   try {requireWrite();busy=true;$('encodingModal').dataset.busy='true';$('saveRecordBtn').disabled=true;$('runOcrBtn').disabled=true;
    $('browseDocumentBtn').disabled=$('removeDocumentBtn').disabled=true;
    for(const input of $('communicationForm').querySelectorAll('input,select,textarea'))input.disabled=true;
    if(isMemo()){await saveToMemos(payload);return;}
    if(file){
     if(mode==='live'){const uploaded=await window.PGENRO_API.uploadDocument(file,'communications');newRemoteUrl=uploaded.url;payload.fileUrl=uploaded.url;}
     newAttachment=M.uuid();await attachmentIO('put',newAttachment,file);attachment={id:newAttachment,name:file.name,type:attachmentMime(file.name)||file.type};
    }
    payload.attachmentId=attachment?.id||null;payload.fileName=attachment?.name||'';payload.fileType=attachment?.type||'';
    if(remoteAttachmentRemoved&&!file)payload.fileUrl='';
    // An existing remote attachment URL remains intact when editing other fields.
    const saved=await persist(payload,editing);if(mode==='live'){records=editing?records.map(r=>String(r.id)===String(editing)?saved:r):[saved,...records];M.storage.set(cacheKey,records);}M.observeRecords('communications',records);render();
    if(priorAttachment&&priorAttachment!==attachment?.id)attachmentIO('delete',priorAttachment).catch(()=>{});
    M.audit(editing?'EDIT_RECORD':'ADD_RECORD',`Communication ${payload.controlNo}`);busy=false;$('encodingModal').dataset.busy='false';M.closeModal('encodingModal');M.toast(mode==='local'?'Communication saved in this browser.':'Communication saved successfully.');
   }catch(error){if(newRemoteUrl&&/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(error.code||''))window.PGENRO_API.removeDocument(newRemoteUrl).catch(()=>{});if(newAttachment){attachmentIO('delete',newAttachment).catch(()=>{});attachment=null;}M.toast(error.message||'Could not save this record.','error');}
   finally{busy=false;$('encodingModal').dataset.busy='false';$('saveRecordBtn').disabled=false;$('runOcrBtn').disabled=routeCommitted||!file;$('browseDocumentBtn').disabled=$('removeDocumentBtn').disabled=routeCommitted;for(const input of $('communicationForm').querySelectorAll('input,select,textarea'))input.disabled=routeCommitted;}
  });
  async function deleteRecords(ids) {
   if(busy||!ids.length||!confirm(`Delete ${ids.length} communication record(s)?`))return;
   busy=true;try{requireWrite();const removed=records.filter(r=>ids.includes(String(r.id)));if(mode==='live')await M.remove(table,ids);const next=records.filter(r=>!ids.includes(String(r.id)));if(mode==='local'&&!M.storage.set(cacheKey,next))throw new Error('Changes could not be saved.');records=next;M.storage.set(cacheKey,records);selected.clear();render();for(const r of removed)if(r.attachmentId)attachmentIO('delete',r.attachmentId).catch(()=>{});M.audit('DELETE_RECORD',`${ids.length} communication records deleted`);M.toast('Records deleted.');}catch(error){M.toast(error.message,'error');}finally{busy=false;}
  }
  $('bulkDeleteBtn').addEventListener('click',()=>deleteRecords([...selected]));
  $('bulkArchiveBtn').addEventListener('click',async()=>{if(busy||!selected.size)return;busy=true;try{requireWrite();let completed=0;for(const id of [...selected]){const r=records.find(r=>String(r.id)===id);const saved=await persist({status:'Archived'},id);records=records.map(r=>String(r.id)===id?{...r,...saved}:r);completed++;}selected.clear();M.storage.set(cacheKey,records);M.audit('ARCHIVE_RECORD',`${completed} communications archived`);M.toast(`Archived ${completed} record(s).`);}catch(error){M.toast(`Archive stopped: ${error.message}`,'error');}finally{busy=false;render();}});
  $('clearSelectionBtn').addEventListener('click',()=>{selected.clear();render();});
  $('selectAllRows').addEventListener('change',e=>{filtered().slice((page-1)*size,page*size).forEach(r=>e.target.checked?selected.add(String(r.id)):selected.delete(String(r.id)));render();});
  $('communicationTableBody').addEventListener('change',e=>{if(!e.target.matches('.row-checkbox'))return;const id=e.target.dataset.id;e.target.checked?selected.add(id):selected.delete(id);render();});
  $('communicationTableBody').addEventListener('click',async e=>{const btn=e.target.closest('[data-action]');if(!btn)return;const r=records.find(r=>String(r.id)===btn.dataset.id);if(!r)return;if(btn.dataset.action==='edit')openEditor(r.id);if(btn.dataset.action==='delete')deleteRecords([String(r.id)]);if(btn.dataset.action==='ocr'){$('viewOcrFileName').textContent=r.controlNo||'';$('viewOcrContent').value=r.ocrText||'No extracted text saved for this record.';M.openModal('viewOcrModal');}if(btn.dataset.action==='file')await viewFile(r);});
  const viewDocumentModal=$('viewDocumentModal'),docViewerFallback=$('docViewerFallback');
  const docViewerDownloadBtn=$('docViewerDownloadBtn'),docViewerExternalBtn=$('docViewerExternalBtn');
  const commPdfToolbar=$('commPdfToolbar'),commPdfStage=$('commPdfStage'),commPdfCanvas=$('commPdfCanvas');
  const commPdfPrevPage=$('commPdfPrevPage'),commPdfNextPage=$('commPdfNextPage'),commPdfPageLabel=$('commPdfPageLabel');
  const commPdfZoom=$('commPdfZoom'),commPdfRenderStatus=$('commPdfRenderStatus');
  const communicationAttachmentImage=$('docViewerImage'),communicationAttachmentText=$('docViewerText');
  let returnToEncoding=false;
  function safeCommunicationAttachment(value){
    const raw=String(value||'').trim();if(!raw)return '';
    if(/^data:(?:application\/(?:pdf|vnd\.openxmlformats-officedocument\.(?:wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|octet-stream)|image\/(?:png|jpeg|webp|bmp|tiff)|text\/(?:plain|csv))(?:;[^,]*)?,/i.test(raw))return raw;
    try{const url=new URL(raw,location.href);if(['https:','http:','blob:'].includes(url.protocol))return url.href;}catch{}return '';
  }
  // Render pages ourselves: Chrome's native PDF plugin cannot run in a sandboxed iframe.
  const commPreview = {generation:0,renderVersion:0,renderPromise:Promise.resolve(),renderTask:null,
    pdfTask:null,pdf:null,abort:null,blobUrl:'',page:1,resizeTimer:null};
  let communicationPdfLibraryPromise = null;
  function loadCommunicationPdfLibrary(){
    if(!communicationPdfLibraryPromise){
      communicationPdfLibraryPromise=import('../vendor/pdfjs/pdf.min.mjs').then(lib=>{
        lib.GlobalWorkerOptions.workerSrc=new URL('../vendor/pdfjs/pdf.worker.min.mjs',location.href).href;
        return lib;
      }).catch(error=>{communicationPdfLibraryPromise=null;throw error;});
    }
    return communicationPdfLibraryPromise;
  }
  function communicationPreviewIsCurrent(generation){
    return generation===commPreview.generation&&viewDocumentModal.classList.contains('open');
  }
  function cleanupCommunicationViewer(){
    commPreview.generation++;commPreview.renderVersion++;
    clearTimeout(commPreview.resizeTimer);
    commPreview.abort?.abort();commPreview.abort=null;
    commPreview.renderTask?.cancel();commPreview.renderTask=null;
    const task=commPreview.pdfTask;
    commPreview.pdfTask=null;commPreview.pdf=null;
    if(task){try{Promise.resolve(task.destroy()).catch(()=>{});}catch{}}
    if(commPreview.blobUrl){URL.revokeObjectURL(commPreview.blobUrl);commPreview.blobUrl='';}
    for(const link of [docViewerDownloadBtn,docViewerExternalBtn]){link.hidden=true;link.removeAttribute('href');}
    communicationAttachmentImage.onload=null;communicationAttachmentImage.onerror=null;communicationAttachmentImage.removeAttribute('src');
    communicationAttachmentText.textContent='';commPdfCanvas.width=0;commPdfCanvas.height=0;
    commPdfToolbar.hidden=true;commPdfStage.hidden=true;commPdfStage.setAttribute('aria-busy','false');
    commPdfCanvas.hidden=true;communicationAttachmentImage.hidden=true;communicationAttachmentText.hidden=true;
    commPdfRenderStatus.textContent='';commPdfZoom.value='fit';commPreview.page=1;
  }
  function showCommunicationPreviewState(title,message,state=''){
    commPdfToolbar.hidden=true;commPdfStage.hidden=true;
    docViewerFallback.classList.remove('hidden');docViewerFallback.dataset.state=state;
    docViewerFallback.querySelector('h3').textContent=title;
    docViewerFallback.querySelector('p').textContent=message;
  }
  function setCommunicationAttachmentLinks(url,filename){
    docViewerDownloadBtn.href=url;docViewerDownloadBtn.download=filename;docViewerDownloadBtn.hidden=false;
    // Remote servers may ignore the download attribute. Keep the registry page open.
    if(/^https?:/i.test(url)){docViewerDownloadBtn.target='_blank';docViewerDownloadBtn.rel='noopener noreferrer';}
    else docViewerDownloadBtn.removeAttribute('target');
    docViewerExternalBtn.href=url;docViewerExternalBtn.hidden=false;
  }
  function communicationPreviewTimeout(promise,milliseconds,message){
    let timer;
    return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),milliseconds);})])
      .finally(()=>clearTimeout(timer));
  }
  async function readCommunicationPreviewBlob(url,signal){
    const limit=50*1024*1024;
    let blob;
    if(url instanceof Blob)blob=url;
    else{
      const resolved=await window.PGENRO_API.getDocumentUrl(url);const response=await fetch(resolved,{signal});
      if(!response.ok)throw new Error('The attachment could not be retrieved.');
      if(Number(response.headers.get('Content-Length'))>limit)throw new Error('This attachment is larger than the 50 MB preview limit.');
      blob=await response.blob();
    }
    if(blob.size>limit)throw new Error('This attachment is larger than the 50 MB preview limit.');
    if(!blob.size)throw new Error('This attachment is empty.');
    return blob;
  }
  function renderCommunicationPdfPage(){
    if(!commPreview.pdf)return;
    const generation=commPreview.generation,version=++commPreview.renderVersion;
    const documentPdf=commPreview.pdf,pageNumber=commPreview.page;
    commPreview.renderTask?.cancel();
    const previous=commPreview.renderPromise;
    commPdfPageLabel.textContent=`Page ${pageNumber} of ${documentPdf.numPages}`;
    commPdfPrevPage.disabled=pageNumber<=1;commPdfNextPage.disabled=pageNumber>=documentPdf.numPages;
    commPdfRenderStatus.textContent='Rendering page\u2026';commPdfStage.setAttribute('aria-busy','true');
    commPreview.renderPromise=(async()=>{
      await previous.catch(()=>{});
      if(!communicationPreviewIsCurrent(generation)||version!==commPreview.renderVersion)return;
      const page=await documentPdf.getPage(pageNumber);
      if(!communicationPreviewIsCurrent(generation)||version!==commPreview.renderVersion)return;
      const base=page.getViewport({scale:1});
      const style=getComputedStyle(commPdfStage);
      const available=Math.max(100,commPdfStage.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight));
      const scale=commPdfZoom.value==='fit'?available/base.width:Number(commPdfZoom.value);
      const viewport=page.getViewport({scale});
      // Keep large scans crisp without allocating an unbounded canvas.
      const ratio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(16000000/(viewport.width*viewport.height)));
      commPdfCanvas.width=Math.max(1,Math.floor(viewport.width*ratio));
      commPdfCanvas.height=Math.max(1,Math.floor(viewport.height*ratio));
      commPdfCanvas.style.width=`${viewport.width}px`;commPdfCanvas.style.height=`${viewport.height}px`;
      commPdfCanvas.setAttribute('aria-label',`PDF page ${pageNumber} of ${documentPdf.numPages}`);
      commPdfCanvas.hidden=false;commPdfStage.scrollTop=0;commPdfStage.scrollLeft=0;
      const task=page.render({canvasContext:commPdfCanvas.getContext('2d'),viewport,
        transform:ratio===1?null:[ratio,0,0,ratio,0,0]});
      commPreview.renderTask=task;
      try{await task.promise;}finally{if(commPreview.renderTask===task)commPreview.renderTask=null;}
      if(!communicationPreviewIsCurrent(generation)||version!==commPreview.renderVersion)return;
      commPdfRenderStatus.textContent=`${Math.round(scale*100)}%`;
      commPdfStage.setAttribute('aria-busy','false');
    })().catch(error=>{
      if(!communicationPreviewIsCurrent(generation)||version!==commPreview.renderVersion||error.name==='RenderingCancelledException')return;
      commPdfStage.setAttribute('aria-busy','false');
      showCommunicationPreviewState('Page preview unavailable','Use Open in new tab or Download Document to view this PDF.','error');
    });
  }
  async function loadCommunicationPreview(url,filename,generation){
    const controller=new AbortController();commPreview.abort=controller;
    try{
      const source=await communicationPreviewTimeout(readCommunicationPreviewBlob(url,controller.signal),20000,'The attachment took too long to load.');
      if(!communicationPreviewIsCurrent(generation))return;
      const bytes=new Uint8Array(await source.arrayBuffer());
      if(!communicationPreviewIsCurrent(generation))return;
      const header=new TextDecoder('ascii').decode(bytes.subarray(0,1024));
      const isPdf=header.includes('%PDF-')||source.type.split(';')[0]==='application/pdf'||/\.pdf$/i.test(filename);
      const mime=source.type.split(';')[0]||attachmentMime(filename)||'';
      const imageType=/^image\/(?:png|jpeg|webp|bmp|tiff)$/i.test(mime);
      const textType=/^text\/(?:plain|csv)$/i.test(mime);
      const type=isPdf?'application/pdf':imageType?mime:textType?'text/plain;charset=utf-8':'application/octet-stream';
      // A Blob URL supports Chrome downloads/new tabs; top-level data: navigation is blocked.
      const blob=new Blob([bytes],{type});
      commPreview.blobUrl=URL.createObjectURL(blob);
      setCommunicationAttachmentLinks(commPreview.blobUrl,filename);
      if(isPdf){
        const lib=await communicationPreviewTimeout(loadCommunicationPdfLibrary(),15000,'The PDF renderer is unavailable.');
        if(!communicationPreviewIsCurrent(generation))return;
        const task=lib.getDocument({data:bytes,isEvalSupported:false,cMapUrl:new URL('../vendor/pdfjs/cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('../vendor/pdfjs/standard_fonts/',location.href).href});commPreview.pdfTask=task;
        const pdf=await communicationPreviewTimeout(task.promise,20000,'The PDF took too long to open.');
        if(!communicationPreviewIsCurrent(generation))return;
        commPreview.pdf=pdf;commPreview.page=1;
        docViewerFallback.classList.add('hidden');commPdfToolbar.hidden=false;commPdfStage.hidden=false;
        renderCommunicationPdfPage();
      }else if(imageType){
        communicationAttachmentImage.onload=()=>{
          if(!communicationPreviewIsCurrent(generation))return;
          docViewerFallback.classList.add('hidden');commPdfStage.hidden=false;communicationAttachmentImage.hidden=false;
        };
        communicationAttachmentImage.onerror=()=>{
          if(communicationPreviewIsCurrent(generation))showCommunicationPreviewState('Image preview unavailable','Use Open in new tab or Download Document to view this attachment.','error');
        };
        communicationAttachmentImage.src=commPreview.blobUrl;
      }else if(textType){
        const text=await blob.slice(0,1024*1024).text();
        if(!communicationPreviewIsCurrent(generation))return;
        communicationAttachmentText.textContent=text+(blob.size>1024*1024?'\n\n[Preview limited to 1 MB. Download Document to read the complete file.]':'');
        docViewerFallback.classList.add('hidden');commPdfStage.hidden=false;communicationAttachmentText.hidden=false;
      }else{
        showCommunicationPreviewState('Download this attachment','Use Download Document to view this file in its compatible application.');
      }
    }catch(error){
      if(!communicationPreviewIsCurrent(generation))return;
      controller.abort();
      const task=commPreview.pdfTask;commPreview.pdfTask=null;commPreview.pdf=null;
      if(task){try{Promise.resolve(task.destroy()).catch(()=>{});}catch{}}
      let message;
      if(error.name==='PasswordException')message='This PDF requires a password. Use Open in new tab or Download Document to open it.';
      else if(commPreview.blobUrl)message='The PDF could not be previewed. Use Open in new tab or Download Document to open the file.';
      else if(docViewerExternalBtn.hidden)message='The attachment could not be read. Select or upload the original file again.';
      else if(/50 MB/.test(error.message))message=error.message+' Use Open in new tab or Download Document to view the file.';
      else message='The attachment could not be loaded. Use Open in new tab or Download Document, and check that its link is still accessible.';
      showCommunicationPreviewState('Preview unavailable',message,'error');
    }finally{if(commPreview.abort===controller)commPreview.abort=null;}
  }
  async function viewFile(r,fromEditor=false){
    if(busy||!M.canStartAction())return;
    const remote=safeCommunicationAttachment(r.fileUrl);
    if(r.fileUrl&&!remote&&!r.previewBlob&&!r.attachmentId){M.toast('The attachment address or file type is invalid.','error');return;}
    cleanupCommunicationViewer();returnToEncoding=fromEditor;
    const filename=String(r.fileName||r.previewBlob?.name||'document').replace(/[\\/\u0000-\u001f\u007f]/g,'_');
    $('docViewerTitle').textContent=r.controlNo?`Communication ${r.controlNo}`:'Document Viewer';
    $('docViewerSubtitle').textContent=[r.subject,filename].filter(Boolean).join(' \xb7 ');
    showCommunicationPreviewState('Loading attachment\u2026','Preparing the document preview.');
    M.openModal('viewDocumentModal');
    const version=commPreview.generation;
    if(remote&&/^(?:https?:|blob:)/i.test(remote))setCommunicationAttachmentLinks(remote,filename);
    try{
      let source=r.previewBlob||null;
      if(!source&&r.attachmentId){
        try{source=await attachmentIO('get',r.attachmentId);}catch(error){if(!remote)throw error;}
      }
      if(!communicationPreviewIsCurrent(version))return;
      source=source||remote;
      if(!source)throw new Error('This attachment is stored in the browser where it was uploaded. Open it there, or reattach the original file.');
      M.audit('RETRIEVE_DOCUMENT',r.controlNo||filename);
      void loadCommunicationPreview(source,filename,version);
    }catch(error){
      if(communicationPreviewIsCurrent(version))showCommunicationPreviewState('Attachment unavailable',error.message||'Reattach the original document to view it.','error');
    }
  }
  viewDocumentModal.addEventListener('pgenro:modal-close',()=>{
    cleanupCommunicationViewer();
    if(returnToEncoding){returnToEncoding=false;M.openModal('encodingModal');}
  });
  $('dismissDocViewerBtn').addEventListener('click',()=>M.closeModal('viewDocumentModal'));
  commPdfPrevPage.addEventListener('click',()=>{if(commPreview.pdf&&commPreview.page>1){commPreview.page--;renderCommunicationPdfPage();}});
  commPdfNextPage.addEventListener('click',()=>{if(commPreview.pdf&&commPreview.page<commPreview.pdf.numPages){commPreview.page++;renderCommunicationPdfPage();}});
  commPdfZoom.addEventListener('change',renderCommunicationPdfPage);
  commPdfStage.addEventListener('keydown',event=>{
    if(!commPreview.pdf||event.altKey||event.ctrlKey||event.metaKey)return;
    if(event.key==='ArrowLeft'){event.preventDefault();commPdfPrevPage.click();}
    if(event.key==='ArrowRight'){event.preventDefault();commPdfNextPage.click();}
  });
  window.addEventListener('resize',()=>{
    clearTimeout(commPreview.resizeTimer);
    if(commPreview.pdf&&commPdfZoom.value==='fit')commPreview.resizeTimer=setTimeout(renderCommunicationPdfPage,150);
  });
  window.addEventListener('pagehide',cleanupCommunicationViewer);
  $('openEncodingModalBtn').addEventListener('click',()=>openEditor());
  for(const[button,modal]of [['closeEncodingModalBtn','encodingModal'],['cancelEncodingBtn','encodingModal'],['closeViewOcrModalBtn','viewOcrModal'],['closeDocViewerBtn','viewDocumentModal']])$(button).addEventListener('click',()=>M.closeModal(modal));
  document.querySelectorAll('.filter-tab').forEach(btn=>btn.addEventListener('click',()=>{direction=btn.dataset.type;page=1;document.querySelectorAll('.filter-tab').forEach(b=>{b.classList.toggle('active',b===btn);b.setAttribute('aria-pressed',String(b===btn));});render();}));
  for(const id of ['tableSearchInput','statusFilter'])$(id).addEventListener(id==='statusFilter'?'change':'input',()=>{page=1;if(id==='tableSearchInput')$('globalSearchInput').value=$(id).value;render();});
  $('globalSearchInput').addEventListener('input',()=>{$('tableSearchInput').value=$('globalSearchInput').value;page=1;render();});
  $('commPrevPage').addEventListener('click',()=>{page=Math.max(1,page-1);render();});$('commNextPage').addEventListener('click',()=>{page++;render();});
  $('syncCommunicationsBtn').addEventListener('click',async()=>{if(busy)return;const btn=$('syncCommunicationsBtn');btn.disabled=true;try{if(await load())M.toast(mode==='local'?'Local records refreshed.':'Records refreshed.');}finally{btn.disabled=false;}});
  $('exportCommunicationsBtn').addEventListener('click',()=>{const rows=filtered();if(!rows.length)return M.toast('No records to export.','warning');M.csv([['Control No','Type','Document Type','Date','Office','Subject','Action Taken','Status','Remarks'],...rows.map(r=>[r.controlNo,r.type,r.docType,r.date,r.office,r.subject,r.actionTaken,r.status,r.remarks])],`pgenro_communications_${M.today()}.csv`);M.audit('EXPORT_RECORDS',`${rows.length} communication records exported`);});
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
 rows.forEach((row,index)=>{
  if(index&&rows[index-1].y-row.y>Math.max(Math.max(rows[index-1].height,row.height)*1.7,typical*1.6))lines.push('');
  let line='',previous=null;
  for(const item of row.items.sort((a,b)=>a.transform[4]-b.transform[4])){
   if(previous){
    const gap=item.transform[4]-(previous.transform[4]+Math.abs(previous.width||0));
    // PDF.js splits words for font changes and kerning, not just table columns.
    const separator=gap>Math.max(8,row.height*.8)?'  ':/\s$/.test(line)||/^\s/.test(item.str)?'':gap>Math.max(.5,row.height*.08)?' ':'';
    line+=separator;
   }
   line+=item.str;previous=item;
  }
  lines.push(line);
 });
 return lines.join('\n');
}
function supplementSenderEvidence(base,extra,signatureRegion=false){
 base=String(base||'');const existing=parseCorrespondence(base);
 if(existing.receivedFrom||existing.receivedFromSource==='ambiguous')return base;
 const candidates=scanPrintedSignatories(extra,signatureRegion).primary,evidence=candidates.map(c=>c.evidence).join('\n\n');
 if(!evidence)return base;
 if(candidates.every(c=>c.kind==='explicit-sender'))return evidence+'\n\n'+base;
 const tail=base.match(/^\s*(?:CC\s*:|COPY\s+(?:TO|FURNISHED)|ANNEX\b|APPENDIX\b|ATTACHMENTS?\s*:|ENCLOSURES?\s*:)/im),at=tail?tail.index:base.length;
 return base.slice(0,at).trimEnd()+'\n\n'+evidence+'\n\n'+base.slice(at);
}
function choosePdfPageText(native,scanned,preferNative=false){
 native=String(native||'');scanned=String(scanned||'');if(!scanned.trim())return native;
 if(preferNative&&(native.match(/\w+/g)||[]).length>=(scanned.match(/\w+/g)||[]).length*.8)return supplementSenderEvidence(native,scanned);
 return preferNative?supplementSenderEvidence(scanned,native):scanned;
}

const readerResults=new WeakMap();
const readerRuntime={worker:null,promise:null,logger:null,idle:null,operation:null,owner:null,workerToken:null,stopping:null};
function notifyReaderCancel(op){
 if(!op?.requestId||!op.endpoint)return;
 if(op.notifiedRequest===op.requestId)return;op.notifiedRequest=op.requestId;
 const url=new URL(op.endpoint,location.href);url.pathname=url.pathname.replace(/\/ocr\/?$/,'/cancel');
 fetch(url.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:op.requestId}),keepalive:true}).catch(()=>{});
}
function cancelDocumentRead(reason='stopped'){
 const op=readerRuntime.operation;if(!op)return;
 if(op.cancelled)return;op.cancelled=true;op.reason=reason;op.controller?.abort();notifyReaderCancel(op);
 op.reject?.(new Error('Reading stopped. Your draft is kept; you can retry.'));
 stopReaderWorker(op);
}
async function readWithCancellation(source,progress,stillCurrent=()=>true){
 await readerRuntime.stopping;
 if(!stillCurrent())throw Error('Reading stopped. Your draft is kept; you can retry.');
 const op={cancelled:false,controller:null,requestId:null,endpoint:null,reject:null,notifiedRequest:null};readerRuntime.operation=op;
 const stopped=new Promise((_,reject)=>op.reject=reject);
 const deadline=setTimeout(()=>{op.cancelled=true;op.reason='timeout';op.controller?.abort();notifyReaderCancel(op);stopReaderWorker(op);op.reject?.(new Error('Reading reached the time limit. Your draft is kept; retry or choose a smaller document.'));},180000);
 try{return await Promise.race([extractDocument(source,progress,op),stopped]);}
 finally{clearTimeout(deadline);if(readerRuntime.operation===op)readerRuntime.operation=null;}
}
async function stopReaderWorker(operation=null){
 if(operation&&readerRuntime.owner!==operation)return;
 clearTimeout(readerRuntime.idle);const worker=readerRuntime.worker;
 readerRuntime.worker=null;readerRuntime.promise=null;readerRuntime.logger=null;readerRuntime.owner=null;readerRuntime.workerToken=null;
 if(worker){
  let timer;const stopping=Promise.race([Promise.resolve().then(()=>worker.terminate()).catch(()=>{}),new Promise(resolve=>timer=setTimeout(resolve,1500))]);
  readerRuntime.stopping=stopping;try{await stopping;}finally{clearTimeout(timer);if(readerRuntime.stopping===stopping)readerRuntime.stopping=null;}
 }
}
window.addEventListener('pagehide',()=>{cancelDocumentRead();stopReaderWorker();});
async function extractDocument(source,progress=()=>{},operation=readerRuntime.operation){
 const checkRead=()=>{if(operation?.cancelled)throw Error(operation.reason==='timeout'?'Reading reached the time limit. Retry or choose a smaller document.':'Reading stopped. Your draft is kept; you can retry.');};
 const started=performance.now(),previous=readerResults.get(source);
 if(previous){progress('Using the document already read\u2026',98);return {...previous,cacheHit:true,durationMs:Math.round(performance.now()-started)};}
 const remember=result=>{checkRead();const finished={...result,metadata:result.formSchemaVersion===1?result.metadata||{}:{...parseLetterDetails(result.text),...(result.metadata||{})},durationMs:Math.round(performance.now()-started)};readerResults.set(source,finished);return finished;};
 const extension=source.name.split('.').pop().toLowerCase();
 const warnings=[],configuredEndpoint=document.querySelector('meta[name="pgenro-ocr-endpoint"]')?.content?.trim();
 const endpoints=configuredEndpoint?[configuredEndpoint]:[];
 // Local static previews can use the supplied Python server without editing HTML.
 if((['localhost','127.0.0.1','[::1]'].includes(location.hostname)||location.protocol==='file:')&&location.port!=='5000')endpoints.push('http://127.0.0.1:5000/ocr');
 for(const address of [...new Set(endpoints)]){
  const endpoint=new URL(address,location.href).href,sameOrigin=new URL(endpoint).origin===location.origin;
  let health=null;
  {
   const probe=new AbortController(),probeTimer=setTimeout(()=>probe.abort(),3500);if(operation)operation.controller=probe;
   try{const url=new URL(endpoint);url.pathname=url.pathname.replace(/\/ocr\/?$/,'/health');progress('Connecting to the document reader\u2026',3);
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
     progress(total?`${state.stage} \xb7 ${done} of ${total} pages`:state.stage||'Reading the full document\u2026',total?Math.min(96,8+88*done/total):8);
    }}
   }catch{}finally{clearTimeout(deadline);pollAbort=null;if(posting&&!operation?.cancelled)pollTimer=setTimeout(pollProgress,1000);}
  }
  try{
   if(operation){operation.controller=controller;operation.endpoint=endpoint;operation.requestId=M.uuid();controller.signal.addEventListener('abort',()=>notifyReaderCancel(operation),{once:true});}
   progress('Reading all pages, the letter body and printed signatures\u2026',8);const body=new FormData();body.append('file',source);body.append('clientId',readerClientId);body.append('communicationType',$('typeSelect').value||'Incoming');
   if(operation)pollTimer=setTimeout(pollProgress,700);
   const response=await fetch(endpoint,{method:'POST',body,headers:operation?{'X-OCR-Request-ID':operation.requestId}:{},signal:controller.signal});
   // A static server has no OCR endpoint. Continue to the local/browser reader.
   if([404,405,501,503].includes(response.status))continue;
   let result;try{result=await response.json();}catch{throw Error('The document reader returned an invalid response. Reload and retry.');}
   if(!response.ok||result.success===false)throw Error(result.error||'The document reader could not read this file.');
   if(typeof result.text!=='string')throw Error('The document reader returned no document text.');
   checkRead();if(result.requestId&&operation&&result.requestId!==operation.requestId)throw Error('The reader response does not match this document. Retry the read.');
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
 if(/^(txt|csv)$/.test(extension)){
  const bytes=new Uint8Array(await source.arrayBuffer()),encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
  const text=new TextDecoder(encoding).decode(bytes);return remember({text,metadata:{},warnings,pages:text.split('\f').length,engine:'native-text'});
 }
 let worker=null,pdf=null,stage='Reading scanned text\u2026',floor=0,span=90;
 async function recognize(input,psm='3'){
  checkRead();clearTimeout(readerRuntime.idle);
  readerRuntime.owner=operation;
  readerRuntime.logger=info=>{if(info.status==='recognizing text')progress(stage,Math.min(98,Math.round(floor+info.progress*span)));};
  if(!readerRuntime.promise){
   const workerToken={};readerRuntime.workerToken=workerToken;
   readerRuntime.promise=(async()=>{
    await loadReaderScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    checkRead();const ready=await Tesseract.createWorker('eng',1,{logger:info=>{if(readerRuntime.workerToken===workerToken)readerRuntime.logger?.(info);}});if(operation?.cancelled){await ready.terminate();checkRead();}readerRuntime.worker=ready;return ready;
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
   if(!parseCorrespondence(text).signatory&&parseCorrespondence(alternate.text||'').signatory)text=supplementSenderEvidence(text,alternate.text);
  }
  const lines=text.split(/\r?\n/),signatureHint=lines.some(line=>/^(?:(?:very\s+)?(?:yours\s+)?(?:sincerely|respectfully|faithfully|truly)|signed(?:\s+by)?|signatory|submitted\s+by|prepared\s+by|approved\s+by)\b/i.test(line))||lines.slice(Math.floor(lines.length*.55)).some(line=>/\b(?:officer|director|chief|mayor|governor|secretary|manager|president|chairperson|coordinator|principal|engineer)\b/i.test(line));
  const senderFields=parseCorrespondence(text);
  if(text&&!senderFields.receivedFrom&&senderFields.receivedFromSource!=='ambiguous'&&(signatureHint||(canvas.height>canvas.width*.65&&(text.match(/\S+/g)||[]).length>=12))){
   const marker=chosen.lines?.find(line=>/^(?:(?:very\s+)?(?:yours\s+)?(?:sincerely|respectfully|faithfully|truly)|signed|submitted|prepared|approved)\b/i.test(line.text||''));
   const top=canvas.height<canvas.width*.65?0:Math.max(0,marker?.bbox?.y0!=null?marker.bbox.y0-30:Math.floor(canvas.height*.45));
   const crop=document.createElement('canvas');crop.width=canvas.width;crop.height=canvas.height-top;const ctx=crop.getContext('2d');ctx.drawImage(canvas,0,top,canvas.width,crop.height,0,0,canvas.width,crop.height);
   const data=ctx.getImageData(0,0,crop.width,crop.height);
   for(let i=0;i<data.data.length;i+=4){const r=data.data[i],g=data.data[i+1],b=data.data[i+2];if(b>r*1.25&&b>g*1.18&&b-r>12)data.data[i]=data.data[i+1]=data.data[i+2]=255;}
   ctx.putImageData(data,0,0);
   try{const recovered=await recognize(crop,'11');text=supplementSenderEvidence(text,recovered.text||'',true);}finally{crop.width=crop.height=0;}
  }
  if(Number(chosen.confidence??100)<65&&!warnings.includes('Some scanned text has low confidence. Review the detected fields.'))warnings.push('Some scanned text has low confidence. Review the detected fields.');
  return text;
 }
 function pdfNativeTextIsTrustworthy(lib,ops,native){
  if(native.includes('\ufffd')||(native.match(/\w+/g)||[]).length<20||!scanPrintedSignatories(native).candidates.some(c=>c.score>=75))return false;
  let mode=0,visible=0,total=0;const stack=[];
  const showOps=[lib.OPS.showText,lib.OPS.showSpacedText,lib.OPS.nextLineShowText,lib.OPS.nextLineSetSpacingShowText].filter(Number.isInteger);
  const count=value=>Array.isArray(value)?value.reduce((sum,item)=>sum+count(item),0):value?.unicode?.length||0;
  for(let i=0;i<ops.fnArray.length;i++){
   const op=ops.fnArray[i],args=ops.argsArray[i];
   if(op===lib.OPS.save)stack.push(mode);
   else if(op===lib.OPS.restore)mode=stack.pop()??0;
   else if(op===lib.OPS.setTextRenderingMode)mode=args?.[0]??0;
   else if(showOps.includes(op)){const chars=count(args);total+=chars;if(mode!==3&&mode!==7)visible+=chars;}
  }
  return total?visible/total>=.8:!ops.fnArray.some((op,i)=>op===lib.OPS.setTextRenderingMode&&ops.argsArray[i]?.[0]===3);
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
  const hiddenText=ops.fnArray.some((op,i)=>op===lib.OPS.setTextRenderingMode&&ops.argsArray[i]?.[0]===3);
  const scannedPage=images.some(([x0,y0,x1,y1])=>(x1-x0)*(y1-y0)/area>.6);
  if(hiddenText&&scannedPage){
   const sender=parseCorrespondence(native),header=parseDocumentHeader(native);
   const hasClosing=/^(?:for your (?:information|compliance|guidance)|respectfully|sincerely|yours|signed by|signatory|submitted by)\b/im.test(native);
   if((page.pageNumber===1||hasClosing)&&!sender.signatory)return true;
   if(page.pageNumber===1&&header.isMemo&&!header.controlNo)return true;
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
   checkRead();let canvas;try{canvas=await imageCanvas(new Blob([await zip.file(name).async('uint8array')],{type:attachmentMime(name)}));parts.push(await readPage(canvas));}catch(error){checkRead();warnings.push('An embedded image could not be read: '+error.message);}finally{if(canvas)canvas.width=canvas.height=0;}
  }
  return parts.filter(s=>s.trim()).join(extension==='docx'?'\n\n':'\n\f\n');
 }
 try{
  const extension=source.name.split('.').pop().toLowerCase();let text='';
  if(/^(txt|csv)$/.test(extension)){
   const bytes=new Uint8Array(await source.arrayBuffer()),encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';text=new TextDecoder(encoding).decode(bytes);
  }else if(/^(docx|pptx|xlsx)$/.test(extension))text=await archiveText(extension);
  else if(extension==='pdf'){
   const lib=await import('../vendor/pdfjs/pdf.min.mjs');lib.GlobalWorkerOptions.workerSrc=new URL('../vendor/pdfjs/pdf.worker.min.mjs',location.href).href;pdf=await lib.getDocument({data:await source.arrayBuffer(),isEvalSupported:false,cMapUrl:new URL('../vendor/pdfjs/cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('../vendor/pdfjs/standard_fonts/',location.href).href}).promise;const pages=[];
   for(let number=1;number<=pdf.numPages;number++){
    checkRead();
    stage=`Reading page ${number} of ${pdf.numPages}, including the body and signature\u2026`;floor=(number-1)/pdf.numPages*90;span=90/pdf.numPages;progress(stage,Math.round(floor));
    const page=await pdf.getPage(number),content=await page.getTextContent(),native=pdfTextLines(content.items),ops=await page.getOperatorList();
    let pageText=native;
    if(pdfNeedsOcr(lib,ops,content.items,native,page)){
     const base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(240/72,3000/Math.max(base.width,base.height))}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
     try{await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)'}).promise;const scanned=await readPage(canvas);
      pageText=choosePdfPageText(native,scanned,pdfNativeTextIsTrustworthy(lib,ops,native));
     }catch(error){checkRead();if(!native.trim())throw error;warnings.push(`Page ${number}: scanned content could not be read; selectable text was kept. ${error.message}`);}
     finally{canvas.width=canvas.height=0;}
    }
    pages.push(pageText);page.cleanup();
   }
   text=pages.join('\n\f\n');
  }else if(/^(tif|tiff)$/.test(extension)){
   await loadReaderScript('https://cdn.jsdelivr.net/npm/pako@1.0.11/dist/pako.min.js');await loadReaderScript('https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js');const bytes=await source.arrayBuffer(),frames=UTIF.decode(bytes),pages=[];
   for(let i=0;i<frames.length;i++){const frame=frames[i];UTIF.decodeImage(bytes,frame);const canvas=document.createElement('canvas');canvas.width=frame.width;canvas.height=frame.height;canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(frame)),frame.width,frame.height),0,0);stage=`Reading image page ${i+1} of ${frames.length}\u2026`;floor=i/frames.length*90;span=90/frames.length;try{pages.push(await readPage(canvas));}finally{canvas.width=canvas.height=0;}}
   text=pages.join('\n\f\n');
  }else if(/^(png|jpe?g|webp|bmp)$/.test(extension)){const canvas=await imageCanvas(source);try{text=await readPage(canvas);}finally{canvas.width=canvas.height=0;}}
  else throw Error('This file type is not supported by the document reader.');
  return remember({text,metadata:{},warnings,pages:text.split('\f').length,engine:'browser-reader'});
 }finally{if(worker&&readerRuntime.worker===worker)readerRuntime.idle=setTimeout(()=>{stopReaderWorker();},60000);if(readerRuntime.owner===operation)readerRuntime.logger=null;await pdf?.destroy();}
}
/* End full-document reader. */

  let lastOcrMetadata=null,lastOcrWarnings=[];
  function setFieldState(id,state,evidence='') {
   const input=$(id);if(!input)return;input.dataset.ocrState=state;
   const label=document.querySelector(`label[for="${id}"]`);if(!label)return;
   let badge=label.querySelector('.ocr-field-badge');
   if(!state){badge?.remove();return;}
   if(!badge){badge=document.createElement('span');badge.className='ocr-field-badge';label.append(badge);}
   badge.dataset.state=state;badge.textContent=({detected:'Detected',review:'Review',missing:'Enter manually',edited:'Edited',generated:'Generated'})[state]||state;
   badge.title=String(evidence||'').slice(0,1500);
  }
  function setReaderState(state,label) {
   $('encodingModal').dataset.ocrState=state;$('filePickerState').dataset.state=state;$('ocrStateLabel').textContent=label;
   $('filePickerState').setAttribute('aria-busy',String(state==='processing'));
  }
  function syncOcrControls() {
   const reading=ocrActive||Boolean(pendingRead);
   $('saveRecordBtn').disabled=busy||reading;
   $('runOcrBtn').disabled=busy||reading||routeCommitted||!file;
   $('browseDocumentBtn').disabled=$('removeDocumentBtn').disabled=busy||routeCommitted;
   $('documentFileInput').disabled=busy||routeCommitted;
   if(!reading)$('ocrStopControls').hidden=true;
  }
  function applyOcrValue(id,value,force=false) {
   const input=$(id);if(!input||!ocrFormIds.has(id)||commManualFields.has(id))return false;
   const current=input.value.trim(),previous=commOcrValues.get(id);
   if(typeof value==='string'&&value.trim()&&(!current||current===previous||force)) {
    if(input.tagName==='SELECT'&&![...input.options].some(option=>option.value===value))return false;
    input.value=value;if(!input.value)return false;commOcrValues.set(id,input.value);return true;
   }
   if(!value&&previous!==undefined&&current===previous){input.value='';commOcrValues.delete(id);}
   return false;
  }
  function browserFormValues(data,text) {
   const outgoing=$('typeSelect').value==='Outgoing',memo=Boolean(data.isMemo||data.documentType==='Memorandum');
   const review=new Set(data.needsReview||[]),received=review.has('receivedFrom')?'':data.receivedFrom||'';
   const values={controlNoInput:(memo?data.memoNo:'')||data.controlNo||'',docTypeSelect:data.documentType||data.docType||'',
    subjectInput:data.subject||'',officeInput:outgoing?(data.recipient||data.addressedTo||''):received,
    dateInput:parseMemoDate((memo?data.date:outgoing?data.releasedDate:data.receivedDate)||data.date||'')};
   if(memo){values.memoRecipientInput=data.recipient||data.addressedTo||'';values.memoIssuerInput=review.has('receivedFrom')?'':data.signatory||data.issuedBy||'';}
   for(const [id,label]of [['statusSelect','STATUS'],['actionTakenInput','ACTION\\s+TAKEN|DATE\\s+FORWARDED'],['remarksInput','REMARKS']]){
    const match=String(text).match(new RegExp(`^\\s*(?:${label})\\s*[:\uff1a;]\\s*([^\\n\\f]+)`,'im'));
    if(match){let value=match[1].trim();if(id==='statusSelect')value=[...$('statusSelect').options].find(option=>option.value.toLowerCase()===value.toLowerCase())?.value||'';if(value)values[id]=value;}
   }
   if(values.docTypeSelect&&![...$('docTypeSelect').options].some(option=>option.value===values.docTypeSelect))values.docTypeSelect='Other Communication';
   return values;
  }
  function extractFields(text,metadata=null,warnings=[],form=null) {
   lastOcrMetadata=metadata;lastOcrWarnings=warnings;lastOcrForm=form;
   const contract=form?.formSchemaVersion===1&&form.formValues&&typeof form.formValues==='object';
   // Python supplies the field mapping. Parse locally only for browser/manual reads.
   const data=contract&&metadata?metadata:{...parseDocumentHeader(text),...parseLetterDetails(text),...parseCorrespondence(text),...(metadata||{})};
   const fallback=browserFormValues(data,contract?'':text);
   const values=contract?{...form.formValues}:fallback;
   const directionChanged=contract&&form.communicationType!==$('typeSelect').value;
   if(contract&&!values.officeInput&&!fallback.officeInput)values.officeInput='';
   // Direction can change during OCR; sender/recipient mapping follows the current form.
   if(directionChanged){values.officeInput=fallback.officeInput;values.dateInput=fallback.dateInput;}
   for(const[id,value]of Object.entries(values)) {
    if(id==='ocrTextInput'||!ocrFormIds.has(id)||typeof value!=='string')continue;
    if(applyOcrValue(id,value,true)) {
     const key=({docTypeSelect:'documentType',subjectInput:'subject',officeInput:$('typeSelect').value==='Outgoing'?'recipient':'receivedFrom',dateInput:'date'})[id];
     const source=data[key+'Source'];
     const contractState=directionChanged&&['officeInput','dateInput'].includes(id)?null:form?.fieldStates?.[id];
     let state=contractState?.state||(data.needsReview?.includes(key)||['body','subject','fallback','letterhead','approval','footer-name','prepared-by'].includes(source)||key==='receivedFrom'&&data.receivedFromNeedsReview?'review':'detected');
     if(id==='dateInput'&&!data.isMemo&&!data[$('typeSelect').value==='Outgoing'?'releasedDate':'receivedDate'])state='review';
     setFieldState(id,state==='review'?'review':'detected',contractState?.evidence||data.fieldEvidence?.[key]||'Detected from the uploaded document.');
    }
   }
   detectedMemo=!commManualFields.has('docTypeSelect')&&isMemo();updateDestination();
   if(!values.controlNoInput&&!commManualFields.has('controlNoInput')&&!editing){applyOcrValue('controlNoInput',isMemo()?newMemoControlNo():newControlNo(),true);setFieldState('controlNoInput','generated','No printed number was detected. This reference was generated from the registry.');}
   if(!values.dateInput&&$('dateInput').value&&!commManualFields.has('dateInput'))setFieldState('dateInput','review','No printed date was detected. Confirm the date received / released.');
   const required=[...$('communicationForm').querySelectorAll('input[required],select[required],textarea[required]')];
   for(const input of required)if(!input.value.trim())setFieldState(input.id,'missing','This required value could not be detected. Enter it manually.');
   const candidates=data.signatoryCandidates||[],outgoing=$('typeSelect').value==='Outgoing';
   const received=(data.needsReview||[]).includes('receivedFrom')?'':data.receivedFrom||'';
   const select=$('ocrSignatorySelect');select.replaceChildren(new Option('Choose the originating person\u2026',''));
   for(const candidate of candidates)select.add(new Option(`${candidate.name}${candidate.role?' \u2014 '+candidate.role:''} (page ${candidate.page})`,candidate.name));
   select.value=received;$('ocrSignatoryGroup').hidden=outgoing||(!candidates.length)||(candidates.length===1&&!data.receivedFromNeedsReview);
   const pageCount=Number(form?.pages)||text.split('\f').length,review=$('communicationOcrReview');review.hidden=!text.trim();
   review.textContent=`Read ${pageCount} ${pageCount===1?'page':'pages'} \xb7 ${text.length.toLocaleString()} characters. `+
    (outgoing?(data.recipient?'Recipient detected. ':'Enter the recipient office manually. '):received?'Originating person detected. ':candidates.length>1?'Choose the originating person from the detected names. ':'Enter Received From manually. ')+[...new Set([...(outgoing?[]:data.senderReviewReasons||[]),...warnings])].join(' ');
   if((data.needsReview||[]).some(key=>key==='subject'||key==='documentType'))review.textContent+=' Confirm the suggested subject and document type.';
   if($('dateInput').dataset.ocrState==='review')review.textContent+=values.dateInput?' The printed issue date was suggested; confirm the actual received / released date.':' No printed date was detected. Confirm the date received / released.';
   $('communicationMemoReview').hidden=!(data.isMemo||data.documentType==='Memorandum');
   $('communicationMemoReview').textContent=isMemo()?'Memorandum detected. Confirm the memo number, issue date, recipient and issuing office before saving to Office Memos.':'A memorandum was detected. Your chosen document type is kept; confirm the save destination.';
   const filled=[...commOcrValues.keys()].filter(id=>['detected','review'].includes($(id).dataset.ocrState)).length;
   const missing=required.filter(input=>!input.value.trim()).length,manual=commManualFields.size;
   $('ocrFieldSummary').textContent=`${filled} ${filled===1?'field':'fields'} detected. ${missing?`${missing} required ${missing===1?'field needs':'fields need'} manual entry.`:'Required fields are complete.'}${manual?' Your manual edits are kept.':''}`;
   $('ocrStatsChip').textContent=`${text.length.toLocaleString()} characters \xb7 ${pageCount} ${pageCount===1?'page':'pages'}`;$('ocrStatsChip').style.display=text?'inline-flex':'none';
   return missing;
  }
  async function runDocumentRead(request) {
   const current=()=>request.version===ocrGeneration&&request.source===file;
   if(!current())return;ocrActive=true;syncOcrControls();setReaderState('processing','Reading your document');
   $('ocrStopControls').hidden=false;$('encodingUploadProgressBox').classList.add('active');
   const started=performance.now();let stageMessage='Preparing the document\u2026',lastPercent=0;
   const elapsed=setInterval(()=>{if(current())$('encodingUploadStatusText').textContent=`${stageMessage} \xb7 ${Math.floor((performance.now()-started)/1000)}s`;},1000);
   const progress=(message,pct)=>{if(!current())return;stageMessage=message;lastPercent=Math.max(lastPercent,Math.max(0,Math.min(100,pct)));
    $('encodingUploadStatusText').textContent=message;$('encodingProgressBar').style.width=`${lastPercent}%`;$('communicationOcrProgress').setAttribute('aria-valuenow',String(Math.round(lastPercent)));};
   $('encodingProgressBar').style.width='0%';$('communicationOcrProgress').setAttribute('aria-valuenow','0');
   try {
    progress('Reading all pages automatically\u2026',2);const result=await readWithCancellation(request.source,progress,current);if(!current())return;
    const manualText=commManualFields.has('ocrTextInput');if(!manualText)$('ocrTextInput').value=result.text;
    const missing=extractFields($('ocrTextInput').value,manualText?null:result.metadata,result.warnings||[],manualText?null:result);
    const seconds=((result.durationMs??(performance.now()-started))/1000).toFixed(1);
    $('ocrStatsChip').textContent+=` \xb7 ${seconds}s${result.cacheHit?' \xb7 reused result':''}`;
    setReaderState(missing?'review':'complete',missing?'Review needed':'Ready to review');
    $('ocrActionSubtext').textContent=`Read in ${seconds}s. Review the detected fields, then save.${result.cacheHit?' The existing result was reused.':''}`;
    progress('Document read. Detected details are ready for review.',100);
   } catch(error) {
    if(!current())return;setReaderState('error','Reading needs attention');$('ocrActionSubtext').textContent=error.message||'Reading failed. Retry or fill the details manually.';
    $('ocrFieldSummary').textContent='Your draft is kept. Retry reading or enter the required fields manually.';M.toast($('ocrActionSubtext').textContent,'error');
   } finally {
    clearInterval(elapsed);ocrActive=false;if(current()){$('encodingUploadProgressBox').classList.remove('active');$('ocrStopControls').hidden=true;}syncOcrControls();
   }
  }
  function scheduleDocumentRead() {
   if(!file||busy||routeCommitted)return;
   pendingRead={source:file,version:ocrGeneration};setReaderState('processing','Preparing automatic reading');syncOcrControls();
   if(ocrTask){cancelDocumentRead('replaced');return;}
   const task=(async()=>{while(pendingRead){const request=pendingRead;pendingRead=null;await runDocumentRead(request);}})();ocrTask=task;
   task.catch(error=>{setReaderState('error','Reading needs attention');M.toast(error.message||'The reader stopped. Retry the document.','error');}).finally(()=>{if(ocrTask===task)ocrTask=null;if(pendingRead)scheduleDocumentRead();else syncOcrControls();});
  }
  $('cancelOcrBtn').addEventListener('click',()=>{
   pendingRead=null;ocrGeneration++;cancelDocumentRead();setReaderState('stopped','Reading stopped');
   $('ocrActionSubtext').textContent='Your draft is kept. Select Read again to retry, or fill the details manually.';
   $('encodingUploadProgressBox').classList.remove('active');$('ocrStopControls').hidden=true;syncOcrControls();
  });
  $('encodingModal').addEventListener('pgenro:modal-close',()=>{if(returnToEncoding)return;pendingRead=null;ocrGeneration++;cancelDocumentRead('closed');});
  function selectOcrSender(name) {
   if(!name)return;
   if(!printedSenderName(name,true)){
    $('communicationOcrReview').textContent='The selected OCR text is not a reliable printed name. Read the original and enter the correct name manually.';
    return;
   }
   $('officeInput').value=name;commManualFields.add('officeInput');setFieldState('officeInput','edited','Selected from the printed signatories.');
   let customIssuerKept=false;
   if(isMemo()){
    const issuer=$('memoIssuerInput');
    // A previous dropdown choice is replaceable; a separately typed issuer is preserved.
    const fromSelection=Boolean(issuer.dataset.senderSelection)&&issuer.value===issuer.dataset.senderSelection;
    if(!commManualFields.has('memoIssuerInput')||fromSelection){
     issuer.value=name;issuer.dataset.senderSelection=name;commManualFields.add('memoIssuerInput');
     setFieldState('memoIssuerInput','edited','Selected from the printed signatories.');
    }else customIssuerKept=issuer.value.trim()!==name;
   }
   $('communicationOcrReview').textContent=customIssuerKept
    ? 'Sender selected. Issued by keeps your separate manual value; confirm both people against the original.'
    : 'Received From selected. Confirm it against the original document.';
  }
  $('ocrSignatorySelect').addEventListener('change',()=>selectOcrSender($('ocrSignatorySelect').value));
  $('typeSelect').addEventListener('change',()=>{updateDestination();if($('ocrTextInput').value.trim())extractFields($('ocrTextInput').value,lastOcrMetadata,lastOcrWarnings,lastOcrForm);});
  $('ocrTextInput').addEventListener('change',()=>extractFields($('ocrTextInput').value));
  $('runOcrBtn').addEventListener('click',scheduleDocumentRead);
  let channel,timer;
  function connectRecords() {
   if(!M.client()||channel)return;
   M.read('office_memos').then(rows=>{memoRegistryRows=rows;M.storage.set('pgenro_office_memos',rows);}).catch(()=>{});
   try{channel=M.client().channel('admin-communications').on('postgres_changes',{event:'*',schema:'public',table},()=>{clearTimeout(timer);timer=setTimeout(()=>load(),250);}).subscribe();}catch{}
  }
  window.addEventListener('pgenro:backend-ready',()=>{connectRecords();if(mode!=='loading')load();});
  await load();connectRecords();
  window.addEventListener('storage',e=>{if(e.key===cacheKey&&!M.client())load();});
  window.addEventListener('pagehide',(event)=>{if(event.persisted)return;clearTimeout(timer);generation++;releasePreview();if(channel)M.client()?.removeChannel(channel);});
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
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
      results.innerHTML = matches.length ? matches.map(a => `<a class="workspace-jump-result" href="${M.escape(a.href)}">${a.icon}<span><strong>${M.escape(a.name)}</strong><small>${M.escape(a.group)}</small></span><span class="workspace-jump-arrow" aria-hidden="true">\u2197</span></a>`).join('') : '<p class="workspace-jump-empty">No matching module. Try \u201cmemo\u201d, \u201cinventory\u201d, or \u201cusers\u201d.</p>';
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
        const busy = surface.dataset.busy === 'true'; dialog.setAttribute('aria-busy',String(busy)); status.hidden = !busy; status.textContent = busy ? 'Working\u2026 Please wait before making more changes.' : '';
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
      controls.innerHTML = `<span>Scroll to see all columns</span><div><button type="button" aria-controls="${region.id}" aria-label="Scroll table left">\u2190</button><button type="button" aria-controls="${region.id}" aria-label="Scroll table right">\u2192</button></div>`;
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
    const tableObserver = typeof MutationObserver === 'function' ? new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches('tr,tbody') || node.querySelector('tbody'))))) enhanceEmptyStates();
    }) : null;
    tableObserver?.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('pagehide', event => { if (!event.persisted) { profileObserver?.disconnect(); tableObserver?.disconnect(); sidebarObserver?.disconnect(); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initModernWorkspace, { once: true });
  else initModernWorkspace();
})();

/* ===== PGENRO SLIDE NAVIGATION AND LOGOUT \xb7 module-owned presentation ===== */
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
      dialog.querySelector('[data-workspace-logout-confirm] span').textContent = value ? 'Logging out\u2026' : 'Yes, log out';
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
          <p id="workspaceLogoutDescription">You\u2019ll need to sign in again to access your records and office modules.</p>
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
    if(status==='loading')list.append(element('p','module-notification-empty','Loading notifications\u2026'));
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
  function connectDatabase(){
    if(disposed||authSubscription)return;
    db=window.pgenroSupabase||window.PGENRO_DB?.client;
    if(!db){status='unavailable';render();return;}
    db.auth.getUser().then(result=>attachSession(result.data?.user)).catch(()=>attachSession(null));
    const subscription=db.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>attachSession(session?.user),0);});authSubscription=subscription.data?.subscription;
    timer=setInterval(()=>{if(!document.hidden&&navigator.onLine!==false)refresh();},60000);
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
    const closeBtn=element('button','module-notification-close','\xd7');closeBtn.type='button';closeBtn.setAttribute('aria-label','Close notifications');closeBtn.onclick=()=>{close();button.focus();};top.append(heading,closeBtn);
    const tools=element('div','module-notification-tools'),retry=element('button','','Refresh');retry.type='button';retry.onclick=refresh;
    markAll=element('button','','Mark all read');markAll.type='button';markAll.onclick=async()=>{markAll.disabled=true;try{await markRead();}catch{count.textContent='Could not mark read. Try again.';}finally{markAll.disabled=!feed.total;}};
    tools.append(retry,markAll);list=element('div','module-notification-list');panel.append(top,tools,list);document.body.append(panel);
    button.addEventListener('click',()=>{const open=panel.hidden;close();if(open){panel.hidden=false;position();button.setAttribute('aria-expanded','true');closeBtn.focus();refresh();}});
    document.addEventListener('click',event=>{if(!wrapper.contains(event.target)&&!panel.contains(event.target))close();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){close();button.focus();}});
    window.addEventListener('resize',()=>{if(!panel.hidden)position();});
    window.addEventListener('focus',scheduleRefresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleRefresh();});
    window.addEventListener('pageshow',event=>{if(event.persisted)scheduleRefresh();});
    render();
    window.addEventListener('pgenro:backend-ready',connectDatabase);
    window.PGENRO_Module?.waitForBackend().then(connectDatabase);
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

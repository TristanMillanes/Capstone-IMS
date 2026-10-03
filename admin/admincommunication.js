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
      fileUrl:['fileUrl','file_url','attachment_url']
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
  window.PGENRO_Module = {canStartAction,normalizeCommunicationType,storage,escape,uuid,today,toast,csv,openModal,closeModal,observeRecords,renderIcons,read,write,remove,audit,client,unwrap};
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
  const aliases={type:['type','communicationType','communication_type','direction','recordType','record_type','commType','comm_type'],controlNo:['controlNo','control_no','control_number'],docType:['docType','documentType','document_type','doc_type'],date:['date','receivedDate','date_received'],office:['office','receivedFrom','received_from','recipient_office'],subject:['subject','particulars'],actionTaken:['actionTaken','action_taken'],remarks:['remarks'],status:['status'],ocrText:['ocrText','ocr_text'],fileName:['fileName','file_name'],fileType:['fileType','file_type'],attachmentId:['attachmentId','attachment_id'],fileUrl:['fileUrl','file_url','attachment_url']};
  const fields={};
  const routeJournalKey='pgenro_memo_routes';
  let routeCommitted=false,remoteAttachmentRemoved=false,detectedMemo=false;
  const commOcrValues=new Map(),commManualFields=new Set();
  const memoInputs={memoNo:'controlNoInput',date:'dateInput',addressedTo:'memoRecipientInput',issuedBy:'memoIssuerInput',subject:'subjectInput'};
  for(const id of [...Object.values(memoInputs),'officeInput'])$(id).addEventListener('input',()=>commManualFields.add(id));
  $('docTypeSelect').addEventListener('input',()=>commManualFields.add('docTypeSelect'));
  const isMemo=()=>$('docTypeSelect').value==='Memorandum';
  function updateDestination() {
   const memo=isMemo();
   $('documentDestination').textContent=memo?'Save destination: Office Memos. Review the memo details below. Attachments: maximum 10 MB.':'Save destination: Communications.';
   $('documentDestination').classList.toggle('is-memo',memo);
   $('memoRecipientGroup').hidden=$('memoIssuerGroup').hidden=!memo;
   $('memoRecipientInput').required=memo;
   $('officeInput').required=!memo;
   if(!editing&&memo&&$('controlNoInput').value===newControlNo())$('controlNoInput').value='';
   if(!memo&&!$('controlNoInput').value)$('controlNoInput').value=newControlNo();
   $('saveRecordBtn').querySelector('span').textContent=routeCommitted?'Finish Move to Office Memos':memo?'Save to Office Memos':editing?'Save Changes':'Save Record';
  }
  $('docTypeSelect').addEventListener('change',()=>{detectedMemo=false;updateDestination();});
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
    const pdfUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('The memo attachment could not be read.'));reader.readAsDataURL(blob.slice(0,blob.size,mime));});
    return {pdfUrl,pdfFileName:name};
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
    const memo={memoNo:payload.controlNo,date:payload.date,addressedTo,issuedBy,subject:payload.subject,title:payload.subject,remarks,isPinned:false,...document,createdAt:now,updatedAt:now};
    const id=pending?.id||M.uuid();
    journal[key]={id,memoNo:payload.controlNo,sourceId:editing||null};
    if(!M.storage.set(routeJournalKey,journal))throw new Error('Browser storage is unavailable. Enable it before saving so an interrupted upload can be retried safely.');
    saved=await M.write('office_memos',memo,null,{insertId:id});
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
    <td><strong>${esc(r.controlNo||'—')}</strong><span class="employee-sub">${esc(r.type||'—')} · ${esc(r.docType||'—')}</span></td>
    <td>${esc(r.date||'—')}</td><td class="communication-office">${esc(r.office||'—')}</td><td class="communication-subject">${esc(r.subject||'—')}</td>
    <td>${r.attachmentId||r.fileUrl?`<button class="btn btn-sm btn-secondary" data-action="file" data-id="${esc(r.id)}" title="View attached document"><i data-lucide="paperclip"></i> View file</button><span class="employee-sub">${esc(r.fileName||'Document')}</span>`:'—'}</td>
    <td><span class="badge-status ${r.status==='Pending'?'urgent':'success'}">${esc(r.status||'—')}</span></td>
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
   try {if(!M.client()){mode='local';const cached=M.storage.get(cacheKey,M.storage.get('communicationRecords',[]));records=(Array.isArray(cached)?cached:[]).map(normalize);}
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
  function resetFile(remove=false) {ocrGeneration++;file=null;attachment=null;if(remove)remoteAttachmentRemoved=true;$('documentFileInput').value='';releasePreview();$('fileNameDisplay').textContent='Choose a document file';$('fileMetaDisplay').textContent='PDF, images, DOCX, TXT • Max 50 MB';$('removeDocumentBtn').style.display='none';$('runOcrBtn').disabled=true;$('filePreviewContainer').style.display='none';$('filePreviewBody').replaceChildren();}
  function setPreview(blob) {
   releasePreview();previewUrl=URL.createObjectURL(blob);const root=$('filePreviewBody');root.replaceChildren();let node;
   if(blob.type.startsWith('image/')){node=document.createElement('img');node.alt='Attached document preview';node.src=previewUrl;}
   else if(blob.type==='application/pdf'||/\.pdf$/i.test(blob.name||'')){
    node=document.createElement('div');node.className='communication-pdf-preview-card';
    const label=document.createElement('p');label.textContent='PDF attachment ready for preview.';
    const button=document.createElement('button');button.type='button';button.className='btn btn-secondary';button.id='previewSelectedDocumentBtn';button.textContent='Preview document';
    button.addEventListener('click',()=>viewFile({previewBlob:blob,fileName:blob.name||'Communication.pdf',fileType:blob.type,controlNo:$('controlNoInput').value,subject:$('subjectInput').value},true));
    node.append(label,button);
   }
   else {node=document.createElement('p');node.textContent='Open or download this file to view it in its original application.';}
   root.append(node);$('filePreviewContainer').style.display='block';$('previewOpenExternalBtn').href=previewUrl;$('previewOpenExternalBtn').style.display='inline-flex';
  }
  async function openEditor(id=null) {
   if(busy)return;routeCommitted=false;remoteAttachmentRemoved=false;detectedMemo=false;commOcrValues.clear();commManualFields.clear();$('communicationMemoReview').hidden=true;$('communicationOcrReview').hidden=true;$('ocrSignatoryGroup').hidden=true;lastOcrMetadata=null;lastOcrWarnings=[];
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
    attachment=r.attachmentId?{id:r.attachmentId,name:r.fileName,type:r.fileType}:null;if(attachment){$('fileNameDisplay').textContent=attachment.name||'Existing attachment';$('fileMetaDisplay').textContent='Previously attached file';$('removeDocumentBtn').style.display='inline-flex';}
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
   updateDestination();M.openModal('encodingModal');
  }
  // IndexedDB retains large attachments without exhausting localStorage.
  let dbPromise;
  function attachmentDB(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const req=indexedDB.open('pgenro_communication_attachments',1);req.onupgradeneeded=()=>req.result.createObjectStore('files');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(new Error('Attachment storage is unavailable.'));});return dbPromise;}
  async function attachmentIO(action,id,value){const db=await attachmentDB();return new Promise((resolve,reject)=>{const tx=db.transaction('files',action==='get'?'readonly':'readwrite');const req=action==='put'?tx.objectStore('files').put(value,id):action==='delete'?tx.objectStore('files').delete(id):tx.objectStore('files').get(id);let result;req.onsuccess=()=>result=req.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(new Error('Could not store the attachment. Browser storage may be full.'));tx.onabort=()=>reject(new Error('Attachment storage was interrupted.'));});}
  $('documentFileInput').addEventListener('change',()=>{
   const chosen=$('documentFileInput').files[0];if(!chosen)return;if(chosen.size>50*1024*1024){M.toast('Choose a file no larger than 50 MB.','warning');$('documentFileInput').value='';return;}
   if(!/\.(pdf|png|jpe?g|webp|bmp|tiff?|docx|txt|csv|xlsx|pptx)$/i.test(chosen.name)){M.toast('Unsupported attachment type.','warning');$('documentFileInput').value='';return;}
   for(const[id,value]of commOcrValues)if($(id).value===value&&!commManualFields.has(id))$(id).value='';commOcrValues.clear();
   if(detectedMemo){$('docTypeSelect').value='';detectedMemo=false;}
   $('communicationMemoReview').hidden=true;$('communicationOcrReview').hidden=true;$('ocrSignatoryGroup').hidden=true;lastOcrMetadata=null;lastOcrWarnings=[];
   $('ocrTextInput').value='';$('ocrStatsChip').style.display='none';updateDestination();
   ocrGeneration++;file=chosen;attachment=null;$('fileNameDisplay').textContent=chosen.name;$('fileMetaDisplay').textContent=`${(chosen.size/1024/1024).toFixed(2)} MB`;$('removeDocumentBtn').style.display='inline-flex';$('runOcrBtn').disabled=false;$('ocrActionSubtext').textContent='Read all pages, the letter body, and the printed signatory. Review the detected fields before saving.';setPreview(chosen);
  });
  $('browseDocumentBtn').addEventListener('click',()=>$('documentFileInput').click());$('removeDocumentBtn').addEventListener('click',()=>resetFile(true));
  $('communicationForm').addEventListener('submit',async e=>{
   e.preventDefault();if(busy||!$('communicationForm').reportValidity())return;
   const payload=Object.fromEntries(Object.entries(fieldInputs).map(([k,id])=>[k,$(id).value.trim()]));if(!isMemo()&&records.some(r=>String(r.id)!==String(editing)&&String(r.controlNo||'').trim().toLowerCase()===payload.controlNo.toLowerCase()))return M.toast('This control number already exists. Use a unique number.','warning');
   let newAttachment=null;const priorAttachment=records.find(r=>String(r.id)===String(editing))?.attachmentId;
   try {requireWrite();busy=true;$('encodingModal').dataset.busy='true';$('saveRecordBtn').disabled=true;$('runOcrBtn').disabled=true;
    $('browseDocumentBtn').disabled=$('removeDocumentBtn').disabled=true;
    for(const input of $('communicationForm').querySelectorAll('input,select,textarea'))input.disabled=true;
    if(isMemo()){await saveToMemos(payload);return;}
    if(file){newAttachment=M.uuid();await attachmentIO('put',newAttachment,file);attachment={id:newAttachment,name:file.name,type:file.type};}
    payload.attachmentId=attachment?.id||null;payload.fileName=attachment?.name||'';payload.fileType=attachment?.type||'';
    if(remoteAttachmentRemoved)payload.fileUrl='';
    // An existing remote attachment URL remains intact when editing other fields.
    const saved=await persist(payload,editing);if(mode==='live'){records=editing?records.map(r=>String(r.id)===String(editing)?saved:r):[saved,...records];M.storage.set(cacheKey,records);}M.observeRecords('communications',records);render();
    if(priorAttachment&&priorAttachment!==attachment?.id)attachmentIO('delete',priorAttachment).catch(()=>{});
    M.audit(editing?'EDIT_RECORD':'ADD_RECORD',`Communication ${payload.controlNo}`);busy=false;$('encodingModal').dataset.busy='false';M.closeModal('encodingModal');M.toast(mode==='local'?'Communication saved in this browser.':'Communication saved successfully.');
   }catch(error){if(newAttachment){attachmentIO('delete',newAttachment).catch(()=>{});attachment=null;}M.toast(error.message||'Could not save this record.','error');}
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
      communicationPdfLibraryPromise=import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs').then(lib=>{
        lib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
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
      const response=await fetch(url,{signal});
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
    commPdfRenderStatus.textContent='Rendering page…';commPdfStage.setAttribute('aria-busy','true');
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
        const task=lib.getDocument({data:bytes,isEvalSupported:false});commPreview.pdfTask=task;
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
    $('docViewerSubtitle').textContent=[r.subject,filename].filter(Boolean).join(' · ');
    showCommunicationPreviewState('Loading attachment…','Preparing the document preview.');
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
 const remember=result=>{checkRead();const finished={...result,durationMs:Math.round(performance.now()-started)};readerResults.set(source,finished);return finished;};
 const extension=source.name.split('.').pop().toLowerCase();
 if(/^(txt|csv)$/.test(extension)){
  const bytes=new Uint8Array(await source.arrayBuffer()),encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
  const text=new TextDecoder(encoding).decode(bytes);return remember({text,metadata:{},warnings:[],pages:text.split('\f').length,engine:'native-text'});
 }
 const warnings=[],endpoint=document.querySelector('meta[name="pgenro-ocr-endpoint"]')?.content?.trim();
 if(endpoint){
  let health=null;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2000);if(operation)operation.controller=controller;
  try{
   progress('Checking the local document reader…',3);
   const healthUrl=new URL(endpoint,location.href);healthUrl.pathname=healthUrl.pathname.replace(/\/ocr\/?$/,'/health');
   const response=await fetch(healthUrl.href,{signal:controller.signal,cache:'no-store'});
   if(response.ok)health=await response.json();
  }catch{}finally{clearTimeout(timer);}
  checkRead();
  if(health&&(health.ok||health.success)){
   const controller=new AbortController(),waitMs=Math.max(45000,Math.min(900000,(Number(health.documentTimeoutSeconds)||120)*1000+15000)),timer=setTimeout(()=>controller.abort(),waitMs);
   try{
    if(operation){operation.controller=controller;operation.endpoint=endpoint;operation.requestId=crypto.randomUUID();controller.signal.addEventListener('abort',()=>notifyReaderCancel(operation),{once:true});}
    progress('Reading all pages with the local OCR reader…',8);const body=new FormData();body.append('file',source);
    const response=await fetch(endpoint,{method:'POST',body,headers:operation?{'X-OCR-Request-ID':operation.requestId}:{},signal:controller.signal});let result;
    try{result=await response.json();}catch{throw Error('The document reader returned an invalid response. Restart the OCR server.');}
    if(!response.ok||result.success===false){
     if(response.status===503){warnings.push('The local OCR engine is unavailable; the browser reader was used.');}
     else throw Error(result.error||'The OCR service could not read this document.');
    }else{
     if(typeof result.text!=='string')throw Error('The OCR service returned no document text.');
     return remember({...result,metadata:result.metadata||{},warnings:result.warnings||[]});
    }
   }catch(error){
    // A slow or rejected document is not OCR'd all over again in the browser.
    if(error.name==='AbortError')throw Error('The OCR reader reached the time limit. Split the document into smaller files and retry.');
    if(error instanceof TypeError)warnings.push('The local reader disconnected; the browser reader was used.');
    else throw error;
   }finally{clearTimeout(timer);}
  }else warnings.push('The local OCR reader is not running; the browser reader was used. Start START_OCR.bat for local reading.');
 }
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
  try{worker=await readerRuntime.promise;}catch(error){readerRuntime.promise=null;throw error;}
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
  if(text&&!parseCorrespondence(text).receivedFrom&&signatureHint){
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

  let lastOcrMetadata=null,lastOcrWarnings=[];
  function applyOcrValue(id,value,generated=false){
   const input=$(id),current=input.value.trim(),previous=commOcrValues.get(id);
   if(commManualFields.has(id))return;
   if(value&&(!current||current===previous||generated)){input.value=value;commOcrValues.set(id,value);}
   else if(!value&&previous!==undefined&&current===previous){input.value='';commOcrValues.delete(id);}
  }
  function extractFields(text,metadata=null,warnings=[]){
   lastOcrMetadata=metadata;lastOcrWarnings=warnings;
   const headerFields=parseDocumentHeader(text),parsed=parseCorrespondence(text),data={...headerFields,...parsed,...(metadata||{})},memo=detectMemo(text);
   const candidates=data.signatoryCandidates||parsed.signatoryCandidates;
   if(!memo&&detectedMemo){detectedMemo=false;$('docTypeSelect').value='';applyOcrValue('memoRecipientInput','');applyOcrValue('memoIssuerInput','');}
   if(memo){
    detectedMemo=true;$('docTypeSelect').value='Memorandum';
    const values={...memo,subject:data.subject||memo.subject,date:parseMemoDate(data.date||'')||memo.date,memoNo:data.memoNo||memo.memoNo||data.controlNo,addressedTo:data.recipient||memo.addressedTo,issuedBy:data.sender||data.issuedBy||memo.issuedBy||data.signatory};
    for(const[key,id]of Object.entries(memoInputs))applyOcrValue(id,values[key],!editing&&((key==='date'&&$(id).value===M.today())||(key==='memoNo'&&$(id).value===newControlNo())));
    $('communicationMemoReview').hidden=false;$('communicationMemoReview').textContent=`Memorandum detected. Review the memo fields and save to Office Memos. ${memo.warnings.join(' ')} Manual edits are preserved.`;
   }else{
    $('communicationMemoReview').hidden=true;
    applyOcrValue('docTypeSelect',data.documentType||headerFields.docType||'');
    const header=text.split('\f')[0].split(/\r?\n/).slice(0,100).join('\n');
    const control=header.match(/(?:^|\n)\s*(?:control\s*(?:no\.?|number|#)|reference\s*(?:no\.?|number))\s*[:#.-]?\s*([A-Z0-9][A-Z0-9/._-]*(?:,?\s*s\.?\s*\d{4})?)/i);
    const subject=memo?memo.subject:headerFields.subject;
    applyOcrValue('controlNoInput',data.controlNo||control?.[1]||'',!editing&&$('controlNoInput').value===newControlNo());
    applyOcrValue('subjectInput',data.subject||subject||'');
    applyOcrValue('dateInput',parseMemoDate(data.date||'')||headerFields.date,!editing&&$('dateInput').value===M.today());
   }
   const outgoing=$('typeSelect').value==='Outgoing';
   const received=(data.needsReview||[]).includes('receivedFrom')&&candidates.length>1?'':data.receivedFrom||data.signatory||data.sender||'';
   const correctedRecipient=!outgoing&&received&&(()=>{const current=$('officeInput').value.trim(),to=String(data.recipient||headerFields.addressedTo||'').trim();return current.length>=4&&(to===current||to.startsWith(current+' '));})();
   applyOcrValue('officeInput',outgoing?(data.recipient||memo?.addressedTo||''):received,correctedRecipient);
   const select=$('ocrSignatorySelect');select.replaceChildren(new Option('Choose the sender / signatory…',''));
   for(const candidate of candidates)select.add(new Option(`${candidate.name}${candidate.role?' — '+candidate.role:''} (page ${candidate.page})`,candidate.name));
   select.value=received;$('ocrSignatoryGroup').hidden=outgoing||candidates.length<2;
   const pageCount=text.split('\f').length,review=$('communicationOcrReview');review.hidden=!text.trim();
   const chosen=candidates.find(c=>c.name===received),ambiguous=(data.needsReview||[]).includes('receivedFrom')&&candidates.length>1;
   review.textContent=(correctedRecipient?'Corrected the TO recipient previously stored as sender. ':'')+`Read ${pageCount} ${pageCount===1?'page':'pages'} (${text.length.toLocaleString()} characters). `+(outgoing?(data.recipient?'Recipient detected: '+data.recipient+'. ':'Recipient was not detected; enter it manually. '):received?`Received From: ${received}${chosen?` (signature area, page ${chosen.page})`:'.'} `:ambiguous?'Multiple possible signatories were found. Choose the sender below. ':'A printed sender or signatory was not detected. Enter Received From manually. ')+warnings.join(' ');
   updateDestination();$('ocrStatsChip').textContent=`${text.length.toLocaleString()} characters · ${pageCount} ${pageCount===1?'page':'pages'}`;$('ocrStatsChip').style.display=text?'inline':'none';
  }
  $('cancelOcrBtn').addEventListener('click',cancelDocumentRead);
  $('ocrSignatorySelect').addEventListener('change',()=>{if(!$('ocrSignatorySelect').value)return;$('officeInput').value=$('ocrSignatorySelect').value;commManualFields.add('officeInput');$('communicationOcrReview').textContent='Received From selected: '+$('officeInput').value+'. Review against the original document before saving.';});
  $('typeSelect').addEventListener('change',()=>{if($('ocrTextInput').value.trim())extractFields($('ocrTextInput').value,lastOcrMetadata,lastOcrWarnings);});
  $('ocrTextInput').addEventListener('change',()=>extractFields($('ocrTextInput').value));
  $('runOcrBtn').addEventListener('click',async()=>{
   if(!file||busy)return;busy=true;const source=file,version=ocrGeneration;
   $('encodingModal').dataset.busy='true';$('ocrStopControls').hidden=false;for(const id of ['runOcrBtn','saveRecordBtn','browseDocumentBtn','removeDocumentBtn'])$(id).disabled=true;$('encodingUploadProgressBox').classList.add('active');
   const started=performance.now();let stageMessage='Reading the document…';const elapsed=setInterval(()=>{$('encodingUploadStatusText').textContent=`${stageMessage} (${Math.floor((performance.now()-started)/1000)}s)`;},1000);
   const progress=(message,pct)=>{stageMessage=message;$('encodingUploadStatusText').textContent=message;$('encodingProgressBar').style.width=`${Math.max(0,Math.min(100,pct))}%`;};
   try{
    progress('Reading the full document…',2);const result=await readWithCancellation(source,progress);if(version!==ocrGeneration)return;
    $('ocrTextInput').value=result.text;extractFields(result.text,result.metadata,result.warnings);
    const seconds=((result.durationMs??(performance.now()-started))/1000).toFixed(1);$('ocrStatsChip').textContent+=` · ${seconds}s${result.cacheHit?' · reused result':''}`;$('ocrActionSubtext').textContent=`Read in ${seconds}s. Review Received From and the detected fields before saving.`;
    M.toast(result.text.trim()?(isMemo()?'Memorandum detected. Review the fields, then save to Office Memos.':'Full document read. Review Received From and the other fields before saving.'):'No readable text was detected. Enter the fields manually.',result.text.trim()?'success':'warning');progress('Full document extraction complete',100);
   }catch(error){M.toast(error.message||'Text extraction failed. You can enter the record manually.',error.message?.startsWith('Reading stopped')?'warning':'error');}
   finally{clearInterval(elapsed);$('ocrStopControls').hidden=true;busy=false;$('encodingModal').dataset.busy='false';for(const id of ['saveRecordBtn','browseDocumentBtn','removeDocumentBtn'])$(id).disabled=false;$('runOcrBtn').disabled=!file;$('encodingUploadProgressBox').classList.remove('active');}
  });
  await load();
  let channel,timer;
  if(M.client())try{channel=M.client().channel('admin-communications').on('postgres_changes',{event:'*',schema:'public',table},()=>{clearTimeout(timer);timer=setTimeout(()=>load(),250);}).subscribe();}catch{}
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

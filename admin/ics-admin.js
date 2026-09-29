/*
 * PGENRO IMS — Supabase data service for admin modules.
 *
 * All storage operations are routed through the single Supabase client created by
 * ../shared/supabase.js.
 * It intentionally does NOT create a second Supabase client.
 */
(() => {
  'use strict';

  if (window.PGENRO_SUPABASE_STORE && window.PGENRO_SUPABASE_STORE.__pgenroSupabaseStore) return;

  const sb = window.pgenroSupabase || window.PGENRO_DB?.client || null;
  if (!sb) {
    console.warn('PGENRO IMS: Supabase data service could not start because the shared Supabase client is unavailable.');
    return;
  }

  const TABLE_ALIASES = {
    users: 'profiles'
  };

  const wrappedCache = new Map();
  const channelRegistry = new Set();

  const tableName = (name) => TABLE_ALIASES[name] || name;
  const uuid = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function normalizeValue(value) {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(normalizeValue);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value)) out[key] = normalizeValue(item);
      return out;
    }
    return value;
  }

  function unwrapRow(row) {
    if (!row || typeof row !== 'object') return row;
    if (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) {
      return {
        ...row.data,
        id: row.id ?? row.data.id,
        created_at: row.created_at ?? row.data.created_at,
        updated_at: row.updated_at ?? row.data.updated_at
      };
    }
    return { ...row };
  }

  // Retry without a supplied ID only when PostgreSQL rejects that ID itself.
  // Permission, network and constraint errors must surface to the caller.
  const isGeneratedIdError = error => ['428C9', '22P02'].includes(String(error?.code || ''));

  async function isWrappedTable(rawName) {
    const name = tableName(rawName);
    if (wrappedCache.has(name)) return wrappedCache.get(name);
    const { error } = await sb.from(name).select('data').limit(1);
    if (error && !['42703', 'PGRST204'].includes(String(error.code || ''))) throw error;
    const wrapped = !error;
    wrappedCache.set(name, wrapped);
    return wrapped;
  }

  async function readRows(rawName, order = null) {
    const name = tableName(rawName);
    let query = sb.from(name).select('*');

    // Stored JSON fields such as createdAt can live inside JSON data, so only use a
    // database-side order when it is a real snake_case column. Otherwise sort
    // after unwrapping.
    if (order?.field && order.field.includes('_')) {
      query = query.order(order.field, { ascending: order.direction !== 'desc' });
    }

    const { data, error } = await query;
    if (error) throw error;

    let rows = (data || []).map(unwrapRow);
    if (order?.field) {
      const dir = order.direction === 'desc' ? -1 : 1;
      rows = rows.sort((a, b) => {
        const av = a?.[order.field];
        const bv = b?.[order.field];
        const ad = new Date(av).getTime();
        const bd = new Date(bv).getTime();
        if (!Number.isNaN(ad) && !Number.isNaN(bd)) return (ad - bd) * dir;
        return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
      });
    }
    return rows;
  }

  async function insertRow(rawName, payload, forcedId = null) {
    const name = tableName(rawName);
    const clean = normalizeValue(payload || {});
    const wrapped = await isWrappedTable(name);

    if (wrapped) {
      const row = forcedId ? { id: forcedId, data: clean } : { data: clean };
      let res = await sb.from(name).insert(row).select('*').single();
      if (res.error && forcedId && isGeneratedIdError(res.error)) {
        // Some schemas generate their own primary key and do not permit a
        // client supplied id. Retry without it and use the returned id.
        res = await sb.from(name).insert({ data: clean }).select('*').single();
      }
      if (res.error) throw res.error;
      return unwrapRow(res.data);
    }

    const direct = forcedId ? { id: forcedId, ...clean } : clean;
    const { data, error } = await sb.from(name).insert(direct).select('*').single();
    if (error) throw error;
    return unwrapRow(data);
  }

  async function getRow(rawName, id) {
    const name = tableName(rawName);
    const { data, error } = await sb.from(name).select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? unwrapRow(data) : null;
  }

  async function updateRow(rawName, id, patch, merge = true) {
    const name = tableName(rawName);
    const clean = normalizeValue(patch || {});
    const wrapped = await isWrappedTable(name);

    if (wrapped) {
      let next = clean;
      if (merge) {
        const current = await getRow(name, id);
        next = { ...(current || {}), ...clean };
        delete next.id;
        delete next.created_at;
        delete next.updated_at;
      }
      const { data, error } = await sb.from(name).update({ data: next }).eq('id', id).select('*').maybeSingle();
      if (error) throw error;
      return data ? unwrapRow(data) : { id, ...next };
    }

    const { data, error } = await sb.from(name).update(clean).eq('id', id).select('*').maybeSingle();
    if (error) throw error;
    return data ? unwrapRow(data) : { id, ...clean };
  }

  async function setRow(rawName, id, payload, merge = false) {
    const name = tableName(rawName);
    const clean = normalizeValue(payload || {});
    const wrapped = await isWrappedTable(name);

    if (wrapped) {
      let next = clean;
      if (merge) {
        const current = await getRow(name, id);
        next = { ...(current || {}), ...clean };
        delete next.id;
        delete next.created_at;
        delete next.updated_at;
      }
      let res = await sb.from(name).upsert({ id, data: next }, { onConflict: 'id' }).select('*').maybeSingle();
      if (res.error) {
        if (!isGeneratedIdError(res.error)) throw res.error;
        const existing = res.error.code === '22P02' ? null : await getRow(name, id);
        if (existing) return updateRow(name, id, clean, merge);
        return insertRow(name, clean);
      }
      return res.data ? unwrapRow(res.data) : { id, ...next };
    }

    if (merge) {
      const existing = await getRow(name, id).catch(() => null);
      if (existing) return updateRow(name, id, clean, true);
    }

    const { data, error } = await sb.from(name).upsert({ id, ...clean }, { onConflict: 'id' }).select('*').maybeSingle();
    if (error) throw error;
    return data ? unwrapRow(data) : { id, ...clean };
  }

  async function deleteRow(rawName, id) {
    const name = tableName(rawName);
    const { error } = await sb.from(name).delete().eq('id', id);
    if (error) throw error;
  }

  function makeTableStoreSnapshot(rows) {
    const docs = (rows || []).map(row => ({
      id: String(row.id ?? ''),
      data: () => {
        const data = { ...row };
        delete data.id;
        return data;
      }
    }));

    return {
      docs,
      empty: docs.length === 0,
      size: docs.length,
      forEach(callback) { docs.forEach(callback); }
    };
  }

  function subscribeTable(rawName, callback, errorCallback, order = null) {
    const name = tableName(rawName);
    let active = true;

    const refresh = async () => {
      if (!active) return;
      try {
        const rows = await readRows(name, order);
        if (active) callback(rows);
      } catch (error) {
        if (active) errorCallback?.(error);
      }
    };

    refresh();

    const channel = sb
      .channel(`supabase-store-${name}-${uuid()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: name }, refresh)
      .subscribe();

    channelRegistry.add(channel);

    return () => {
      active = false;
      channelRegistry.delete(channel);
      try { sb.removeChannel(channel); } catch {}
    };
  }

  class TableStoreQuery {
    constructor(name, order = null) {
      this.name = name;
      this.order = order;
    }

    orderBy(field, direction = 'asc') {
      return new TableStoreQuery(this.name, { field, direction });
    }

    onSnapshot(next, error) {
      return subscribeTable(
        this.name,
        rows => next(makeTableStoreSnapshot(rows)),
        error,
        this.order
      );
    }

    async get() {
      const rows = await readRows(this.name, this.order);
      return makeTableStoreSnapshot(rows);
    }
  }

  class TableStoreDocumentRef {
    constructor(name, id) {
      this.name = name;
      this.id = String(id);
    }

    async set(payload, options = {}) {
      return setRow(this.name, this.id, payload, !!options.merge);
    }

    async update(payload) {
      return updateRow(this.name, this.id, payload, true);
    }

    async delete() {
      return deleteRow(this.name, this.id);
    }

    async get() {
      const row = await getRow(this.name, this.id);
      return {
        id: this.id,
        exists: !!row,
        data: () => {
          if (!row) return undefined;
          const data = { ...row };
          delete data.id;
          return data;
        }
      };
    }
  }

  class TableStoreCollectionRef extends TableStoreQuery {
    constructor(name) {
      super(name, null);
      this.name = name;
    }

    doc(id = uuid()) {
      return new TableStoreDocumentRef(this.name, id);
    }

    async add(payload) {
      const row = await insertRow(this.name, payload);
      return new TableStoreDocumentRef(this.name, row.id || uuid());
    }
  }

  function makeValueSnapshot(value) {
    return {
      val: () => value,
      exists: () => value !== null && value !== undefined && !(typeof value === 'object' && Object.keys(value).length === 0)
    };
  }

  class RealtimeRef {
    constructor(path = '') {
      this.path = String(path || '').replace(/^\/+|\/+$/g, '');
      this._unsubs = [];
      this.key = this.path.split('/').filter(Boolean).pop() || null;
    }

    _parts() {
      return this.path.split('/').filter(Boolean);
    }

    child(childPath) {
      const child = String(childPath || '').replace(/^\/+|\/+$/g, '');
      return new RealtimeRef([this.path, child].filter(Boolean).join('/'));
    }

    push(value) {
      const child = this.child(uuid());
      if (value !== undefined) child.set(value).catch(console.error);
      return child;
    }

    async _read() {
      if (this.path === '.info/connected') return !!navigator.onLine;

      const [rawTable, id] = this._parts();
      if (!rawTable) return null;
      const name = tableName(rawTable);

      if (id) return getRow(name, id);

      const rows = await readRows(name);
      return Object.fromEntries(
        rows.map((row, index) => {
          const key = String(row.id ?? row.user_id ?? index);
          const value = { ...row };
          delete value.id;
          return [key, value];
        })
      );
    }

    async once(eventName) {
      if (eventName !== 'value') throw new Error(`Unsupported Supabase store event: ${eventName}`);
      return makeValueSnapshot(await this._read());
    }

    on(eventName, callback, errorCallback) {
      if (eventName !== 'value') return callback;

      if (this.path === '.info/connected') {
        const emit = () => callback(makeValueSnapshot(!!navigator.onLine));
        emit();
        addEventListener('online', emit);
        addEventListener('offline', emit);
        const unsub = () => {
          removeEventListener('online', emit);
          removeEventListener('offline', emit);
        };
        this._unsubs.push(unsub);
        return callback;
      }

      const [rawTable] = this._parts();
      if (!rawTable) return callback;
      const name = tableName(rawTable);
      let active = true;

      const refresh = async () => {
        if (!active) return;
        try {
          callback(makeValueSnapshot(await this._read()));
        } catch (error) {
          errorCallback?.(error);
        }
      };

      refresh();
      const channel = sb
        .channel(`supabase-realtime-${name}-${uuid()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: name }, refresh)
        .subscribe();
      channelRegistry.add(channel);

      const unsub = () => {
        active = false;
        channelRegistry.delete(channel);
        try { sb.removeChannel(channel); } catch {}
      };
      this._unsubs.push(unsub);
      return callback;
    }

    off() {
      this._unsubs.splice(0).forEach(fn => {
        try { fn(); } catch {}
      });
    }

    async set(value) {
      const [rawTable, id] = this._parts();
      if (!rawTable || !id) throw new Error('Supabase store set() requires a table/id path.');
      return setRow(rawTable, id, value, false);
    }

    async update(value) {
      const [rawTable, id] = this._parts();
      if (!rawTable || !id) throw new Error('Supabase store update() requires a table/id path.');
      return updateRow(rawTable, id, value, true);
    }

    async remove() {
      const [rawTable, id] = this._parts();
      if (!rawTable || !id) throw new Error('Supabase remove() requires a table/id path.');
      return deleteRow(rawTable, id);
    }
  }

  const authApi = {
    currentUser: null,
    onAuthStateChanged(callback) {
      let active = true;
      sb.auth.getSession().then(({ data }) => {
        const user = data?.session?.user || null;
        authApi.currentUser = user;
        if (active) callback(user);
      }).catch(() => active && callback(null));

      const { data } = sb.auth.onAuthStateChange((_event, session) => {
        authApi.currentUser = session?.user || null;
        if (active) callback(authApi.currentUser);
      });

      return () => {
        active = false;
        try { data?.subscription?.unsubscribe?.(); } catch {}
      };
    },
    signOut() {
      return sb.auth.signOut();
    }
  };

  const tableStore = () => ({
    collection(name) {
      return new TableStoreCollectionRef(name);
    }
  });
  tableStore.FieldValue = {
    serverTimestamp: () => new Date().toISOString()
  };

  const realtimeStore = () => ({
    ref(path = '') {
      return new RealtimeRef(path);
    }
  });
  realtimeStore.ServerValue = {};
  Object.defineProperty(realtimeStore.ServerValue, 'TIMESTAMP', {
    enumerable: true,
    get: () => Date.now()
  });

  const supabaseStoreAdapter = {
    __pgenroSupabaseStore: true,
    clients: [{ name: '[PGENRO-SUPABASE]' }],
    connect() { return supabaseStoreAdapter.clients[0]; },
    auth: () => authApi,
    realtimeStore,
    tableStore
  };

  window.PGENRO_SUPABASE_STORE = supabaseStoreAdapter;
  window.PGENRO_SUPABASE_STORE_INFO = {
    client: sb,
    shutdown() {
      for (const channel of [...channelRegistry]) {
        try { sb.removeChannel(channel); } catch {}
      }
      channelRegistry.clear();
    }
  };
})();

/* ===== ICS Admin page controller — admin-interface matched v4 ===== */
(() => {
  'use strict';

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
    const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d;
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
  function refreshIcons(){ window.lucide?.createIcons?.(); }

  function toast(message,type='success'){
    let stack = document.querySelector('.toast-stack');
    if(!stack){ stack=document.createElement('div'); stack.className='toast-stack'; stack.setAttribute('aria-live','polite'); document.body.appendChild(stack); }
    const el=document.createElement('div'); el.className=`toast ${type}`;
    const icon=type==='error'?'circle-alert':type==='warning'?'triangle-alert':'circle-check';
    el.innerHTML=`<i data-lucide="${icon}"></i><span>${escapeHtml(message)}</span>`;
    stack.appendChild(el); refreshIcons();
    setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateY(8px)'; setTimeout(()=>el.remove(),220); },2800);
  }

  function setDatabaseStatus(online,message=''){
    ['dbStatusDot','topStatusDot'].forEach(id=>{ const el=$(id); if(el) el.className=`status-dot ${online?'online':'offline'}`; });
    if($('dbStatusText')) $('dbStatusText').textContent=message || (online?'System Connected':'Database Disconnected');
    if($('topStatusText')) $('topStatusText').textContent=online?'Database Online':'Database Offline';
    const registryBadge=$('registrySyncBadge');
    const registryText=$('registrySyncText');
    registryBadge?.classList.toggle('offline',!online);
    if(registryText) registryText.textContent=online?'Live sync':'Sync offline';
  }

  function initDatabase(){
    const store=window.PGENRO_SUPABASE_STORE;
    if(!store?.tableStore){ state.dbReady=false; setDatabaseStatus(false,'Service unavailable'); return; }
    try{
      state.db=store.tableStore(); state.dbReady=!!state.db; setDatabaseStatus(state.dbReady,state.dbReady?'System Connected':'Database unavailable');
    }catch(err){ console.error('ICS database initialization failed:',err); state.dbReady=false; state.db=null; setDatabaseStatus(false,'Database initialization failed'); }
  }
  function serverTimestamp(){
    return window.PGENRO_SUPABASE_STORE?.tableStore?.FieldValue?.serverTimestamp?.() || new Date().toISOString();
  }

  /* Shell controls */
  function initShell(){
    const sidebar=$('sidebar'), main=document.querySelector('.main-wrapper'), mobile=$('mobileMenuBtn'), collapse=$('sidebarCollapseBtn');
    let backdrop=document.querySelector('.admin-sidebar-backdrop');
    if(!backdrop){ backdrop=document.createElement('div'); backdrop.className='admin-sidebar-backdrop'; document.body.appendChild(backdrop); }
    const closeMobile=()=>{ sidebar?.classList.remove('mobile-open','open'); mobile?.setAttribute('aria-expanded','false'); backdrop.classList.remove('active'); };
    mobile?.addEventListener('click',()=>{ const opening=!sidebar?.classList.contains('mobile-open'); sidebar?.classList.toggle('mobile-open',opening); mobile.setAttribute('aria-expanded',String(opening)); backdrop.classList.toggle('active',opening); });
    backdrop.addEventListener('click',closeMobile);
    collapse?.addEventListener('click',()=>{
      if(innerWidth<=900){ closeMobile(); return; }
      const collapsed=!sidebar?.classList.contains('collapsed'); sidebar?.classList.toggle('collapsed',collapsed); main?.classList.toggle('sidebar-collapsed',collapsed); collapse.setAttribute('aria-expanded',String(!collapsed));
      try{ localStorage.setItem('pgenro_admin_sidebar',collapsed?'collapsed':'expanded'); }catch{}
    });
    try{ if(innerWidth>900 && localStorage.getItem('pgenro_admin_sidebar')==='collapsed'){ sidebar?.classList.add('collapsed'); main?.classList.add('sidebar-collapsed'); collapse?.setAttribute('aria-expanded','false'); } }catch{}
    window.addEventListener('resize',()=>{ if(innerWidth>900) closeMobile(); });

    const profileMenu=$('profileMenu'), profileBtn=$('profileBtn');
    const notificationsBtn=$('notificationsBtn'), notificationDropdown=$('notificationDropdown');
    const closeProfile=()=>{ profileMenu?.classList.remove('open'); profileBtn?.setAttribute('aria-expanded','false'); $('profileDropdown')?.setAttribute('aria-hidden','true'); };
    const closeNotifications=()=>{ notificationDropdown?.classList.remove('open'); notificationsBtn?.setAttribute('aria-expanded','false'); notificationDropdown?.setAttribute('aria-hidden','true'); };
    profileBtn?.addEventListener('click',(e)=>{ e.stopPropagation(); const open=!profileMenu?.classList.contains('open'); closeNotifications(); profileMenu?.classList.toggle('open',open); profileBtn.setAttribute('aria-expanded',String(open)); $('profileDropdown')?.setAttribute('aria-hidden',String(!open)); });
    notificationsBtn?.addEventListener('click',(e)=>{ e.stopPropagation(); const open=!notificationDropdown?.classList.contains('open'); closeProfile(); notificationDropdown?.classList.toggle('open',open); notificationsBtn.setAttribute('aria-expanded',String(open)); notificationDropdown?.setAttribute('aria-hidden',String(!open)); });
    document.addEventListener('click',(e)=>{ if(profileMenu && !profileMenu.contains(e.target)) closeProfile(); if(notificationDropdown && !notificationDropdown.contains(e.target) && !notificationsBtn?.contains(e.target)) closeNotifications(); });

    $('logoutBtn')?.addEventListener('click',async()=>{
      const btn=$('logoutBtn'); if(btn) btn.disabled=true;
      try{ await (window.pgenroSupabase || window.PGENRO_DB?.client)?.auth?.signOut?.(); }
      catch(err){ console.warn('Sign-out failed:',err); }
      finally{ window.location.href='../User/login.html'; }
    });
  }

  /* Form UI */
  const form=$('icsForm'), editorModal=$('editorModal'), viewModal=$('viewModal');
  function setModalOpen(modal,open){
    if(!modal) return;
    modal.classList.toggle('open',open); modal.setAttribute('aria-hidden',String(!open));
    const anyOpen=$$('.modal-backdrop.open').length>0; document.body.classList.toggle('admin-modal-open',anyOpen || open);
  }
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
    return true;
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
    resetForm();
    if(record){ if($('editorTitle')) $('editorTitle').textContent='Edit Inventory Custodian Slip'; if($('recordId')) $('recordId').value=record.id||''; populateForm(record); }
    setModalOpen(editorModal,true); setTimeout(()=>$('controlNo')?.focus(),80);
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
    event.preventDefault(); if(!validateForm()) return;
    if(!state.dbReady || !state.db){ showFormFeedback('The form is working, but Supabase is not connected. Check ../shared/supabase.js and your database/RLS settings before saving.'); setDatabaseStatus(false,'Database unavailable'); return; }
    const button=$('saveIcsBtn'), original=button?.innerHTML; if(button){ button.disabled=true; button.setAttribute('aria-busy','true'); button.innerHTML='<i class="loading-spin" data-lucide="loader-circle"></i><span>Saving...</span>'; refreshIcons(); }
    try{
      const data=getFormData(), recordId=$('recordId')?.value.trim();
      if(recordId){ await state.db.collection('ics_records').doc(recordId).set({...data,updatedAt:serverTimestamp()},{merge:true}); toast('ICS record updated successfully.'); }
      else{ await state.db.collection('ics_records').add({...data,createdAt:serverTimestamp(),updatedAt:serverTimestamp()}); toast('ICS record saved successfully.'); }
      closeEditor();
    }catch(err){ console.error('Save ICS error:',err); showFormFeedback(`Unable to save this ICS record. ${err?.message ? 'Database response: '+err.message : 'Check Supabase configuration and RLS policies.'}`); }
    finally{ if(button){ button.disabled=false; button.removeAttribute('aria-busy'); button.innerHTML=original; refreshIcons(); } }
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

  function attachRealtime(){
    if(!state.dbReady||!state.db){ renderTable([]); return; }
    try{
      state.unsubscribe=state.db.collection('ics_records').onSnapshot(snapshot=>{
        state.records=[]; snapshot.forEach(doc=>state.records.push({id:doc.id,...doc.data()})); sortRecords(); updateKpis(); populateFilters(); applyFilters(); setDatabaseStatus(true,'System Connected');
      },err=>{ console.error('ICS realtime listener error:',err); setDatabaseStatus(false,'Supabase Read Error'); state.dbReady=false; renderTable([]); });
    }catch(err){ console.error('Unable to attach ICS listener:',err); state.dbReady=false; setDatabaseStatus(false,'Database listener failed'); renderTable([]); }
  }

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
    try{ await state.db.collection('ics_records').doc(record.id).delete(); toast('ICS record deleted successfully.'); }
    catch(err){ console.error('Delete ICS error:',err); toast(`Delete failed${err?.message?': '+err.message:'.'}`,'error'); }
  }

  function bindRegistry(){
    const search=$('icsSearchInput'), global=$('globalSearchInput'); search?.addEventListener('input',()=>{ if(global && global.value!==search.value) global.value=search.value; applyFilters(); }); global?.addEventListener('input',()=>{ if(search) search.value=global.value; applyFilters(); });
    $('articleFilter')?.addEventListener('change',applyFilters); $('divisionFilter')?.addEventListener('change',applyFilters);
    $$('.view-tab').forEach(btn=>btn.addEventListener('click',()=>{ $$('.view-tab').forEach(x=>x.classList.remove('active')); btn.classList.add('active'); state.statusFilter=btn.dataset.statusFilter||'ALL'; applyFilters(); }));
    $('clearFiltersBtn')?.addEventListener('click',()=>{ if(search) search.value=''; if(global) global.value=''; if($('articleFilter')) $('articleFilter').value='ALL'; if($('divisionFilter')) $('divisionFilter').value='ALL'; state.statusFilter='ALL'; $$('.view-tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.statusFilter==='ALL')); applyFilters(); });
    $('icsTableBody')?.addEventListener('click',(e)=>{ const btn=e.target.closest('[data-action]'); if(!btn) return; const record=state.records.find(r=>String(r.id)===String(btn.dataset.id)); if(!record) return; if(btn.dataset.action==='view') openView(record); else if(btn.dataset.action==='edit') openEditor(record); else if(btn.dataset.action==='delete') deleteRecord(record); });
    $('closeViewBtn')?.addEventListener('click',closeView); viewModal?.addEventListener('click',(e)=>{ if(e.target===viewModal) closeView(); });
    $('editViewBtn')?.addEventListener('click',()=>{ const r=activeRecord(); if(r){ closeView(); openEditor(r); } }); $('deleteViewBtn')?.addEventListener('click',async()=>{ const r=activeRecord(); if(r){ closeView(); await deleteRecord(r); } }); $('printViewBtn')?.addEventListener('click',()=>{ const r=activeRecord(); if(r) printRecord(r); });
    $('exportCsvBtn')?.addEventListener('click',exportCsv);
  }

  function exportCsv(){
    if(!state.records.length){ toast('There are no ICS records to export.','warning'); return; }
    const headers=['Control No.','ICS No.','Entry No.','Account Code','Article','Item Description','Serial No.','Item / Inventory No.','Unit','Quantity','Unit Cost','Total Value','Date Acquired','PR No.','PR Date','Fund Cluster','Person Accountable','Division / Unit','Status','Remarks'];
    const rows=state.records.map(r=>[r.controlNo,r.icsNo,r.entryNo,r.accountCode,r.article,r.itemDescription,r.serialNo,r.itemNo,r.unit,r.quantity,r.unitCost,r.totalValue!=null?r.totalValue:(Number(r.quantity)||0)*(Number(r.unitCost)||0),r.dateAcquired,r.prNo,r.prDate,r.fundCluster,r.accountablePerson,r.division,r.status||'Active',r.remarks]);
    const csv=[headers,...rows].map(row=>row.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n'); const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}), url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url;a.download=`PGENRO_ICS_Records_${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);toast('CSV export generated.');
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
    refreshIcons(); initShell(); bindForm(); bindRegistry(); bindKeyboard(); initDatabase(); updateTotals(); updateRemarksCounter(); updateProgress(); attachRealtime();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
  window.addEventListener('beforeunload',()=>{ try{ state.unsubscribe?.(); }catch{} });
})();

/* Module-owned motion; content remains visible if JavaScript is unavailable. */
/* Progressive, one-time entrance effects for the administrator workspace. */
(() => {
  'use strict';
  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const targets = [
    '.main-content > .page-header',
    '.main-content > .ics-admin-header',
    '.main-content :is(.kpi-grid,.stats-grid,.metrics-grid,.ics-kpi-grid) > *',
    '.main-content .module-control-grid > *',
    '.main-content :is(.section-header,.panel-header,.ics-panel-header)',
    '.main-content :is(.chart-card,.table-card,.ics-panel,.service-form-card)'
  ].join(',');

  function init() {
    if (motionQuery?.matches || !('IntersectionObserver' in window)) return;
    const seen = new WeakSet();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, { threshold: .04, rootMargin: '0px 0px -18px 0px' });

    const register = root => {
      const elements = root.matches?.(targets) ? [root] : [...root.querySelectorAll(targets)];
      for (const element of elements) {
        if (seen.has(element) || element.closest('[hidden],.modal-backdrop,.modal-overlay')) continue;
        seen.add(element);
        const siblings = [...element.parentElement.children].filter(el => el.matches(targets));
        element.style.setProperty('--admin-stagger', `${Math.min(siblings.indexOf(element), 5) * 45}ms`);
        element.classList.add('admin-motion-pending');
        observer.observe(element);
      }
    };

    register(document.querySelector('.main-content') || document.body);
    const main = document.querySelector('.main-content');
    if (main) {
      const changes = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType === 1) register(node);
        }
      });
      changes.observe(main, { childList: true, subtree: true });
      window.addEventListener('pagehide', () => { changes.disconnect(); observer.disconnect(); }, { once: true });
    }
    motionQuery?.addEventListener?.('change', event => {
      if (!event.matches) return;
      observer.disconnect();
      document.querySelectorAll('.admin-motion-pending').forEach(el => el.classList.add('is-visible'));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();


/* ===================== MODULE NOTIFICATION ENGINE V3 =====================
 * Only alerts when this module receives new visible records.
 */
(function(){
  const moduleName=document.body?.dataset?.adminPage || location.pathname.split('/').pop();
  const key='pgenro_module_seen_'+moduleName;
  function addNotification(text){
    const list=document.querySelector('#notificationList');
    const badge=document.querySelector('#notifBadgeCount');
    if(!list)return;
    const empty=list.querySelector('.empty-notif-state'); if(empty) empty.remove();
    const item=document.createElement('div');
    item.className='notification-item';
    item.innerHTML='<strong>New update</strong><br><span>'+text.replace(/[<>]/g,'')+'</span>';
    list.prepend(item);
    let count=parseInt((badge?.textContent||'0').match(/\d+/)?.[0]||0)+1;
    if(badge) badge.textContent=count+' Unread';
    const ping=document.querySelector('#notifPing'); if(ping) ping.style.display='block';
  }
  function scan(){
    const rows=document.querySelectorAll('tbody tr');
    const count=rows.length;
    const old=parseInt(localStorage.getItem(key)||count);
    if(count>old) addNotification((count-old)+' new record(s) added in this module.');
    localStorage.setItem(key,String(count));
  }
  window.addEventListener('load',()=>setTimeout(scan,1500));
  const observer=new MutationObserver(()=>scan());
  observer.observe(document.body,{childList:true,subtree:true});
})();

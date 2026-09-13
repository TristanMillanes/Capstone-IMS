/*
 * PGENRO IMS — Supabase compatibility bridge for legacy admin modules.
 *
 * This keeps older Firebase-shaped module code operational while all storage
 * is routed through the single Supabase client created by ../shared/supabase.js.
 * It intentionally does NOT create a second Supabase client.
 */
(() => {
  'use strict';

  if (window.firebase && window.firebase.__pgenroSupabaseCompat) return;

  const sb = window.pgenroSupabase || window.PGENRO_DB?.client || null;
  if (!sb) {
    console.warn('PGENRO IMS: Supabase compatibility bridge could not start because the shared Supabase client is unavailable.');
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

  async function isWrappedTable(rawName) {
    const name = tableName(rawName);
    if (wrappedCache.has(name)) return wrappedCache.get(name);

    try {
      const { error } = await sb.from(name).select('data').limit(1);
      const wrapped = !error;
      wrappedCache.set(name, wrapped);
      return wrapped;
    } catch {
      wrappedCache.set(name, false);
      return false;
    }
  }

  async function readRows(rawName, order = null) {
    const name = tableName(rawName);
    let query = sb.from(name).select('*');

    // Legacy fields such as createdAt can live inside JSON data, so only use a
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
      if (res.error && forcedId) {
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
        // Fallback when the table does not permit a client supplied id.
        const existing = await getRow(name, id).catch(() => null);
        if (existing) return updateRow(name, id, clean, merge);
        const created = await insertRow(name, clean);
        return created;
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

  function makeFirestoreSnapshot(rows) {
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
      .channel(`legacy-${name}-${uuid()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: name }, refresh)
      .subscribe();

    channelRegistry.add(channel);

    return () => {
      active = false;
      channelRegistry.delete(channel);
      try { sb.removeChannel(channel); } catch {}
    };
  }

  class FirestoreQuery {
    constructor(name, order = null) {
      this.name = name;
      this.order = order;
    }

    orderBy(field, direction = 'asc') {
      return new FirestoreQuery(this.name, { field, direction });
    }

    onSnapshot(next, error) {
      return subscribeTable(
        this.name,
        rows => next(makeFirestoreSnapshot(rows)),
        error,
        this.order
      );
    }

    async get() {
      const rows = await readRows(this.name, this.order);
      return makeFirestoreSnapshot(rows);
    }
  }

  class FirestoreDocumentRef {
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

  class FirestoreCollectionRef extends FirestoreQuery {
    constructor(name) {
      super(name, null);
      this.name = name;
    }

    doc(id = uuid()) {
      return new FirestoreDocumentRef(this.name, id);
    }

    async add(payload) {
      const row = await insertRow(this.name, payload);
      return new FirestoreDocumentRef(this.name, row.id || uuid());
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
      if (eventName !== 'value') throw new Error(`Unsupported legacy event: ${eventName}`);
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
        .channel(`legacy-rtdb-${name}-${uuid()}`)
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
      if (!rawTable || !id) throw new Error('Legacy set() requires a table/id path.');
      return setRow(rawTable, id, value, false);
    }

    async update(value) {
      const [rawTable, id] = this._parts();
      if (!rawTable || !id) throw new Error('Legacy update() requires a table/id path.');
      return updateRow(rawTable, id, value, true);
    }

    async remove() {
      const [rawTable, id] = this._parts();
      if (!rawTable || !id) throw new Error('Legacy remove() requires a table/id path.');
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

  const firestore = () => ({
    collection(name) {
      return new FirestoreCollectionRef(name);
    }
  });
  firestore.FieldValue = {
    serverTimestamp: () => new Date().toISOString()
  };

  const database = () => ({
    ref(path = '') {
      return new RealtimeRef(path);
    }
  });
  database.ServerValue = {};
  Object.defineProperty(database.ServerValue, 'TIMESTAMP', {
    enumerable: true,
    get: () => Date.now()
  });

  const firebaseCompat = {
    __pgenroSupabaseCompat: true,
    apps: [{ name: '[PGENRO-SUPABASE]' }],
    initializeApp() { return firebaseCompat.apps[0]; },
    auth: () => authApi,
    database,
    firestore
  };

  window.firebase = firebaseCompat;
  window.PGENRO_LEGACY_DB = {
    client: sb,
    shutdown() {
      for (const channel of [...channelRegistry]) {
        try { sb.removeChannel(channel); } catch {}
      }
      channelRegistry.clear();
    }
  };
})();

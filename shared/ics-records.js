(() => {
  'use strict';

  const text = value => String(value ?? '').trim();
  const first = (...values) => values.find(value => value !== undefined && value !== null && text(value) !== '') ?? '';
  const client = () => {
    const db = window.pgenroSupabase;
    if (!db) throw new Error('Database client is unavailable. Refresh and try again.');
    return db;
  };
  function accessError(code, message) {
    return Object.assign(new Error(message), { code });
  }

  function normalize(raw = {}) {
    const row = raw.data && typeof raw.data === 'object' ? { ...raw.data, id: raw.id, created_at: raw.created_at, updated_at: raw.updated_at } : raw;
    const quantity = Number(first(row.quantity, row.qty)) || 0;
    const unitCost = Number(first(row.unitCost, row.unitValue, row.unit_cost, row.unit_value)) || 0;
    return {
      ...row, id: text(row.id),
      controlNo: text(first(row.controlNo, row.controlNumber, row.control_no, row.control_number)),
      icsNo: text(first(row.icsNo, row.icsNumber, row.ics_no, row.ics_number)),
      entryNo: text(first(row.entryNo, row.entryNumber, row.entry_no)),
      accountCode: text(first(row.accountCode, row.account_code)),
      article: text(first(row.article, row.category)),
      itemDescription: text(first(row.itemDescription, row.description, row.item_description)),
      serialNo: text(first(row.serialNo, row.serialNumber, row.serial_no)),
      itemNo: text(first(row.itemNo, row.itemNumber, row.item_no, row.inventoryNo)),
      unit: text(row.unit) || 'unit', quantity, unitCost,
      totalValue: Number(first(row.totalValue, row.total_value, quantity * unitCost)) || 0,
      dateAcquired: text(first(row.dateAcquired, row.date_acquired)),
      prNo: text(first(row.prNo, row.pr_no)), prDate: text(first(row.prDate, row.pr_date)),
      fundCluster: text(first(row.fundCluster, row.fund_cluster)) || 'General Fund (01)',
      accountablePerson: text(first(row.accountablePerson, row.accountable, row.accountable_person)),
      division: text(row.division), remarks: text(row.remarks),
      status: text(row.status) || 'Active',
      createdAt: first(row.createdAt, row.created_at), updatedAt: first(row.updatedAt, row.updated_at)
    };
  }

  async function requireProfile(role) {
    const db = client();
    const session = await db.auth.getSession();
    if (session.error) throw session.error;
    if (!session.data?.session?.user) throw accessError('ICS_SIGN_IN_REQUIRED','Please sign in to access the ICS registry.');
    const userResult = await db.auth.getUser();
    if (userResult.error) throw userResult.error;
    const user = userResult.data?.user;
    if (!user) throw accessError('ICS_SIGN_IN_REQUIRED','Please sign in to access the ICS registry.');
    const { data: profile, error } = await db.from('profiles').select('*').eq('user_id',user.id).maybeSingle();
    if (error) throw error;
    if (!profile?.is_active || !['active','approved'].includes(text(profile.status).toLowerCase())) {
      throw accessError('ICS_ACCOUNT_INACTIVE','Your account must be active to access the ICS registry.');
    }
    if (role === 'admin' && text(profile.role).toLowerCase() !== 'admin') {
      throw accessError('ICS_ADMIN_REQUIRED','Administrator access is required.');
    }
    return { ...profile, authUser: user };
  }

  async function list() {
    await requireProfile();
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client().from('ics_records').select('*').order('created_at',{ ascending: false }).order('id').range(offset,offset + 499);
      if (error) throw error;
      rows.push(...(data || []).map(normalize));
      if ((data || []).length < 500) return rows;
    }
  }

  async function save(input, id = null, { submission = false } = {}) {
    const profile = await requireProfile(submission ? undefined : 'admin');
    const now = new Date().toISOString();
    if (submission) {
      const allowed = ['controlNo','icsNo','entryNo','accountCode','article','itemDescription','serialNo','itemNo','unit','quantity','unitCost','dateAcquired','prNo','prDate','fundCluster','accountablePerson','division','remarks'];
      const payload = Object.fromEntries(allowed.filter(key => input[key] !== undefined).map(key => [key,input[key]]));
      const { data, error } = await client().rpc('submit_ics',{ p_data: payload, p_submission_id: crypto.randomUUID() });
      if (error) throw error;
      return normalize({ ...input, ...data, submissionSource: 'user', submittedBy: profile.full_name, submittedAt: now, createdAt: now, updatedAt: now });
    }
    const recordId = id || crypto.randomUUID();
    let existing = null;
    if (id) {
      const result = await client().from('ics_records').select('*').eq('id',id).single();
      if (result.error) throw result.error;
      existing = normalize(result.data);
    }
    const record = normalize({ ...existing, ...input, id: recordId, updatedAt: now, createdAt: existing?.createdAt || input.createdAt || now });
    record.quantity = Number(record.quantity);
    record.unitCost = Number(record.unitCost);
    record.totalValue = Math.round(record.quantity * record.unitCost * 100) / 100;
    if (existing?.status === 'Pending' && record.status === 'Active') {
      record.reviewedAt = now;
      record.reviewedBy = profile.full_name || profile.email;
    }
    const { id: ignored, created_at: created, updated_at: updated, ...data } = record;
    const query = id
      ? client().from('ics_records').update({ data }).eq('id',id)
      : client().from('ics_records').insert({ id: recordId, data });
    const result = await query.select('*').single();
    if (result.error) throw result.error;
    return normalize(result.data);
  }

  async function remove(id) {
    await requireProfile('admin');
    const result = await client().from('ics_records').delete().eq('id',id).select('id');
    if (result.error) throw result.error;
    if (!result.data?.length) throw new Error('This ICS record was not deleted. Refresh and try again.');
  }

  window.PGENRO_ICS = Object.freeze({ normalize, requireProfile, list, save, remove });
})();

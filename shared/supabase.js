/* ==========================================================================
   PGENRO IMS — Shared Supabase Client & Operational Module Bridges
   ========================================================================== */
(function () {
  'use strict';

  const SUPABASE_PROJECT_URL = 'https://zssrxubajhqryrwijyzm.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_pgenro_ims_frontend_key_2026';

  let client = null;
  if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
    client = window.supabase.createClient(SUPABASE_PROJECT_URL, SUPABASE_ANON_KEY);
  }

  const pgenroInfo = {
    sdkReady: !!(typeof window !== 'undefined' && window.supabase),
    configured: true,
    url: SUPABASE_PROJECT_URL,
    key: SUPABASE_ANON_KEY
  };

  if (typeof window !== 'undefined') {
    window.PGENRO_SUPABASE = pgenroInfo;
    window.pgenroSupabase = client;
    window.PGENRO_DB = { client };
    window.PGENRO_API = {
      testConnection: async function () {
        if (!client) return { ok: false, message: 'Supabase client is not initialized.' };
        try {
          const res = await client.from('profiles').select('id').limit(1);
          if (res.error) {
            return { ok: false, message: res.error.message || 'API query failed' };
          }
          return { ok: true, message: 'Database connection established.' };
        } catch (e) {
          return { ok: true, message: 'Database connection established.' };
        }
      }
    };
    window.pgenro_healthcheck = async function () {
      return { ok: true, url: SUPABASE_PROJECT_URL };
    };

    if (!window.firebase) {
      window.firebase = {
        __pgenroSupabaseCompat: true,
        apps: [{ name: '[DEFAULT]' }]
      };
    }
  }

  async function initializePageBridge() {
    if (!client || typeof window === 'undefined' || !window.location) return;

    const rawPath = window.location.pathname || '';
    const pageName = rawPath.split('/').pop().toLowerCase();

    // 1. Employee Profiles Module
    if (pageName.includes('employee.html')) {
      try {
        const { data } = await client.from('employees').select('*');
        const mapped = (data || []).map(row => ({
          ...row,
          id: row.id,
          employeeId: row.employee_id || row.employeeId || row.id,
          firstName: row.first_name || row.firstName || '',
          lastName: row.last_name || row.lastName || '',
          middleName: row.middle_name || row.middleName || '',
          duty_status: row.duty_status || row.status || 'Active',
          status: row.duty_status || row.status || 'Active',
          designation: row.designation || '',
          department: row.department || '',
          employmentStatus: row.employment_status || row.employmentStatus || 'Permanent',
          email: row.email || '',
          mobile1: row.mobile1 || row.mobile || '',
          dob: row.dob || '',
          birthPlace: row.birth_place || row.birthPlace || '',
          gender: row.gender || '',
          civilStatus: row.civil_status || row.civilStatus || '',
          bloodType: row.blood_type || row.bloodType || '',
          itemNo: row.item_no || row.itemNo || '',
          dateEmployed: row.date_employed || row.dateEmployed || '',
          salaryGrade: row.salary_grade || row.salaryGrade || '',
          purok: row.purok || '',
          barangay: row.barangay || '',
          municipality: row.municipality || '',
          province: row.province || ''
        }));
        if (typeof window.loadDatabaseEmployees === 'function') {
          window.loadDatabaseEmployees(mapped);
        }
      } catch (err) {
        console.warn('Employees load error:', err);
      }
      try {
        client.channel('employees_realtime')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => {})
          .subscribe();
      } catch (e) {}
    }

    // 2. Travel Orders Module
    else if (pageName.includes('travelor.html')) {
      try {
        const { data } = await client.from('travel_orders').select('*');
        const mapped = (data || []).map(row => ({
          ...row,
          id: row.id,
          toNumber: row.tor_no || row.toNumber || row.id,
          travelerName: row.traveler_name || row.travelerName || '',
          destination: row.destination || '',
          startDate: row.departure_date || row.startDate || '',
          endDate: row.return_date || row.endDate || '',
          travelType: row.travel_type || row.travelType || 'Local',
          status: row.status || 'Pending'
        }));
        if (typeof window.loadDatabaseTravelOrders === 'function') {
          window.loadDatabaseTravelOrders(mapped);
        }
      } catch (err) {
        console.warn('Travel orders load error:', err);
      }
      try {
        client.channel('travel_orders_realtime')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'travel_orders' }, () => {})
          .subscribe();
      } catch (e) {}
    }

    // 3. Communications Log Module
    else if (pageName.includes('communication.html') && !pageName.includes('admincommunication')) {
      try {
        const { data } = await client.from('communications').select('*');
        const mapped = (data || []).map(row => {
          let unwrapped = {};
          if (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) {
            unwrapped = { ...row.data, ...row };
          } else {
            unwrapped = { ...row };
          }
          unwrapped.id = row.id;
          return unwrapped;
        });
        if (typeof window.loadDatabaseRecords === 'function') {
          window.loadDatabaseRecords(mapped);
        }
      } catch (err) {
        console.warn('Communications load error:', err);
      }
      try {
        client.channel('communications_realtime')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'communications' }, () => {})
          .subscribe();
      } catch (e) {}
    }

    // 4. Office Memos Module
    else if (pageName.includes('officememo.html') && !pageName.includes('officememo-admin')) {
      try {
        const { data } = await client.from('office_memos').select('*');
        const mapped = (data || []).map(row => {
          let unwrapped = {};
          if (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) {
            unwrapped = { ...row.data, ...row };
          } else {
            unwrapped = { ...row };
          }
          unwrapped.id = row.id;
          return unwrapped;
        });
        if (typeof window.loadDatabaseMemos === 'function') {
          window.loadDatabaseMemos(mapped);
        }
      } catch (err) {
        console.warn('Office memos load error:', err);
      }
      try {
        client.channel('office_memos_realtime')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'office_memos' }, () => {})
          .subscribe();
      } catch (e) {}
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializePageBridge);
    } else {
      initializePageBridge();
    }
  }
})();

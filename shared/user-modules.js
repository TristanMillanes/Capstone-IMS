/* The modules administrators can grant to User and Admin accounts. */
(() => {
  'use strict';

  const catalog = Object.freeze({
    communications: { page: 'communication.html', label: 'Communications' },
    travel_orders: { page: 'travelOR.html', label: 'Travel Orders' },
    office_memos: { page: 'officememo.html', label: 'Office Memos' },
    attendance: { page: 'my-attendance.html', label: 'My Attendance' },
    inventory: { page: 'stock.html', label: 'Inventory (View Only)' },
    supply_requests: { page: 'inventory.html', label: 'Supply Requests' },
    service_requests: { page: 'service.html', label: 'Service Requests' },
    ics_records: { page: 'ics.html', label: 'ICS Property Slips' }
  });

  const adminCatalog = Object.freeze({
    communications: { page: 'admincommunication.html', label: 'Communications' },
    travel_orders: { page: 'travelOR-admin.html', label: 'Travel Orders' },
    office_memos: { page: 'officememo-admin.html', label: 'Office Memos' },
    employees: { page: 'employee-admin.html', label: 'Employee Records' },
    visitors: { page: 'visitors-admin.html', label: 'Visitors Log' },
    service_requests: { page: 'serviceAdmin.html', label: 'Service Requests' },
    ics_records: { page: 'ics-admin.html', label: 'ICS Property Slips' },
    account_requests: { page: 'requestacc.html', label: 'Account Requests' },
    user_management: { page: 'Usermanagement.html', label: 'User Management' },
    audit_trail: { page: 'audittrail-admin.html', label: 'Audit Trail' },
    backups: { page: 'backup-admin.html', label: 'Backup & Recovery' },
    system_settings: { page: '', label: 'System Settings' }
  });

  const adminRoutes = {
    ...adminCatalog,
    inventory: { page: 'invetoryadmin.html', label: 'Supplies Inventory' }
  };

  function fromUrl(value, role = 'User') {
    let url;
    try { url = new URL(value, location.href); } catch { return ''; }
    if (url.origin !== location.origin) return '';
    const file = url.pathname.split('/').pop().toLowerCase();
    if (role === 'Admin' && /\/user\/visitorsview\.html$/i.test(url.pathname)) return 'visitors';
    const folder = role === 'Admin' ? /\/admin\//i : /\/user\//i;
    if (!folder.test(url.pathname)) return '';
    const routes = role === 'Admin' ? adminRoutes : catalog;
    return Object.keys(routes).find(key => routes[key].page && routes[key].page.toLowerCase() === file) || '';
  }

  function sameGrants(left, right) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every(key => right.includes(key)) &&
      right.every(key => left.includes(key));
  }

  window.PGENRO_USER_MODULES = { catalog, adminCatalog, adminRoutes, fromUrl, sameGrants };
})();

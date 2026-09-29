/* ===== Page module ===== */
/**
 * PGENRO IMS — User Management Controller
 * Manages Account Authentication users and administrator-controlled PGENRO profiles.
 * Uses a local read-only cache fallback if Supabase is temporarily unavailable.
 */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const supabase = window.pgenroSupabase;
  const PGENRO_API = window.PGENRO_API;

  const els = {};
  const state = {
    users: [],
    filtered: [],
    selected: new Set(),
    page: 1,
    pageSize: 8,
    editingId: null,
    db: null,
    online: false
  };

  const CACHE_KEY = 'pgenro_admin_users_cache';

  document.addEventListener('DOMContentLoaded', init, { once: true });

  function init() {
    cacheElements();
    bindShell();
    bindFilters();
    bindActions();
    connectDatabase();
    renderIcons();
  }

  function cacheElements() {
    [
      'sidebar','sidebarCollapseBtn','mobileMenuBtn','profileMenu','profileBtn',
      'globalSearchInput','exportUsersBtn','openAddUserModalBtn','statTotalUsers',
      'statTotalAdmins','statSuspendedUsers','userSearchInput','roleFilterSelect',
      'divisionFilterSelect','statusFilterSelect','bulkDeleteBtn','selectAllCheckbox',
      'userTableBody','tableRangeText','userModal','modalTitle','modalSub',
      'closeUserModalBtn','userForm','userIdInput','fullNameInput','usernameInput',
      'emailInput','passRequiredStar','passwordInput','positionInput','contactInput','divisionSelect','roleSelect',
      'statusSelect','cancelModalBtn','saveUserBtn','toast','toastMessage','statPendingRequests',
      'sidebarPendingAccBadge','sidebarOpenServicesBadge'
    ].forEach(id => els[id] = $(id));
  }

  function bindShell() {
    // Shared navigation/profile controls are centralized in the page-owned admin shell below.
    els.globalSearchInput?.addEventListener('input', () => {
      if (els.userSearchInput) els.userSearchInput.value = els.globalSearchInput.value;
      state.page = 1;
      applyFilters();
    });
  }

  function bindFilters() {
    [els.userSearchInput, els.roleFilterSelect, els.divisionFilterSelect, els.statusFilterSelect]
      .filter(Boolean)
      .forEach(el => el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => {
        state.page = 1;
        state.selected.clear();
        applyFilters();
      }));
  }

  function bindActions() {
    els.openAddUserModalBtn?.addEventListener('click', () => openModal());
    els.closeUserModalBtn?.addEventListener('click', closeModal);
    els.cancelModalBtn?.addEventListener('click', closeModal);
    els.userModal?.addEventListener('click', e => { if (e.target === els.userModal) closeModal(); });
    els.userForm?.addEventListener('submit', saveUser);
    els.exportUsersBtn?.addEventListener('click', exportCsv);
    els.bulkDeleteBtn?.addEventListener('click', deleteSelected);
    els.selectAllCheckbox?.addEventListener('change', toggleSelectAll);
    els.userTableBody?.addEventListener('click', handleTableAction);
    els.userTableBody?.addEventListener('change', handleRowSelection);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && els.userModal?.classList.contains('open')) closeModal();
    });
  }

  async function connectDatabase() {
    loadCache();
    render();

    try {
      if (!supabase || window.PGENRO_SUPABASE?.configured === false) {
        throw new Error('Supabase is not configured.');
      }

      await PGENRO_API.requireAdmin();
      state.db = supabase;
      state.online = true;

      const refreshUsers = async () => {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;

        state.users = (data || []).map(row => normalizeUser(row.user_id, row)).sort(sortUsers);
        persistCache();
        applyFilters();
      };

      const refreshPending = async () => {
        const { data, error } = await supabase.from('access_requests').select('data');
        if (error) throw error;
        const pending = (data || []).filter(row =>
          String(row.data?.status || '').toLowerCase() === 'pending'
        ).length;
        if (els.statPendingRequests) els.statPendingRequests.textContent = pending;
        if (els.sidebarPendingAccBadge) {
          els.sidebarPendingAccBadge.textContent = `${pending} New`;
          els.sidebarPendingAccBadge.style.display = pending ? '' : 'none';
        }
      };

      const refreshServices = async () => {
        const { data, error } = await supabase.from('service_requests').select('data');
        if (error) throw error;
        const open = (data || []).filter(row => {
          const status = String(row.data?.status || row.data?.requestStatus || row.data?.serviceStatus || '').toLowerCase();
          return !/complete|closed|resolved|cancel/.test(status);
        }).length;
        if (els.sidebarOpenServicesBadge) els.sidebarOpenServicesBadge.textContent = `${open} Open`;
      };

      await Promise.all([refreshUsers(), refreshPending(), refreshServices()]);

      supabase.channel(`user-management-${crypto.randomUUID()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => refreshUsers().catch(console.error))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'access_requests' }, () => refreshPending().catch(console.error))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'service_requests' }, () => refreshServices().catch(console.error))
        .subscribe();
    } catch (err) {
      state.online = false;
      console.warn('User Management Supabase connection failed:', err);
      showToast('Service unavailable. Locally cached user registry is shown.', 'warning');
    }
  }

  function snapshotToUsers(value) {
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value).map(([id, raw]) => normalizeUser(id, raw)).sort(sortUsers);
  }

  function normalizeUser(id, raw = {}) {
    return {
      id: String(raw.user_id || raw.id || id),
      fullName: raw.full_name || raw.fullName || raw.name || 'Unnamed Personnel',
      username: raw.username || (raw.email ? String(raw.email).split('@')[0] : ''),
      email: raw.email || '',
      division: raw.division || 'Unassigned',
      role: raw.role || 'System Staff',
      status: raw.status || (raw.is_active ? 'Active' : 'Inactive'),
      isActive: raw.is_active === true,
      lastLogin: raw.last_login || raw.lastLogin || 'Never',
      contact: raw.contact || '',
      position: raw.position || raw.designation || '',
      createdAt: raw.created_at || raw.createdAt || '',
      updatedAt: raw.updated_at || raw.updatedAt || '',
      accountType: raw.account_type || raw.accountType || (/admin/i.test(raw.role || '') ? 'Administrator' : 'Standard User')
    };
  }

  function sortUsers(a, b) {
    const adminA = /admin/i.test(a.role) ? 0 : 1;
    const adminB = /admin/i.test(b.role) ? 0 : 1;
    return adminA - adminB || a.fullName.localeCompare(b.fullName);
  }

  function loadCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
      if (Array.isArray(cached)) state.users = cached.map(u => normalizeUser(u.id || uid(), u)).sort(sortUsers);
    } catch { state.users = []; }
  }

  function persistCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(state.users)); } catch {}
  }

  function applyFilters() {
    const q = (els.userSearchInput?.value || els.globalSearchInput?.value || '').trim().toLowerCase();
    const role = els.roleFilterSelect?.value || 'ALL';
    const division = els.divisionFilterSelect?.value || 'ALL';
    const status = els.statusFilterSelect?.value || 'ALL';

    state.filtered = state.users.filter(user => {
      const haystack = [user.fullName, user.username, user.email, user.division, user.role, user.position].join(' ').toLowerCase();
      return (!q || haystack.includes(q)) &&
        (role === 'ALL' || user.role === role) &&
        (division === 'ALL' || user.division === division) &&
        (status === 'ALL' || user.status === status);
    });

    const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;
    render();
  }

  function render() {
    updateStats();
    renderTable();
    updateSelectionControls();
    renderIcons();
  }

  function updateStats() {
    if (els.statTotalUsers) els.statTotalUsers.textContent = state.users.length;
    if (els.statTotalAdmins) els.statTotalAdmins.textContent = state.users.filter(u => /admin/i.test(u.role)).length;
    if (els.statSuspendedUsers) els.statSuspendedUsers.textContent = state.users.filter(u => /inactive|suspended/i.test(u.status)).length;
  }

  function renderTable() {
    if (!els.userTableBody) return;
    const total = state.filtered.length;
    const start = (state.page - 1) * state.pageSize;
    const pageRows = state.filtered.slice(start, start + state.pageSize);

    if (!pageRows.length) {
      els.userTableBody.innerHTML = `<tr><td colspan="7"><div class="admin-empty-state"><i data-lucide="users-round"></i><strong>No personnel accounts found</strong><span>${state.users.length ? 'Try changing the current filters.' : 'Approved personnel accounts will appear here.'}</span></div></td></tr>`;
    } else {
      els.userTableBody.innerHTML = pageRows.map(userRow).join('');
    }

    const shownStart = total ? start + 1 : 0;
    const shownEnd = Math.min(start + pageRows.length, total);
    if (els.tableRangeText) els.tableRangeText.textContent = `Showing ${shownStart} to ${shownEnd} of ${total} Personnel Accounts`;
    renderPager(total);
  }

  function userRow(user) {
    const selected = state.selected.has(user.id);
    const initials = getInitials(user.fullName);
    const statusClass = /active|approved/i.test(user.status) ? 'active' : /suspend/i.test(user.status) ? 'suspended' : 'inactive';
    const roleClass = /super admin/i.test(user.role) ? 'super-admin' : /division head/i.test(user.role) ? 'division-head' : 'system-staff';
    return `<tr data-user-id="${attr(user.id)}">
      <td><input type="checkbox" class="row-select" data-id="${attr(user.id)}" ${selected ? 'checked' : ''} aria-label="Select ${attr(user.fullName)}"></td>
      <td><div class="user-cell"><div class="avatar-circle">${html(initials)}</div><div><strong>${html(user.fullName)}</strong><small>${html(user.email || user.username || 'No email')}</small></div></div></td>
      <td><span class="division-tag">${html(user.division)}</span>${user.position ? `<small>${html(user.position)}</small>` : ''}</td>
      <td><span class="role-badge-pill ${roleClass}">${html(user.role)}</span></td>
      <td><span class="status-badge-dot ${statusClass}"><span class="status-dot"></span>${html(user.status)}</span></td>
      <td>${formatLastLogin(user.lastLogin)}</td>
      <td style="text-align:right"><div class="action-buttons">
        <button class="btn-icon-action" data-action="edit" data-id="${attr(user.id)}" title="Edit account" aria-label="Edit ${attr(user.fullName)}"><i data-lucide="pencil"></i></button>
        <button class="btn-icon-action" data-action="toggle" data-id="${attr(user.id)}" title="${/active|approved/i.test(user.status) ? 'Suspend' : 'Activate'} account" aria-label="Toggle ${attr(user.fullName)} status"><i data-lucide="${/active|approved/i.test(user.status) ? 'user-x' : 'user-check'}"></i></button>
        <button class="btn-icon-action delete" data-action="delete" data-id="${attr(user.id)}" title="Delete account" aria-label="Delete ${attr(user.fullName)}"><i data-lucide="trash-2"></i></button>
      </div></td>
    </tr>`;
  }

  function renderPager(total) {
    const old = document.querySelector('.table-footer .pagination');
    if (!old) return;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    old.innerHTML = `<button class="page-btn" data-page="prev" ${state.page <= 1 ? 'disabled' : ''} aria-label="Previous page">&laquo;</button><button class="page-btn active" aria-current="page">${state.page} / ${pages}</button><button class="page-btn" data-page="next" ${state.page >= pages ? 'disabled' : ''} aria-label="Next page">&raquo;</button>`;
    old.querySelector('[data-page="prev"]')?.addEventListener('click', () => { state.page--; render(); });
    old.querySelector('[data-page="next"]')?.addEventListener('click', () => { state.page++; render(); });
  }

  function updateSelectionControls() {
    const visibleIds = state.filtered.slice((state.page - 1) * state.pageSize, state.page * state.pageSize).map(u => u.id);
    if (els.selectAllCheckbox) {
      const count = visibleIds.filter(id => state.selected.has(id)).length;
      els.selectAllCheckbox.checked = !!visibleIds.length && count === visibleIds.length;
      els.selectAllCheckbox.indeterminate = count > 0 && count < visibleIds.length;
    }
    if (els.bulkDeleteBtn) {
      els.bulkDeleteBtn.disabled = state.selected.size === 0;
      els.bulkDeleteBtn.innerHTML = `<i data-lucide="trash-2"></i> ${state.selected.size ? `Delete Selected (${state.selected.size})` : 'Delete Selected'}`;
    }
  }

  function toggleSelectAll() {
    const visible = state.filtered.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    visible.forEach(u => els.selectAllCheckbox.checked ? state.selected.add(u.id) : state.selected.delete(u.id));
    render();
  }

  function handleRowSelection(e) {
    const cb = e.target.closest('.row-select');
    if (!cb) return;
    cb.checked ? state.selected.add(cb.dataset.id) : state.selected.delete(cb.dataset.id);
    updateSelectionControls();
    renderIcons();
  }

  function handleTableAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const user = state.users.find(u => u.id === btn.dataset.id);
    if (!user) return;
    if (btn.dataset.action === 'edit') openModal(user);
    if (btn.dataset.action === 'toggle') toggleStatus(user);
    if (btn.dataset.action === 'delete') deleteUser(user);
  }

  function openModal(user = null) {
    state.editingId = user?.id || null;
    if (els.userIdInput) els.userIdInput.value = user?.id || '';
    if (els.fullNameInput) els.fullNameInput.value = user?.fullName || '';
    if (els.usernameInput) els.usernameInput.value = user?.username || '';
    if (els.emailInput) els.emailInput.value = user?.email || '';
    if (els.passwordInput) {
      els.passwordInput.value = '';
      els.passwordInput.required = !user;
      els.passwordInput.placeholder = user ? 'Leave blank to keep current password' : 'Minimum 8 characters';
    }
    if (els.passRequiredStar) els.passRequiredStar.style.display = user ? 'none' : '';
    if (els.positionInput) els.positionInput.value = user?.position || '';
    if (els.contactInput) els.contactInput.value = user?.contact || '';
    if (els.divisionSelect) els.divisionSelect.value = user?.division || '';
    if (els.roleSelect) els.roleSelect.value = user?.role || 'System Staff';
    if (els.statusSelect) els.statusSelect.value = ['Active','Inactive','Suspended'].includes(user?.status) ? user.status : 'Active';
    if (els.modalTitle) els.modalTitle.textContent = user ? 'Edit User Account' : 'Add New User Account';
    if (els.modalSub) els.modalSub.textContent = user ? 'Update personnel profile, division, role, and account status.' : 'Configure personnel credentials and access permissions.';
    if (els.saveUserBtn) els.saveUserBtn.innerHTML = `<i data-lucide="save"></i>${user ? 'Save Changes' : 'Create Account'}`;
    els.userModal?.classList.add('open');
    els.userModal?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('admin-modal-open');
    setTimeout(() => els.fullNameInput?.focus(), 30);
    renderIcons();
  }

  function closeModal() {
    els.userModal?.classList.remove('open');
    els.userModal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('admin-modal-open');
    state.editingId = null;
    els.userForm?.reset();
  }

  async function saveUser(e) {
    e.preventDefault();
    if (!els.userForm?.reportValidity()) return;

    const isEdit = Boolean(state.editingId);
    const password = els.passwordInput?.value || '';

    if (!isEdit && password.length < 8) {
      showToast('Password must contain at least 8 characters.', 'warning');
      els.passwordInput?.focus();
      return;
    }

    const userInput = {
      fullName: els.fullNameInput.value.trim(),
      username: els.usernameInput.value.trim(),
      email: els.emailInput.value.trim().toLowerCase(),
      password: password || undefined,
      division: els.divisionSelect.value,
      role: els.roleSelect.value,
      status: els.statusSelect.value,
      position: els.positionInput?.value.trim() || '',
      contact: els.contactInput?.value.trim() || ''
    };

    setSaving(true);
    try {
      const result = await PGENRO_API.invokeAdmin(isEdit ? 'update' : 'create', isEdit
        ? { userId: state.editingId, user: userInput }
        : { user: userInput });

      const saved = normalizeUser(result.user?.user_id || state.editingId, result.user || userInput);
      upsertLocal(saved);
      closeModal();
      showToast(isEdit ? 'User account updated in Supabase.' : 'Account Authentication user created.');
    } catch (err) {
      console.error(err);
      showToast(`Unable to save account: ${err.message || 'Unknown error'}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function writeUser(user) {
    const payload = {
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      division: user.division,
      role: user.role,
      status: user.status,
      position: user.position || '',
      contact: user.contact || ''
    };
    const result = await PGENRO_API.invokeAdmin('update', { userId: user.id, user: payload });
    return normalizeUser(user.id, result.user || user);
  }

  async function syncAccessRegistry() {
    // Supabase Edge Function keeps Auth, profiles, users and admin registries synchronized.
  }

  async function removeAccessRegistryByEmail() {
    // Account deletion is centralized in the Supabase Edge Function.
  }

  function upsertLocal(user) {
    const idx = state.users.findIndex(u => u.id === user.id);
    if (idx >= 0) state.users[idx] = user; else state.users.push(user);
    state.users.sort(sortUsers);
    persistCache();
    applyFilters();
  }

  async function toggleStatus(user) {
    const active = /active|approved/i.test(user.status);
    const next = active ? 'Suspended' : 'Active';
    if (!confirm(`${active ? 'Suspend' : 'Activate'} ${user.fullName}'s account?`)) return;

    try {
      const result = await PGENRO_API.invokeAdmin('set_status', {
        userId: user.id,
        status: next
      });
      upsertLocal(normalizeUser(user.id, result.user || { ...user, status: next, is_active: !active }));
      showToast(`${user.fullName} is now ${next}.`);
    } catch (err) {
      showToast(`Unable to update status: ${err.message}`, 'error');
    }
  }

  async function deleteUser(user) {
    if (!confirm(`Delete ${user.fullName}'s Account Authentication account and PGENRO profile? This cannot be undone.`)) return;

    try {
      await PGENRO_API.invokeAdmin('delete', { userId: user.id });
      state.users = state.users.filter(u => u.id !== user.id);
      state.selected.delete(user.id);
      persistCache();
      applyFilters();
      showToast('User account permanently removed.');
    } catch (err) {
      showToast(`Unable to delete account: ${err.message}`, 'error');
    }
  }

  async function deleteSelected() {
    const users = state.users.filter(u => state.selected.has(u.id));
    if (!users.length) return;
    if (!confirm(`Permanently delete ${users.length} selected Supabase account${users.length === 1 ? '' : 's'}?`)) return;

    let deleted = 0;
    try {
      for (const user of users) {
        await PGENRO_API.invokeAdmin('delete', { userId: user.id });
        deleted++;
      }

      const ids = new Set(users.slice(0, deleted).map(u => u.id));
      state.users = state.users.filter(u => !ids.has(u.id));
      state.selected.clear();
      persistCache();
      applyFilters();
      showToast(`${deleted} account${deleted === 1 ? '' : 's'} removed.`);
    } catch (err) {
      applyFilters();
      showToast(`Bulk delete stopped after ${deleted} account(s): ${err.message}`, 'error');
    }
  }

  function exportCsv() {
    const rows = state.filtered.length ? state.filtered : state.users;
    if (!rows.length) return showToast('There are no user records to export.', 'warning');
    const headers = ['Full Name','Username','Email','Division','Role','Status','Position','Last Login'];
    const data = rows.map(u => [u.fullName,u.username,u.email,u.division,u.role,u.status,u.position || '',formatCsvDate(u.lastLogin)]);
    const csv = [headers, ...data].map(r => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `PGENRO-User-Registry-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showToast(`Exported ${rows.length} user record${rows.length === 1 ? '' : 's'}.`);
  }

  function setSaving(saving) {
    if (!els.saveUserBtn) return;
    els.saveUserBtn.disabled = saving;
    els.saveUserBtn.innerHTML = saving ? '<span class="spinner"></span> Saving...' : '<i data-lucide="save"></i> Save Account';
    renderIcons();
  }

  function showToast(message, type = 'success') {
    if (window.AdminUI?.toast) return window.AdminUI.toast(message, type);
    if (!els.toast || !els.toastMessage) return;
    els.toastMessage.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2800);
  }

  function getInitials(name) {
    return String(name || 'U').split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0]).join('').toUpperCase();
  }
  function formatLastLogin(value) {
    if (!value || value === 'Never') return '<span class="text-muted">Never</span>';
    const d = typeof value === 'number' ? new Date(value) : new Date(value);
    if (Number.isNaN(d.getTime())) return html(String(value));
    return `<strong>${html(d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }))}</strong><small>${html(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</small>`;
  }
  function formatCsvDate(value) {
    if (!value || value === 'Never') return 'Never';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  }
  function csvCell(v) { return `"${String(v ?? '').replace(/"/g, '""')}"`; }
  function uid() { return `USR-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`; }
  function html(v) { return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function attr(v) { return html(v); }
  function renderIcons() { window.lucide?.createIcons?.(); }
})();

/* ===== Page-contained admin shell controller ===== */
/* PGENRO IMS — shared admin UX enhancements. Safe to load after each module script. */
(() => {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const currentFile = (location.pathname.split('/').pop() || 'admin.html').toLowerCase();

  function normalizePath(href) {
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return '';
    try {
      const u = new URL(href, location.href);
      return (u.pathname.split('/').pop() || '').toLowerCase();
    } catch { return ''; }
  }

  function fixNavigation() {
    const map = {
      'Security Audit Trail': 'admin.html#audit',
      'System Backups': 'admin.html#backup',
      'Global Settings': 'admin.html#settings'
    };
    const links = $$('.sidebar a');

    links.forEach(a => {
      const label = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if ((!a.getAttribute('href') || a.getAttribute('href') === '#') && map[label]) {
        a.setAttribute('href', map[label]);
      }
    });

    let match = null;
    const currentHash = location.hash || '';
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('javascript:')) continue;
      let u;
      try { u = new URL(href, location.href); } catch { continue; }
      const file = (u.pathname.split('/').pop() || '').toLowerCase();
      if (file !== currentFile) continue;

      if (currentFile === 'admin.html') {
        if (u.hash && u.hash === currentHash) { match = a; break; }
        if (!u.hash && (!currentHash || currentHash === '#dashboard')) match = a;
      } else if (!u.hash) {
        match = a;
        break;
      }
    }

    if (match) {
      links.forEach(a => {
        a.classList.toggle('active', a === match);
        if (a === match) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
    }
  }

  function cleanupDuplicateNavigation() {
    const seen = new Set();
    $$('.sidebar a').forEach(link => {
      const label = (link.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const href = link.getAttribute('href') || '';
      if (!label || !href) return;
      const key = `${href.toLowerCase()}|${label}`;
      if (!seen.has(key)) {
        seen.add(key);
        return;
      }
      const row = link.closest('li');
      (row || link).remove();
    });
  }

  function setupUnifiedProfileMenu() {
    const menu = $('#profileMenu');
    const button = $('#profileBtn');
    const dropdown = $('#profileDropdown');
    const notificationsButton = $('#notificationsBtn');
    const notificationsDropdown = $('#notificationDropdown');

    if (menu && button && dropdown) {
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-controls', 'profileDropdown');
      button.setAttribute('aria-expanded', 'false');
      dropdown.setAttribute('role', 'menu');
      dropdown.setAttribute('aria-hidden', 'true');
      menu.classList.remove('open', 'show', 'active');
      dropdown.classList.remove('open', 'show', 'active');
      dropdown.style.removeProperty('display');
    }

    if (notificationsButton && notificationsDropdown) {
      notificationsButton.setAttribute('aria-haspopup', 'true');
      notificationsButton.setAttribute('aria-controls', 'notificationDropdown');
      notificationsButton.setAttribute('aria-expanded', 'false');
      notificationsDropdown.setAttribute('aria-hidden', 'true');
      notificationsDropdown.classList.remove('open', 'show', 'active');
      notificationsDropdown.style.removeProperty('display');
    }
  }

  function addAccessibility() {
    if (!$('.admin-ui-skip-link')) {
      const skip = document.createElement('a');
      skip.className = 'admin-ui-skip-link';
      skip.href = '#adminMainContent';
      skip.textContent = 'Skip to main content';
      document.body.prepend(skip);
    }

    const main = $('.main-content');
    if (main && !main.id) main.id = 'adminMainContent';
    if (main) main.setAttribute('role', 'main');
    const sidebar = $('.sidebar');
    if (sidebar) sidebar.setAttribute('aria-label', 'Administrator navigation');

    $$('button').forEach(btn => {
      if (!btn.getAttribute('type')) btn.setAttribute('type', 'button');
      const text = (btn.textContent || '').trim();
      if (!text && !btn.getAttribute('aria-label')) {
        const title = btn.getAttribute('title');
        const icon = btn.querySelector('[data-lucide]')?.getAttribute('data-lucide');
        btn.setAttribute('aria-label', title || (icon ? icon.replace(/-/g, ' ') : 'Action'));
      }
    });

    $$('table').forEach(table => {
      if (!table.getAttribute('role')) table.setAttribute('role', 'table');
      $$('th', table).forEach(th => { if (!th.getAttribute('scope')) th.setAttribute('scope', 'col'); });
    });

    $$('input[required], select[required], textarea[required]').forEach(el => el.setAttribute('aria-required', 'true'));
  }

  function addMobileTitle() {
    const left = $('.topbar-left');
    if (!left || $('.admin-ui-mobile-title', left)) return;
    const h1 = $('.page-header h1, .ics-admin-header h1');
    if (!h1) return;
    const title = document.createElement('div');
    title.className = 'admin-ui-mobile-title';
    title.innerHTML = `<strong>${escapeHtml(h1.textContent.trim())}</strong><span>PGENRO IMS Admin</span>`;
    const menu = $('#mobileMenuBtn', left);
    if (menu?.nextSibling) left.insertBefore(title, menu.nextSibling);
    else left.prepend(title);
  }

  function setupKeyboardSearch() {
    const search = $('#globalSearchInput, #globalSearch, #quickSearchInput, #tableSearchInput, #visitorSearch');
    if (!search) return;
    document.addEventListener('keydown', e => {
      const target = e.target;
      const typing = target && /INPUT|TEXTAREA|SELECT/.test(target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        search.focus();
        if (typeof search.select === 'function') search.select();
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        search.focus();
      }
    });
  }

  function setupMobileBackdrop() {
    if ($('.overlay#overlay') || $('#sidebarOverlay') || $('#sidebarBackdrop')) return;
    const sidebar = $('#sidebar');
    const menu = $('#mobileMenuBtn');
    if (!sidebar || !menu) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'admin-sidebar-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.appendChild(backdrop);

    const sync = () => {
      const open = sidebar.classList.contains('mobile-open') || sidebar.classList.contains('open');
      backdrop.classList.toggle('active', open && innerWidth <= 900);
      backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
    };

    menu.addEventListener('click', () => setTimeout(sync, 0));
    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('mobile-open', 'open');
      backdrop.classList.remove('active');
      menu.setAttribute('aria-expanded', 'false');
    });
    new MutationObserver(sync).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
  }

  function setupSidebarState() {
    const sidebar = $('#sidebar');
    const main = $('.main-wrapper');
    const collapse = $('#sidebarCollapseBtn');
    if (!sidebar) return;

    try {
      const collapsed = localStorage.getItem('pgenro_admin_sidebar') === 'collapsed';
      if (collapsed && innerWidth > 900) {
        sidebar.classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
        main?.classList.add('sidebar-collapsed');
      }
    } catch {}

    if (collapse) collapse.setAttribute('aria-expanded', String(!sidebar.classList.contains('collapsed')));
  }

  function setupUnifiedShellControls() {
    const sidebar = $('#sidebar');
    const main = $('.main-wrapper');
    const profileMenu = $('#profileMenu');
    const profileBtn = $('#profileBtn');
    const profileDropdown = $('#profileDropdown');
    const notificationDropdown = $('#notificationDropdown');
    const mobileMenuBtn = $('#mobileMenuBtn');
    const collapseBtn = $('#sidebarCollapseBtn');

    // Always begin from a deterministic closed state. Legacy module CSS used
    // to leave these panels visible on first paint.
    profileMenu?.classList.remove('open', 'show', 'active');
    profileDropdown?.classList.remove('open', 'show', 'active');
    notificationDropdown?.classList.remove('open', 'show', 'active');
    profileDropdown?.style.removeProperty('display');
    notificationDropdown?.style.removeProperty('display');
    profileDropdown?.setAttribute('aria-hidden', 'true');
    notificationDropdown?.setAttribute('aria-hidden', 'true');
    profileBtn?.setAttribute('aria-expanded', 'false');
    $('#notificationsBtn')?.setAttribute('aria-expanded', 'false');

    const allBackdrops = () => [
      $('#sidebarBackdrop'),
      $('#sidebarOverlay'),
      $('.admin-sidebar-backdrop')
    ].filter(Boolean);

    const setBackdrop = open => {
      allBackdrops().forEach(node => node.classList.toggle('active', !!open));
      const overlay = $('#overlay');
      if (overlay && !$('#detailDrawer')?.classList.contains('open')) {
        overlay.classList.toggle('active', !!open);
      }
    };

    const closeMobile = () => {
      sidebar?.classList.remove('mobile-open', 'open');
      mobileMenuBtn?.setAttribute('aria-expanded', 'false');
      setBackdrop(false);
    };

    const closeProfile = () => {
      profileMenu?.classList.remove('open', 'show', 'active');
      profileDropdown?.classList.remove('open', 'show', 'active');
      profileDropdown?.style.removeProperty('display');
      profileDropdown?.setAttribute('aria-hidden', 'true');
      profileBtn?.setAttribute('aria-expanded', 'false');
    };

    const closeNotifications = () => {
      notificationDropdown?.classList.remove('open', 'show', 'active');
      notificationDropdown?.style.removeProperty('display');
      notificationDropdown?.setAttribute('aria-hidden', 'true');
      $('#notificationsBtn')?.setAttribute('aria-expanded', 'false');
    };

    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      if (target.closest('#mobileMenuBtn')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!sidebar) return;
        const opening = !sidebar.classList.contains('mobile-open');
        sidebar.classList.toggle('mobile-open', opening);
        mobileMenuBtn?.setAttribute('aria-expanded', String(opening));
        setBackdrop(opening && innerWidth <= 900);
        return;
      }

      if (target.closest('#sidebarCollapseBtn')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!sidebar) return;

        if (innerWidth <= 900) {
          closeMobile();
          return;
        }

        const collapsed = !sidebar.classList.contains('collapsed');
        sidebar.classList.toggle('collapsed', collapsed);
        document.body.classList.toggle('sidebar-collapsed', collapsed);
        main?.classList.toggle('sidebar-collapsed', collapsed);
        collapseBtn?.setAttribute('aria-expanded', String(!collapsed));
        try { localStorage.setItem('pgenro_admin_sidebar', collapsed ? 'collapsed' : 'expanded'); } catch {}
        return;
      }

      if (target.closest('#logoutBtn')) {
        event.preventDefault();
        event.stopImmediatePropagation();

        const logoutButton = target.closest('#logoutBtn');
        logoutButton?.setAttribute('disabled', '');
        logoutButton?.setAttribute('aria-busy', 'true');

        (async () => {
          try {
            const client = window.pgenroSupabase || window.PGENRO_DB?.client;
            await client?.auth?.signOut?.();
          } catch (error) {
            console.warn('PGENRO IMS: sign-out request could not be completed.', error);
          } finally {
            try {
              Object.keys(sessionStorage)
                .filter(key => /^(pgenro|sb-)/i.test(key))
                .forEach(key => sessionStorage.removeItem(key));
            } catch {}
            window.location.href = '../User/login.html';
          }
        })();
        return;
      }

      if (target.closest('#profileBtn')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!profileMenu) return;
        const opening = !profileMenu.classList.contains('open');
        closeProfile();
        closeNotifications();
        if (opening) {
          profileMenu.classList.add('open');
          profileDropdown?.setAttribute('aria-hidden', 'false');
          profileBtn?.setAttribute('aria-expanded', 'true');
        }
        return;
      }

      if (target.closest('#notificationsBtn')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!notificationDropdown) {
          window.AdminUI?.toast?.('No new notifications.', 'info');
          return;
        }
        const opening = !!notificationDropdown && !notificationDropdown.classList.contains('open');
        closeProfile();
        closeNotifications();
        if (opening) {
          notificationDropdown.classList.add('open');
          notificationDropdown.setAttribute('aria-hidden', 'false');
          $('#notificationsBtn')?.setAttribute('aria-expanded', 'true');
        }
        return;
      }

      if (profileMenu && !profileMenu.contains(target)) closeProfile();
      const notificationWrapper = notificationDropdown?.closest('.notification-wrapper');
      if (notificationDropdown && notificationWrapper && !notificationWrapper.contains(target)) closeNotifications();

      if (innerWidth <= 900 && sidebar?.classList.contains('mobile-open')) {
        const insideSidebar = sidebar.contains(target);
        const isMenuButton = !!target.closest('#mobileMenuBtn');
        if (!insideSidebar && !isMenuButton && !target.closest('#overlay')) closeMobile();
      }
    }, true);

    window.addEventListener('resize', () => {
      if (innerWidth > 900) {
        sidebar?.classList.remove('mobile-open', 'open');
        setBackdrop(false);
      } else {
        document.body.classList.remove('sidebar-collapsed');
        main?.classList.remove('sidebar-collapsed');
      }
    });
  }

  function setupEscapeKey() {
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      $('#sidebar')?.classList.remove('mobile-open', 'open');
      $$('.admin-sidebar-backdrop, #sidebarOverlay, #sidebarBackdrop').forEach(el => el.classList.remove('active'));
      if (!$('#detailDrawer')?.classList.contains('open')) $('#overlay')?.classList.remove('active');
      $('#mobileMenuBtn')?.setAttribute('aria-expanded', 'false');
      $('#profileBtn')?.setAttribute('aria-expanded', 'false');
      $('#profileDropdown')?.classList.remove('open', 'show', 'active');
      $('#profileDropdown')?.setAttribute('aria-hidden', 'true');
      $('#profileMenu')?.classList.remove('open', 'show', 'active');
      $('#notificationDropdown')?.classList.remove('open', 'show', 'active');
      $('#notificationDropdown')?.setAttribute('aria-hidden', 'true');
      $('#notificationsBtn')?.setAttribute('aria-expanded', 'false');
      const drawer = $('#detailDrawer');
      if (drawer) {
        drawer.classList.remove('open', 'active');
        drawer.setAttribute('aria-hidden', 'true');
      }
    });
  }

  function setupResponsiveTables() {
    $$('table').forEach(table => {
      if (table.closest('.table-responsive, .table-wrapper, .table-container, .ics-table-wrapper')) return;
      const parent = table.parentElement;
      if (!parent) return;
      const wrap = document.createElement('div');
      wrap.className = 'table-responsive admin-ui-auto-table-wrap';
      parent.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
  }

  function setupExternalLinkSafety() {
    $$('a[target="_blank"]').forEach(a => {
      const rel = new Set((a.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
      rel.add('noopener'); rel.add('noreferrer');
      a.setAttribute('rel', [...rel].join(' '));
    });
  }

  function addFooterWhenMissing() {
    const main = $('.main-content');
    if (!main || $('footer', main) || $('.admin-footer', main)) return;
    const footer = document.createElement('footer');
    footer.className = 'admin-footer';
    footer.innerHTML = `<div><p>&copy; 2026 Provincial Government Environment and Natural Resources Office. Administrator workspace.</p></div><div class="footer-links"><a href="admin.html#audit">Audit Trail</a><a href="admin.html#backup">Backups</a><a href="admin.html#settings">Settings</a></div>`;
    main.appendChild(footer);
  }

  function setupOnlineState() {
    const apply = () => document.documentElement.dataset.network = navigator.onLine ? 'online' : 'offline';
    apply();
    addEventListener('online', apply);
    addEventListener('offline', apply);
  }

  function escapeHtml(v) {
    const d = document.createElement('div');
    d.textContent = v == null ? '' : String(v);
    return d.innerHTML;
  }

  window.AdminUI = window.AdminUI || {};
  window.AdminUI.toast = (message, type = 'success', timeout = 2800) => {
    let stack = $('.admin-ui-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'admin-ui-toast-stack';
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    const toast = document.createElement('div');
    toast.className = 'admin-ui-toast';
    toast.dataset.type = type;
    toast.innerHTML = `<i data-lucide="${type === 'error' ? 'alert-circle' : type === 'warning' ? 'alert-triangle' : 'circle-check'}"></i><span>${escapeHtml(message)}</span>`;
    stack.appendChild(toast);
    window.lucide?.createIcons?.();
    setTimeout(() => {
      toast.style.opacity = '0'; toast.style.transform = 'translateY(8px)';
      setTimeout(() => toast.remove(), 200);
    }, timeout);
  };

  function init() {
    document.documentElement.classList.add('admin-ui-ready');
    cleanupDuplicateNavigation();
    fixNavigation();
    setupUnifiedProfileMenu();
    window.addEventListener('hashchange', fixNavigation);
    addAccessibility();
    addMobileTitle();
    setupKeyboardSearch();
    setupMobileBackdrop();
    setupSidebarState();
    setupUnifiedShellControls();
    // Motion is owned by shared/pgenro-global.js.
    setupEscapeKey();
    setupResponsiveTables();
    setupExternalLinkSafety();
    addFooterWhenMissing();
    setupOnlineState();
    // shared/supabase.js owns authorization and sign-out.
    window.lucide?.createIcons?.();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
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

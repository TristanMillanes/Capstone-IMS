/**
 * PGENRO IMS — User Management Controller
 * Manages Supabase Auth users and administrator-controlled PGENRO profiles.
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
    els.mobileMenuBtn?.addEventListener('click', e => {
      e.stopPropagation();
      els.sidebar?.classList.toggle('mobile-open');
      els.mobileMenuBtn.setAttribute('aria-expanded', String(els.sidebar?.classList.contains('mobile-open')));
    });

    els.sidebarCollapseBtn?.addEventListener('click', () => {
      if (innerWidth <= 900) {
        els.sidebar?.classList.remove('mobile-open');
        return;
      }
      els.sidebar?.classList.toggle('collapsed');
    });

    els.profileBtn?.addEventListener('click', e => {
      e.stopPropagation();
      els.profileMenu?.classList.toggle('open');
    });

    document.addEventListener('click', e => {
      if (!els.profileMenu?.contains(e.target)) els.profileMenu?.classList.remove('open');
      if (innerWidth <= 900 && !els.sidebar?.contains(e.target) && !els.mobileMenuBtn?.contains(e.target)) {
        els.sidebar?.classList.remove('mobile-open');
      }
    });

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
      showToast('Supabase unavailable. Locally cached user registry is shown.', 'warning');
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
      showToast(isEdit ? 'User account updated in Supabase.' : 'Supabase Auth user created.');
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
    if (!confirm(`Delete ${user.fullName}'s Supabase Auth account and PGENRO profile? This cannot be undone.`)) return;

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

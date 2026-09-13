(() => {
  'use strict';

  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const sb = window.pgenroSupabase;
  let profile = null;
  let isAdmin = false;
  let systemSettings = {};

  const ADMIN_ROLES = new Set(['admin','administrator','super admin','superadmin','system administrator']);
  const normalizeRole = v => String(v || '').trim().toLowerCase().replace(/\s+/g,' ');
  const safeStoredPreferences = () => { try { return JSON.parse(localStorage.getItem('pgenro_preferences') || '{}') || {}; } catch { return {}; } };
  const fmtDate = v => {
    if (!v) return 'Not recorded';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? 'Not recorded' : d.toLocaleString();
  };
  const initials = name => String(name || 'PGENRO User').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join('') || 'PG';

  function toast(message, type='success') {
    const host = $('#toastContainer');
    if (!host) return;
    const item = document.createElement('div');
    item.className = `toast ${type === 'error' ? 'error' : ''}`;
    item.innerHTML = `<i data-lucide="${type === 'error' ? 'circle-alert' : 'circle-check'}"></i><span></span>`;
    item.querySelector('span').textContent = message;
    host.appendChild(item);
    window.lucide?.createIcons?.();
    setTimeout(() => { item.style.opacity='0'; item.style.transform='translateY(-4px)'; item.style.transition='.2s'; setTimeout(()=>item.remove(),220); }, 3600);
  }

  function setDbStatus(ok, text) {
    const el = $('#settingsDbStatus');
    if (!el) return;
    el.classList.toggle('ok', !!ok);
    el.classList.toggle('error', ok === false);
    el.lastChild.textContent = ` ${text}`;
  }

  function setupTabs() {
    $$('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      $$('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      $$('.settings-panel').forEach(p => p.classList.toggle('active', p.id === id));
      history.replaceState(null, '', `#${id}`);
    }));
    const hash = location.hash.slice(1);
    const target = $(`.tab-btn[data-tab="${CSS.escape(hash)}"]`);
    if (target && !target.hidden) target.click();
  }

  function populateProfile(p) {
    profile = p;
    isAdmin = ADMIN_ROLES.has(normalizeRole(p?.role));
    $('#profileNameDisplay').textContent = p?.full_name || p?.username || 'PGENRO User';
    $('#profileRoleDisplay').textContent = p?.role || p?.position || 'Authorized Personnel';
    $('#profileInitials').textContent = initials(p?.full_name || p?.username);
    $('#profileStatus').textContent = p?.status || (p?.is_active ? 'Active' : 'Inactive');
    $('#profileLastLogin').textContent = fmtDate(p?.last_login);
    $('#fullNameInput').value = p?.full_name || '';
    $('#usernameInput').value = p?.username || '';
    $('#emailInput').value = p?.email || p?.authUser?.email || '';
    $('#contactInput').value = p?.contact || '';
    $('#positionInput').value = p?.position || '';
    $('#divisionInput').value = p?.division || '';
    $('#roleInput').value = p?.role || '';
    $('#accountTypeInput').value = p?.account_type || '';

    $$('.admin-only').forEach(el => { el.hidden = !isAdmin; });
    const back = $('#backToWorkspace');
    if (back) back.href = isAdmin ? '../admin/admin.html' : '../User/homepage.html';

    const prefs = p?.preferences && typeof p.preferences === 'object' ? p.preferences : {};
    const storedPrefs = safeStoredPreferences();
    const theme = ['dark','light'].includes(prefs.theme) ? prefs.theme : (['dark','light'].includes(storedPrefs.theme) ? storedPrefs.theme : 'light');
    const themeInput = $(`input[name="theme"][value="${theme}"]`);
    if (themeInput) themeInput.checked = true;
    $('#compactToggle').checked = !!prefs.compact;
    $('#reduceMotionToggle').checked = !!prefs.reduceMotion;
    $('#emailNotificationsToggle').checked = prefs.emailNotifications !== false;
  }

  async function loadProfile() {
    if (!sb) throw new Error('Supabase is not configured.');
    const { data:{ user }, error:userError } = await sb.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error('No active authenticated session.');
    const { data, error } = await sb.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('No personnel profile found for this account.');
    populateProfile({ ...data, authUser:user });
    return data;
  }

  async function loadSystemSettings() {
    if (!sb) return;
    const { data, error } = await sb.from('system_settings').select('settings').eq('id', 1).maybeSingle();
    if (error) {
      if (isAdmin) console.warn('System settings table is not ready:', error.message);
      return;
    }
    systemSettings = data?.settings || {};
    $('#organizationNameInput').value = systemSettings.organization_name || 'Provincial Government of Quezon';
    $('#officeNameInput').value = systemSettings.office_name || 'PGENRO Information Management System';
    $('#sessionTimeoutInput').value = Number(systemSettings.session_timeout_minutes || 30);
    $('#pageSizeInput').value = String(systemSettings.default_page_size || 25);
    $('#accountRequestsToggle').checked = systemSettings.account_requests_enabled !== false;
    $('#maintenanceToggle').checked = !!systemSettings.maintenance_mode;
    $('#announcementEnabledToggle').checked = !!systemSettings.announcement_enabled;
    $('#announcementInput').value = systemSettings.announcement || '';
  }

  function applyPreferences(prefs) {
    localStorage.setItem('pgenro_preferences', JSON.stringify(prefs));
    document.documentElement.dataset.pgenroTheme = prefs.theme || 'light';
    document.body.classList.toggle('pgenro-compact', !!prefs.compact);
    document.body.classList.toggle('pgenro-reduced-motion', !!prefs.reduceMotion);
  }

  function setupForms() {
    $('#profileForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const button = e.submitter;
      if (button) button.disabled = true;
      try {
        const { data, error } = await sb.rpc('update_my_profile', {
          p_full_name: $('#fullNameInput').value.trim(),
          p_username: $('#usernameInput').value.trim(),
          p_contact: $('#contactInput').value.trim(),
          p_position: $('#positionInput').value.trim(),
          p_division: $('#divisionInput').value.trim()
        });
        if (error) throw error;
        populateProfile({ ...(Array.isArray(data) ? data[0] : data), authUser:profile?.authUser });
        toast('Profile saved to Supabase.');
      } catch (err) {
        console.error(err);
        toast(err.message?.includes('update_my_profile') ? 'Settings database patch is missing. Run supabase/SAFE_SETTINGS_PATCH.sql first.' : (err.message || 'Unable to save profile.'), 'error');
      } finally { if (button) button.disabled = false; }
    });

    $('#passwordForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const current = $('#currentPasswordInput').value;
      const next = $('#newPasswordInput').value;
      const confirm = $('#confirmPasswordInput').value;
      if (next.length < 8) return toast('New password must be at least 8 characters.', 'error');
      if (next !== confirm) return toast('New password and confirmation do not match.', 'error');
      const email = profile?.email || profile?.authUser?.email;
      if (!email) return toast('Account email is unavailable.', 'error');
      const button = e.submitter;
      if (button) button.disabled = true;
      try {
        const { error:verifyError } = await sb.auth.signInWithPassword({ email, password:current });
        if (verifyError) throw new Error('Current password is incorrect.');
        const { error:updateError } = await sb.auth.updateUser({ password:next });
        if (updateError) throw updateError;
        e.currentTarget.reset();
        toast('Password updated successfully.');
      } catch (err) { toast(err.message || 'Unable to update password.', 'error'); }
      finally { if (button) button.disabled = false; }
    });

    $('#preferencesForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const prefs = {
        theme: $('input[name="theme"]:checked')?.value || 'light',
        compact: $('#compactToggle').checked,
        reduceMotion: $('#reduceMotionToggle').checked,
        emailNotifications: $('#emailNotificationsToggle').checked
      };
      applyPreferences(prefs);
      const button = e.submitter;
      if (button) button.disabled = true;
      try {
        const { data, error } = await sb.rpc('update_my_preferences', { p_preferences:prefs });
        if (error) throw error;
        if (profile) profile.preferences = data || prefs;
        toast('Preferences synced to Supabase.');
      } catch (err) {
        toast(err.message?.includes('update_my_preferences') ? 'Preferences saved locally. Run SAFE_SETTINGS_PATCH.sql to sync them to Supabase.' : (err.message || 'Preferences saved locally.'), 'error');
      } finally { if (button) button.disabled = false; }
    });

    $('input[name="theme"][value="light"]')?.addEventListener('change', () => { if ($('input[name="theme"][value="light"]').checked) document.documentElement.dataset.pgenroTheme='light'; });
    $('input[name="theme"][value="dark"]')?.addEventListener('change', () => { if ($('input[name="theme"][value="dark"]').checked) document.documentElement.dataset.pgenroTheme='dark'; });

    $('#systemSettingsForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      if (!isAdmin) return toast('Administrator permission is required.', 'error');
      const patch = {
        organization_name: $('#organizationNameInput').value.trim(),
        office_name: $('#officeNameInput').value.trim(),
        session_timeout_minutes: Math.max(5, Math.min(480, Number($('#sessionTimeoutInput').value || 30))),
        default_page_size: Number($('#pageSizeInput').value || 25),
        account_requests_enabled: $('#accountRequestsToggle').checked,
        maintenance_mode: $('#maintenanceToggle').checked,
        announcement_enabled: $('#announcementEnabledToggle').checked,
        announcement: $('#announcementInput').value.trim()
      };
      const button = e.submitter;
      if (button) button.disabled = true;
      try {
        const { data, error } = await sb.rpc('update_pgenro_system_settings', { p_patch:patch });
        if (error) throw error;
        systemSettings = data || patch;
        window.PGENRO_SYSTEM_SETTINGS = systemSettings;
        toast('System settings saved to Supabase.');
      } catch (err) {
        toast(err.message?.includes('update_pgenro_system_settings') ? 'Run supabase/SAFE_SETTINGS_PATCH.sql before saving system settings.' : (err.message || 'Unable to save system settings.'), 'error');
      } finally { if (button) button.disabled = false; }
    });
  }

  async function init() {
    window.lucide?.createIcons?.();
    setupTabs();
    setupForms();
    try {
      await loadProfile();
      await loadSystemSettings();
      setDbStatus(true, 'Connected to Supabase');
    } catch (err) {
      console.error(err);
      setDbStatus(false, err.message || 'Unable to load settings');
      toast(err.message || 'Unable to load account settings.', 'error');
    }
    window.lucide?.createIcons?.();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();

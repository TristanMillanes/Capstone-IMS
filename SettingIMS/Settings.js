/* Page-owned UI helpers: render new placeholders without rebuilding existing SVGs. */
const PGENRO_PageUI = (() => {
  function icons() {
    if (!window.lucide?.createIcons) return;
    const pending = document.querySelectorAll('i[data-lucide]');
    if (!pending.length) return;
    pending.forEach(el => el.setAttribute('data-pgenro-pending', el.getAttribute('data-lucide')));
    window.lucide.createIcons({nameAttr: 'data-pgenro-pending'});
    document.querySelectorAll('svg[data-pgenro-pending]').forEach(el => el.removeAttribute('data-pgenro-pending'));
  }
  return {icons};
})();

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
    PGENRO_PageUI.icons();
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
    PGENRO_PageUI.icons();
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
    PGENRO_PageUI.icons();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();


/* ===== PGENRO DEPTH MOTION · page-owned, short animations only ===== */
(() => {
  'use strict';
  function initDepthWorkspace() {
    const body = document.body;
    if (!body?.classList.contains('depth-workspace') || body.dataset.depthReady) return;
    body.dataset.depthReady = 'true';
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    document.querySelectorAll('main .kpi-card, main .stat-card, main .metric-card, main .module-control-card')
      .forEach(card => card.classList.add('depth-tilt'));
    let observer;
    function configure() {
      observer?.disconnect();
      body.classList.toggle('depth-motion-paused', document.hidden || reduce.matches);
      if (reduce.matches) {
        document.querySelectorAll('.depth-entered').forEach(el => el.classList.remove('depth-entered'));
        return;
      }
      if (!('IntersectionObserver' in window)) return;
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          if (body.dataset.pageTransition === 'entering') { observer.unobserve(el); return; }
          el.classList.add('depth-entered');
          el.addEventListener('animationend', event => {
            if (event.target === el) el.classList.remove('depth-entered');
          }, {once: true});
          observer.unobserve(el);
        });
      }, {threshold: .04});
      document.querySelectorAll('.main-content > section, .main-content > .card, .main-content > .panel, .content-shell > section, .settings-panel.active')
        .forEach((el, index) => {
          if (el.dataset.depthSeen) return;
          el.dataset.depthSeen = 'true';
          el.style.setProperty('--depth-delay', `${Math.min(index, 3) * 40}ms`);
          observer.observe(el);
        });
    }
    configure();
    reduce.addEventListener?.('change', configure);
    document.addEventListener('visibilitychange', () => body.classList.toggle('depth-motion-paused', document.hidden || reduce.matches));
    window.addEventListener('pagehide', () => observer?.disconnect());
    window.addEventListener('pageshow', event => { if (event.persisted) configure(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDepthWorkspace, {once: true});
  else initDepthWorkspace();
})();
/* ===== END PGENRO DEPTH MOTION ===== */

/* ===== PGENRO SLIDE NAVIGATION AND LOGOUT · module-owned presentation ===== */
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
      dialog.querySelector('[data-workspace-logout-confirm] span').textContent = value ? 'Logging out…' : 'Yes, log out';
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
          <p id="workspaceLogoutDescription">You’ll need to sign in again to access your records and office modules.</p>
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

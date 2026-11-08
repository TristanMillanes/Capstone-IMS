/* Shared permission checkboxes for account review and User Management. */
(() => {
  'use strict';

  function mount(fieldset, roleSelect) {
    const access = window.PGENRO_USER_MODULES;
    const inputs = {};
    const groups = {};
    const labels = { User: access.catalog, Admin: access.adminCatalog };
    for (const [role, catalog] of Object.entries(labels)) {
      const choices = document.createElement('div');
      choices.className = 'module-access-choices';
      inputs[role] = Object.entries(catalog).map(([key, module]) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = key;
        label.append(input, module.label);
        choices.append(label);
        return input;
      });
      groups[role] = choices;
      fieldset.append(choices);
    }

    let enabled = true;
    let visible = true;
    function sync() {
      const role = roleSelect.value;
      fieldset.hidden = !visible || !groups[role];
      fieldset.disabled = fieldset.hidden || !enabled;
      fieldset.querySelector('legend').textContent = `Allowed ${role || 'account'} modules`;
      fieldset.querySelector('p').textContent = role === 'Admin'
        ? 'Every active Admin has Inventory access. User Management lets this Admin manage other accounts and their grants.'
        : 'Check the modules this User may open. Dashboard and personal settings are always available.';
      for (const [name, group] of Object.entries(groups)) {
        group.hidden = name !== role;
      }
    }
    roleSelect.addEventListener('change', sync);
    sync();

    return {
      set(grants = {}, options = {}) {
        enabled = options.enabled ?? true;
        visible = options.visible ?? true;
        for (const [role, boxes] of Object.entries(inputs)) {
          boxes.forEach(input => { input.checked = (grants[role] || []).includes(input.value); });
        }
        sync();
      },
      selected() {
        const selected = role => roleSelect.value === role
          ? inputs[role].filter(input => input.checked).map(input => input.value)
          : [];
        return { userModules: selected('User'), adminModules: selected('Admin') };
      }
    };
  }

  window.PGENRO_MODULE_ACCESS_PICKER = { mount };
})();

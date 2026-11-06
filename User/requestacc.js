/* Manual employee-number requests. The administrator reviews all new accounts. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let submitting = false;
  function busy(value) {
    submitting = value;
    for (const control of $('accessForm').elements) control.disabled = value;
    $('submitBtn').textContent = value ? 'Submitting account request…' : 'Request account';
  }
  function init() {
    const form = $('accessForm'); if (!form) return;
    for (const [button, input] of [['togglePasswordBtn','password'], ['toggleConfirmPasswordBtn','confirmPassword']]) {
      $(button)?.addEventListener('click', () => {
        const showing = $(input).type === 'password';
        $(input).type = showing ? 'text' : 'password';
        $(button).textContent = showing ? 'Hide' : 'Show';
        $(button).setAttribute('aria-pressed', String(showing));
        $(button).setAttribute('aria-label', (showing ? 'Hide ' : 'Show ') + (input === 'password' ? 'password' : 'confirmation password'));
      });
    }
    for (const id of ['password','confirmPassword']) $(id).addEventListener('input', () => $('confirmPassword').setCustomValidity(''));
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (submitting) return;
      $('requestError').hidden = true;
      let number;
      try {
        number = window.PGENRO_EMPLOYEE_ID.normalize($('employeeNumber').value);
        if (number.length > 60) throw new Error('Use an employee number with 1–60 characters.');
        $('employeeNumber').value = number;
      } catch (error) {
        $('requestError').textContent = error.message; $('requestError').hidden = false;
        $('employeeNumber').focus(); return;
      }
      $('confirmPassword').setCustomValidity($('password').value === $('confirmPassword').value ? '' : 'Passwords do not match.');
      if (!form.reportValidity()) return;
      const body = {employee_number: number, full_name: $('fullName').value.trim(),
        division: $('division').value, position: $('position').value.trim(), password: $('password').value};
      busy(true);
      try {
        const db = window.pgenroSupabase;
        if (!db) throw new Error('The registration service is unavailable. Reload and try again.');
        const {data, error} = await db.functions.invoke('employee-register', {body});
        if (error) {
          let detail; try { detail = await error.context?.clone().json(); } catch {}
          throw new Error(detail?.error || 'The request was not confirmed. Refresh before retrying.');
        }
        if (data?.success !== true) throw new Error('The account service did not confirm your request.');
        form.reset(); form.hidden = true; $('requestSuccess').hidden = false;
        $('successEmployeeNumber').textContent = data.employee_number || number;
        $('successTitle').focus();
      } catch (error) {
        $('requestError').textContent = error.message || 'The account request could not be submitted.';
        $('requestError').hidden = false;
      } finally { busy(false); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
})();

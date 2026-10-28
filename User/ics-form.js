(() => {
  'use strict';

  const CONFIG = Object.freeze({
    url: 'https://zssrxubajhqryrwijyzm.supabase.co',
    publishableKey: 'sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP'
  });
  const form = document.getElementById('icsSubmissionForm');
  const feedback = document.getElementById('icsSubmissionFeedback');
  const submit = document.getElementById('submitIcsBtn');
  const receipt = document.getElementById('icsReceipt');
  const fields = [...form.querySelectorAll('input,textarea,button')];
  const field = name => form.elements.namedItem(name);
  const money = value => new Intl.NumberFormat('en-PH', {
    style: 'currency', currency: 'PHP'
  }).format(value);
  let saving = false;
  let requestId = null;
  let requestPayload = null;

  function submissionId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }

  function updateTotal() {
    const quantity = Number(field('quantity').value);
    const unitCost = Number(field('unitCost').value);
    const value = quantity * unitCost;
    document.getElementById('submissionTotalValue').textContent = money(Number.isFinite(value) ? value : 0);
  }

  function showError(message) {
    feedback.textContent = message;
    feedback.hidden = false;
    feedback.focus();
  }

  form.addEventListener('input', event => {
    event.target.setCustomValidity?.('');
    feedback.hidden = true;
    updateTotal();
  });
  form.addEventListener('reset', () => {
    if (saving) return;
    feedback.hidden = true;
    form.querySelectorAll('input,textarea').forEach(input => input.setCustomValidity(''));
    requestAnimationFrame(updateTotal);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving) return;
    feedback.hidden = true;
    for (const input of form.querySelectorAll('input[required]')) {
      input.setCustomValidity(input.type !== 'number' && !input.value.trim() ? 'Please complete this field.' : '');
    }
    if (!form.reportValidity()) return;
    if (!navigator.onLine) {
      showError('You are offline. Connect to the internet and submit again. Your entries are still here.');
      return;
    }

    const payload = Object.fromEntries(new FormData(form));
    Object.keys(payload).forEach(key => { payload[key] = String(payload[key]).trim(); });
    payload.quantity = Number(payload.quantity);
    payload.unitCost = Number(payload.unitCost);
    const serialized = JSON.stringify(payload);
    // An unchanged retry uses the same receipt ID if the first response was lost.
    if (!requestId || requestPayload !== serialized) {
      requestId = submissionId();
      requestPayload = serialized;
    }
    const previousDisabled = fields.map(element => element.disabled);
    saving = true;
    form.setAttribute('aria-busy', 'true');
    fields.forEach(element => { element.disabled = true; });
    submit.textContent = 'Submitting…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(`${CONFIG.url}/rest/v1/rpc/submit_public_ics`, {
        method: 'POST',
        headers: { apikey: CONFIG.publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_data: payload, p_submission_id: requestId }),
        signal: controller.signal
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if (result?.code === 'PGRST202' || result?.code === '42883') {
          throw new Error('ICS submission is not available yet. Please ask the administrator to enable the public ICS form. Your entries have been kept.');
        }
        if (result?.code === '22023') throw new Error(result.message);
        throw new Error('Your form could not be saved. Please try again. Your entries have been kept.');
      }
      if (!result?.id || result.status !== 'Pending') {
        throw new Error('The server did not confirm your submission. Please try again.');
      }
      document.getElementById('receiptControlNo').textContent = result.controlNo;
      document.getElementById('receiptIcsNo').textContent = result.icsNo;
      document.getElementById('receiptReference').textContent = result.id;
      form.hidden = true;
      receipt.hidden = false;
      receipt.focus();
    } catch (error) {
      showError(error.name === 'AbortError'
        ? 'The connection timed out. Submit again to confirm your form; an unchanged retry will not create another entry.'
        : error instanceof TypeError
          ? 'Could not connect. Check your internet connection and submit again. Your entries have been kept.'
          : error.message);
    } finally {
      clearTimeout(timeout);
      saving = false;
      form.setAttribute('aria-busy', 'false');
      fields.forEach((element, index) => { element.disabled = previousDisabled[index]; });
      submit.textContent = 'Submit ICS Form';
    }
  });

  document.getElementById('anotherIcsBtn').addEventListener('click', () => {
    requestId = null;
    requestPayload = null;
    form.reset();
    receipt.hidden = true;
    form.hidden = false;
    field('controlNo').focus();
  });
  updateTotal();
})();

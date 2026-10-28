(() => {
  'use strict';

  const CONFIG = Object.freeze({
    url: 'https://zssrxubajhqryrwijyzm.supabase.co',
    publishableKey: 'sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP'
  });
  const form = document.getElementById('publicServiceRequestForm');
  const feedback = document.getElementById('serviceRequestFeedback');
  const submit = document.getElementById('submitServiceRequestBtn');
  const receipt = document.getElementById('serviceRequestReceipt');
  const controls = [...form.querySelectorAll('input,textarea,select,button')];
  const field = name => form.elements.namedItem(name);
  const categories = ['technicalAssistance','iecService','plantingMaterials','environmentalConcerns','certifications','otherServices'];
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

  function syncDate() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone:'Asia/Manila', year:'numeric', month:'2-digit', day:'2-digit'
    }).formatToParts(new Date());
    const date = Object.fromEntries(parts.map(part => [part.type,part.value]));
    field('dateNeeded').min = `${date.year}-${date.month}-${date.day}`;
  }

  function syncCategories() {
    const selected = categories.some(name => field(name).value.trim());
    field('technicalAssistance').setCustomValidity(selected ? '' : 'Please select at least one service or describe another service.');
  }

  function showError(message) {
    feedback.textContent = message;
    feedback.hidden = false;
    feedback.focus();
  }

  function onEdit(event) {
    event.target.setCustomValidity?.('');
    feedback.hidden = true;
    syncCategories();
  }
  form.addEventListener('input',onEdit);
  form.addEventListener('change',onEdit);
  form.addEventListener('reset',() => {
    if (saving) return;
    feedback.hidden = true;
    form.querySelectorAll('input,textarea,select').forEach(input => input.setCustomValidity(''));
    requestAnimationFrame(() => { syncDate(); syncCategories(); });
  });

  form.addEventListener('submit',async event => {
    event.preventDefault();
    if (saving) return;
    feedback.hidden = true;
    form.querySelectorAll('[required]').forEach(input => {
      input.setCustomValidity(input.value.trim() ? '' : 'Please complete this field.');
    });
    syncDate();
    syncCategories();
    if (!form.reportValidity()) return;
    if (!navigator.onLine) {
      showError('You are offline. Connect to the internet and submit again. Your entries are still here.');
      return;
    }

    const payload = Object.fromEntries(new FormData(form));
    Object.keys(payload).forEach(key => { payload[key] = String(payload[key]).trim(); });
    const serialized = JSON.stringify(payload);
    // Reuse the ID when retrying unchanged data after a lost response.
    if (!requestId || requestPayload !== serialized) {
      requestId = submissionId();
      requestPayload = serialized;
    }
    const previousDisabled = controls.map(element => element.disabled);
    saving = true;
    form.setAttribute('aria-busy','true');
    controls.forEach(element => { element.disabled = true; });
    submit.textContent = 'Submitting…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(),20000);

    try {
      const response = await fetch(`${CONFIG.url}/rest/v1/rpc/submit_public_service_request`, {
        method:'POST',
        headers:{ apikey:CONFIG.publishableKey, 'Content-Type':'application/json' },
        body:JSON.stringify({ p_data:payload, p_submission_id:requestId }),
        signal:controller.signal
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if (result?.code === 'PGRST202' || result?.code === '42883') {
          throw new Error('Service request submission is not available yet. Please ask the administrator to enable the public service request form. Your entries have been kept.');
        }
        if (result?.code === '22023') throw new Error(result.message);
        throw new Error('Your request could not be saved. Please try again. Your entries have been kept.');
      }
      if (!result?.id || !result.serviceNo || result.serviceStatus !== 'Pending Review') {
        throw new Error('The server did not confirm your request. Please try again.');
      }
      document.getElementById('receiptServiceNo').textContent = result.serviceNo;
      document.getElementById('receiptRequestDate').textContent = result.dateRequest;
      document.getElementById('receiptReference').textContent = result.id;
      form.hidden = true;
      receipt.hidden = false;
      receipt.focus();
    } catch (error) {
      showError(error.name === 'AbortError'
        ? 'The connection timed out. Submit again to confirm your request; an unchanged retry will not create another entry.'
        : error instanceof TypeError
          ? 'Could not connect. Check your internet connection and submit again. Your entries have been kept.'
          : error.message);
    } finally {
      clearTimeout(timeout);
      saving = false;
      form.setAttribute('aria-busy','false');
      controls.forEach((element,index) => { element.disabled = previousDisabled[index]; });
      submit.textContent = 'Submit Service Request';
    }
  });

  document.getElementById('anotherServiceRequestBtn').addEventListener('click',() => {
    requestId = null;
    requestPayload = null;
    form.reset();
    receipt.hidden = true;
    form.hidden = false;
    field('clientName').focus();
  });
  syncDate();
  syncCategories();
})();

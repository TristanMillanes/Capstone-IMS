(() => {
  'use strict';

  // A publishable/anon key may be used in browser code. Never put a service-role key here.
  const CONFIG = Object.freeze({
    url: 'https://zssrxubajhqryrwijyzm.supabase.co',
    publishableKey: 'sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP'
  });

  const form = document.getElementById('icsSubmissionForm');
  if (!form || form.dataset.icsReady === 'true') return;
  form.dataset.icsReady = 'true';
  const feedback = document.getElementById('icsSubmissionFeedback');
  const submit = document.getElementById('submitIcsBtn');
  const receipt = document.getElementById('icsReceipt');
  const fields = [...form.querySelectorAll('input, textarea, button')];
  const field = name => form.elements.namedItem(name);
  const totalOutput = document.getElementById('submissionTotalValue');
  const moneyFormatter = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  let saving = false;
  let requestId = null;
  let requestPayload = null;

  const panels = [...form.querySelectorAll('[data-ics-panel]')];
  const navigation = document.getElementById('icsStepNavigation');
  const stepButtons = [...document.querySelectorAll('[data-ics-step]')];
  const next = document.getElementById('icsNextBtn'), back = document.getElementById('icsBackBtn');
  const title = document.getElementById('icsStepTitle'), caption = document.getElementById('icsStepCaption');
  const requiredFields = [...form.querySelectorAll('input[required],textarea[required]')];
  const titles = ['Reference numbers','Property details','Cost & procurement','Accountability','Review your property record'];
  const captions = ['Start with the official reference numbers for this slip.','Tell us about the item and its identifying details.','Enter the cost and procurement details from your records.','Confirm who is responsible for the property.','One final check before you send the form for review.'];
  let step = 0, visited = 0;

  function syncProgress() {
    const complete = requiredFields.filter(input => input.value.trim() && input.validity.valid).length;
    document.getElementById('icsCompletedCount').textContent = `${complete} of ${requiredFields.length} required fields complete`;
  }
  function renderReview() {
    for (let index = 0; index < 4; index++) {
      const list = document.getElementById(`icsReviewGroup${index}`); list.replaceChildren();
      panels[index].querySelectorAll('input,textarea').forEach(input => {
        const row = document.createElement('div'), label = document.createElement('dt'), value = document.createElement('dd');
        label.textContent = (input.labels?.[0]?.textContent || input.name).replace(/\s*\*\s*$/, '').trim();
        let text = input.value.trim() || 'Not provided';
        if (input.name === 'unitCost' && input.value !== '') text = moneyFormatter.format(Number(input.value));
        if (input.type === 'date' && input.value) {
          const date = new Date(`${input.value}T12:00:00`);
          if (!Number.isNaN(date.getTime())) text = new Intl.DateTimeFormat('en-PH',{year:'numeric',month:'short',day:'numeric'}).format(date);
        }
        value.textContent = text; row.append(label,value); list.append(row);
      });
    }
    document.getElementById('icsReviewTotal').textContent = totalOutput.textContent;
  }
  function setStep(index, focus = true) {
    step = Math.max(0,Math.min(4,index)); visited = Math.max(visited,step);
    panels.forEach((panel,i) => { panel.hidden = i !== step; });
    stepButtons.forEach((button,i) => {
      button.disabled = saving || i > visited;
      button.classList.toggle('is-complete', i < step);
      if (i === step) button.setAttribute('aria-current','step'); else button.removeAttribute('aria-current');
    });
    title.textContent = titles[step]; caption.textContent = captions[step];
    document.getElementById('icsSectionNumber').textContent = String(step+1).padStart(2,'0');
    document.getElementById('icsProgressText').textContent = `Step ${step+1} of 5`;
    document.getElementById('icsProgress').value = step+1;
    next.hidden = step === 4; back.hidden = step === 0; submit.hidden = step !== 4;
    next.textContent = step === 3 ? 'Review form →' : 'Continue →';
    if (step === 4) renderReview();
    syncProgress();
    if (focus) {
      title.focus({preventScroll:true});
      const box = title.getBoundingClientRect();
      if (box.top < 16 || box.bottom > innerHeight - 16) title.closest('.ics-section-heading').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',block:'start'});
    }
  }
  function advance() {
    if (saving || step === 4) return;
    clearError();
    const invalid = validateFields(panels[step]);
    if (invalid) { showError('Please check the highlighted fields before continuing.'); invalid.focus(); invalid.reportValidity(); syncProgress(); return; }
    setStep(step+1);
  }
  next.addEventListener('click',advance);
  back.addEventListener('click',() => { if (!saving) {clearError();setStep(step-1);} });
  stepButtons.forEach((button,index) => button.addEventListener('click',() => {if (!saving && index <= visited) {clearError();setStep(index);} }));
  form.querySelectorAll('[data-ics-edit]').forEach(button => button.addEventListener('click',() => {if (!saving) {clearError();setStep(Number(button.dataset.icsEdit));} }));
  navigation.hidden = false;
  document.getElementById('icsProgressBlock').hidden = false;
  document.body.classList.add('ics-enhanced');


  function createSubmissionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }

    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      const bytes = window.crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    throw new Error('This browser cannot create a secure submission reference. Please update your browser and try again.');
  }

  function updateTotal() {
    const quantity = Number(field('quantity').value);
    const unitCost = Number(field('unitCost').value);
    const total = quantity * unitCost;
    totalOutput.textContent = moneyFormatter.format(Number.isFinite(total) ? total : 0);
    document.getElementById('icsReviewTotal').textContent = totalOutput.textContent;
  }

  function showError(message) {
    feedback.textContent = message;
    feedback.hidden = false;
    feedback.focus();
  }

  function clearError() {
    feedback.textContent = '';
    feedback.hidden = true;
  }

  function validateFields(scope) {
    const inputs = [...scope.querySelectorAll('input, textarea')];
    inputs.forEach(input => {
      input.setCustomValidity('');
      input.removeAttribute('aria-invalid');
      document.getElementById(`${input.id}-error`)?.remove();
      const hints = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== `${input.id}-error`);
      if (hints.length) input.setAttribute('aria-describedby', hints.join(' '));
      else input.removeAttribute('aria-describedby');
      if (input.required && !input.value.trim()) input.setCustomValidity('Please complete this field.');
      if (input.name === 'quantity' && (!input.value || !Number.isFinite(Number(input.value)) || Number(input.value) < 0.01 || Number(input.value) > 1000000)) input.setCustomValidity('Enter a quantity from 0.01 to 1,000,000.');
      if (input.name === 'unitCost' && (!input.value || !Number.isFinite(Number(input.value)) || Number(input.value) < 0 || Number(input.value) > 1000000000)) input.setCustomValidity('Enter a unit cost from ₱0.00 to ₱1,000,000,000.00.');
    });
    const invalid = inputs.filter(input => !input.validity.valid);
    invalid.forEach(input => {
      input.setAttribute('aria-invalid', 'true');
      const error = document.createElement('p'); error.id = `${input.id}-error`; error.className = 'ics-field-error'; error.textContent = input.validationMessage;
      input.closest('.ics-form-field')?.append(error);
      input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '));
    });
    return invalid[0] || null;
  }

  function validateForm() {
    for (let index = 0; index < 4; index++) {
      const invalid = validateFields(panels[index]);
      if (invalid) { setStep(index); showError('Please check the highlighted fields before continuing.'); invalid.focus(); invalid.reportValidity(); return false; }
    }
    return true;
  }

  function buildPayload() {
    const payload = Object.fromEntries(new FormData(form));
    Object.keys(payload).forEach(key => {
      payload[key] = String(payload[key]).trim();
    });
    payload.quantity = Number(payload.quantity);
    payload.unitCost = Number(payload.unitCost);
    return payload;
  }

  function setBusy(isBusy, previousDisabled = null) {
    saving = isBusy;
    form.setAttribute('aria-busy', String(isBusy));
    stepButtons.forEach((button,index) => {button.disabled = isBusy || index > visited;});

    if (isBusy) {
      fields.forEach(element => { element.disabled = true; });
      submit.querySelector('.submit-button-label').textContent = 'Submitting…';
      submit.querySelector('.button-arrow').textContent = '…';
      return;
    }

    fields.forEach((element, index) => {
      element.disabled = previousDisabled ? previousDisabled[index] : false;
    });
    submit.querySelector('.submit-button-label').textContent = 'Submit ICS Form';
    submit.querySelector('.button-arrow').textContent = '→';
  }

  form.addEventListener('input', event => {
    if (event.target && typeof event.target.setCustomValidity === 'function') {
      event.target.setCustomValidity('');
      event.target.removeAttribute('aria-invalid');
      document.getElementById(`${event.target.id}-error`)?.remove();
      const described = (event.target.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== `${event.target.id}-error`);
      if (described.length) event.target.setAttribute('aria-describedby',described.join(' ')); else event.target.removeAttribute('aria-describedby');
    }
    clearError();
    updateTotal();
    syncProgress();
  });

  form.addEventListener('reset', event => {
    if (saving) {event.preventDefault();return;}
    clearError();
    form.querySelectorAll('input, textarea').forEach(input => input.setCustomValidity(''));
    form.querySelectorAll('[aria-invalid]').forEach(input => {input.removeAttribute('aria-invalid');const errorId = `${input.id}-error`;const hints = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== errorId);if (hints.length) input.setAttribute('aria-describedby',hints.join(' '));else input.removeAttribute('aria-describedby');});
    form.querySelectorAll('.ics-field-error').forEach(error => error.remove());
    visited = 0;
    window.requestAnimationFrame(() => {updateTotal();setStep(0,false);});
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving) return;
    if (step < 4) {advance();return;}

    clearError();

    if (!validateForm()) return;

    const quantity = Number(field('quantity').value);
    const unitCost = Number(field('unitCost').value);
    if (!Number.isFinite(quantity * unitCost)) {
      showError('The calculated total is too large. Check the quantity and unit cost.');
      return;
    }

    if (!navigator.onLine) {
      showError('You appear to be offline. Connect to the internet and submit again. Your entries are still here.');
      return;
    }

    let payload;
    try {
      payload = buildPayload();
    } catch {
      showError('The form could not be prepared. Please review the fields and try again.');
      return;
    }

    const serialized = JSON.stringify(payload);

    // Reuse the same ID for an unchanged retry so the server can safely deduplicate it.
    if (!requestId || requestPayload !== serialized) {
      try {
        requestId = createSubmissionId();
      } catch (error) {
        showError(error.message);
        return;
      }
      requestPayload = serialized;
    }

    const previousDisabled = fields.map(element => element.disabled);
    setBusy(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(`${CONFIG.url}/rest/v1/rpc/submit_public_ics`, {
        method: 'POST',
        headers: {
          apikey: CONFIG.publishableKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_data: payload,
          p_submission_id: requestId
        }),
        signal: controller.signal
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        if (result?.code === 'PGRST202' || result?.code === '42883') {
          throw new Error('Public ICS submission is not enabled yet. Please contact the system administrator. Your entries have been kept.');
        }
        if (result?.code === '22023') {
          throw new Error(result.message || 'The server rejected some of the submitted details. Please review the form and try again.');
        }
        throw new Error('The form could not be saved. Please try again. Your entries have been kept.');
      }

      const data = Array.isArray(result) ? result[0] : result;
      if (!data?.id || data.status !== 'Pending') {
        throw new Error('The server did not confirm the submission. Please try again; an unchanged retry will use the same request reference.');
      }

      document.getElementById('receiptControlNo').textContent = data.controlNo ?? payload.controlNo;
      document.getElementById('receiptIcsNo').textContent = data.icsNo ?? payload.icsNo;
      document.getElementById('receiptReference').textContent = String(data.id);

      form.hidden = true;
      receipt.hidden = false;
      document.body.classList.add('ics-submitted');
      receipt.focus();
      receipt.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    } catch (error) {
      if (error.name === 'AbortError') {
        showError('The connection timed out. Submit again to confirm your form. An unchanged retry will use the same request reference.');
      } else if (error instanceof TypeError) {
        showError('Could not connect to the submission service. Check your internet connection and try again. Your entries have been kept.');
      } else {
        showError(error.message || 'Something went wrong. Please try again.');
      }
    } finally {
      window.clearTimeout(timeoutId);
      setBusy(false, previousDisabled);
    }
  });

  document.getElementById('anotherIcsBtn').addEventListener('click', () => {
    requestId = null;
    requestPayload = null;
    form.reset();
    receipt.hidden = true;
    form.hidden = false;
    document.body.classList.remove('ics-submitted');
    visited = 0;setStep(0,false);
    clearError();
    updateTotal();
    field('controlNo').focus();
    form.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });

  submit.disabled = false;
  updateTotal();
  setStep(0,false);
})();

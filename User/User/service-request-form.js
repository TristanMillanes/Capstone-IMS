(() => {
  'use strict';
  const CONFIG = Object.freeze({
    url: 'https://zssrxubajhqryrwijyzm.supabase.co',
    publishableKey: 'sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP'
  });
  const form = document.getElementById('publicServiceRequestForm');
  if (!form) return;
  const feedback = document.getElementById('serviceRequestFeedback');
  const submit = document.getElementById('submitServiceRequestBtn');
  const receipt = document.getElementById('serviceRequestReceipt');
  const next = document.getElementById('requestNextBtn');
  const back = document.getElementById('requestBackBtn');
  const heading = document.getElementById('activeStepTitle');
  const panels = [...form.querySelectorAll('.wizard-panel')];
  const steps = [...form.querySelectorAll('[data-go-step]')];
  const field = name => form.elements.namedItem(name);
  const categories = ['technicalAssistance','iecService','plantingMaterials','environmentalConcerns','certifications','otherServices'];
  const titles = ['Tell us about yourself','How can we help?','Add your request details','Review your request'];
  let step = 0, visited = 0, saving = false;
  let requestId = null, requestPayload = null;

  function submissionId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2,'0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  function syncDate() {
    const parts = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const date = Object.fromEntries(parts.map(part=>[part.type,part.value]));
    field('dateNeeded').min = `${date.year}-${date.month}-${date.day}`;
  }
  function syncCategories() {
    const selected = categories.some(name=>field(name).value.trim());
    field('technicalAssistance').setCustomValidity(selected?'':'Please select at least one service or describe another service.');
    return selected;
  }
  function showError(message,focus=true) {
    feedback.textContent=message;feedback.hidden=false;
    if(focus) feedback.focus();
  }
  function clearFieldError(input) {
    input.removeAttribute('aria-invalid');
    const id=`${input.id}-error`;
    document.getElementById(id)?.remove();
    const described=(input.getAttribute('aria-describedby')||'').split(/\s+/).filter(item=>item&&item!==id);
    if(described.length) input.setAttribute('aria-describedby',described.join(' '));
    else input.removeAttribute('aria-describedby');
  }
  function markFieldError(input) {
    clearFieldError(input);
    const note=document.createElement('p');note.id=`${input.id}-error`;note.className='service-field-error';note.textContent=input.validationMessage;
    input.closest('.service-form-field')?.append(note);
    input.setAttribute('aria-invalid','true');
    input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),note.id].filter(Boolean).join(' '));
  }
  function validatePanel(index) {
    if(index>2) return null;
    syncDate();
    const fields=[...panels[index].querySelectorAll('input,textarea,select')];
    fields.forEach(input=>{
      input.setCustomValidity(input.required&&!input.value.trim()?'Please complete this field.':'');
      clearFieldError(input);
    });
    if(index===1) syncCategories();
    let invalid=null;
    fields.forEach(input=>{if(!input.validity.valid){markFieldError(input);invalid??=input;}});
    return invalid;
  }
  function formattedDate(value) {
    if(!value)return 'Not specified';
    const date=new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('en-PH',{year:'numeric',month:'long',day:'numeric'}).format(date);
  }
  function renderReview() {
    const target=document.getElementById('requestReviewContent');target.replaceChildren();
    const val=name=>field(name).value.trim();
    const groups=[
      {title:'Your details',step:0,rows:[['Client / requestor',val('clientName')],['Organization / LGU / Barangay',val('organization')],['Contact number',val('contactNo')],['Email address',val('emailAddress')]]},
      {title:'Services requested',step:1,rows:categories.filter(name=>val(name)).map(name=>[field(name).labels[0].textContent.trim(),val(name),true])},
      {title:'Request details',step:2,rows:[['Detailed request notes & quantities',val('requestDetails'),true],['Location / project site',val('location'),true],['Date needed',formattedDate(val('dateNeeded'))],['Requested by',val('requestedBy')||val('clientName')],['Noted / endorsed by',val('notedBy')]]}
    ];
    groups.forEach(group=>{
      const section=document.createElement('section');section.className='request-review-group';
      const header=document.createElement('div');header.className='review-group-heading';
      const title=document.createElement('h4');title.textContent=group.title;
      const edit=document.createElement('button');edit.type='button';edit.className='review-edit';edit.textContent='Edit';edit.setAttribute('aria-label',`Edit ${group.title.toLowerCase()}`);edit.addEventListener('click',()=>setStep(group.step));
      header.append(title,edit);section.append(header);
      const dl=document.createElement('dl');dl.className='review-details';
      group.rows.forEach(([label,value,wide])=>{
        const row=document.createElement('div');if(wide)row.className='review-wide';
        const dt=document.createElement('dt');dt.textContent=label;
        const dd=document.createElement('dd');dd.textContent=value||'Not provided';
        row.append(dt,dd);dl.append(row);
      });
      section.append(dl);target.append(section);
    });
  }
  function setStep(index,focus=true) {
    step=Math.max(0,Math.min(3,index));visited=Math.max(step,visited);
    panels.forEach((panel,i)=>{panel.hidden=i!==step;});
    steps.forEach((button,i)=>{
      button.disabled=i>visited;button.classList.toggle('is-complete',i<step);
      if(i===step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');
      button.querySelector('.step-number').textContent=i<step?'✓':String(i+1);
    });
    heading.textContent=titles[step];
    document.getElementById('requestProgress').value=step+1;
    document.getElementById('requestProgressText').textContent=`Step ${step+1} of 4`;
    next.hidden=step===3;back.hidden=step===0;submit.hidden=step!==3;
    document.getElementById('requestSaveNote').textContent=step===3?'Your request will be sent to the office for review.':'Your entries stay here as you move between steps.';
    if(step===3)renderReview();
    if(focus)heading.focus();
  }
  function moveTo(target) {
    if(saving)return;
    feedback.hidden=true;
    if(target>step) {
      for(let i=step;i<target;i++) {
        const invalid=validatePanel(i);
        if(invalid){setStep(i,false);showError('Please check the highlighted fields before continuing.',false);invalid.focus();return;}
      }
    }
    setStep(target);
  }
  next.addEventListener('click',()=>moveTo(step+1));
  back.addEventListener('click',()=>moveTo(step-1));
  steps.forEach(button=>button.addEventListener('click',()=>moveTo(Number(button.dataset.goStep))));
  function onEdit(event) {
    if(!event.target.matches('input,textarea,select'))return;
    event.target.setCustomValidity('');clearFieldError(event.target);feedback.hidden=true;
    if(categories.includes(event.target.name)&&syncCategories())clearFieldError(field('technicalAssistance'));
  }
  form.addEventListener('input',onEdit);form.addEventListener('change',onEdit);
  form.addEventListener('reset',event=>{
    if(saving){event.preventDefault();return;}
    feedback.hidden=true;requestId=null;requestPayload=null;
    form.querySelectorAll('input,textarea,select').forEach(input=>{input.setCustomValidity('');clearFieldError(input);});
    requestAnimationFrame(()=>{visited=0;syncDate();setStep(0);});
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(saving)return;
    // Enter on an earlier step advances the form; only the review step submits.
    if(step<3){moveTo(step+1);return;}
    feedback.hidden=true;
    for(let i=0;i<3;i++) {
      const invalid=validatePanel(i);
      if(invalid){setStep(i,false);showError('Please check the highlighted fields before submitting.',false);invalid.focus();return;}
    }
    if(!navigator.onLine){showError('You are offline. Connect to the internet and submit again. Your entries are still here.');return;}
    const payload=Object.fromEntries(new FormData(form));
    Object.keys(payload).forEach(key=>{payload[key]=String(payload[key]).trim();});
    const serialized=JSON.stringify(payload);
    // The existing RPC uses this ID to deduplicate unchanged retries.
    if(!requestId||requestPayload!==serialized){requestId=submissionId();requestPayload=serialized;}
    // Review edit buttons are recreated, so collect current controls per submit.
    const controls=[...form.querySelectorAll('input,textarea,select,button')];
    const previousDisabled=controls.map(element=>element.disabled);
    saving=true;form.setAttribute('aria-busy','true');controls.forEach(element=>{element.disabled=true;});submit.textContent='Submitting…';
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await fetch(`${CONFIG.url}/rest/v1/rpc/submit_public_service_request`,{
        method:'POST',headers:{apikey:CONFIG.publishableKey,'Content-Type':'application/json'},
        body:JSON.stringify({p_data:payload,p_submission_id:requestId}),signal:controller.signal
      });
      const result=await response.json().catch(()=>null);
      if(!response.ok) {
        if(result?.code==='PGRST202'||result?.code==='42883')throw new Error('Service request submission is not available yet. Please ask the administrator to enable the public service request form. Your entries have been kept.');
        if(result?.code==='22023')throw new Error(result.message||'Please review the request details.');
        throw new Error('Your request could not be saved. Please try again. Your entries have been kept.');
      }
      if(!result?.id||!result.serviceNo||result.serviceStatus!=='Pending Review')throw new Error('The server did not confirm your request. Please try again.');
      document.getElementById('receiptServiceNo').textContent=result.serviceNo;
      document.getElementById('receiptRequestDate').textContent=result.dateRequest||'Not returned by the office';
      document.getElementById('receiptReference').textContent=result.id;
      document.getElementById('receiptCopyFeedback').textContent='';
      form.hidden=true;receipt.hidden=false;receipt.focus();
    } catch(error) {
      showError(error.name==='AbortError'?'The connection timed out. Submit again to confirm your request; an unchanged retry will not create another entry.':error instanceof TypeError?'Could not connect. Check your internet connection and submit again. Your entries have been kept.':error.message);
    } finally {
      clearTimeout(timeout);saving=false;form.setAttribute('aria-busy','false');
      controls.forEach((element,index)=>{element.disabled=previousDisabled[index];});submit.textContent='Submit service request ↗';
    }
  });
  document.getElementById('anotherServiceRequestBtn').addEventListener('click',()=>{
    receipt.hidden=true;form.hidden=false;form.reset();
  });
  document.getElementById('copyServiceNumberBtn').addEventListener('click',async()=>{
    const value=document.getElementById('receiptServiceNo').textContent;
    const status=document.getElementById('receiptCopyFeedback');
    try{await navigator.clipboard.writeText(value);status.textContent='Service number copied.';}
    catch{status.textContent=`Copy this service number: ${value}`;}
  });
  document.getElementById('printReceiptBtn').addEventListener('click',()=>window.print());
  form.classList.add('is-enhanced');document.getElementById('requestStepNavigation').hidden=false;
  heading.setAttribute('aria-live','polite');heading.setAttribute('aria-atomic','true');
  syncDate();setStep(0,false);
})();

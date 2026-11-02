/* Shared, read-only registry tools. Bookmarks contain IDs only, scoped to account. */
(() => {
  'use strict';
  const registries = new Map();
  const module = location.pathname.split('/').pop().replace('.html', '');
  let printing = false;
  const text = value => String(value ?? '').trim();
  const el = (tag, className = '', content) => {
    const node = document.createElement(tag); node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  };
  const first = (...values) => values.find(value => text(value)) ?? '';
  function scope() {
    try { const user = JSON.parse(localStorage.getItem('pgenro_current_user') || '{}'); return text(user.uid || user.id || user.user_id || 'guest'); } catch { return 'guest'; }
  }
  const storageKey = suffix => `ims_viewer:${scope()}:${module}:${suffix}`;
  function read(suffix, fallback) { try { return JSON.parse(localStorage.getItem(storageKey(suffix)) || 'null') ?? fallback; } catch { return fallback; } }
  function write(suffix, value) { try { localStorage.setItem(storageKey(suffix), JSON.stringify(value)); return true; } catch { return false; } }
  function notify(message) {
    let region = document.querySelector('.viewer-notice');
    if (!region) { region = el('div', 'viewer-notice'); region.setAttribute('role', 'status'); document.body.append(region); }
    region.textContent = message; region.hidden = false;
    clearTimeout(notify.timer); notify.timer = setTimeout(() => { region.hidden = true; }, 3500);
  }
  function icon(name) { const node = el('i'); node.dataset.lucide = name; return node; }
  function button(label, className = '') {
    const node = el('button', `viewer-button ${className}`, label); node.type = 'button'; return node;
  }
  function icons() {
    const pending = document.querySelectorAll('i[data-lucide]');
    if (!pending.length || !window.lucide?.createIcons) return;
    pending.forEach(node => node.setAttribute('data-viewer-icon', node.dataset.lucide));
    window.lucide.createIcons({nameAttr:'data-viewer-icon'});
  }
  const id = record => text(first(record.databaseId, record.id, record.controlNo, record.controlNumber, record.itemId, record.serviceNo, record.employeeId, record.toNumber));
  const title = record => text(first(record.subject, record.itemName, record.name, record.fullName, record.clientName, record.description, record.travelerName, record.controlNo, record.controlNumber, record.id, 'Record'));
  const reference = record => text(first(record.controlNo, record.controlNumber, record.itemId, record.serviceNo, record.employeeId, record.toNumber, record.id));
  function file(record) {
    const source = {...(record.raw || {}), ...(record.data || {}), ...record};
    const attachment = Array.isArray(source.attachments) ? source.attachments[0] || {} : source.attachment || {};
    const url = first(source.attachmentUrl, source.attachment_url, source.fileUrl, source.fileURL, source.file_url, source.pdfUrl, source.pdf_url, source.documentUrl, source.document_url, source.download_url, source.downloadUrl, attachment.url, attachment.fileUrl);
    return url ? {url:text(url), name:text(first(source.attachmentName, source.fileName, source.file_name, source.pdfFileName, attachment.name, reference(record) || 'Attachment'))} : null;
  }
  const columns = {
    communication:['controlNo','date','office','subject','action','status'],
    officememo:['id','date','target','subject','remarks'],
    employee:['employeeId','fullName','designation','employmentType','department','email','dutyStatus'],
    inventory:['itemId','name','category','total','used','balance'],
    service:['serviceNo','clientName','organization','primaryCategory','dateRequest','serviceStatus'],
    ics:['controlNumber','accountCode','article','description','serialNumber','quantity','totalValue','accountable','status'],
    visitorsView:['fullName','contact','purposeCategory','personToVisit','timestamp','status'],
    travelOR:['toNumber','travelerName','destination','startDate','travelType','status']
  };
  const dateKey = {communication:'date',officememo:'date',employee:'dateEmployed',inventory:'updatedAt',service:'dateRequest',ics:'dateAcquired',visitorsView:'timestamp',travelOR:'startDate'}[module];
  function compare(a, b, key) {
    const left = a[key], right = b[key];
    if (key === dateKey || /date|At$|timestamp/i.test(key)) {
      const parse = value => typeof value === 'number' ? value : Date.parse(value) || 0;
      return parse(left) - parse(right);
    }
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    return text(left).localeCompare(text(right), undefined, {numeric:true,sensitivity:'base'});
  }
  function ensure(tbody, render) {
    let state = registries.get(tbody);
    if (state) {
      state.render=render;
      if(state.account!==scope()){const saved=read('saved',[]);state.account=scope();state.bookmarks=new Set(Array.isArray(saved)?saved:[]);state.savedOnly=false;state.tools.querySelector('.viewer-saved-filter').setAttribute('aria-pressed','false');}
      return state;
    }
    const prefs = read('preferences', {});
    const stored=read('saved',[]);
    state = {tbody, render, account:scope(), page:1, size:[10,25,50].includes(prefs?.size) ? prefs.size : 10, sort:'original', direction:1, savedOnly:false, attachedOnly:false, query:'', rows:[], key:'', bookmarks:new Set((Array.isArray(stored)?stored:[]).filter(value => typeof value === 'string'))};
    registries.set(tbody, state);
    const table = tbody.closest('table');
    state.headers=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
    const region = table.closest('.table-wrapper,.table-responsive,.table-wrap,.table-container,.table-scroll,.table-frame,.ui-table-scroll') || table;
    const tools = el('div', 'viewer-registry-tools'); tools.setAttribute('aria-label','Reading tools');
    const saved = button('Saved', 'viewer-saved-filter'); saved.prepend(icon('bookmark')); saved.setAttribute('aria-pressed','false');
    saved.addEventListener('click', () => { state.savedOnly = !state.savedOnly; saved.setAttribute('aria-pressed',String(state.savedOnly)); state.page = 1; state.render(); });
    tools.append(saved);
    if (['communication','officememo','travelOR','service','ics'].includes(module)) {
      const attached = button('With files'); attached.prepend(icon('paperclip')); attached.setAttribute('aria-pressed','false');
      attached.addEventListener('click', () => { state.attachedOnly = !state.attachedOnly; attached.setAttribute('aria-pressed',String(state.attachedOnly)); state.page=1; state.render(); });
      tools.append(attached); state.attachedButton = attached;
    }
    const sort = el('select'); sort.setAttribute('aria-label','Sort records');
    [['original','Default order'],['newest','Newest first'],['oldest','Oldest first'],['name','Name / title A–Z']].forEach(([value,label]) => sort.add(new Option(label,value)));
    sort.addEventListener('change', () => { state.sort=sort.value; state.direction=1; state.page=1; state.render(); });
    const reset = button('Clear filters', 'viewer-reset'); reset.prepend(icon('filter-x'));
    reset.addEventListener('click', () => {
      state.savedOnly=state.attachedOnly=false; saved.setAttribute('aria-pressed','false'); state.attachedButton?.setAttribute('aria-pressed','false'); state.sort='original';sort.value='original';state.page=1;
      const card=table.closest('.records-card,.table-card') || document.querySelector('main');
      card?.querySelectorAll('input[type=search],input[type=text]').forEach(input => { input.value='';input.dispatchEvent(new Event('input',{bubbles:true})); });
      card?.querySelectorAll('select:not(.viewer-registry-tools select)').forEach(select => { select.selectedIndex=0;select.dispatchEvent(new Event('change',{bubbles:true})); });
      const allTab=[...card?.querySelectorAll('[data-filter]') || []].find(tab => /^(all)$/i.test(tab.dataset.filter));allTab?.click();
      card?.querySelector('.date-chip[data-range=all]')?.click();
      state.render();
    });
    const spacer = el('span','viewer-tools-spacer');
    const sizeLabel=el('label','viewer-size-label','Rows'); const size=el('select');size.setAttribute('aria-label','Rows per page');
    [10,25,50].forEach(value => size.add(new Option(String(value),String(value))));size.value=String(state.size);
    size.addEventListener('change', () => { state.size=Number(size.value);state.page=1;write('preferences',{size:state.size});state.render(); });
    sizeLabel.append(size);tools.append(sort,reset,spacer,sizeLabel);region.before(tools);
    const nav=el('nav','registry-pagination viewer-pagination');nav.setAttribute('aria-label','Registry pages');
    const count=el('span','registry-range');count.setAttribute('role','status');
    const controls=el('div','registry-page-controls');
    const previous=button('Previous'),next=button('Next'),label=el('span','registry-page-label');
    previous.addEventListener('click',()=>{state.page--;state.render();});next.addEventListener('click',()=>{state.page++;state.render();});
    controls.append(previous,label,next);nav.append(count,controls);region.after(nav);
    Object.assign(state,{tools,nav,count,previous,next,label,sortSelect:sort});
    table.querySelectorAll('thead th').forEach((th,index) => {
      const key=columns[module]?.[index]; if (!key) return;
      const control=button(th.textContent.trim(),'viewer-column-sort');control.append(icon('arrow-up-down'));th.replaceChildren(control);
      control.addEventListener('click',()=>{state.direction=state.sort===key ? -state.direction : 1;state.sort=key;state.sortSelect.value='';state.page=1;state.render();});
      th.dataset.sortKey=key;th.setAttribute('aria-sort','none');
    });
    icons();return state;
  }
  function filter(rows, tbody, render) {
    const state=ensure(tbody,render);
    let results=rows.filter(row => (!state.savedOnly || state.bookmarks.has(id(row))) && (!state.attachedOnly || Boolean(file(row))));
    if(state.sort==='name') results.sort((a,b)=>title(a).localeCompare(title(b),undefined,{numeric:true,sensitivity:'base'}));
    else if(['newest','oldest'].includes(state.sort)) results.sort((a,b)=>compare(a,b,dateKey)*(state.sort==='newest'?-1:1));
    else if(state.sort!=='original') results.sort((a,b)=>compare(a,b,state.sort)*state.direction);
    tbody.closest('table').querySelectorAll('th[data-sort-key]').forEach(th=>th.setAttribute('aria-sort',th.dataset.sortKey===state.sort?(state.direction===1?'ascending':'descending'):'none'));
    state.filtered=results;return results;
  }
  function paginate(rows, tbody, render) {
    const state=ensure(tbody,render); state.rows=rows;
    const generation=state.renderGeneration=(state.renderGeneration||0)+1;
    const decorateCurrent=items=>{if(state.renderGeneration===generation)decorate(tbody,items,state);};
    if(printing) { queueMicrotask(()=>decorateCurrent(rows));return rows; }
    const key=[...document.querySelectorAll('main input:not([type=hidden]),main select:not(.viewer-registry-tools select), main [data-filter].active,main .date-chip.active')].map(node=>`${node.id}:${node.value || node.dataset.filter || node.dataset.range || ''}`).join('|');
    if(state.key!==key)state.page=1;state.key=key;
    const pages=Math.max(1,Math.ceil(rows.length/state.size));state.page=Math.max(1,Math.min(pages,state.page));
    const start=(state.page-1)*state.size;
    state.count.textContent=rows.length?`${start+1}–${Math.min(start+state.size,rows.length)} of ${rows.length} records`:'0 records';
    state.label.textContent=`Page ${state.page} of ${pages}`;state.previous.disabled=state.page===1;state.next.disabled=state.page===pages;
    const sliced=rows.slice(start,start+state.size);queueMicrotask(()=>decorateCurrent(sliced));return sliced;
  }
  function decorate(tbody, rows, state) {
    const elements=[...tbody.children].filter(row=>!row.querySelector('td[colspan]'));
    elements.forEach((row,index)=>{
      const record=rows[index];if(!record)return;
      row.classList.add('viewer-record-row');
      let cell=row.querySelector('.action-column');
      if(!cell){cell=el('td','action-column');row.append(cell);}
      const recordId=id(record);row.dataset.viewerRecord=recordId;
      const old=cell.querySelector('button:not(.viewer-button)');
      if(old){
        old.classList.add('viewer-legacy-details');
        old.replaceChildren(icon(module==='employee'?'user-round':'eye'),document.createTextNode(module==='employee'?'Profile':'Details'));
        old.title=module==='employee'?'View profile':'View record details';
      }
      if(module==='officememo')cell.replaceChildren();
      cell.querySelectorAll('.viewer-button,.readonly-label').forEach(node=>node.remove());
      const attachment=file(record);
      if(attachment){
        const view=button('View file','viewer-file-button');view.prepend(icon('file-text'));
        view.setAttribute('aria-label',`View file for ${reference(record)}`);
        view.addEventListener('click',event=>{event.stopPropagation();window.PGENRO_Documents.open({...attachment,title:title(record),reference:reference(record)});});cell.prepend(view);
      }else if(['communication','officememo','travelOR'].includes(module))cell.prepend(el('span','viewer-no-file','No file'));
      if(['inventory','travelOR','officememo'].includes(module)){
        const details=button('Details');details.prepend(icon('eye'));details.addEventListener('click',()=>showRecord(record));cell.append(details);
      }
      [...row.cells].forEach((td,index)=>td.dataset.label=state.headers[index]||'Actions');
      if(recordId){
        const saved=state.bookmarks.has(recordId);const save=button('','viewer-bookmark');save.append(icon(saved?'bookmark-check':'bookmark'));
        save.title=saved?'Remove from saved':'Save reference';save.setAttribute('aria-label',`${save.title}: ${reference(record)}`);save.setAttribute('aria-pressed',String(saved));
        save.addEventListener('click',event=>{event.stopPropagation();if(state.bookmarks.has(recordId))state.bookmarks.delete(recordId);else state.bookmarks.add(recordId);const persisted=write('saved',[...state.bookmarks]);state.render();queueMicrotask(()=>{const target=[...tbody.children].find(row=>row.dataset.viewerRecord===recordId)?.querySelector('.viewer-bookmark')||state.tools.querySelector('.viewer-saved-filter');target?.focus({preventScroll:true});});if(!persisted)notify('Saved for this page only. Browser storage is unavailable.');});cell.append(save);
      }
    });icons();
  }
  const detailFields={
    inventory:[['itemId','Item ID'],['name','Item'],['category','Category'],['description','Description'],['unit','Unit'],['total','Total quantity'],['used','Used quantity'],['balance','Available'],['threshold','Low stock threshold'],['status','Status']],
    travelOR:[['toNumber','Travel order no.'],['travelerName','Traveler'],['travelerPosition','Position'],['destination','Destination'],['purpose','Purpose'],['startDate','Departure'],['endDate','Return'],['travelType','Travel type'],['status','Status'],['fundSource','Fund source'],['perDiem','Per diem']],
    officememo:[['id','Control no.'],['date','Date'],['target','Recipients'],['subject','Subject'],['remarks','Remarks']]
  };
  function showRecord(record){
    const dialog=el('dialog','viewer-record-dialog');dialog.setAttribute('aria-labelledby','viewerRecordTitle');
    const header=el('header','viewer-dialog-header'),copy=el('div');copy.append(el('span','viewer-kicker','Record details'));
    const heading=el('h2','',reference(record)||title(record));heading.id='viewerRecordTitle';copy.append(heading);
    const close=button('Close');header.append(copy,close);dialog.append(header);
    const list=el('dl','viewer-detail-grid');
    (detailFields[module]||[]).forEach(([key,label])=>{const group=el('div');group.append(el('dt','',label),el('dd','',text(record[key])||'—'));list.append(group);});dialog.append(list);
    const footer=el('footer','viewer-dialog-footer'),copyButton=button('Copy reference');
    copyButton.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(reference(record));notify('Reference copied.');}catch{notify('Copy unavailable. Select the reference above to copy it.');}});footer.append(copyButton);dialog.append(footer);
    const last=document.activeElement;close.addEventListener('click',()=>dialog.close());dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
    dialog.addEventListener('keydown',event=>event.stopPropagation());dialog.addEventListener('close',()=>{dialog.remove();last?.focus?.();},{once:true});document.body.append(dialog);dialog.showModal();
  }
  function search(render){let timer;return()=>{clearTimeout(timer);timer=setTimeout(render,120);};}
  window.addEventListener('beforeprint',()=>{printing=true;registries.forEach(state=>state.render());});
  window.addEventListener('afterprint',()=>{printing=false;registries.forEach(state=>state.render());});
  window.addEventListener('storage',event=>{if(event.key?.startsWith(`ims_viewer:${scope()}:`)){registries.forEach(state=>{const values=read('saved',[]);state.bookmarks=new Set(Array.isArray(values)?values:[]);state.render();});}});
  document.addEventListener('keydown',event=>{
    if(event.key!=='/'||event.ctrlKey||event.metaKey||event.altKey||document.querySelector('dialog[open],[role=dialog].open,.detail-drawer.open')||event.target.closest('input,textarea,select,[contenteditable=true]'))return;
    const input=document.querySelector('main input[type=search],main #searchInput,main #tableSearchInput,main #visitorSearch');if(input){event.preventDefault();input.focus();}
  });
  window.PGENRO_ViewerUI=Object.freeze({icons,filter,paginate,search,file,notify,showRecord});
})();

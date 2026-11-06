/* Viewing tools only: chart presentation, accessible data, and registry filters. */
(() => {
  'use strict';
  const number=new Intl.NumberFormat('en-PH');
  const $=selector=>document.querySelector(selector);
  const create=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
  const icons=()=>window.lucide?.createIcons?.();
  const dayLabel=day=>new Date(day*86400000).toLocaleDateString('en-PH',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'});
  const isoDay=day=>new Date(day*86400000).toISOString().slice(0,10);
  const percentage=(value,total)=>total?(100*value/total).toLocaleString('en-PH',{maximumFractionDigits:1})+'%':'0%';
  let chartState=null,selectedModule=null;

  function chartTable(kind,headers,rows){
    const table=$('#viewer-'+kind+'-data table');if(!table)return;
    const head=create('tr');headers.forEach(text=>{const th=create('th','',text);th.scope='col';head.append(th);});
    table.tHead.replaceChildren(head);
    const body=table.tBodies[0];body.replaceChildren();
    for(const row of rows){const tr=create('tr');row.forEach((value,index)=>{const cell=create(index===0?'th':'td','',value);if(index===0)cell.scope='row';tr.append(cell);});body.append(tr);}
  }
  function insight(container,items){
    container?.replaceChildren(...items.map(([label,value,note])=>{const div=create('div');div.append(create('span','viewer-insight-label',label),create('strong','',value),create('small','',note));return div;}));
  }
  function highlightModule(index){
    selectedModule=index;
    const chart=window.Chart?.getChart?.($('#operationsDistChart'));
    if(chart){
      const element=index===null?null:chart.getDatasetMeta(0).data[index];
      const active=element&&chartState.model.breakdown[index].current>0?[{datasetIndex:0,index}]:[];
      chart.setActiveElements(active);
      chart.tooltip?.setActiveElements(active,element?{x:element.x,y:element.y}:{x:0,y:0});
      chart.update('none');
    }
    document.querySelectorAll('[data-module-highlight]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.moduleHighlight)===index)));
    document.querySelectorAll('[data-module-index]').forEach(segment=>segment.style.opacity=index===null||Number(segment.dataset.moduleIndex)===index?'1':'.25');
  }
  function renderCharts(snapshot){
    if(!snapshot?.model)return;
    chartState=snapshot;selectedModule=null;
    const {model,rangeDays,mode}=snapshot;
    $('#viewerPeriodDates').textContent=dayLabel(model.start)+' – '+dayLabel(model.end);
    document.querySelectorAll('[data-chart-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.chartMode===mode)));
    const peaks=model.buckets.filter(bucket=>bucket.total===Math.max(...model.buckets.map(value=>value.total)));
    const peak=peaks[0];
    insight($('#viewer-trend-insight'),[
      ['IN THIS PERIOD',number.format(model.total)+' record'+(model.total===1?'':'s'),'Across '+model.availableCount+' available activity modules'],
      ['BUSIEST WEEK',peak?.total?number.format(peak.total)+' record'+(peak.total===1?'':'s'):'No dated activity',peak?.total?(peaks.length>1?peaks.length+' weeks share the peak':'Week starting '+peak.label):'Choose a wider period to explore activity']
    ]);
    const top=Math.max(...model.breakdown.map(module=>module.current));
    const leaders=model.breakdown.filter(module=>module.current===top&&top>0);
    insight($('#viewer-distribution-insight'),[
      [leaders.length>1?'SHARED LEAD':'LARGEST SHARE',top?(leaders.length>1?leaders.length+' modules tied':leaders[0].label):'No dated activity',top?(leaders.length>1?number.format(top)+' record'+(top===1?'':'s')+' each':number.format(top)+' record'+(top===1?'':'s')+' · '+percentage(top,model.total)):(model.availableCount?'Try another chart period':'Activity sources are unavailable')]
    ]);
    chartTable('trend',['Week starting','Documents & ICS','Travel orders','Service requests','Total'],model.buckets.map(bucket=>[bucket.label,bucket.documents,bucket.travel,bucket.services,bucket.total]));
    chartTable('distribution',['Module','Records','Share'],model.breakdown.map(module=>[module.label,module.available?module.current:'Unavailable',module.available?percentage(module.current,model.total):'—']));
    for(const kind of ['trend','distribution'])$('#viewer-'+kind+'-data caption').textContent=(kind==='trend'?'Weekly record activity':'Activity by module')+' · '+dayLabel(model.start)+' – '+dayLabel(model.end);
    const legend=$('#viewerDistributionLegend');legend.replaceChildren();
    model.breakdown.forEach((module,index)=>{
      const button=create('button','viewer-distribution-row');button.type='button';button.dataset.moduleHighlight=index;button.setAttribute('aria-pressed','false');
      button.setAttribute('aria-label',module.label+': '+(module.available?number.format(module.current)+' records, '+percentage(module.current,model.total)+'. Highlight chart segment.':'data unavailable.'));
      const dot=create('i','viewer-module-swatch');dot.style.setProperty('--series',module.color);dot.setAttribute('aria-hidden','true');
      const label=create('span','viewer-distribution-name',module.label),amount=create('strong','',module.available?number.format(module.current):'—'),share=create('small','',module.available?percentage(module.current,model.total):'Unavailable');
      button.append(dot,label,amount,share);
      button.addEventListener('click',()=>highlightModule(selectedModule===index?null:index));
      legend.append(button);
    });
  }
  function csv(kind){
    if(!chartState)return;
    const model=chartState.model;
    const rows=kind==='trend'?
      [['Week starting','Documents & ICS','Travel orders','Service requests','Total'],...model.buckets.map((bucket,index)=>[isoDay(model.start+index*7),bucket.documents,bucket.travel,bucket.services,bucket.total])]:
      [['Module','Records','Share'],...model.breakdown.map(module=>[module.label,module.available?module.current:'Unavailable',module.available?percentage(module.current,model.total):''])];
    const content='\uFEFF'+rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8;'}));
    const link=create('a');link.href=url;link.download='PGENRO-'+kind+'-'+isoDay(model.start)+'-to-'+isoDay(model.end)+'.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function dashboard(){
    if(!$('#viewer-trend-panel'))return;
    document.addEventListener('pgenro:viewer-charts',event=>{renderCharts(event.detail);updateSync();});
    if(window.PGENRO_ViewerChartState)renderCharts(window.PGENRO_ViewerChartState);
    $('#operationsDistChart').addEventListener('mousemove',()=>{if(selectedModule===null)return;selectedModule=null;document.querySelectorAll('[data-module-highlight]').forEach(button=>button.setAttribute('aria-pressed','false'));});
    document.querySelectorAll('[data-chart-mode]').forEach(button=>button.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('pgenro:viewer-chart-mode',{detail:{mode:button.dataset.chartMode}}))));
    for(const kind of ['trend','distribution']){
      const toggle=$('#viewer-'+kind+'-data-toggle'),panel=$('#viewer-'+kind+'-data');
      toggle.addEventListener('click',()=>{const expanded=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-label',(expanded?'Hide ':'View ')+kind+' chart data');panel.hidden=!expanded;toggle.innerHTML='<i data-lucide="clipboard-list"></i>'+(expanded?'Hide data':'View data');icons();});
    }
    document.querySelectorAll('[data-chart-csv]').forEach(button=>button.addEventListener('click',()=>csv(button.dataset.chartCsv)));
    const status=$('#dbStatusText'),note=$('#viewerSyncNote'),refresh=$('#refreshDashboardBtn');let previous='';
    function updateSync(){
      const text=status?.textContent.trim()||'',missing=chartState?.unavailableModules||0,key=text+'|'+missing+'|'+Boolean(refresh?.disabled);if(previous===key)return;previous=key;
      if(refresh?.disabled){note.textContent='Updating records…';note.dataset.sync='loading';}
      else if(missing){note.textContent=missing+' module'+(missing===1?'':'s')+' unavailable';note.dataset.sync='unavailable';}
      else if(/\bconnected\b/i.test(text)){note.textContent='Updated '+new Date().toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'});note.dataset.sync='ready';}
      else if(/loading|connecting/i.test(text)){note.textContent='Updating records…';note.dataset.sync='loading';}
      else{note.textContent=text||'Waiting for records';note.dataset.sync='unavailable';}
    }
    updateSync();if(status)new MutationObserver(updateSync).observe(status,{childList:true,subtree:true,characterData:true});
    if(refresh)new MutationObserver(updateSync).observe(refresh,{attributes:true,attributeFilter:['disabled']});
    document.querySelectorAll('.viewer-chart-guide').forEach(guide=>guide.addEventListener('toggle',()=>{if(guide.open)document.querySelectorAll('.viewer-chart-guide').forEach(other=>{if(other!==guide)other.open=false;});}));
    document.addEventListener('click',event=>{if(!event.target.closest('.viewer-chart-guide'))document.querySelectorAll('.viewer-chart-guide[open]').forEach(guide=>guide.open=false);});
    document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;document.querySelectorAll('.viewer-chart-guide[open]').forEach(guide=>{guide.open=false;guide.querySelector('summary').focus();});if(selectedModule!==null)highlightModule(null);});
  }
  const fieldsByPage={
    communication:['searchInput','statusFilter'],travelOR:['travelSearch','travelStatus'],officememo:['searchInput'],
    employee:['searchInput','filterEmploymentType','filterDepartment','filterStatus'],inventory:['searchInput'],
    visitorsView:['visitorSearch','purposeFilter','statusFilter'],service:['tableSearchInput','filterStatusSelect'],ics:['tableSearchInput','filterArticleSelect','filterIcsStatus']
  };
  const fieldLabels={statusFilter:'Status',travelStatus:'Status',filterEmploymentType:'Employment',filterDepartment:'Department',filterStatus:'Status',purposeFilter:'Purpose',filterStatusSelect:'Status',filterArticleSelect:'Article',filterIcsStatus:'Status'};
  function registry(){
    const page=location.pathname.split('/').pop().replace('.html',''),ids=fieldsByPage[page];if(!ids)return;
    const table=$('main table');if(!table)return;
    const fields=ids.map(id=>document.getElementById(id)).filter(Boolean);
    const defaults=new Map(fields.map(field=>[field,field.tagName==='SELECT'?(field.options[0]?.value||''):'']));
    const tabGroups=['[data-filter]','[data-range]'].map(selector=>{const buttons=[...document.querySelectorAll('main '+selector)];return{buttons,defaultButton:buttons.find(button=>button.classList.contains('active'))||buttons[0]};}).filter(group=>group.buttons.length);
    const tools=create('div','viewer-registry-tools'),summary=create('div','viewer-filter-summary'),label=create('span','viewer-filter-label','ALL RECORDS'),chips=create('div','viewer-filter-chips');
    summary.append(label,chips);
    const actions=create('div','viewer-registry-actions'),reset=create('button','viewer-reset-filters','Reset filters'),density=create('button','viewer-density-toggle');
    reset.type=density.type='button';reset.hidden=true;density.setAttribute('aria-pressed','false');
    const hint=create('kbd','viewer-search-shortcut','/ Search');hint.setAttribute('aria-hidden','true');
    actions.append(reset,density,hint);tools.append(summary,actions);
    const wrapper=table.closest('.table-wrapper,.table-responsive,.table-container,.table-scroll,.ui-table-scroll')||table;wrapper.before(tools);
    let compact=false;try{compact=localStorage.getItem('pgenro_viewer_density')==='compact';}catch{}
    function setDensity(){document.body.dataset.rowDensity=compact?'compact':'comfortable';density.setAttribute('aria-pressed',String(compact));density.textContent=compact?'Comfortable rows':'Compact rows';density.title=compact?'Switch to comfortable row spacing':'Show more records with compact spacing';}
    setDensity();density.addEventListener('click',()=>{compact=!compact;try{localStorage.setItem('pgenro_viewer_density',compact?'compact':'comfortable');}catch{}setDensity();});
    function update(){
      const active=fields.filter(field=>field.tagName==='INPUT'?field.value.trim()!=='':field.value!==defaults.get(field));
      const selected=tabGroups.map(group=>group.buttons.find(button=>button.classList.contains('active'))).filter((button,index)=>button&&button!==tabGroups[index].defaultButton);
      const count=active.length+selected.length;label.textContent=count?count+' ACTIVE FILTER'+(count===1?'':'S'):'ALL RECORDS';reset.hidden=!count;chips.replaceChildren();
      active.forEach(field=>{const value=field.tagName==='SELECT'?field.selectedOptions[0]?.textContent.trim():field.value.trim();chips.append(create('span','viewer-filter-chip',(fieldLabels[field.id]||'Search')+': '+value));});
      selected.forEach(button=>chips.append(create('span','viewer-filter-chip',button.textContent.trim().replace(/\s+/g,' '))));
    }
    fields.forEach(field=>{field.addEventListener('input',update);field.addEventListener('change',update);});
    tabGroups.forEach(group=>group.buttons.forEach(button=>button.addEventListener('click',()=>queueMicrotask(update))));
    reset.addEventListener('click',()=>{fields.forEach(field=>{field.value=defaults.get(field);field.dispatchEvent(new Event(field.tagName==='SELECT'?'change':'input',{bubbles:true}));});tabGroups.forEach(group=>group.defaultButton?.click());update();});
    const search=fields.find(field=>field.tagName==='INPUT');
    document.addEventListener('keydown',event=>{
      if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.target.closest('input,textarea,select,[contenteditable="true"]')&&!document.querySelector('dialog[open],.modal-backdrop.open,.detail-drawer.open')){event.preventDefault();search?.focus();}
      if(event.key==='Escape'&&event.target===search&&search.value){search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));}
    });
    update();
  }
  function init(){if(document.body.dataset.viewerExperience!=='v2')return;dashboard();registry();icons();document.body.dataset.experienceReady='true';}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

/* Visual feedback follows the existing async state; it never submits a form. */
(() => {
  'use strict';
  if(window.PGENRO_ButtonFeedback)return;
  window.PGENRO_ButtonFeedback=true;
  function init(){
    const submitFor={loginForm:'loginBtn',accessForm:'submitBtn',publicServiceRequestForm:'submitServiceRequestBtn',visitorForm:'submitBtn'};
    Object.entries(submitFor).forEach(([formId,buttonId])=>{
      const form=document.getElementById(formId),button=document.getElementById(buttonId);if(!form||!button)return;
      const status=document.createElement('p');status.className='sr-only ui-async-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');form.after(status);
      const labels={loginForm:'Signing in. Please wait.',accessForm:'Sending your account request. Please wait.',publicServiceRequestForm:'Sending your service request. Please wait.',visitorForm:'Saving your visit. Please wait.'};
      const sync=()=>{const busy=form.getAttribute('aria-busy')==='true';button.setAttribute('aria-busy',String(busy));button.classList.toggle('ui-button-busy',busy);status.textContent=busy?labels[formId]:'';};
      sync();new MutationObserver(sync).observe(form,{attributes:true,attributeFilter:['aria-busy']});
    });
    if(document.body.dataset.recordAccess==='view-only'){
      document.querySelectorAll('#refreshDashboardBtn,#refreshRecordsBtn,#refreshBtn,#travelRefresh').forEach(button=>{
        let previous='';
        const sync=()=>{const busy=button.disabled||button.classList.contains('is-loading'),key=String(busy);if(key===previous)return;previous=key;button.setAttribute('aria-busy',key);button.classList.toggle('ui-button-busy',busy);};
        sync();new MutationObserver(sync).observe(button,{attributes:true,attributeFilter:['disabled','class']});
      });
    }
    const eligible='.primary-sign-btn,.submit-btn,.btn-solid,.primary-action,.secondary-action,.btn-outline,.refresh-btn,.secondary-btn';
    document.addEventListener('pointerdown',event=>{
      const button=event.target.closest('button');if(!button||!button.matches(eligible)||button.disabled||event.button!==0||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      const r=button.getBoundingClientRect(),wave=document.createElement('span');wave.className='ui-tap-wave';wave.setAttribute('aria-hidden','true');
      wave.style.setProperty('--tap-x',event.clientX-r.left+'px');wave.style.setProperty('--tap-y',event.clientY-r.top+'px');wave.style.setProperty('--tap-size',Math.max(r.width,r.height)*2+'px');
      button.append(wave);wave.addEventListener('animationend',()=>wave.remove(),{once:true});setTimeout(()=>wave.remove(),700);
    },true);
    document.body.dataset.buttonFeedbackReady='true';
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

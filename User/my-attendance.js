/* Personal monitoring is fetched through an authenticated, caller-only RPC.
   No employee records, attendance or passwords are read from browser caches. */
(() => {
  'use strict';
  const text=value=>value==null?'':String(value).trim();
  const activity=value=>text(value).toUpperCase().replace(/^0[1-4][.\s]+/,'');
  function records(value,kind) {
    return (Array.isArray(value)?value:[]).filter(row=>row&&typeof row==='object'&&!Array.isArray(row)).map(row=>({
      control:text(row.control_number),date:text(row.date).slice(0,10),activity:activity(row.activity)||'FLAG CEREMONY',
      status:kind==='uniform'?(typeof row.compliant==='boolean'?(row.compliant?'YES':'NO'):text(row.compliant).toUpperCase()):
        (/^(OB|O\.B\.?|OFFICIAL BUSINESS \(O\.B\.\))$/i.test(text(row.status))?'OFFICIAL BUSINESS':text(row.status).toUpperCase()),
      remarks:text(row.remarks)
    })).sort((a,b)=>b.date.localeCompare(a.date)||a.control.localeCompare(b.control));
  }
  function filter(rows,{month='',status='',search=''}={}) {
    const needle=search.trim().toLowerCase();
    return rows.filter(row=>(!month||row.date.startsWith(month+'-'))&&(!status||row.status===status)&&
      (!needle||[row.control,row.activity,row.status,row.remarks,row.date].join(' ').toLowerCase().includes(needle)));
  }
  const summary=rows=>rows.reduce((result,row)=>{result.total++;result[row.status]=(result[row.status]||0)+1;return result;},{total:0});
  const api=Object.freeze({records,filter,summary});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof document==='undefined')return;
  window.PGENRO_AttendanceData=api;
  const $=id=>document.getElementById(id);
  let source=null,kind='ceremony',pageNumber=1,generation=0,currentUser=null,pollTimer,subscription;
  const size=20;
  function clear() {
    source=null;currentUser=null;$('attendanceIdentity').hidden=true;$('attendanceWorkspace').hidden=true;
    $('attendanceBody').replaceChildren();$('attendanceName').textContent='';$('attendanceNumber').textContent='';
    $('attendanceDepartment').textContent='';$('attendanceRange').textContent='';
    $('attendanceUpdated').textContent='';
    for(const id of ['attendanceTotal','attendancePositive','attendanceNegative','attendanceOther'])$(id).textContent='0';
  }
  function notice(message,error=false) {
    $('attendanceMessage').textContent=message;$('attendanceMessage').dataset.kind=error?'error':'info';
    $('attendanceMessage').hidden=!message;
  }
  function render() {
    if(!source?.linked)return;
    const all=records(source[kind==='ceremony'?'ceremony_records':'uniform_records'],kind);
    const filtered=filter(all,{month:$('attendanceMonth').value,status:$('attendanceStatus').value,search:$('attendanceSearch').value});
    const totals=summary(filtered),ceremony=kind==='ceremony';
    $('attendanceTotal').textContent=totals.total;
    $('positiveLabel').textContent=ceremony?'Present':'Compliant';$('attendancePositive').textContent=totals[ceremony?'PRESENT':'YES']||0;
    $('negativeLabel').textContent=ceremony?'Absent':'Not compliant';$('attendanceNegative').textContent=totals[ceremony?'ABSENT':'NO']||0;
    $('otherLabel').textContent=ceremony?'Late':'Other / unrecorded';$('attendanceOther').textContent=ceremony?(totals.LATE||0):filtered.filter(r=>!['YES','NO'].includes(r.status)).length;
    $('attendanceTableTitle').textContent=ceremony?'Flag ceremony attendance':'Uniform monitoring';
    const labels=ceremony?['Date','Activity','Status','Control number','Remarks']:['Date','Compliant','Control number','Remarks'];
    $('attendanceColumns').replaceChildren(...labels.map(label=>{const th=document.createElement('th');th.scope='col';th.textContent=label;return th;}));
    const pages=Math.max(1,Math.ceil(filtered.length/size));pageNumber=Math.min(pageNumber,pages);
    const rows=filtered.slice((pageNumber-1)*size,pageNumber*size),body=$('attendanceBody');body.replaceChildren();
    const names={'PRESENT':'Present','ABSENT':'Absent','LATE':'Late','LEAVE':'Leave','OFFICIAL BUSINESS':'Official Business','YES':'Yes','NO':'No'};
    for(const record of rows){
      const tr=document.createElement('tr');tr.className='viewer-record-row';
      const parsedDate=new Date(record.date+'T00:00:00Z');
      const date=/^\d{4}-\d{2}-\d{2}$/.test(record.date)&&!Number.isNaN(parsedDate.getTime())?new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeZone:'UTC'}).format(parsedDate):'—';
      const values=ceremony?[date,record.activity,names[record.status]||record.status||'—',record.control||'—',record.remarks||'—']:
        [date,names[record.status]||record.status||'—',record.control||'—',record.remarks||'—'];
      values.forEach((value,i)=>{const td=document.createElement('td');td.dataset.label=labels[i];
        if(i===(ceremony?2:1)){const badge=document.createElement('span');badge.className='attendance-badge '+(['PRESENT','YES'].includes(record.status)?'positive':['ABSENT','NO'].includes(record.status)?'negative':'neutral');badge.textContent=value;td.append(badge);}
        else td.textContent=value;
        tr.append(td);
      });body.append(tr);
    }
    if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=labels.length;td.className='attendance-empty';td.textContent=all.length?'No records match your filters.':'No records have been encoded for your employee account yet.';tr.append(td);body.append(tr);}
    $('attendanceRange').textContent=`${filtered.length?((pageNumber-1)*size+1):0}–${Math.min(pageNumber*size,filtered.length)} of ${filtered.length} records`;
    $('attendancePage').textContent=`Page ${pageNumber} of ${pages}`;$('attendancePrevious').disabled=pageNumber<=1;$('attendanceNext').disabled=pageNumber>=pages;
  }
  function selectKind(next) {
    kind=next;pageNumber=1;
    for(const tab of document.querySelectorAll('[data-attendance-kind]')){const active=tab.dataset.attendanceKind===kind;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));}
    $('attendanceRecords').setAttribute('aria-labelledby',kind==='ceremony'?'ceremonyTab':'uniformTab');
    const select=$('attendanceStatus');select.replaceChildren();
    for(const [value,label] of (kind==='ceremony'?[['','All statuses'],['PRESENT','Present'],['ABSENT','Absent'],['LATE','Late'],['OFFICIAL BUSINESS','Official Business'],['LEAVE','Leave']]:[['','All records'],['YES','Compliant'],['NO','Not compliant']])){
      const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);
    }
    render();
  }
  async function load() {
    const token=++generation;$('attendanceRefresh').disabled=true;
    try {
      const db=window.pgenroSupabase;if(!db)throw new Error('The attendance service is unavailable. Reload and try again.');
      const {data:identity,error:authError}=await db.auth.getUser();if(token!==generation)return;
      if(authError)throw authError;
      if(!identity?.user){clear();notice('Sign in to view your attendance.');window.location.replace('login.html');return;}
      if(currentUser!==identity.user.id){clear();notice('Loading your employee attendance…');currentUser=identity.user.id;}
      // No ID or query-string value is supplied. The database uses auth.uid().
      const {data,error}=await db.rpc('pgenro_my_attendance');if(token!==generation)return;
      if(error)throw error;
      if(!data||typeof data.linked!=='boolean')throw new Error('Attendance is not configured. Please contact the administrator.');
      if(!data.linked){clear();notice('Your account needs an employee number. Ask the administrator to update your account.');return;}
      source=data;$('attendanceName').textContent=text(data.employee?.full_name)||'Employee';
      $('attendanceNumber').textContent=text(data.employee?.employee_number);$('attendanceDepartment').textContent=[data.employee?.designation,data.employee?.department].filter(Boolean).join(' · ');
      for(const el of document.querySelectorAll('.profile-text strong,.profile-dropdown-header h3'))el.textContent=text(data.employee?.full_name)||'Employee';
      $('attendanceIdentity').hidden=false;$('attendanceWorkspace').hidden=false;
      notice(data.reason==='ambiguous_employee_number'?'Your employee number needs an administrator review before attendance can be shown.':
        data.matched===false?'No attendance or uniform records have been encoded for your employee number yet.':'');render();
      $('attendanceUpdated').textContent='Updated '+new Intl.DateTimeFormat('en-PH',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Manila'}).format(new Date());
    } catch(error) {
      if(token!==generation)return;
      clear();notice(error?.code==='PGRST202'?'Attendance is not configured. Please contact the administrator.':error?.message||'Your attendance could not be loaded. Try Refresh.',true);
    } finally {if(token===generation)$('attendanceRefresh').disabled=false;}
  }
  function navigation() {
    const sidebar=$('sidebar'),menu=$('hamburgerMenu'),overlay=$('overlay'),profile=$('profileMenu');
    const closeProfile=()=>{profile.classList.remove('open');$('profileBtn').setAttribute('aria-expanded','false');$('profileDropdown').setAttribute('aria-hidden','true');};
    const setMenu=open=>{const active=open&&matchMedia('(max-width:900px)').matches;sidebar.classList.toggle('open',active);menu.classList.toggle('active',active);menu.setAttribute('aria-expanded',String(active));overlay.classList.toggle('active',active);document.body.classList.toggle('sidebar-open',active);};
    menu.addEventListener('click',()=>{if(innerWidth<=900){closeProfile();setMenu(!sidebar.classList.contains('open'));}});
    overlay.addEventListener('click',()=>setMenu(false));
    $('profileBtn').addEventListener('click',event=>{event.stopPropagation();const open=!profile.classList.contains('open');closeProfile();profile.classList.toggle('open',open);$('profileBtn').setAttribute('aria-expanded',String(open));$('profileDropdown').setAttribute('aria-hidden',String(!open));});
    profile.addEventListener('click',event=>event.stopPropagation());document.addEventListener('click',closeProfile);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeProfile();setMenu(false);}});
  }
  function init() {
    if(!$('attendanceBody'))return;navigation();selectKind('ceremony');
    $('attendanceRefresh').addEventListener('click',load);
    for(const id of ['attendanceMonth','attendanceStatus','attendanceSearch'])$(id).addEventListener(id==='attendanceSearch'?'input':'change',()=>{pageNumber=1;render();});
    for(const tab of document.querySelectorAll('[data-attendance-kind]'))tab.addEventListener('click',()=>selectKind(tab.dataset.attendanceKind));
    $('attendancePrevious').addEventListener('click',()=>{pageNumber--;render();});$('attendanceNext').addEventListener('click',()=>{pageNumber++;render();});
    const db=window.pgenroSupabase;
    if(db?.auth.onAuthStateChange)subscription=db.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT'||(currentUser&&session?.user?.id!==currentUser)){generation++;clear();notice('Your session changed. Loading the current account…');}
      if(event==='SIGNED_OUT'){window.location.replace('login.html');return;}
      if(event==='SIGNED_IN')queueMicrotask(load);
    }).data?.subscription;
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
    pollTimer=setInterval(()=>{if(!document.hidden&&currentUser)load();},45000);
    window.addEventListener('pagehide',()=>{generation++;clearInterval(pollTimer);subscription?.unsubscribe();clear();});
    load();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

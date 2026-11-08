/* Personal monitoring is fetched through an authenticated, caller-only RPC.
   No employee records, attendance or passwords are read from browser caches. */
(() => {
  'use strict';
  const text=value=>value==null?'':String(value).trim();
  const normalizeActivity = value => text(value).toUpperCase().replace(/^0[1-4][.\s]+/, '');
  const activityLabels = new Map([
    ['FLAG CEREMONY', 'Flag Ceremony'],
    ['FLAG RETREAT', 'Flag Retreat'],
    ['HOLIDAY CELEBRATION', 'Holiday Celebration'],
    ['OTHERS', 'Others']
  ]);
  const statusOptions = {
    ceremony: new Map([
      ['PRESENT', {label: 'Present', tone: 'present'}],
      ['ABSENT', {label: 'Absent', tone: 'absent'}],
      ['LATE', {label: 'Late', tone: 'late'}],
      ['OFFICIAL BUSINESS', {label: 'Official Business', tone: 'official'}],
      ['LEAVE', {label: 'Leave', tone: 'leave'}]
    ]),
    uniform: new Map([
      ['YES', {label: 'Compliant', tone: 'present'}],
      ['NO', {label: 'Not compliant', tone: 'absent'}]
    ])
  };
  const otherStatus = {label: 'Other / unrecorded', tone: 'other'};
  function records(value,kind) {
    return (Array.isArray(value)?value:[]).filter(row=>row&&typeof row==='object'&&!Array.isArray(row)).map(row=>({
      control:text(row.control_number),date:text(row.date).slice(0,10),activity:normalizeActivity(row.activity)||'FLAG CEREMONY',
      status:kind==='uniform'?(typeof row.compliant==='boolean'?(row.compliant?'YES':'NO'):text(row.compliant).toUpperCase()):
        (/^(OB|O\.B\.?|OFFICIAL BUSINESS \(O\.B\.\))$/i.test(text(row.status))?'OFFICIAL BUSINESS':text(row.status).toUpperCase()),
      remarks:text(row.remarks)
    })).sort((a,b)=>b.date.localeCompare(a.date)||a.control.localeCompare(b.control));
  }
  function filter(rows, {month = '', status = '', activity = '', search = ''} = {}) {
    const needle = search.trim().toLowerCase();
    const selectedActivity = normalizeActivity(activity);
    return rows.filter(row =>
      (!month || row.date.startsWith(month + '-')) &&
      (!status || row.status === status) &&
      (!selectedActivity || row.activity === selectedActivity) &&
      (!needle || [row.control, row.activity, row.status, row.remarks, row.date].join(' ').toLowerCase().includes(needle))
    );
  }
  const summary=rows=>rows.reduce((result,row)=>{result.total++;result[row.status]=(result[row.status]||0)+1;return result;},{total:0});
  const api=Object.freeze({records,filter,summary});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof document==='undefined')return;
  window.PGENRO_AttendanceData=api;
  const $=id=>document.getElementById(id);
  const filterFields = ['attendanceMonth', 'attendanceStatus', 'attendanceActivity', 'attendanceSearch'];
  let attendanceRecords = null;
  let manualTabSelection = false;
  let kind='ceremony',pageNumber=1,generation=0,currentUser=null,pollTimer,subscription;
  let liveChannel=null,liveUser='',liveRefresh;
  const size=20;
  function updateActivityOptions() {
    const select = $('attendanceActivity');
    const selected = select.value;
    const options = new Map(activityLabels);
    for (const record of attendanceRecords?.ceremony ?? []) {
      options.set(record.activity, activityLabels.get(record.activity) ?? record.activity);
    }
    select.replaceChildren(new Option('All activities', ''));
    for (const [value, label] of options) select.add(new Option(label, value));
    select.value = options.has(selected) ? selected : '';
  }
  function setVisualization(open) {
    $('attendanceVisualization').hidden = !open;
    $('attendanceVisualize').setAttribute('aria-expanded', String(open));
    $('attendanceVisualizeLabel').textContent = open ? 'Hide chart' : 'Visualize';
    if (!open) {
      $('activityChartRows').replaceChildren();
      $('activityChartLegend').replaceChildren();
    }
  }
  function statusTotals(totals, options) {
    let otherCount = totals.total;
    const counts = Array.from(options, ([key, status]) => {
      const count = totals[key] ?? 0;
      otherCount -= count;
      return {...status, count};
    });
    counts.push({...otherStatus, count: otherCount});
    return counts;
  }
  function renderMetrics(total, counts) {
    const metrics = [{label: 'Total records', tone: 'other', count: total}, ...counts];
    const template = $('attendanceMetric');
    $('attendanceMetrics').replaceChildren(...metrics.map(metric => {
      const card = template.content.firstElementChild.cloneNode(true);
      card.dataset.attendanceTone = metric.tone;
      card.querySelector('dt').textContent = metric.label;
      card.querySelector('dd').textContent = metric.count;
      return card;
    }));
  }
  function chartKeyItem(status, label) {
    const item = document.createElement('li');
    item.dataset.attendanceTone = status.tone;
    item.textContent = label;
    return item;
  }
  function renderActivityChart(rows, counts) {
    const list = $('activityChartRows');
    const legend = $('activityChartLegend');
    const hasRows = rows.length > 0;
    $('activityChartEmpty').hidden = hasRows;
    legend.hidden = !hasRows;
    list.hidden = !hasRows;
    if (!rows.length) return;

    legend.replaceChildren(...counts.map(status => chartKeyItem(status, status.label)));
    const groups = new Map();
    for (const record of rows) {
      if (!groups.has(record.activity)) groups.set(record.activity, []);
      groups.get(record.activity).push(record);
    }
    const largestGroup = Array.from(groups.values()).reduce((largest, group) => Math.max(largest, group.length), 1);
    const activitySelect = $('attendanceActivity');
    const options = [...activitySelect.options].filter(option => option.value);
    // Keep the same segments while filters change so their widths can transition.
    if (list.children.length !== options.length || options.some((option, index) => list.children[index].dataset.activity !== option.value)) {
      const template = $('activityChartRow');
      list.replaceChildren(...options.map(option => {
        const item = template.content.firstElementChild.cloneNode(true);
        item.dataset.activity = option.value;
        item.querySelector('.activity-chart-label').textContent = option.textContent;
        const bar = item.querySelector('.activity-chart-bar');
        for (const status of [...statusOptions.ceremony.values(), otherStatus]) {
          const segment = document.createElement('span');
          segment.className = 'activity-chart-segment';
          segment.dataset.attendanceTone = status.tone;
          bar.append(segment);
        }
        return item;
      }));
    }
    for (const item of list.children) {
      const activity = item.dataset.activity;
      item.hidden = Boolean(activitySelect.value && activity !== activitySelect.value);
      if (item.hidden) continue;
      const totals = summary(groups.get(activity) ?? []);
      const parts = statusTotals(totals, statusOptions.ceremony);
      item.querySelector('.activity-chart-count').textContent = `${totals.total} ${totals.total === 1 ? 'record' : 'records'}`;
      const segments = item.querySelector('.activity-chart-bar').children;
      parts.forEach((status, index) => {
        segments[index].style.width = `${status.count / largestGroup * 100}%`;
        segments[index].title = `${status.label} · ${status.count}`;
      });
      item.querySelector('.activity-chart-statuses').replaceChildren(
        ...parts.filter(status => status.count).map(status => chartKeyItem(status, `${status.label} ${status.count}`))
      );
    }
  }
  function stopLiveUpdates() {
    clearTimeout(liveRefresh);liveRefresh=null;liveUser='';
    const channel=liveChannel;liveChannel=null;
    if(channel)Promise.resolve(window.pgenroSupabase?.removeChannel?.(channel)).catch(()=>{});
  }
  function watchAttendance(userId) {
    if(liveUser===userId&&liveChannel)return;
    stopLiveUpdates();
    const db=window.pgenroSupabase;if(!db?.channel)return;
    liveUser=userId;
    try {
      liveChannel=db.channel('my-attendance-'+userId)
        .on('postgres_changes',{event:'*',schema:'public',table:'pgenro_attendance_updates',filter:'user_id=eq.'+userId},payload=>{
          // Only a revision signal is received. Attendance is always fetched
          // again through the authenticated caller-only RPC, never from events.
          if(liveUser!==userId||currentUser!==userId||payload?.new?.user_id!==userId||document.hidden)return;
          clearTimeout(liveRefresh);liveRefresh=setTimeout(load,180);
        }).subscribe();
    } catch {stopLiveUpdates();} // Polling/Refresh remain available offline.
  }
  function clear(resetUser=true) {
    attendanceRecords = null;
    setVisualization(false);
    if (resetUser) {
      currentUser = null;
      manualTabSelection = false;
      $('attendanceActivity').value = '';
      stopLiveUpdates();
      selectKind('ceremony');
    }
    updateActivityOptions();
    $('attendanceIdentity').hidden=true;$('attendanceWorkspace').hidden=true;
    $('attendanceBody').replaceChildren();$('attendanceName').textContent='';$('attendanceNumber').textContent='';
    $('attendanceDepartment').textContent='';$('attendanceRange').textContent='';
    $('attendanceUpdated').textContent='';
    $('attendanceMetrics').replaceChildren();
    for (const id of ['ceremonyTabCount', 'uniformTabCount']) $(id).textContent = '0';
  }
  function notice(message,error=false) {
    $('attendanceMessage').textContent=message;$('attendanceMessage').dataset.kind=error?'error':'info';
    $('attendanceMessage').hidden=!message;
  }
  function render() {
    if (!attendanceRecords) return;
    const all = attendanceRecords[kind];
    const ceremony = kind === 'ceremony';
    const filters = {
      month: $('attendanceMonth').value,
      status: $('attendanceStatus').value,
      activity: ceremony ? $('attendanceActivity').value : '',
      search: $('attendanceSearch').value
    };
    $('attendanceClearFilters').disabled = !Object.values(filters).some(Boolean);
    const filtered = filter(all, filters);
    const totals = summary(filtered);
    const statuses = statusOptions[kind];
    const counts = statusTotals(totals, statuses).filter(status => status.tone !== 'other' || status.count > 0);
    if (ceremony && !$('attendanceVisualization').hidden) renderActivityChart(filtered, counts);
    renderMetrics(totals.total, counts);
    $('attendanceTableTitle').textContent=ceremony?'Activity attendance':'Uniform monitoring';
    const labels=ceremony?['Date','Activity','Status','Control number','Remarks']:['Date','Compliant','Control number','Remarks'];
    $('attendanceColumns').replaceChildren(...labels.map(label=>{const th=document.createElement('th');th.scope='col';th.textContent=label;return th;}));
    const pages=Math.max(1,Math.ceil(filtered.length/size));pageNumber=Math.min(pageNumber,pages);
    const rows=filtered.slice((pageNumber-1)*size,pageNumber*size),body=$('attendanceBody');body.replaceChildren();
    for(const record of rows){
      const tr=document.createElement('tr');tr.className='viewer-record-row';
      const parsedDate=new Date(record.date+'T00:00:00Z');
      const date=/^\d{4}-\d{2}-\d{2}$/.test(record.date)&&!Number.isNaN(parsedDate.getTime())?new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeZone:'UTC'}).format(parsedDate):'—';
      const activityLabel = activityLabels.get(record.activity) ?? record.activity;
      const status = statuses.get(record.status);
      const statusLabel = status?.label || record.status || 'Unrecorded';
      const values=ceremony?[date,activityLabel,statusLabel,record.control||'—',record.remarks||'—']:
        [date,statusLabel,record.control||'—',record.remarks||'—'];
      values.forEach((value,i)=>{const td=document.createElement('td');td.dataset.label=labels[i];
        if(i===(ceremony?2:1)){
          const badge = document.createElement('span');
          badge.className = 'attendance-badge';
          badge.dataset.attendanceTone = status?.tone ?? otherStatus.tone;
          badge.textContent = value;
          td.append(badge);
        }
        else td.textContent=value;
        tr.append(td);
      });body.append(tr);
    }
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = labels.length;
      td.className = 'attendance-empty';
      const recordType = ceremony ? 'activity attendance' : 'uniform monitoring';
      td.textContent = all.length ? 'No records match your filters.' : `No ${recordType} records for this employee account yet.`;
      const otherCount = attendanceRecords[ceremony ? 'uniform' : 'ceremony'].length;
      if (!all.length && otherCount) {
        const otherTab = ceremony ? 'Uniform monitoring' : 'Activity attendance';
        td.textContent += ` Open ${otherTab} to view ${otherCount} ${otherCount === 1 ? 'record' : 'records'}.`;
      }
      tr.append(td);
      body.append(tr);
    }
    $('attendanceRange').textContent=`${filtered.length?((pageNumber-1)*size+1):0}–${Math.min(pageNumber*size,filtered.length)} of ${filtered.length} records`;
    $('attendancePage').textContent=`Page ${pageNumber} of ${pages}`;$('attendancePrevious').disabled=pageNumber<=1;$('attendanceNext').disabled=pageNumber>=pages;
  }
  function selectKind(next) {
    kind=next;pageNumber=1;
    $('attendanceActivityField').hidden = kind !== 'ceremony';
    $('attendanceVisualize').hidden = kind !== 'ceremony';
    if (kind !== 'ceremony') setVisualization(false);
    for(const tab of document.querySelectorAll('[data-attendance-kind]')){const active=tab.dataset.attendanceKind===kind;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));}
    $('attendanceRecords').setAttribute('aria-labelledby',kind==='ceremony'?'ceremonyTab':'uniformTab');
    const select = $('attendanceStatus');
    select.replaceChildren(new Option(kind === 'ceremony' ? 'All statuses' : 'All records', ''));
    for (const [value, status] of statusOptions[kind]) select.add(new Option(status.label, value));
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
      watchAttendance(identity.user.id);
      // No ID or query-string value is supplied. The database uses auth.uid().
      const {data,error}=await db.rpc('pgenro_my_attendance');if(token!==generation)return;
      if(error)throw error;
      if(!data||typeof data.linked!=='boolean')throw new Error('Attendance is not configured. Please contact the administrator.');
      if(!data.linked){clear(false);notice('Your account is not linked to an employee record yet. Ask the administrator to link your employee number.');return;}
      attendanceRecords = {
        ceremony: records(data.ceremony_records, 'ceremony'),
        uniform: records(data.uniform_records, 'uniform')
      };
      updateActivityOptions();
      $('ceremonyTabCount').textContent = attendanceRecords.ceremony.length;
      $('uniformTabCount').textContent = attendanceRecords.uniform.length;
      $('attendanceName').textContent=text(data.employee?.full_name)||'Employee';
      $('attendanceNumber').textContent=text(data.employee?.employee_number);$('attendanceDepartment').textContent=[data.employee?.designation,data.employee?.department].filter(Boolean).join(' · ');
      for(const el of document.querySelectorAll('.profile-text strong,.profile-dropdown-header h3'))el.textContent=text(data.employee?.full_name)||'Employee';
      $('attendanceIdentity').hidden=false;$('attendanceWorkspace').hidden=false;
      notice(data.reason==='ambiguous_employee_number'?'Your employee number needs an administrator review before attendance can be shown.':
        data.matched===false?'No attendance or uniform records have been encoded for your employee number yet.':'');
      const otherKind = kind === 'ceremony' ? 'uniform' : 'ceremony';
      if (!manualTabSelection && !attendanceRecords[kind].length && attendanceRecords[otherKind].length) {
        selectKind(otherKind);
      } else {
        render();
      }
      $('attendanceUpdated').textContent='Updated '+new Intl.DateTimeFormat('en-PH',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Manila'}).format(new Date());
    } catch(error) {
      if(token!==generation)return;
      clear(false);notice(error?.code==='PGRST202'?'Attendance is not configured. Please contact the administrator.':error?.message||'Your attendance could not be loaded. Try Refresh.',true);
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
    $('attendanceVisualize').addEventListener('click', () => {
      const chart = $('attendanceVisualization');
      const open = chart.hidden;
      setVisualization(open);
      if (!open) return;
      render();
      if (chart.getBoundingClientRect().top + 160 > window.innerHeight) {
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches ||
          document.body.classList.contains('pgenro-reduced-motion');
        chart.scrollIntoView({block: 'start', behavior: reduced ? 'instant' : 'smooth'});
      }
    });
    for (const id of filterFields) $(id).addEventListener(id === 'attendanceSearch' ? 'input' : 'change', () => {
      pageNumber = 1;
      render();
    });
    $('attendanceClearFilters').addEventListener('click', () => {
      for (const id of filterFields) $(id).value = '';
      pageNumber = 1;
      $('attendanceSearch').focus({preventScroll: true});
      render();
    });
    for (const tab of document.querySelectorAll('[data-attendance-kind]')) {
      tab.addEventListener('click', () => {
        manualTabSelection = true;
        selectKind(tab.dataset.attendanceKind);
      });
    }
    $('attendancePrevious').addEventListener('click',()=>{pageNumber--;render();});$('attendanceNext').addEventListener('click',()=>{pageNumber++;render();});
    const db=window.pgenroSupabase;
    if(db?.auth.onAuthStateChange)subscription=db.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT'||(currentUser&&session?.user?.id!==currentUser)){generation++;clear();notice('Your session changed. Loading the current account…');}
      if(event==='SIGNED_OUT'){window.location.replace('login.html');return;}
      if(event==='SIGNED_IN')queueMicrotask(load);
    }).data?.subscription;
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
    window.addEventListener('focus',()=>{if(!document.hidden)load();});
    pollTimer=setInterval(()=>{if(!document.hidden&&currentUser)load();},45000);
    window.addEventListener('pagehide',()=>{generation++;clearInterval(pollTimer);subscription?.unsubscribe();clear();});
    load();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

// Actual application pages and Chart.js, with local Supabase simulations.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),checks=[];
let browser,server,base;
const sdk=fs.readFileSync(path.join(root,'verification/ui/mock-sdk.js'),'utf8')+`
(() => {
 const db=window.supabase.createClient(),profile=window.__db.profiles[0];
 profile.role=window.__testRole;profile.status='Active';profile.is_active=true;
 window.__approvalCalls=[];window.__signupCalls=[];window.__notificationListeners=[];
 window.__db.access_requests=[
  {id:'request-admin',data:{uid:'11111111-1111-4111-8111-111111111110',fullName:'Admin Applicant',email:'admin-applicant@example.test',requestedRole:'Admin',role:'Admin',assignedRole:null,status:'Pending',division:'Admin Office',position:'Staff',createdAt:'2026-10-10T08:00:00Z'}},
  {id:'request-user',data:{uid:'11111111-1111-4111-8111-111111111119',fullName:'User Applicant',email:'user-applicant@example.test',requestedRole:'User',role:'User',assignedRole:null,status:'Pending',division:'Admin Office',position:'Staff',createdAt:'2026-10-10T07:00:00Z'}}
 ];
 window.__db.communications.push({id:'older-document',created_at:'2026-07-01T10:00:00Z',data:{date:'2026-07-01',subject:'Older communication',type:'Incoming'}});
 const initial=[
  {id:'n1',module:'communications',title:'New received letter',createdAt:'2026-10-10T09:00:00Z'},
  {id:'n2',module:'communications',title:'Another new letter',createdAt:'2026-10-10T10:00:00Z'},
  {id:'n3',module:'inventory',title:'New supply item',createdAt:'2026-10-10T11:00:00Z'},
  {id:'n4',module:'account_requests',title:'New account application',createdAt:'2026-10-10T12:00:00Z'}
 ];
 window.__notificationEvents=JSON.parse(localStorage.getItem('test_notification_events')||'null')||initial;
 window.__readNotifications=new Set(JSON.parse(localStorage.getItem('test_notification_reads')||'[]'));
 const visible=()=>window.__notificationEvents.filter(n=>profile.role==='Admin'||!['account_requests','user_accounts'].includes(n.module));
 const originalRpc=db.rpc.bind(db);
 db.rpc=async(name,args={})=>{
  if(name==='pgenro_get_module_notifications'){
   if(window.__testNotificationFailure)return {data:null,error:{code:'PGRST202',message:'Unavailable notifications'}};
   const items=visible().filter(n=>!window.__readNotifications.has(n.id)),counts={};for(const n of items)counts[n.module]=(counts[n.module]||0)+1;
   return {data:{total:items.length,workspace:profile.role==='Admin'?'admin':'user',counts,items:items.slice().reverse().slice(0,args.p_limit||30)},error:null};
  }
  if(name==='pgenro_mark_notifications_read'){
   let added=0;for(const n of visible())if((!args.p_ids||args.p_ids.includes(n.id))&&(!args.p_module||args.p_module===n.module)){
    if(!window.__readNotifications.has(n.id))added++;window.__readNotifications.add(n.id);
   }
   localStorage.setItem('test_notification_reads',JSON.stringify([...window.__readNotifications]));return {data:added,error:null};
  }
  return originalRpc(name,args);
 };
 db.auth.signUp=async({email,options})=>{window.__signupCalls.push({email,metadata:options.data});return {data:{user:{id:'signup-applicant',identities:[{id:'signup-identity'}]},session:null},error:null};};
 db.functions.invoke=async(name,{body})=>{
  const row=window.__db.access_requests.find(r=>r.id===body.requestId);window.__approvalCalls.push(body);
  if(!row)return {data:{success:false,error:'Missing request'},error:null};
  row.data={...row.data,role:body.role,assignedRole:body.role,status:'Approved'};return {data:{success:true,ok:true,request:row.data},error:null};
 };
 const originalChannel=db.channel.bind(db);db.channel=name=>{
  const channel=originalChannel(name),on=channel.on.bind(channel);channel.on=(event,filter,callback)=>{
   window.__notificationListeners.push({event,filter,callback});return on(event,filter,callback);
  };return channel;
 };
})();`;
function pass(label){checks.push({scenario:label,result:'PASS'});console.log('PASS',label);}
async function open(file,options={}){
 const context=await browser.newContext({viewport:options.mobile?{width:390,height:844}:{width:1440,height:1040},reducedMotion:'reduce'});
 await context.addInitScript(options=>{
   window.__testRole=options.role;window.__testNotificationFailure=!!options.notificationFailure;
   const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-10-10T14:00:00Z']));}static now(){return new NativeDate('2026-10-10T14:00:00Z').getTime();}};
 },{...options,role:options.role||(file.startsWith('admin/')?'Admin':'User')});
 await context.route('**/*',route=>{
  const url=route.request().url();
  if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:sdk});
  if(url.includes('chart.js'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'verification/ui/chart.umd.min.js'))});
  if(url.startsWith(base))return route.continue();
  return route.fulfill({contentType:url.includes('fonts.')?'text/css':'text/javascript',body:''});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/'+file);return {page,context,errors};
}
async function ready(test){await test.page.waitForFunction(()=>document.body.dataset.notificationsState==='ready');assert.deepEqual(test.errors,[]);}
async function register(role){
 const t=await open('User/requestacc.html');
 await t.page.locator('#fullName').fill(role+' Applicant');await t.page.locator('#email').fill(role.toLowerCase()+'-registration@example.test');
 await t.page.locator('#contact').fill('09123456789');await t.page.locator('#password').fill('TestPassword123!');await t.page.locator('#confirmPassword').fill('TestPassword123!');await t.page.locator('#nextBtn').click();
 await t.page.locator('#position').selectOption('Administrative Officer');await t.page.locator('#division').selectOption('Admin Office');
 await t.page.locator('.role-choice[data-role="'+role+'"]').click();await t.page.locator('#endorser').fill('Division Head');await t.page.locator('#nextBtn').click();
 assert.equal(await t.page.locator('#summaryRoleBadge').innerText(),'Requested: '+role);
 await t.page.locator('#reason').fill('Requesting access for my assigned office duties.');await t.page.locator('label[for="endorsementCheck"]').click();await t.page.locator('label[for="agree"]').click();await t.page.locator('#submitBtn').click();
 await t.page.locator('#requestSuccess').waitFor({state:'visible'});
 const metadata=await t.page.evaluate(()=>window.__signupCalls[0].metadata);assert.equal(metadata.requested_role,role);assert.equal(metadata.requested_system,role);assert.equal(metadata.status,undefined);
 assert.deepEqual(t.errors,[]);await t.context.close();pass(role+' registration submits the selected request role and displays the same role in the review summary');
}
(async()=>{
 server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE||'/tmp/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 await register('Admin');await register('User');
 let t=await open('admin/requestacc.html');await ready(t);await t.page.locator('.review-btn[data-key="request-admin"]').click();
 assert.equal(await t.page.locator('#reviewRole').innerText(),'Admin');assert.equal(await t.page.locator('#assignRoleSelect').inputValue(),'Admin');
 assert.deepEqual(await t.page.locator('#assignRoleSelect option').evaluateAll(options=>options.map(o=>o.value)),['User','Admin']);
 await t.page.locator('#assignRoleSelect').selectOption('User');await t.page.locator('#approveModalActionBtn').click();await t.page.waitForFunction(()=>!document.getElementById('reviewModal').classList.contains('open'));
 assert.equal(await t.page.evaluate(()=>window.__approvalCalls[0].role),'User');assert.match(await t.page.locator('#requestTableBody').innerText(),/Admin.*User/s);
 await t.page.locator('.approve-quick-btn[data-key="request-user"]').click();assert.equal(await t.page.locator('#reviewRole').innerText(),'User');
 await t.page.locator('#assignRoleSelect').selectOption('Admin');await t.page.locator('#approveModalActionBtn').click();await t.page.waitForFunction(()=>window.__approvalCalls.length===2);
 assert.equal(await t.page.evaluate(()=>window.__approvalCalls[1].role),'Admin');assert.deepEqual(t.errors,[]);await t.context.close();pass('Review and quick approval let Admin assign either final role while retaining the original requested role');
 t=await open('admin/requestacc.html');await ready(t);await t.page.locator('#selectAllCheckbox').check();await t.page.locator('#bulkApproveBtn').click();
 assert.equal(await t.page.locator('#bulkAssignRoleSelect').inputValue(),'');await t.page.locator('#confirmBulkApproveBtn').click();assert.equal(await t.page.evaluate(()=>window.__approvalCalls.length),0);
 await t.page.locator('#bulkAssignRoleSelect').selectOption('User');await t.page.locator('#confirmBulkApproveBtn').click();await t.page.waitForFunction(()=>window.__approvalCalls.length===2);
 assert.deepEqual(await t.page.evaluate(()=>window.__approvalCalls.map(c=>c.role)),['User','User']);assert.deepEqual(t.errors,[]);await t.context.close();pass('Bulk approval requires a final role and applies it to every selected account');
 t=await open('admin/admin.html');await ready(t);assert.equal(await t.page.locator('.module-notification-badge').innerText(),'4');
 assert.equal(await t.page.locator('aside a[href="admincommunication.html"] .module-new-badge').innerText(),'2');
 await t.page.locator('#moduleNotificationButton').click();assert.equal(await t.page.locator('.module-notification-item').count(),4);
 await t.page.evaluate(()=>{
   window.__notificationEvents.push({id:'n5',module:'office_memos',title:'A newly added memo',createdAt:'2026-10-10T13:00:00Z'});
   localStorage.setItem('test_notification_events',JSON.stringify(window.__notificationEvents));
   window.__notificationListeners.find(listener=>listener.filter.table==='pgenro_module_notifications').callback({eventType:'INSERT'});
 });await t.page.waitForFunction(()=>document.querySelector('.module-notification-badge').textContent==='5');
 assert.equal(await t.page.locator('aside a[href="officememo-admin.html"] .module-new-badge').innerText(),'1');
 await t.page.getByRole('button',{name:'Mark all read',exact:true}).click();await t.page.waitForFunction(()=>document.querySelector('.module-notification-badge').hidden);
 assert.equal(await t.page.locator('.module-notification-empty').innerText(),'No new notifications');await t.page.goto(base+'/admin/invetoryadmin.html');await ready(t);
 assert.equal(await t.page.locator('.module-notification-badge').isHidden(),true);assert.deepEqual(t.errors,[]);await t.context.close();pass('Realtime inserts update the bell and correct module badge; marking read survives page navigation');
 t=await open('User/homepage.html');await ready(t);assert.equal(await t.page.locator('.module-notification-badge').innerText(),'3');await t.page.locator('#moduleNotificationButton').click();
 assert.equal(await t.page.locator('.module-notification-item').count(),3);assert.doesNotMatch(await t.page.locator('#moduleNotificationPanel').innerText(),/Account Requests/);
 await t.page.keyboard.press('Escape');assert.equal(await t.page.locator('#moduleNotificationPanel').isHidden(),true);assert.equal(await t.page.locator('#moduleNotificationButton').evaluate(el=>el===document.activeElement),true);
 await t.context.close();pass('User notifications show permitted operational modules and keyboard dismissal restores bell focus');
 t=await open('admin/admin.html',{notificationFailure:true});await t.page.waitForFunction(()=>document.body.dataset.notificationsState==='unavailable');await t.page.locator('#moduleNotificationButton').click();
 assert.match(await t.page.locator('#moduleNotificationPanel').innerText(),/unavailable/);assert.equal(await t.page.locator('.module-notification-badge').isHidden(),true);assert.deepEqual(t.errors,[]);await t.context.close();pass('Notification service failure shows a usable error state without inventing unread records');
 t=await open('admin/admin.html');await ready(t);await t.page.waitForFunction(()=>window.Chart?.getChart('monthlyChart')?.data.datasets[0].data.length>0);
 const adminCharts=await t.page.evaluate(()=>['monthlyChart','categoryChart','statusChart','personnelChart','commChart'].map(id=>{const chart=Chart.getChart(id);return {id,type:chart.config.type,data:chart.data.datasets[0].data,animation:chart.options.animation,centerPlugin:!!Chart.registry.plugins.get('pgenroDoughnutTotal')};}));
 assert.equal(adminCharts.length,5);assert.ok(adminCharts.every(chart=>chart.centerPlugin&&chart.animation===false));assert.ok(adminCharts.every(chart=>chart.data.every(Number.isFinite)));
 await t.page.screenshot({path:path.join(__dirname,'modern-admin-dashboard.png'),fullPage:true});assert.deepEqual(t.errors,[]);await t.context.close();pass('All five Admin charts render real fixture counts with the modern theme, totals and reduced-motion behavior');
 t=await open('User/homepage.html');await ready(t);await t.page.waitForFunction(()=>window.Chart?.getChart('commCompareChart')?.data.datasets[0].data.length>0);
 const total=()=>t.page.evaluate(()=>Chart.getChart('operationsDistChart').data.datasets[0].data.reduce((a,b)=>a+b,0));
 const initial=await total();await t.page.locator('#dashboardChartRange').selectOption('180');await t.page.waitForFunction(initial=>Chart.getChart('operationsDistChart').data.datasets[0].data.reduce((a,b)=>a+b,0)===initial+1,initial);
 assert.equal(await total(),initial+1);assert.match(await t.page.locator('#dashboardTrendSummary').innerText(),/180 days/);
 await t.page.screenshot({path:path.join(__dirname,'modern-user-dashboard.png'),fullPage:true});assert.deepEqual(t.errors,[]);await t.context.close();pass('User chart period selection recalculates actual dated records and updates the summary');
 const pages=JSON.parse(fs.readFileSync(path.join(root,'verification/notifications/installed-pages.json'),'utf8'));
 for(const file of pages){t=await open(file,{mobile:true});await ready(t);assert.equal(await t.page.locator('#moduleNotificationButton').count(),1,file);assert.equal(await t.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,file);await t.page.locator('#moduleNotificationButton').click();const bounds=await t.page.locator('#moduleNotificationPanel').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390,file);assert.deepEqual(t.errors,[],file);await t.context.close();}
 pass('Notifications mount once on all 21 authenticated pages and the mobile pages/popovers stay within the viewport');
 fs.writeFileSync(path.join(__dirname,'roles-notifications-dashboard-results.json'),JSON.stringify({result:'PASS',scenario_groups:checks.length,mobile_pages:pages.length,checks,hosted_changes:false},null,2));
 console.log(JSON.stringify({result:'PASS',scenario_groups:checks.length,mobile_pages:pages.length,hosted_changes:false}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());});

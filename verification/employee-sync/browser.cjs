/* Actual application pages with isolated Auth/database fixtures; no live calls. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':require.resolve('playwright',{paths:[__dirname,path.resolve(__dirname,'../frontend')]}));
const root=path.resolve(__dirname,'../..'),checks=[],errors=[],missing=[];
const sdk=fs.readFileSync(path.join(root,'verification/ui/mock-sdk.js'),'utf8');
const addon=`
window.__rpcCalls=[];window.__tableCalls=[];window.__registerCalls=[];window.__callbacks=[];
const db=window.supabase.createClient(),rpc=db.rpc,from=db.from,listener=db.auth.onAuthStateChange;
const channel=db.channel,removeChannel=db.removeChannel;
db.channel=name=>{const c=channel(name),on=c.on;c.on=(event,filter,callback)=>{c.filter=filter;return on.call(c,event,filter,callback);};return c;};
db.removeChannel=c=>{c.removed=true;return removeChannel.call(db,c);};
window.__db.employees[0].employee_id='0007';
window.__db.employees[0].ceremony_records=[{date:'2026-11-02',status:'PRESENT',remarks:'ONLY_0007'}];
window.__db.employees[0].uniform_records=[{date:'2026-11-02',compliant:true,remarks:'OWN_UNIFORM'}];
if (new URLSearchParams(location.search).has('uniform-only')) {
  window.__db.employees[0].ceremony_records = [];
  window.__db.employees[0].uniform_records = [
    {control_number:'UM-2026-0001',date:'2026-11-06',compliant:'Yes'},
    {control_number:'UM-2026-0002',date:'2026-11-07',compliant:'Yes'}
  ];
}
window.__db.employees.push({id:'other-employee',employee_id:'0008',first_name:'OTHER',last_name:'PERSON',ceremony_records:[{remarks:'PRIVATE_OTHER_PERSON'}]});
window.__db.inventory.push({id:'inv-2',control_no:'INV-2026-00002',item_name:'PAPER CLIP',unit:'BOX',quantity:3,threshold:1,category:'Office Supplies'});
db.from=table=>{window.__tableCalls.push(table);return from(table);};
db.functions.invoke=async(name,{body})=>{window.__registerCalls.push({name,body});if(window.__registerFail)return{data:null,error:{context:new Response(JSON.stringify({error:window.__registerFail}))}};return{data:{success:true,employee_number:body.employee_number},error:null};};
db.rpc=async(name,args)=>{
 window.__rpcCalls.push({name,args});
 if(name==='pgenro_employee_directory'&&!location.pathname.includes('/admin/'))return{data:null,error:{code:'42501',message:'Personnel records are Admin-only'}};
 if(name==='record_inventory_movement'){
  if(window.__movementDelay)await new Promise(r=>setTimeout(r,window.__movementDelay));
  if(window.__movementFail)return{data:null,error:{message:'Fixture connection failure'}};
  const item=window.__db.inventory.find(i=>i.id===args.p_item_id),qty=args.p_quantity;
  const next=args.p_movement_type==='IN'?item.quantity+qty:args.p_movement_type==='OUT'?item.quantity-qty:qty;
  if(next<0)return{data:null,error:{message:'Insufficient stock'}};
  item.quantity=next;item.updated_at=new Date().toISOString();
  window.__db.inventory_movements.unshift({id:crypto.randomUUID(),item_id:item.id,movement_type:args.p_movement_type,quantity:qty,balance_after:next,reference_no:args.p_reference_no,remarks:args.p_remarks,created_at:new Date().toISOString()});
  return{data:{success:true},error:null};
 }
 if(name==='pgenro_my_attendance'&&window.__attendanceFail)return{data:null,error:{code:'42501',message:'Account is not approved'}};
 const result=await rpc(name,args);const delay=window.__attendanceDelay||0;window.__attendanceDelay=0;
 if(name==='pgenro_my_attendance'&&delay)await new Promise(r=>setTimeout(r,delay));
 return result;
};
const getUser=db.auth.getUser;
db.auth.getUser=async()=>{const r=await getUser();if(window.__actorId&&r.data.user)r.data.user={...r.data.user,id:window.__actorId};return r;};
db.auth.onAuthStateChange=callback=>{window.__callbacks.push(callback);return listener(callback);};
window.__emitAuth=(event,session)=>window.__callbacks.forEach(fn=>fn(event,session));
`;
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
let browser,base;
const pass=check=>{checks.push({check,result:'PASS'});console.log('PASS',check);};
async function open(file,width=1440){
 const context=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'});
 await context.addInitScript(sdk);await context.addInitScript(addon);
 await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.fulfill({contentType:route.request().url().includes('fonts.')?'text/css':'text/javascript',body:''}));
 const page=await context.newPage();page.setDefaultTimeout(8000);
 page.on('pageerror',e=>errors.push(file+': '+e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()===404)missing.push(new URL(r.url()).pathname);});
 await page.goto(base+'/'+file,{waitUntil:'networkidle'});return{context,page};
}
async function screenshot(page,name){if(!process.env.PGENRO_SCREENSHOT_DIR)return;fs.mkdirSync(process.env.PGENRO_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.PGENRO_SCREENSHOT_DIR,name+'.png'),fullPage:true});}
async function details(page){
 await page.locator('#employeeNumber').fill('0007');await page.locator('#firstName').fill('Maria');await page.locator('#middleName').fill('Lopez');await page.locator('#lastName').fill('Santos');
 await page.locator('#division').selectOption('Admin Office');await page.locator('#position').fill('Officer');await page.locator('#password').fill('FixtureOnly123!');await page.locator('#confirmPassword').fill('FixtureOnly123!');await page.locator('#agree').check();
}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 const launch={headless:true,executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']};
 if(process.env.PGENRO_CHROMIUM_MODULE){const module=require(process.env.PGENRO_CHROMIUM_MODULE),shell=module.default||module;launch.executablePath=await shell.executablePath();launch.args.push('--no-zygote','--disable-gpu');}
 browser=await chromium.launch(launch);
 for(const file of ['homepage.html','communication.html','travelOR.html','officememo.html','inventory.html','service.html','ics.html','my-attendance.html']){
  const {page,context}=await open('User/'+file);await page.waitForSelector('.modules-list');
  assert.equal(await page.locator('a[href="employee.html"],a[href$="/employee.html"]').count(),0,file);
  assert.equal(await page.locator('.modules-list a[href="my-attendance.html"]').count(),1,file);
  assert(!(await page.evaluate(()=>window.__tableCalls)).includes('employees'),file);
  assert(!(await page.evaluate(()=>window.__rpcCalls)).some(c=>c.name==='pgenro_employee_directory'),file);
  if(file==='homepage.html'){
   assert.equal(await page.locator('#kpiTotalEmployees').count(),0);
   await page.evaluate(()=>{const li=document.createElement('li');li.innerHTML='<a href="employee.html">Employee Profiles</a>';document.querySelector('.modules-list').append(li);});
   await page.waitForFunction(()=>!document.querySelector('a[href="employee.html"]'));
   await screenshot(page,'user-dashboard-attendance-only');
  }
  pass(file+' shows My Attendance without personnel profiles or directory requests');await context.close();
 }
 {
  const {page,context}=await open('User/employee.html?employeeNumber=0008');await page.waitForURL('**/my-attendance.html');await page.waitForSelector('#attendanceWorkspace:not([hidden])');
  assert.equal(await page.locator('#attendanceNumber').innerText(),'0007');assert.equal(await page.locator('#employeeTable').count(),0);
  assert(!(await page.evaluate(()=>window.__tableCalls)).includes('employees'));
  pass('An old Employee Profiles bookmark redirects to the signed-in user attendance');await context.close();
 }
 {
  const {page,context}=await open('User/requestacc.html');
  assert.equal(await page.locator('#verifyEmployeeBtn,#role').count(),0);await details(page);
  await page.locator('#confirmPassword').fill('Different123!');await page.locator('#submitBtn').click();assert.equal(await page.evaluate(()=>window.__registerCalls.length),0);
  await page.locator('#confirmPassword').fill('FixtureOnly123!');await page.evaluate(()=>window.__registerFail='This employee number already has an account or request.');
  await page.locator('#submitBtn').click();await page.waitForSelector('#requestError:not([hidden])');assert.equal(await page.locator('#firstName').inputValue(),'Maria');assert(await page.locator('#submitBtn').isEnabled());
  await page.evaluate(()=>window.__registerFail=null);await page.locator('#submitBtn').click();await page.waitForSelector('#requestSuccess:not([hidden])');
  const call=await page.evaluate(()=>window.__registerCalls.at(-1));assert.equal(call.name,'employee-register');assert.equal(call.body.first_name,'Maria');assert.equal(call.body.last_name,'Santos');assert.equal(call.body.full_name,'Maria Lopez Santos');assert.equal(call.body.employee_number,'0007');assert(!('role'in call.body));
  assert((await page.locator('#requestSuccess').innerText()).includes('employee record are linked'));
  pass('Registration submits names and employee number without directory verification, reports duplicate errors and confirms the employee link');await context.close();
 }
 {
  const {page,context}=await open('User/my-attendance.html?employeeNumber=0008');await page.waitForSelector('#attendanceWorkspace:not([hidden])');
  assert.equal(await page.locator('#attendanceNumber').innerText(),'0007');assert((await page.locator('#attendanceBody').innerText()).includes('ONLY_0007'));assert(!(await page.locator('body').innerText()).includes('PRIVATE_OTHER_PERSON'));
  assert((await page.evaluate(()=>window.__rpcCalls.filter(c=>c.name==='pgenro_my_attendance'))).every(c=>c.args===undefined));assert(!(await page.evaluate(()=>window.__tableCalls)).includes('employees'));
  await page.locator('#uniformTab').click();assert((await page.locator('#attendanceBody').innerText()).includes('OWN_UNIFORM'));
  await page.evaluate(()=>window.__attendanceFail=true);await page.locator('#attendanceRefresh').click();await page.waitForFunction(()=>document.getElementById('attendanceWorkspace').hidden);assert.equal(await page.locator('#attendanceBody tr').count(),0);
  pass('Personal attendance ignores another number in the URL, uses caller-only RPC and clears private data when access is refused');
  await page.evaluate(()=>window.__attendanceFail=false);await page.locator('#attendanceRefresh').click();await page.waitForSelector('#attendanceWorkspace:not([hidden])');
  await page.evaluate(()=>{window.__attendanceDelay=300;document.getElementById('attendanceRefresh').click();});await page.waitForTimeout(40);
  await page.evaluate(()=>{window.__actorId='second-user';window.__attendanceRPCResult={linked:true,employee:{employee_number:'0008',full_name:'Second Person'},ceremony_records:[{date:'2026-11-03',status:'ABSENT',remarks:'ONLY_0008'}],uniform_records:[]};window.__emitAuth('SIGNED_IN',{user:{id:'second-user'}});});
  await page.waitForFunction(()=>document.getElementById('attendanceNumber').textContent==='0008');await page.waitForTimeout(350);assert(!(await page.locator('#attendanceBody').innerText()).includes('ONLY_0007'));
  pass('A delayed response from the previous account cannot overwrite the new account attendance');await context.close();
 }
 {
  const {page,context} = await open('User/my-attendance.html?uniform-only');
  await page.waitForSelector('#uniformTab[aria-selected="true"]');
  assert.equal(await page.locator('#ceremonyTabCount').innerText(),'0');
  assert.equal(await page.locator('#uniformTabCount').innerText(),'2');
  assert.equal(await page.locator('#attendanceTotal').innerText(),'2');
  assert.equal(await page.locator('#attendancePositive').innerText(),'2');
  assert.equal(await page.locator('#attendanceBody .viewer-record-row').count(),2);
  assert((await page.locator('#attendanceBody').innerText()).includes('UM-2026-0002'));
  pass('My Attendance opens the populated Uniform tab when Flag Ceremony is empty');
  await page.evaluate(() => window.PGENRO_UserTheme.set('dark'));
  await screenshot(page,'my-attendance-uniform-first');
  await page.locator('#ceremonyTab').click();
  assert.match(await page.locator('.attendance-empty').innerText(),/Uniform monitoring to view 2 records/);
  await page.evaluate(() => {
   window.__db.employees[0].uniform_records.push({control_number:'UM-2026-0003',date:'2026-11-08',compliant:'Yes'});
   window.__channels.find(c=>c.table==='pgenro_attendance_updates'&&!c.removed).callback({new:{user_id:'qa-user',revision:4}});
  });
  await page.waitForFunction(() => document.getElementById('uniformTabCount').textContent === '3');
  assert.equal(await page.locator('#ceremonyTab').getAttribute('aria-selected'),'true');
  assert.match(await page.locator('.attendance-empty').innerText(),/Uniform monitoring to view 3 records/);
  await page.locator('#uniformTab').click();
  assert.equal(await page.locator('#attendanceBody .viewer-record-row').count(),3);
  pass('Live updates refresh the tab counts while preserving the user-selected tab');
  await context.close();
 }
 {
  const {page,context}=await open('User/my-attendance.html');await page.waitForSelector('#attendanceWorkspace:not([hidden])');
  const live=await page.evaluate(()=>window.__channels.find(c=>c.table==='pgenro_attendance_updates'&&!c.removed)?.filter);
  assert.equal(live.filter,'user_id=eq.qa-user');
  await page.evaluate(()=>{
   window.__db.employees[0].ceremony_records=[{date:'2026-11-03',status:'LATE',remarks:'ADMIN_UPDATED_0007'}];
   window.__db.employees[0].uniform_records=[{date:'2026-11-03',compliant:false,remarks:'ADMIN_UPDATED_UNIFORM'}];
   window.__channels.find(c=>c.table==='pgenro_attendance_updates'&&!c.removed).callback({new:{user_id:'qa-user',revision:2}});
  });
  await page.waitForFunction(()=>document.getElementById('attendanceBody').textContent.includes('ADMIN_UPDATED_0007'));
  await page.locator('#uniformTab').click();assert((await page.locator('#attendanceBody').innerText()).includes('ADMIN_UPDATED_UNIFORM'));
  const before=await page.evaluate(()=>window.__rpcCalls.filter(c=>c.name==='pgenro_my_attendance').length);
  await page.evaluate(()=>window.__channels.find(c=>c.table==='pgenro_attendance_updates'&&!c.removed).callback({new:{user_id:'other-user',revision:9}}));await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>window.__rpcCalls.filter(c=>c.name==='pgenro_my_attendance').length),before);
  pass('An Admin change refreshes the matching user attendance/uniform history automatically; other account signals are ignored');
  await page.evaluate(()=>window.__attendanceRPCResult={linked:false,employee:null,ceremony_records:[],uniform_records:[]});
  await page.locator('#attendanceRefresh').click();await page.waitForFunction(()=>document.getElementById('attendanceWorkspace').hidden);
  await page.evaluate(()=>{
   window.__attendanceRPCResult={linked:true,employee:{employee_number:'0044',full_name:'Linked User'},ceremony_records:[{date:'2026-11-04',status:'PRESENT',remarks:'NEWLY_LINKED_0044'}],uniform_records:[]};
   window.__channels.find(c=>c.table==='pgenro_attendance_updates'&&!c.removed).callback({new:{user_id:'qa-user',revision:3}});
  });
  await page.waitForSelector('#attendanceWorkspace:not([hidden])');assert.equal(await page.locator('#attendanceNumber').innerText(),'0044');
  await page.locator('#ceremonyTab').click();assert((await page.locator('#attendanceBody').innerText()).includes('NEWLY_LINKED_0044'));
  assert(!(await page.evaluate(()=>window.__tableCalls)).includes('employees'));
  pass('An already-open unlinked User page displays attendance automatically when Admin links the employee number');
  await screenshot(page,'my-attendance-live');await context.close();
 }
 {
  const {page,context}=await open('admin/invetoryadmin.html');await page.waitForSelector('#inventoryBody [data-edit="inv-1"]');
  assert.equal(await page.locator('#movementBtn,#inventoryBody [data-move]').count(),0);
  await page.locator('[data-edit="inv-1"]').click();assert(await page.locator('#inventoryEditorTabs').isVisible());assert(await page.locator('#itemQuantity').evaluate(e=>e.readOnly));
  await page.locator('#itemName').fill('UPDATED PAPER');await page.evaluate(()=>window.__db.inventory[0].quantity=35);await page.locator('#saveItemBtn').click();await page.waitForFunction(()=>!document.getElementById('itemModal').classList.contains('open'));
  assert.equal(await page.evaluate(()=>window.__db.inventory[0].quantity),35);assert.equal(await page.evaluate(()=>window.__db.inventory[0].item_name),'UPDATED PAPER');
  pass('The pencil opens item details and stock movement; editing details preserves a newer stock balance');
  await page.locator('[data-edit="inv-1"]').click();await page.locator('#itemMovementTab').click();assert(await page.locator('#itemForm').isHidden());assert(await page.locator('#movementForm').isVisible());assert(await page.locator('#movementItem').isDisabled());assert.equal(await page.locator('#movementItem').inputValue(),'inv-1');
  await page.locator('#movementType').selectOption('IN');await page.locator('#movementQty').fill('5');await page.locator('#movementReference').fill('PO-TEST');
  await page.locator('#movementForm button[type=submit]').click();await page.waitForFunction(()=>!document.getElementById('itemModal').classList.contains('open'));
  assert.equal(await page.evaluate(()=>window.__db.inventory[0].quantity),40);assert.equal(await page.evaluate(()=>window.__db.inventory_movements.length),1);assert((await page.locator('#movementBody').innerText()).includes('PO-TEST'));
  pass('Stock In through the pencil calls the existing movement transaction and refreshes the audit history');
  await page.locator('[data-edit="inv-2"]').click();await page.locator('#itemMovementTab').click();assert.equal(await page.locator('#movementItem').inputValue(),'inv-2');
  await page.locator('#movementType').selectOption('OUT');await page.locator('#movementQty').fill('4');await page.locator('#movementReference').fill('RIS-TEST');
  const before=await page.evaluate(()=>window.__rpcCalls.filter(c=>c.name==='record_inventory_movement').length);
  await page.locator('#movementForm button[type=submit]').click();assert.equal(await page.evaluate(()=>window.__rpcCalls.filter(c=>c.name==='record_inventory_movement').length),before);
  await page.locator('#movementQty').fill('2');await page.locator('#movementForm button[type=submit]').click();await page.waitForFunction(()=>!document.getElementById('itemModal').classList.contains('open'));
  assert.deepEqual(await page.evaluate(()=>window.__db.inventory.map(i=>i.quantity)),[40,1]);
  pass('Stock Out targets the selected item and rejects quantities above its available stock');
  await page.locator('[data-edit="inv-2"]').click();await page.locator('#itemMovementTab').click();await page.locator('#movementType').selectOption('ADJUSTMENT');await page.locator('#movementQty').fill('0');await page.locator('#movementReference').fill('AUDIT-TEST');
  await page.evaluate(()=>window.__movementFail=true);await page.locator('#movementForm button[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#movementForm button[type=submit]').disabled);assert(await page.locator('#movementForm').isVisible());assert.equal(await page.evaluate(()=>window.__db.inventory[1].quantity),1);
  await page.evaluate(()=>{window.__movementFail=false;window.__movementDelay=150;document.getElementById('movementForm').requestSubmit();document.getElementById('movementForm').requestSubmit();});
  await page.waitForFunction(()=>!document.getElementById('itemModal').classList.contains('open'));assert.equal(await page.evaluate(()=>window.__db.inventory[1].quantity),0);assert.equal(await page.evaluate(()=>window.__db.inventory_movements.length),3);
  pass('Zero-stock adjustments, retry after failure and duplicate-submit protection still work inside the pencil editor');
  await page.locator('#addItemBtn').click();assert(await page.locator('#inventoryEditorTabs').isHidden());assert(await page.locator('#movementForm').isHidden());assert.equal(await page.locator('#itemQuantity').evaluate(e=>e.readOnly),false);await page.locator('#itemModal [data-close="itemModal"]').first().click();
  pass('Adding a new inventory item retains its separate initial-quantity form');
  await page.locator('[data-edit="inv-1"]').click();await page.locator('#itemMovementTab').click();await screenshot(page,'inventory-pencil-desktop');await context.close();
 }
 for(const file of ['User/requestacc.html','User/homepage.html','User/my-attendance.html','admin/invetoryadmin.html']){
  const {page,context}=await open(file,390);
  if(file.includes('/invetory')){await page.waitForSelector('[data-edit="inv-1"]');await page.locator('[data-edit="inv-1"]').click();await page.locator('#itemMovementTab').click();}
  for(const theme of ['light','dark']){
   await page.evaluate(t=>window.PGENRO_UserTheme.set(t),theme);
   if(file.includes('/invetory')){
    const contrast=await page.locator('#itemMovementTab').evaluate(el=>{
     const s=getComputedStyle(el),lum=color=>{
      const c=color.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{n/=255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;});return c[0]*0.2126+c[1]*0.7152+c[2]*0.0722;
     };const a=lum(s.color),b=lum(s.backgroundColor);return(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
    });assert(contrast>=4.5,'Selected inventory tab contrast: '+contrast);
   }
   for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:960});await page.waitForTimeout(80);
    const size=await page.evaluate(()=>({viewport:innerWidth,page:document.documentElement.scrollWidth}));assert(size.page<=size.viewport+1,JSON.stringify({file,theme,size}));
    if(file.includes('/invetory')){const box=await page.locator('#itemModal [role=dialog]').boundingBox();assert(box.x>=-1&&box.x+box.width<=width+1);}
   }
   await page.setViewportSize({width:390,height:960});await screenshot(page,path.basename(file,'.html')+'-mobile-'+theme);
  }
  pass(file+' fits desktop and phone widths in light and dark mode');await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
 fs.writeFileSync(path.join(__dirname,'browser-results.json'),JSON.stringify({passed:true,checks,errors,missing},null,2));
 console.log(JSON.stringify({passed:true,checks:checks.length}));
})().catch(e=>{fs.writeFileSync(path.join(__dirname,'browser-results.json'),JSON.stringify({passed:false,checks,errors,missing,error:e.message},null,2));console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});

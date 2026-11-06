/* Production frontend; Auth/RPC fixtures; no live requests or account writes. */
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const root=path.resolve(__dirname,'../..'),checks=[],errors=[],missing=[];let browser;
const sdk=fs.readFileSync(path.join(root,'verification/ui/mock-sdk.js'),'utf8');
const addon=`
window.__regCalls=[];window.__rpcCalls=[];window.__tableCalls=[];window.__callbacks=[];
const c=window.supabase.createClient(),rpc=c.rpc,from=c.from,authListener=c.auth.onAuthStateChange;
window.__db.employees[0].employee_id='0007';
window.__db.employees[0].ceremony_records=[{control_number:'OWN-1',date:'2026-11-02',activity:'FLAG CEREMONY',status:'PRESENT',remarks:'OWN_ATTENDANCE'},{control_number:'OWN-2',date:'2026-10-02',activity:'FLAG RETREAT',status:'ABSENT',remarks:'Own previous month'}];
window.__db.employees[0].uniform_records=[{control_number:'OWN-U1',date:'2026-11-02',compliant:true,remarks:'Own uniform'}];
window.__db.employees.push({id:'emp-other',employee_id:'0008',first_name:'OTHER',last_name:'EMPLOYEE',email:'other@example.com',designation:'Officer',department:'Administration',duty_status:'Active',ceremony_records:[{date:'2026-11-02',remarks:'OTHER_EMPLOYEE_PRIVATE_ATTENDANCE'}]});
c.from=table=>{window.__tableCalls.push(table);return from(table);};
c.rpc=async(name,args)=>{
 window.__rpcCalls.push({name,args});
 if(window.__rpcFail===name)return {data:null,error:{code:'PGRST202',message:'RPC not configured'}};
 if(name==='pgenro_employee_registration_check'&&window.__claimed)return {data:null,error:{code:'23505',message:'This employee ID already has an account or pending request.'}};
 const result=await rpc(name,args);const delay=window.__rpcDelay||0;window.__rpcDelay=0;if(delay)await new Promise(r=>setTimeout(r,delay));return result;
};
c.auth.signUp=async payload=>{window.__regCalls.push(payload);return window.__signupFail?{data:null,error:{message:'Simulated registration failure'}}:{data:{user:{id:'new-user',identities:[{}]},session:null},error:null};};
const oldUser=c.auth.getUser;c.auth.getUser=async()=>window.__actorId?{data:{user:{id:window.__actorId}},error:null}:oldUser();
c.auth.onAuthStateChange=callback=>{window.__callbacks.push(callback);return authListener(callback);};
window.__emitAuth=(event,session)=>window.__callbacks.forEach(fn=>fn(event,session));
`;
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
const pass=scenario=>{checks.push({scenario,result:'PASS'});console.log('PASS',scenario);};
let base;
async function open(file,width=1440){
 const context=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'});
 await context.addInitScript(sdk);await context.addInitScript(addon);
 await context.route('**/*',route=>{const u=route.request().url();if(u.startsWith(base))return route.continue();return route.fulfill({contentType:u.includes('fonts.')?'text/css':'text/javascript',body:''});});
 const page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(file+': '+e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()===404)missing.push(new URL(r.url()).pathname);});
 await page.goto(base+'/'+file,{waitUntil:'networkidle'});return {page,context};
}
async function verify(page){await page.locator('#employeeNumber').fill('0007');await page.locator('#email').fill('maria@example.com');await page.locator('#verifyEmployeeBtn').click();await page.waitForFunction(()=>!document.getElementById('submitBtn').disabled);}
async function readyPassword(page){await page.locator('#password').fill('ExamplePass42!');await page.locator('#confirmPassword').fill('ExamplePass42!');await page.locator('#agree').check();}
async function shots(page,name){if(!process.env.PGENRO_SCREENSHOT_DIR)return;fs.mkdirSync(process.env.PGENRO_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.PGENRO_SCREENSHOT_DIR,name+'.png'),fullPage:true});}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,args:process.env.PGENRO_CHROMIUM_ARGS?JSON.parse(process.env.PGENRO_CHROMIUM_ARGS):['--no-sandbox','--disable-dev-shm-usage']});
 {
  const {page,context}=await open('User/requestacc.html');
  assert.equal(await page.locator('#fullName,#role,.role-choice').count(),0);assert(await page.locator('#submitBtn').isDisabled());pass('Registration starts with an employee ID and no self-selected role or personnel identity');
  await page.locator('#employeeNumber').fill('NOT-ENCODED');await page.locator('#email').fill('maria@example.com');await page.locator('#verifyEmployeeBtn').click();await page.waitForFunction(()=>document.getElementById('employeeCheckStatus').dataset.kind==='error');assert(await page.locator('#submitBtn').isDisabled());assert.equal(await page.evaluate(()=>window.__regCalls.length),0);pass('An unencoded employee ID cannot reach Auth signup');
  await verify(page);assert.equal(await page.locator('#employeeNumber').inputValue(),'0007');pass('An encoded employee ID, including leading zeroes, unlocks account creation');
  await page.locator('#employeeNumber').fill('0008');assert(await page.locator('#submitBtn').isDisabled());assert(await page.locator('#password').isDisabled());pass('Changing the verified ID immediately invalidates verification');
  await verify(page);await readyPassword(page);await page.locator('#confirmPassword').fill('WrongPassword42!');await page.locator('#submitBtn').click();assert.equal(await page.evaluate(()=>window.__regCalls.length),0);pass('Mismatched passwords are rejected before signup');
  await page.locator('#confirmPassword').fill('ExamplePass42!');await page.evaluate(()=>window.__signupFail=true);await page.locator('#submitBtn').click();await page.waitForFunction(()=>!document.getElementById('requestError').hidden);assert.equal(await page.locator('#employeeNumber').inputValue(),'0007');assert.equal(await page.locator('#password').inputValue(),'ExamplePass42!');assert(await page.locator('#submitBtn').isEnabled());pass('A failed signup retains the employee details and permits a retry');
  await page.evaluate(()=>window.__signupFail=false);await page.locator('#submitBtn').click();await page.waitForFunction(()=>!document.getElementById('requestSuccess').hidden);
  const last=await page.evaluate(()=>window.__regCalls.at(-1));assert.equal(last.options.data.employee_number,'0007');assert.equal(last.options.data.requested_role,'User');assert(!('password'in last.options.data));assert(!('full_name'in last.options.data));assert.equal(await page.locator('#successEmployeeNumber').innerText(),'0007');pass('Successful registration sends only the employee link and keeps password data inside Auth');await context.close();
 }
 for(const mode of ['missing-service','duplicate']){
  const {page,context}=await open('User/requestacc.html',390);await page.evaluate(mode=>{if(mode==='duplicate')window.__claimed=true;else window.__rpcFail='pgenro_employee_registration_check';},mode);
  await page.locator('#employeeNumber').fill('0007');await page.locator('#email').fill('maria@example.com');await page.locator('#verifyEmployeeBtn').click();await page.waitForFunction(()=>document.getElementById('employeeCheckStatus').dataset.kind==='error');assert(await page.locator('#submitBtn').isDisabled());assert.equal(await page.evaluate(()=>window.__regCalls.length),0);pass(mode==='duplicate'?'A claimed employee ID remains blocked':'Registration fails closed while the employee-verification service is missing');await context.close();
 }
 {
  const {page,context}=await open('User/my-attendance.html?employeeNumber=0008');await page.waitForSelector('#attendanceWorkspace:not([hidden])');assert.equal(await page.locator('#attendanceNumber').innerText(),'0007');assert.equal(await page.locator('#attendanceBody tr').count(),2);assert(!(await page.locator('body').innerText()).includes('OTHER_EMPLOYEE_PRIVATE_ATTENDANCE'));
  const calls=await page.evaluate(()=>window.__rpcCalls.filter(c=>c.name==='pgenro_my_attendance'));assert(calls.length);assert(calls.every(c=>c.args===undefined));assert(!(await page.evaluate(()=>window.__tableCalls)).includes('employees'));pass('Personal attendance ignores URL employee IDs and never loads the raw employee table');
  await page.locator('#attendanceMonth').fill('2026-11');await page.locator('#attendanceStatus').selectOption('PRESENT');assert.equal(await page.locator('#attendanceTotal').innerText(),'1');assert.equal(await page.locator('#attendanceBody tr').count(),1);pass('Month and status filters update the personal record list and totals');
  await page.locator('#uniformTab').click();assert.equal(await page.locator('#attendanceBody tr').count(),1);assert((await page.locator('#attendanceBody').innerText()).includes('Yes'));assert.equal(await page.locator('[data-edit],[data-delete],#saveMonitoringRecord').count(),0);pass('The User can view their uniform records without employee encoding controls');
  await page.locator('#ceremonyTab').click();await shots(page,'my-attendance-desktop-light');
  await page.evaluate(()=>window.__attendanceRPCResult={linked:true,employee:{employee_number:'0007',full_name:'MARIA SANTOS'},ceremony_records:[],uniform_records:[]});await page.locator('#attendanceRefresh').click();await page.waitForFunction(()=>document.getElementById('attendanceBody').textContent.includes('No records have been encoded'));pass('An employee with no monitoring entries receives a clear empty state');
  await page.evaluate(()=>window.__attendanceRPCResult={linked:false,employee:null,ceremony_records:[],uniform_records:[]});await page.locator('#attendanceRefresh').click();await page.waitForFunction(()=>document.getElementById('attendanceWorkspace').hidden);assert((await page.locator('#attendanceMessage').innerText()).includes('not linked'));assert.equal(await page.locator('#attendanceBody tr').count(),0);pass('An unlinked existing account sees no attendance data from another employee');
  await page.evaluate(()=>{window.__attendanceRPCResult=null;window.__rpcFail='pgenro_my_attendance';});await page.locator('#attendanceRefresh').click();await page.waitForFunction(()=>document.getElementById('attendanceMessage').dataset.kind==='error');assert(await page.locator('#attendanceWorkspace').isHidden());pass('An attendance service error clears records instead of showing cached attendance');await context.close();
 }
 {
  const {page,context}=await open('User/my-attendance.html');await page.waitForSelector('#attendanceWorkspace:not([hidden])');
  await page.evaluate(()=>{window.__rpcDelay=350;document.getElementById('attendanceRefresh').click();});await page.waitForTimeout(40);
  await page.evaluate(()=>{window.__actorId='qa-user-b';window.__attendanceRPCResult={linked:true,employee:{employee_number:'0008',full_name:'SECOND EMPLOYEE'},ceremony_records:[{date:'2026-11-03',status:'PRESENT',remarks:'SECOND_OWN_RECORD'}],uniform_records:[]};window.__emitAuth('SIGNED_IN',{user:{id:'qa-user-b'}});});
  await page.waitForFunction(()=>document.getElementById('attendanceNumber').textContent==='0008');await page.waitForTimeout(450);assert.equal(await page.locator('#attendanceNumber').innerText(),'0008');assert(!(await page.locator('#attendanceBody').innerText()).includes('OWN_ATTENDANCE'));pass('A delayed response for a previous account cannot overwrite the current account attendance');await context.close();
 }
 for(const file of ['User/requestacc.html','User/my-attendance.html']){
  const {page,context}=await open(file,390);if(file.includes('my-attendance'))await page.waitForSelector('#attendanceWorkspace:not([hidden])');
  for(const theme of ['light','dark']){
   await page.evaluate(t=>window.PGENRO_UserTheme.set(t),theme);await page.waitForTimeout(260);
   for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:960});const measure=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(measure.scroll<=measure.width+1,JSON.stringify(measure));}
   await page.setViewportSize({width:390,height:960});await shots(page,(file.includes('requestacc')?'employee-registration':'my-attendance')+'-mobile-'+theme);
  }
  if(file.includes('my-attendance')){
   await page.setViewportSize({width:1440,height:960});await page.locator('#profileBtn').click();assert.equal(await page.locator('#profileBtn').getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');
   await page.setViewportSize({width:390,height:960});await page.locator('#hamburgerMenu').click();assert(await page.locator('#sidebar a[href="my-attendance.html"]').isVisible());await page.locator('.user-sidebar-close').click();await page.waitForFunction(()=>!document.getElementById('sidebar').classList.contains('open'));pass('The personal attendance profile menu and mobile navigation open and close correctly');
  }
  pass(file+' fits desktop, tablet and phone widths in both appearances');await context.close();
 }
 {
  const {page,context}=await open('User/employee.html');await page.waitForFunction(()=>document.getElementById('employeeTable').textContent.includes('OTHER'));
  assert((await page.evaluate(()=>window.__rpcCalls)).some(c=>c.name==='pgenro_employee_directory'));assert(!(await page.evaluate(()=>window.__tableCalls)).includes('employees'));pass('The existing Employee Directory uses the safe projection instead of raw attendance-bearing rows');await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
 fs.writeFileSync(path.join(__dirname,'employee-account-browser-results.json'),JSON.stringify({passed:true,checks,errors,missing,method:'Actual Chromium; production frontend; fixture Auth/RPC; no live backend calls'},null,2));
})().catch(error=>{console.error(error);fs.writeFileSync(path.join(__dirname,'employee-account-browser-results.json'),JSON.stringify({passed:false,checks,errors,missing,error:error.message},null,2));process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});

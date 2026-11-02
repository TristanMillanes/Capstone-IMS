/* Production Flask/frontend; all Supabase, Auth and Storage interactions use local fixtures. */
const fs=require('fs'),path=require('path'),assert=require('assert'),{spawn}=require('child_process');
const deps=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const {chromium}=require(deps?deps+'/playwright':'playwright');
const {PDFDocument,StandardFonts}=require(deps?deps+'/pdf-lib':'pdf-lib');
const root=path.resolve(__dirname,'../..'),port=5076,base=`http://127.0.0.1:${port}`;
const report=[],errors=[];let browser,server,log='',pdf;
const sdk=fs.readFileSync(path.join(root,'verification/ui/mock-sdk.js'),'utf8').replace("const admin = location.pathname.includes('/admin/');","const admin = window.__forcedRole ? window.__forcedRole === 'Admin' : location.pathname.includes('/admin/') || new URLSearchParams(location.search).get('from') === 'admin';");
const support=()=>{
 const db=window.supabase.createClient();window.__rpcCalls=[];window.__functionCalls=[];window.__signedRequests=[];window.__healthNames=[];
 const original=db.rpc.bind(db),actor=()=>window.__db.profiles.find(p=>p.user_id==='qa-user');
 db.rpc=async(name,args={})=>{
  window.__rpcCalls.push({name,args});
  if(window.__rpcFail===name)return {data:null,error:{code:'42501',message:'Permission denied'}};
  if(window.__legacy&&name.startsWith('pgenro_um_'))return {data:null,error:{code:'PGRST202',message:'Function missing'}};
  if(name==='pgenro_um_context'){const profile=actor();return {data:{authorized:profile?.role==='Admin'&&profile.is_active===true,reason:profile?.role==='User'?'USER':'INACTIVE',profile},error:null};}
  if(name==='pgenro_is_admin')return {data:actor()?.role==='Admin'&&actor()?.is_active===true,error:null};
  if(name==='pgenro_um_directory')return {data:{items:window.__db.profiles.slice(args.p_offset,args.p_offset+args.p_limit),offset:args.p_offset,total:window.__db.profiles.length,pending:0,hasMore:args.p_offset+args.p_limit<window.__db.profiles.length},error:null};
  if(name==='pgenro_admin_list_users'){if(actor()?.role!=='Admin')return {data:null,error:{code:'42501',message:'Admin required'}};return {data:window.__db.profiles.slice(args.p_offset,args.p_offset+args.p_limit),error:null};}
  if(name==='pgenro_admin_pending_count')return {data:0,error:null};
  if(name==='pgenro_get_module_notifications')return {data:[],error:null};
  if(name==='update_my_preferences'){actor().preferences=args.p_preferences;return {data:args.p_preferences,error:null};}
  if(name==='update_my_profile'){
   Object.assign(actor(),{full_name:args.p_full_name,username:args.p_username,contact:args.p_contact,position:args.p_position,division:args.p_division});return {data:actor(),error:null};
  }
  return original(name,args);
 };
 db.functions.invoke=async(name,options)=>{
  window.__functionCalls.push({name,body:options.body});
  if(window.__functionFail)return {data:null,error:{message:'Test unavailable service',name:'FunctionsFetchError'}};
  const body=options.body,input=body.user;
  if(body.action==='create'||body.action==='update'){
   let profile=window.__db.profiles.find(p=>p.user_id===body.userId);
   if(!profile){profile={user_id:crypto.randomUUID(),id:crypto.randomUUID(),created_at:new Date().toISOString()};window.__db.profiles.push(profile);}
   Object.assign(profile,{full_name:input.fullName,username:input.username,email:input.email,division:input.division,role:input.role,status:input.status,is_active:input.status==='Active',account_type:input.role.toUpperCase(),position:input.position,contact:input.contact,updated_at:new Date().toISOString()});
   return {data:{success:true,user:{...profile}},error:null};
  }
  return {data:{success:true},error:null};
 };
 db.storage.from=bucket=>({createSignedUrl:async key=>{window.__signedRequests.push({bucket,key});return window.__storageFailure?{data:null,error:{message:'Attachment access denied'}}:{data:{signedUrl:'https://fixture.invalid/signed.pdf'},error:null};},upload:async key=>({data:{path:key},error:null}),remove:async()=>({error:null})});
 if(window.__seedAttachments){
  const url='https://zssrxubajhqryrwijyzm.supabase.co/storage/v1/object/authenticated/pgenro-documents/communications/fixture.pdf';
  for(const table of ['communications','office_memos','travel_orders','service_requests','ics_records'])Object.assign(window.__db[table][0].data,{fileUrl:url,fileName:'fixture.pdf',attachmentUrl:url,attachmentName:'fixture.pdf'});
 }
};
async function open(file,options={}){
 const context=await browser.newContext({viewport:{width:options.width||1440,height:950},reducedMotion:'reduce'});context.setDefaultTimeout(10000);
 await context.addInitScript(options=>{window.__legacy=!!options.legacy;window.__forcedRole=options.role;window.__seedAttachments=!!options.attachments;if(options.anonymous)sessionStorage.setItem('qa_signed_out','true');if(!localStorage.getItem('pgenro_admin_theme'))localStorage.setItem('pgenro_admin_theme','light');if(!localStorage.getItem('pgenro_user_theme'))localStorage.setItem('pgenro_user_theme','light');},options);
 await context.addInitScript(sdk);await context.addInitScript(support);
 await context.route('**/*',async route=>{
  const url=route.request().url();
  if(url.startsWith(base))return route.continue();
  if(url.includes('/functions/v1/')){const name=new URL(url).pathname.split('/').pop();return route.fulfill({status:name==='admin-users'?405:404,headers:{'Access-Control-Allow-Origin':'*'},json:{success:false,error:'Use POST.'}});}
  if(url==='https://fixture.invalid/signed.pdf')return route.fulfill({contentType:'application/pdf',headers:{'Access-Control-Allow-Origin':'*'},body:pdf});
  if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:''});
  if(url.includes('lucide@'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'User/vendor/lucide/lucide.min.js'))});
  return route.fulfill({contentType:url.includes('fonts.')?'text/css':'application/json',body:url.includes('fonts.')?'':'[]'});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(file+': '+e.message));page.on('dialog',d=>d.accept());
 await page.goto(base+'/'+file,{waitUntil:'networkidle'});return {page,context};
}
function pass(scenario){report.push({scenario,result:'PASS'});console.log('PASS',scenario);}
async function createAccount(page,username){
 await page.locator('#openAddUserModalBtn').click();await page.locator('#fullNameInput').fill('QA Test Account');await page.locator('#usernameInput').fill(username);await page.locator('#emailInput').fill(username+'@example.test');await page.locator('#passwordInput').fill('Fixture123!Secure');
 await page.locator('#divisionSelect').selectOption({index:1});await page.locator('#roleSelect').selectOption('User');await page.locator('#statusSelect').selectOption('Active');await page.locator('#saveUserBtn').click();
}
async function fillRequired(page,formId){
 return page.locator('#'+formId).evaluate(form=>{
  for(const el of form.querySelectorAll('input,select,textarea')){
   if(el.disabled||el.readOnly||['hidden','file'].includes(el.type))continue;
   if(el.tagName==='SELECT'){
    if(!el.value&&el.required){const opt=[...el.options].find(o=>o.value&&!o.disabled);if(opt)el.value=opt.value;}
   }else if(!el.value&&el.required){
    if(['checkbox','radio'].includes(el.type))el.checked=true;
    else if(el.type==='number')el.value=String(Math.max(Number(el.min)||1,1));
    else if(el.type==='date')el.value='2026-11-02';
    else if(el.type==='datetime-local')el.value='2026-11-02T10:00';
    else if(el.type==='time')el.value='10:00';
    else if(/contact|phone|mobile/i.test(el.id))el.value='09123456789';
    else if(el.type==='email'||/email/i.test(el.id))el.value='qa-record@example.test';
    else el.value='QA VALIDATION RECORD';
    if(el.maxLength>0)el.value=el.value.slice(0,el.maxLength);
   }
   el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  return [...form.querySelectorAll('input,select,textarea')].filter(el=>!el.disabled&&!el.checkValidity()).map(el=>({id:el.id,message:el.validationMessage}));
 });
}
(async()=>{
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);for(let i=1;i<=3;i++){const p=doc.addPage([612,792]);p.drawText('Verified attachment page '+i,{x:40,y:720,font,size:22});}pdf=Buffer.from(await doc.save());
 server=spawn(process.env.PGENRO_PYTHON||'python',['-u','ocr_server.py'],{cwd:root,env:{...process.env,OCR_PORT:String(port),OCR_WORKERS:'1',OCR_DOCUMENT_WORKERS:'1'}});server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
 let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(base+'/health')).ok;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,log);
 const args=process.env.PGENRO_CHROMIUM_ARGS?JSON.parse(process.env.PGENRO_CHROMIUM_ARGS):['--no-sandbox','--disable-dev-shm-usage'];browser=await chromium.launch({headless:true,executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,args});
 for(const route of ['/vendor/chart.umd.min.js','/vendor/pdfjs/pdf.min.mjs','/User/vendor/pdfjs/pdf.worker.min.mjs','/admin/assets/service-request/PGENRO_Service_Request_Template.pdf','/admin/assets/service-request/PGENRO_Service_Request_Template.docx']){const r=await fetch(base+route);assert.equal(r.status,200,route);if(route.endsWith('.mjs'))assert(r.headers.get('content-type').includes('javascript'));}pass('Production Flask serves chart, PDF modules/workers and official PDF/Word assets');
 for(const legacy of [false,true]){
  const {page,context}=await open('admin/Usermanagement.html',{legacy});try{await page.waitForFunction(()=>document.body.dataset.directoryState==='ready');}catch(error){console.log('DIRECTORY DEBUG',await page.evaluate(()=>({state:document.body.dataset.directoryState,feedback:document.getElementById('userManagementFeedback')?.textContent,calls:window.__rpcCalls,profile:window.__db?.profiles,build:window.PGENRO_USER_MANAGEMENT_SCRIPT_BUILD})));throw error;}assert.equal(await page.locator('#userTableBody tr').count(),1);
  await createAccount(page,legacy?'qa.legacy':'qa.current');try{await page.waitForFunction(()=>!document.getElementById('userModal').classList.contains('open'));}catch(error){console.log('SAVE DEBUG',await page.evaluate(()=>({feedback:document.getElementById('userManagementFeedback')?.textContent,toasts:[...document.querySelectorAll('.toast')].map(el=>el.textContent),invalid:[...document.querySelectorAll('#userForm input,#userForm select')].filter(el=>!el.checkValidity()).map(el=>({id:el.id,message:el.validationMessage})),calls:window.__functionCalls,rpc:window.__rpcCalls.map(c=>c.name)})));throw error;}
  assert.equal(await page.locator('#userTableBody tr').count(),2);const calls=await page.evaluate(()=>window.__functionCalls);assert.equal(calls.length,1);assert.equal(calls[0].name,'admin-users');assert.equal(calls[0].body.user.role,'User');
  if(legacy){
   assert((await page.evaluate(()=>window.__rpcCalls)).some(call=>call.name==='pgenro_admin_list_users'));
   await page.locator('#userTableBody tr').filter({hasText:'qa.legacy'}).locator('[data-action=edit]').click();await page.locator('#fullNameInput').fill('QA Updated Legacy Account');await page.locator('#saveUserBtn').click();await page.waitForFunction(()=>!document.getElementById('userModal').classList.contains('open'));
   assert((await page.locator('#userTableBody').innerText()).includes('QA Updated Legacy Account'));assert.equal(await page.evaluate(()=>window.__functionCalls.length),2);assert.equal(await page.evaluate(()=>window.__functionCalls[1].body.action),'update');
  }
  // A denial of the newer authorization function must not invoke the compatibility fallback.
  await page.evaluate(()=>{window.__rpcFail='pgenro_um_context';window.__rpcCalls=[];});await page.locator('#refreshUsersBtn').click();await page.waitForFunction(()=>document.body.dataset.directoryState==='unavailable');
  assert(!(await page.evaluate(()=>window.__rpcCalls)).some(call=>call.name==='pgenro_is_admin'));assert.equal(await page.locator('#userTableBody tr[data-user-id]').count(),0);
  pass(`User Management ${legacy?'bundled SQL compatibility':'current RPC'}: one confirmed create, matching service, authorization denial blocks fallback`);await context.close();
 }
 {
  const {page,context}=await open('admin/Usermanagement.html',{legacy:true,role:'User'});await page.waitForURL('**/User/homepage.html');assert.equal(await page.evaluate(()=>window.__functionCalls.length),0);pass('User accounts cannot enter or mutate the Admin account directory');await context.close();
 }
 for(const role of ['User','Admin']){
  const {page,context}=await open('SettingIMS/Settings.html?from='+role.toLowerCase(),{role});await page.waitForFunction(()=>document.getElementById('fullNameInput').value.length>0);
  await page.locator('[data-tab="preferencesPanel"]').click();await page.locator('input[name=theme][value=dark]').check();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');assert.equal(await page.locator('html').getAttribute('data-pgenro-theme'),'dark');
  await page.locator('#preferencesForm button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#preferencesForm button[type=submit]').disabled===false);assert.equal(await page.evaluate(role=>localStorage.getItem(role==='Admin'?'pgenro_admin_theme':'pgenro_user_theme'),role),'dark');
  await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');assert.equal(await page.locator('html').getAttribute('data-pgenro-theme'),'dark');
  assert((await page.locator('#backToWorkspace').getAttribute('href')).includes(role==='Admin'?'admin/admin.html':'User/homepage.html'));
  pass(`${role} settings appearance preview/save/reload and correct workspace return`);await context.close();
 }
 for(const [file,button,formId] of [
  ['admincommunication.html','openEncodingModalBtn','communicationForm'],
  ['employee-admin.html','addEmployeeBtn','employeeForm'],
  ['ics-admin.html','addIcsBtn','icsForm'],
  ['invetoryadmin.html','addItemBtn','itemForm'],
  ['officememo-admin.html','openCreateModalBtn','memoForm'],
  ['serviceAdmin.html','btnNewRecord','serviceRequestForm'],
  ['travelOR-admin.html','addOrderBtn','orderForm'],
  ['visitors-admin.html','addVisitorBtn','visitorAdminForm']
 ]){
  const {page,context}=await open('admin/'+file);await page.locator('#'+button).click();const form=page.locator('#'+formId);
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:980});
   const layout=await form.evaluate(el=>{const panel=el.closest('.modal-container,.modal-card,.admin-modal-dialog')||el.parentElement;const r=panel.getBoundingClientRect();return {left:r.left,right:r.right,visible:!!el.getClientRects().length};});
   assert(layout.visible&&layout.left>=-1&&layout.right<=width+1,file+' editor fits '+width+': '+JSON.stringify(layout));
  }
  await page.setViewportSize({width:1440,height:980});assert.deepEqual(await fillRequired(page,formId),[]);
  if(file==='serviceAdmin.html')for(let i=0;i<2;i++)if(await page.locator('#btnNextTab').isVisible())await page.locator('#btnNextTab').click();
  const before=await page.evaluate(()=>window.__mutations.length);await form.evaluate(el=>el.requestSubmit());
  await page.waitForFunction(before=>window.__mutations.slice(before).some(x=>!['audit_logs','admin_logs'].includes(x.table)),before);
  pass(file+': responsive Admin editor and record save through fixture database');await context.close();
 }
 for(const file of ['communication','officememo','travelOR','service','ics']){
  const {page,context}=await open(`User/${file}.html`,{attachments:true,width:390});await page.locator('tbody .viewer-file-button').first().click();await page.waitForFunction(()=>document.querySelector('.viewer-document-status')?.textContent==='Page 1 of 3');
  await page.getByRole('spinbutton',{name:'Go to PDF page'}).fill('3');await page.getByRole('spinbutton',{name:'Go to PDF page'}).press('Tab');await page.waitForFunction(()=>document.querySelector('.viewer-document-status')?.textContent==='Page 3 of 3');
  assert.equal(await page.evaluate(()=>window.__signedRequests.length),1);assert.equal(await page.locator('main [data-action=edit],main [data-action=delete],#fillIcsFormBtn,.modal-stepper-container').count(),0);await page.keyboard.press('Escape');
  pass(`${file}: mobile private attachment signing, real three-page PDF and viewer-only controls`);await context.close();
 }
 {
  const {page,context}=await open('admin/serviceAdmin.html');const record={id:'generated',serviceNo:'SR-QA-FORM',clientName:'QA Fixture',organization:'Test office',contactNo:'09123456789',emailAddress:'qa@example.test',dateRequest:'2026-11-02',requestDetails:'Fixture generation test',technicalAssistance:'Tree Growing'};
  const values=await page.evaluate(async record=>{const generated=await window.PGENRO_ServiceFile.generate(record);const word=await window.PGENRO_ServiceFile.wordDocument(generated);return {pdf:generated.pdf.size,word:word.size,signature:[...new Uint8Array(await word.arrayBuffer()).slice(0,2)]};},record);assert(values.pdf>1000&&values.word>1000);assert.deepEqual(values.signature,[80,75]);
  await page.evaluate(record=>window.PGENRO_ServiceFile.view(record),record);await page.waitForFunction(()=>document.querySelectorAll('#serviceFilePages canvas').length>0);assert(await page.locator('#downloadServicePdfBtn').isEnabled());assert(await page.locator('#downloadServiceWordBtn').isEnabled());
  pass('Official Service Request PDF/Word generation and rendered document preview through the production server');await context.close();
 }
 {
  const {page,context}=await open('admin/admin.html');await page.locator('#sidebarCollapseBtn').click();assert(await page.locator('#sidebar').evaluate(el=>el.classList.contains('collapsed')));await page.locator('#sidebarCollapseBtn').click();
  await page.setViewportSize({width:390,height:850});await page.locator('#mobileMenuBtn').click();assert(await page.locator('#sidebar').evaluate(el=>el.classList.contains('mobile-open')));await page.keyboard.press('Escape');
  await page.setViewportSize({width:1440,height:950});await page.locator('#profileBtn').click();await page.locator('#logoutBtn').click();assert.equal(await page.locator('dialog[open]').count(),1);await page.locator('[data-workspace-logout-cancel]').click();assert.equal(await page.evaluate(()=>Number(sessionStorage.getItem('qa_signout_count')||0)),0);
  if(!await page.locator('#logoutBtn').isVisible())await page.locator('#profileBtn').click();await page.locator('#logoutBtn').click();await page.locator('[data-workspace-logout-confirm]').click();await page.waitForURL('**/User/login.html');assert.equal(await page.evaluate(()=>Number(sessionStorage.getItem('qa_signout_count')||0)),1);pass('Desktop/mobile navigation and logout cancel/confirm use one dialog and one sign-out');await context.close();
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'integration-results.json'),JSON.stringify({passed:true,method:'Production Flask and page code with fixture Supabase/Auth/Storage',checks:report,errors},null,2));
})().catch(e=>{console.error(e);fs.writeFileSync(path.join(__dirname,'integration-results.json'),JSON.stringify({passed:false,checks:report,errors,error:e.stack},null,2));process.exitCode=1;}).finally(async()=>{await browser?.close();server?.kill('SIGTERM');});

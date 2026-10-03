const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright' : 'playwright');
const root=path.resolve(__dirname,'../..');
const server=http.createServer((req,res)=>{const filename=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(filename)]||'application/octet-stream');res.end(fs.readFileSync(filename));});
let browser,port;const findings=[],errors=[];
async function open(filename){
 const context=await browser.newContext({viewport:{width:1440,height:980},reducedMotion:'reduce'});
 await context.route('**/*',async route=>{const u=route.request().url();if(u.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'mock-sdk.js'),'utf8')});if(u.includes('lucide@'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || path.resolve(__dirname,'node_modules'),'lucide/dist/umd/lucide.min.js'),'utf8')});if(u.includes('chart.js'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'chart.umd.min.js'),'utf8')});if(u.startsWith('http://127.0.0.1:'+port))return route.continue();return route.fulfill({status:200,body:'',contentType:'text/javascript'});});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(filename+': '+e.message));page.on('dialog',d=>d.accept());await page.goto('http://127.0.0.1:'+port+'/'+filename);await page.waitForTimeout(350);return {page,context};
}
async function fillRequired(page,selector){
 return page.evaluate(selector=>{
  const form=document.querySelector(selector);const changed=[];
  for(const el of form.querySelectorAll('input,select,textarea')){
   if(el.disabled||el.readOnly||el.type==='hidden'||el.type==='file')continue;
   if(el.tagName==='SELECT'){
    if(!el.value&&el.required){const opt=[...el.options].find(o=>o.value&&!o.disabled);if(opt)el.value=opt.value;}
   }else if(!el.value&&el.required){
    if(el.type==='checkbox'||el.type==='radio')el.checked=true;
    else if(el.type==='number')el.value=String(Math.max(Number(el.min)||1,1));
    else if(el.type==='date')el.value='2026-10-02';
    else if(el.type==='datetime-local')el.value='2026-10-02T10:00';
    else if(el.type==='time')el.value='10:00';
    else if(el.type==='email')el.value='qa-record@example.com';
    else if(el.type==='password')el.value='QaOffice2026!';
    else if(/contact|phone|mobile/i.test(el.id))el.value='09123456789';
    else if(/email/i.test(el.id))el.value='qa-record@example.com';
    else el.value='QA VALIDATION RECORD';
    if(el.maxLength>0)el.value=el.value.slice(0,el.maxLength);
    changed.push(el.id);
   }
   el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  return {changed,invalid:[...form.querySelectorAll('input,select,textarea')].filter(e=>!e.disabled&&!e.checkValidity()).map(e=>({id:e.id,message:e.validationMessage}))};
 },selector);
}
const configs=[
 ['admincommunication.html','openEncodingModalBtn','encodingModal','communicationForm'],
 ['employee-admin.html','addEmployeeBtn','employeeModal','employeeForm'],
 ['ics-admin.html','addIcsBtn','editorModal','icsForm'],
 ['invetoryadmin.html','addItemBtn','itemModal','itemForm'],
 ['officememo-admin.html','openCreateModalBtn','memoModal','memoForm'],
 ['serviceAdmin.html','btnNewRecord','requestModal','serviceRequestForm'],
 ['travelOR-admin.html','addOrderBtn','orderModal','orderForm'],
 ['visitors-admin.html','addVisitorBtn','visitorModal','visitorAdminForm'],
 ['Usermanagement.html','openAddUserModalBtn','userModal','userForm']
];
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;browser=await chromium.launch({headless:true,executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-zygote']});
 for(const [file,button,modal,formId] of configs){
  const {page,context}=await open('admin/'+file);
  try{
   await page.locator('#'+button).click({timeout:2500});
   const actual=await page.evaluate(formId=>document.getElementById(formId)?.closest('.modal-overlay,.modal-backdrop,.admin-modal')?.id,formId);
   const form=page.locator('#'+formId);if(!await form.count())throw Error('Form not found: '+formId);
   for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:980});
    const layout=await form.evaluate(el=>{const panel=el.closest('.modal-container,.modal-card,.admin-modal-dialog')||el.parentElement;const r=panel.getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:r.width,height:r.height,viewport:innerWidth,visible:!!el.getClientRects().length,overflow:el.scrollWidth>el.clientWidth+1};});
    assert(layout.visible,'Editor visible at '+width);assert(layout.x>=-1&&layout.right<=width+1,'Editor fits viewport at '+width+': '+JSON.stringify(layout));
    if(width===390)await page.screenshot({path:path.join(__dirname,'form-'+file+'-390.png'),animations:'disabled'});
   }
   await page.setViewportSize({width:1440,height:980});
   const fill=await fillRequired(page,'#'+formId);if(fill.invalid.length)throw Error('Required validation: '+JSON.stringify(fill));
   if(file==='serviceAdmin.html')for(let i=0;i<2;i++)if(await page.locator('#btnNextTab').isVisible())await page.locator('#btnNextTab').click();
   const before=await page.evaluate(()=>window.__mutations.length);await form.evaluate(el=>el.requestSubmit());await page.waitForTimeout(350);
   const result=await page.evaluate(before=>({writes:window.__mutations.slice(before).filter(x=>!['audit_logs','admin_logs'].includes(x.table)),messages:[...document.querySelectorAll('.toast,.form-feedback,.error-msg,.field-error')].filter(el=>el.getClientRects().length).map(el=>el.textContent.trim())}),before);
   assert(result.writes.length,'Saving sends a record write: '+JSON.stringify(result));
   findings.push({scenario:file+' centered form, responsive editor and save',result:'PASS',actualModal:actual,writes:result.writes.map(x=>x.table||x.function)});console.log('PASS',file,'editor + save');
  }catch(error){findings.push({scenario:file+' editor + save',result:'FAIL',error:error.message});console.log('FAIL',file,error.message);await page.screenshot({path:path.join(__dirname,'fail-'+file+'.png'),fullPage:true});}
  await context.close();
 }
 {
  const {page,context}=await open('admin/admin.html');
  assert(await page.evaluate(()=>['monthlyChart','categoryChart','statusChart'].every(id=>window.Chart.getChart(document.getElementById(id)))),'All three main charts created');
  await page.locator('#sidebarCollapseBtn').click();const layout=await page.evaluate(()=>{const a=document.querySelector('.main-wrapper').getBoundingClientRect();return {left:a.left,right:a.right};});assert.equal(Math.round(layout.right),1440);assert.equal(Math.round(layout.left),78);
  await page.keyboard.press('Control+k');assert(await page.locator('#workspaceJumpModal').evaluate(el=>el.classList.contains('open')));await page.keyboard.press('Escape');
  findings.push({scenario:'Dashboard charts, full-width collapsed content, keyboard module switcher',result:'PASS'});await context.close();
 }
 {
  const {page,context}=await open('admin/admincommunication.html');
  const result=await page.evaluate(async()=>{window.__deny=true;try{await window.PGENRO_Module.write('communications',{subject:'Denied'});return false;}catch(e){return /not saved|permissions/.test(e.message);}});assert(result,'Denied save must not report success');
  await page.evaluate(()=>{window.__deny=false;window.PGENRO_Module.observeRecords('test',[{id:'old'}]);});assert.equal(await page.locator('#notifBadgeCount').innerText(),'0 Unread');await page.evaluate(()=>window.PGENRO_Module.observeRecords('test',[{id:'old'},{id:'new'}]));assert.equal(await page.locator('#notifBadgeCount').innerText(),'1 Unread');
  findings.push({scenario:'Denied save reports failure; notifications only appear for new records',result:'PASS'});await context.close();
 }
 {
  const {page,context}=await open('User/travelOR.html');const text=await page.locator('#travelOrderTable').innerText();assert(text.includes('TOR-2026-00001')&&text.includes('MARIA L. SANTOS'),text);await page.evaluate(()=>window.loadDatabaseTravelOrders([]));assert.equal(await page.locator('#metricTotal').innerText(),'0');assert.equal(await page.locator('#metricPending').innerText(),'0');
  findings.push({scenario:'User travel fields display nested records and empty counters reset',result:'PASS'});await context.close();
 }
 {
  const {page,context}=await open('User/inventory.html');assert.equal(await page.locator('#openEncodingBtn,[data-action="edit"],[data-action="delete"]').count(),0);assert(await page.locator('.readonly-label').isVisible());const before=await page.evaluate(()=>window.__mutations.length);await page.locator('#inventoryForm').evaluate(el=>el.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})));await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.__mutations.filter(x=>x.table==='inventory'||x.table==='inventory_movements').length),0);
  assert.equal(await page.evaluate(()=>window.PGENRO_API.isAdminProfile({role:'System Staff',authUser:{user_metadata:{role:'Administrator',account_type:'ADMIN'}}})),false);
  findings.push({scenario:'User inventory has no encoding controls; forced submit and metadata escalation are blocked',result:'PASS'});await context.close();
 }
 {
  const {page,context}=await open('User/visitorsView.html');await page.locator('[data-open-visitor]').first().click();assert.equal(await page.locator('#toggleCheckoutBtn').count(),0);assert(await page.locator('.readonly-label').isVisible());assert.equal(await page.evaluate(()=>window.__mutations.filter(x=>x.table==='visitors').length),0);
  findings.push({scenario:'User visitor details open with read-only status and no departure controls',result:'PASS'});await context.close();
 }
 assert.deepEqual(errors,[]);const fail=findings.some(x=>x.result==='FAIL');fs.writeFileSync(path.join(__dirname,'functional-results.json'),JSON.stringify({method:'Production page code with simulated Supabase; no live records changed',passed:!fail,findings,uncaughtErrors:errors},null,2));if(fail)process.exitCode=1;
})().catch(e=>{console.error(e);fs.writeFileSync(path.join(__dirname,'functional-results.json'),JSON.stringify({passed:false,findings,errors,error:e.message},null,2));process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});

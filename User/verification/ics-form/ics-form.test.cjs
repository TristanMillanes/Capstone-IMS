const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright' : 'playwright');
const root=path.resolve(__dirname,'../..'),out=__dirname;fs.mkdirSync(out,{recursive:true});
const result={method:'Local application source with intercepted API responses; no live records submitted.',checks:[],errors:[],failures:[]};
const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.mjs':'text/javascript'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
let browser,base;
async function setup(theme='light',behavior='success'){
 const c=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),requests=[];let responseNo=0;
 await c.addInitScript(theme=>{localStorage.setItem('pgenro_user_theme',theme);localStorage.setItem('pgenro_preferences',JSON.stringify({theme}));},theme);
 await c.route('**/*',async route=>{
  const url=route.request().url();
  if(url.includes('/rpc/submit_public_ics')){
   requests.push(route.request().postDataJSON());responseNo++;
   if(behavior==='slow')await new Promise(r=>setTimeout(r,180));
   if(behavior==='retry'&&responseNo===1)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Fixture unavailable'})});
   if(behavior==='unconfirmed')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'Active'})});
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'ics-fixture-reference-001',status:'Pending',controlNo:requests.at(-1).p_data.controlNo,icsNo:requests.at(-1).p_data.icsNo})});
  }
  if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(root+'/verification/ui/mock-sdk.js','utf8')});
  if(url.includes('lucide@'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync((process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/lucide/dist/umd/lucide.min.js' : require.resolve('lucide/dist/umd/lucide.min.js')),'utf8')});
  if(url.startsWith(base))return route.continue();
  return route.fulfill({body:'',contentType:'text/css'});
 });
 const p=await c.newPage();p.on('pageerror',e=>result.errors.push(e.message));p.on('dialog',d=>d.dismiss());await p.goto(base+'/User/ics-form.html');return {c,p,requests};
}
async function check(name,fn){try{await fn();result.checks.push({name,passed:true});console.log('PASS',name);}catch(e){result.failures.push({name,error:e.message});console.log('FAIL',name,e.message);}}
async function fillToReview(p){
 await p.locator('[name=controlNo]').fill('ICS-QA-001');await p.locator('[name=icsNo]').fill('ICS-2026-QA');await p.locator('#icsNextBtn').click();
 await p.locator('[name=article]').fill('Office equipment');await p.locator('[name=itemDescription]').fill('Portable office computer');await p.locator('[name=quantity]').fill('2');await p.locator('#icsNextBtn').click();
 await p.locator('[name=unitCost]').fill('12500.50');await p.locator('[name=dateAcquired]').fill('2026-10-31');await p.locator('#icsNextBtn').click();
 await p.locator('[name=accountablePerson]').fill('QA Sample Employee');await p.locator('[name=division]').fill('Administration');await p.locator('[name=remarks]').fill('QA review only');await p.locator('#icsNextBtn').click();assert.match(await p.locator('#icsStepTitle').innerText(),/Review/);
}
function geometry(){const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return {width:innerWidth,scroll:document.documentElement.scrollWidth,duplicates:ids.filter((id,i)=>ids.indexOf(id)!==i),art:document.querySelectorAll('.ics-property-art').length,eco:document.querySelectorAll('.eco-scene').length,activePanels:[...document.querySelectorAll('[data-ics-panel]')].filter(e=>!e.hidden).length,toggles:document.querySelectorAll('.user-appearance-toggle').length};}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote'],headless:true});
 for(const theme of ['light','dark']){
  const {c,p}=await setup(theme);
  for(const width of [1440,1024,768,390,320])await check(`${theme} initial layout at ${width}px`,async()=>{
   await p.setViewportSize({width,height:1000});const g=await p.evaluate(geometry);assert(g.scroll<=width+1,JSON.stringify(g));assert.equal(g.duplicates.length,0);assert.equal(g.art,1);assert.equal(g.eco,0);assert.equal(g.activePanels,1);assert.equal(g.toggles,1);assert.equal(await p.locator('html').getAttribute('data-theme'),theme);if([1440,390].includes(width))await p.screenshot({path:path.join(out,`ics-${theme}-${width}.png`),animations:'disabled'});
  });
  await check(`${theme} section validation and accessible error reset`,async()=>{await p.locator('#icsNextBtn').click();assert.equal(await p.locator('[aria-invalid=true]').count(),2);assert(await p.locator('#icsSubmissionFeedback').isVisible());assert.equal(await p.locator('#icsStepTitle').innerText(),'Reference numbers');await p.locator('[type=reset]').click();await p.waitForFunction(()=>document.querySelectorAll('[aria-invalid=true]').length===0);assert.equal(await p.locator('.ics-field-error').count(),0);});
  await check(`${theme} full wizard, calculated total, and review layout`,async()=>{
   await p.setViewportSize({width:1440,height:1000});await fillToReview(p);assert(await p.locator('#submitIcsBtn').isVisible());assert(!await p.locator('#icsNextBtn').isVisible());assert.match(await p.locator('#icsReviewTotal').innerText(),/25,001\.00/);assert.equal(await p.locator('#icsReviewGroup0 dd').first().innerText(),'ICS-QA-001');
   for(const width of [1440,768,390,320]){await p.setViewportSize({width,height:1000});const g=await p.evaluate(geometry);assert(g.scroll<=width+1,JSON.stringify(g));if(width===1440||width===390)await p.screenshot({path:path.join(out,`ics-review-${theme}-${width}.png`),animations:'disabled'});}
  });
  await check(`${theme} review edit keeps data; reset returns to first section`,async()=>{await p.locator('[data-ics-edit="1"]').click();assert.equal(await p.locator('[name=itemDescription]').inputValue(),'Portable office computer');await p.locator('[type=reset]').click();await p.waitForFunction(()=>document.getElementById('icsStepTitle').textContent==='Reference numbers');assert.equal(await p.locator('[name=controlNo]').inputValue(),'');assert.equal(await p.locator('[data-ics-step="4"]').isDisabled(),true);});
  await c.close();
 }
 await check('Successful API payload, receipt, print and another-form workflow',async()=>{
  const {c,p,requests}=await setup('dark');await fillToReview(p);await p.locator('#submitIcsBtn').click();await p.locator('#icsReceipt').waitFor({state:'visible'});assert.equal(requests.length,1);assert.equal(requests[0].p_data.quantity,2);assert.equal(requests[0].p_data.unitCost,12500.5);assert.equal(Object.keys(requests[0].p_data).length,18);assert.equal(await p.locator('#receiptControlNo').innerText(),'ICS-QA-001');assert.equal(await p.locator('#receiptReference').innerText(),'ics-fixture-reference-001');assert(await p.locator('#icsSubmissionForm').isHidden());
  for(const width of [1440,390,320]){await p.setViewportSize({width,height:1000});const g=await p.evaluate(geometry);assert(g.scroll<=width+1);if(width===390)await p.screenshot({path:path.join(out,'ics-receipt-dark-390.png'),animations:'disabled'});}
  await p.emulateMedia({media:'print'});assert.equal(await p.locator('#receiptTitle').evaluate(e=>getComputedStyle(e).color),'rgb(17, 17, 17)');await p.emulateMedia({media:'screen'});await p.locator('#anotherIcsBtn').click();assert(await p.locator('#icsReceipt').isHidden());assert.equal(await p.locator('#icsStepTitle').innerText(),'Reference numbers');assert.equal(await p.locator('[name=controlNo]').inputValue(),'');await c.close();
 });
 await check('Unchanged failed submission retries reuse the request ID and keep entries',async()=>{
  const {c,p,requests}=await setup('light','retry');await fillToReview(p);await p.locator('#submitIcsBtn').click();await p.locator('#icsSubmissionFeedback').waitFor({state:'visible'});assert.equal(await p.locator('#icsReviewGroup0 dd').first().innerText(),'ICS-QA-001');await p.locator('#submitIcsBtn').click();await p.locator('#icsReceipt').waitFor({state:'visible'});assert.equal(requests.length,2);assert.equal(requests[0].p_submission_id,requests[1].p_submission_id);await c.close();
 });
 await check('A changed retry uses a new request ID',async()=>{
  const {c,p,requests}=await setup('light','retry');await fillToReview(p);await p.locator('#submitIcsBtn').click();await p.locator('#icsSubmissionFeedback').waitFor({state:'visible'});await p.locator('[data-ics-edit="3"]').click();await p.locator('[name=remarks]').fill('Revised QA note');await p.locator('#icsNextBtn').click();await p.locator('#submitIcsBtn').click();await p.locator('#icsReceipt').waitFor({state:'visible'});assert.notEqual(requests[0].p_submission_id,requests[1].p_submission_id);await c.close();
 });
 await check('Repeated submit events send one request while busy',async()=>{
  const {c,p,requests}=await setup('dark','slow');await fillToReview(p);await p.evaluate(()=>{const f=document.getElementById('icsSubmissionForm');f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});await p.locator('#icsReceipt').waitFor({state:'visible'});assert.equal(requests.length,1);await c.close();
 });
 await check('Unconfirmed API response stays on the form and reports the error',async()=>{
  const {c,p}=await setup('dark','unconfirmed');await fillToReview(p);await p.locator('#submitIcsBtn').click();await p.locator('#icsSubmissionFeedback').waitFor({state:'visible'});assert(await p.locator('#icsReceipt').isHidden());assert(await p.locator('#submitIcsBtn').isEnabled());assert.match(await p.locator('#icsSubmissionFeedback').innerText(),/did not confirm/);await c.close();
 });
 await check('Offline submission preserves the review and sends no request',async()=>{const {c,p,requests}=await setup();await fillToReview(p);await c.setOffline(true);await p.locator('#submitIcsBtn').click();assert.match(await p.locator('#icsSubmissionFeedback').innerText(),/offline/);assert.equal(requests.length,0);await c.close();});
 await check('Review values render as text and previous invalid sections are revisited',async()=>{
  const {c,p}=await setup();await fillToReview(p);await p.locator('[data-ics-edit="3"]').click();await p.locator('[name=remarks]').fill('<img src=x onerror="window.qaInjected=true">');await p.locator('#icsNextBtn').click();assert.match(await p.locator('#icsReviewGroup3').innerText(),/<img/);assert.equal(await p.evaluate(()=>window.qaInjected),undefined);await p.locator('[data-ics-edit="0"]').click();await p.locator('[name=controlNo]').fill('   ');await p.locator('[data-ics-step="4"]').click();await p.locator('#submitIcsBtn').click();assert.equal(await p.locator('#icsStepTitle').innerText(),'Reference numbers');assert.equal(await p.locator('[name=controlNo]').getAttribute('aria-invalid'),'true');await c.close();
 });
 await check('Quantity and unit-cost bounds stop invalid steps',async()=>{
  const {c,p}=await setup();await p.locator('[name=controlNo]').fill('QA');await p.locator('[name=icsNo]').fill('QA');await p.locator('#icsNextBtn').click();await p.locator('[name=article]').fill('QA');await p.locator('[name=itemDescription]').fill('QA');await p.locator('[name=quantity]').fill('0');await p.locator('#icsNextBtn').click();assert.equal(await p.locator('[name=quantity]').getAttribute('aria-invalid'),'true');await p.locator('[name=quantity]').fill('1');await p.locator('#icsNextBtn').click();await p.locator('[name=unitCost]').fill('-1');await p.locator('#icsNextBtn').click();assert.equal(await p.locator('[name=unitCost]').getAttribute('aria-invalid'),'true');await c.close();
 });
 await check('Staff ICS entry dialog fits desktop and phone in both appearances',async()=>{
  for(const theme of ['light','dark']){const {c,p}=await setup(theme);await p.goto(base+'/User/ics.html');await p.locator('#fillIcsFormBtn').click();const modal=p.locator('#icsSubmissionModal');await modal.waitFor({state:'visible'});for(const width of [1440,768,390,320]){await p.setViewportSize({width,height:844});const r=await modal.locator('.modal-container').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:innerWidth,height:innerHeight}});assert(r.x>=-1&&r.right<=width+1&&r.y>=-1&&r.bottom<=844+1,JSON.stringify(r));if(width===390||width===1440)await p.screenshot({path:path.join(out,`ics-staff-${theme}-${width}.png`),animations:'disabled'});}assert.equal(await p.locator('#icsSubmissionForm input[required]').count(),7);await c.close();}
 });
 result.passed=!result.failures.length&&!result.errors.length;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,checks:result.checks.length,failures:result.failures,errors:result.errors},null,2));if(!result.passed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});

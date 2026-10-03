const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert'),{spawn}=require('child_process');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright' : 'playwright');
const root=path.resolve(__dirname,'../..'),fixtures=path.join(root,'verification/ocr');
const findings=[],errors=[];let browser,service,port,log='';
const server=http.createServer((req,res)=>{
 const f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.writeHead(404);return res.end();}
 let body=fs.readFileSync(f);if(f.endsWith('.html'))body=body.toString().replace('127.0.0.1:5000/ocr','127.0.0.1:5053/ocr');
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(f)]||'application/octet-stream');res.end(body);
});
async function open(file){
 const context=await browser.newContext({viewport:{width:390,height:980}});
 await context.route('**/*',async r=>{const u=r.request().url();if(u.includes('@supabase/supabase-js'))return r.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'mock-sdk.js'),'utf8')});if(u.startsWith('http://127.0.0.1:'))return r.continue();return r.fulfill({status:200,body:''});});
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto('http://127.0.0.1:'+port+'/admin/'+file);await p.waitForTimeout(250);return {p,context};
}
(async()=>{
 service=spawn(process.env.PGENRO_PYTHON || 'python',[path.join(root,'User/OCR.py')],{env:{...process.env,OCR_PORT:'5053'}});service.stdout.on('data',x=>log+=x);service.stderr.on('data',x=>log+=x);
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:5053/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,log);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
 {
  const {p,context}=await open('admincommunication.html');await p.locator('#openEncodingModalBtn').click();await p.locator('#documentFileInput').setInputFiles(path.join(fixtures,'incoming.png'));await p.locator('#subjectInput').fill('Reviewed manual subject');
  let pending,cancelRequests=0;const stalled=new Promise(r=>pending=r);p.on('request',r=>{if(r.url().includes('/cancel'))cancelRequests++;});
  await context.route('**/ocr',async r=>{pending();await new Promise(resolve=>setTimeout(resolve,700));await r.abort().catch(()=>{});});
  await p.locator('#runOcrBtn').click();await stalled;const started=Date.now();await p.locator('#cancelOcrBtn').click();await p.waitForFunction(()=>document.getElementById('encodingModal').dataset.busy==='false');assert(Date.now()-started<1500);assert.equal(await p.locator('#subjectInput').inputValue(),'Reviewed manual subject');assert.equal(await p.locator('#ocrTextInput').inputValue(),'');assert(cancelRequests>0);findings.push({scenario:'Stop unlocks the mobile form, keeps manual edits and cancels the server request',result:'PASS'});
  await context.unroute('**/ocr');await p.locator('#runOcrBtn').click();await p.waitForFunction(()=>document.getElementById('encodingModal').dataset.busy==='false',null,{timeout:30000});
  assert.equal(await p.locator('#controlNoInput').inputValue(),'REF-2026-181');assert.equal(await p.locator('#officeInput').inputValue(),'OFFICE OF THE MUNICIPAL MAYOR');assert.equal(await p.locator('#docTypeSelect').inputValue(),'Request Letter');assert.equal(await p.locator('#dateInput').inputValue(),'2026-09-20');assert.equal(await p.locator('#subjectInput').inputValue(),'Reviewed manual subject');assert((await p.locator('#ocrTextInput').inputValue()).includes('RIVER REHABILITATION'));findings.push({scenario:'Real scan autofills sender, issue date, control number and type after Stop/Retry; manual subject survives',result:'PASS'});assert(await p.locator('#saveRecordBtn').isEnabled());await p.locator('#encodingModalBody').evaluate(el=>el.scrollTop=0);await p.waitForTimeout(300);await p.screenshot({path:path.join(__dirname,'ocr-communications-mobile.png')});await context.close();
 }
 {
  const {p,context}=await open('officememo-admin.html');await p.locator('#openCreateModalBtn').click();await p.locator('#formPdfFile').setInputFiles(path.join(fixtures,'memo.png'));await p.locator('#runMemoOcrBtn').click();await p.waitForFunction(()=>document.getElementById('memoFormModal').dataset.busy==='false',null,{timeout:30000});
  assert.equal(await p.locator('#formControlNo').inputValue(),'2026-077');assert.equal(await p.locator('#formDate').inputValue(),'2026-10-01');assert.equal(await p.locator('#formAddressedTo').inputValue(),'ALL DIVISION HEADS');assert.equal(await p.locator('#formIssuedBy').inputValue(),'PROVINCIAL ENRO');assert((await p.locator('#formSubject').inputValue()).includes('MONTHLY REPORTS'));findings.push({scenario:'Real scanned memorandum autofills the existing mobile memo form through the local reader',result:'PASS'});assert(await p.locator('#saveMemoSubmitBtn').isEnabled());await p.locator('.memo-form-body').evaluate(el=>el.scrollTop=0);await p.waitForTimeout(300);await p.screenshot({path:path.join(__dirname,'ocr-memo-mobile.png')});const before=await p.evaluate(()=>window.__mutations.length);await p.locator('#saveMemoSubmitBtn').click();await p.waitForFunction(before=>window.__mutations.slice(before).some(x=>x.table==='office_memos'),before);findings.push({scenario:'The memorandum remains editable and saves after scanned autofill',result:'PASS'});await context.close();
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'ocr-ui-results.json'),JSON.stringify({method:'Production forms, real HTTP Flask OCR service and local Tesseract; Supabase simulated',passed:true,findings,uncaughtErrors:errors},null,2));console.log(findings);
})().catch(e=>{console.error(e);fs.writeFileSync(path.join(__dirname,'ocr-ui-results.json'),JSON.stringify({passed:false,error:e.message,findings,errors,serverLog:log},null,2));process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();service?.kill();});

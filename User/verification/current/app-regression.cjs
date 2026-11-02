// Actual production pages/Flask/Tesseract. Supabase and Storage are simulated locally.
const fs=require('fs'),path=require('path'),assert=require('assert'),{spawn}=require('child_process');
const deps=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const {chromium}=require(deps?deps+'/playwright':'playwright');
const root=path.resolve(__dirname,'../..'),fixtures=path.join(root,'verification/ocr'),port=5059,base=`http://127.0.0.1:${port}`;
const objects=new Map(),writes=[],checks=[],errors=[];let browser,service,log='';
let sdk=fs.readFileSync(path.join(root,'verification/ui/mock-sdk.js'),'utf8');
sdk=sdk.replace('return Promise.resolve().then(()=> {','return Promise.resolve().then(async()=> {')
 .replace("window.__mutations.push({table,operation:state.operation,payload:state.payload});","window.__mutations.push({table,operation:state.operation,payload:state.payload});await window.__qaWrite(table,state.operation,state.payload);");
sdk+=`
if(window.__qaSeed)for(const [table,rows] of Object.entries(window.__qaSeed))window.__db[table]=rows;
window.__signedRequests=[];window.__storageFail=false;
const qaClient=window.supabase.createClient();
qaClient.storage={from(bucket){return {
 async upload(path,file,options){if(window.__storageFail)return {data:null,error:{message:'Storage unavailable'}};await window.__qaStore(bucket+'/'+path,Array.from(new Uint8Array(await file.arrayBuffer())),options.contentType);return {data:{path},error:null};},
 async createSignedUrl(path){window.__signedRequests.push({bucket,path});return {data:{signedUrl:location.origin+'/qa-documents/'+bucket+'/'+path},error:null};},
 async remove(paths){for(const path of paths)await window.__qaRemove(bucket+'/'+path);return {error:null};}
};}};
`;
async function open(filename,seed={},width=390,height=800){
 const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
 await context.exposeFunction('__qaStore',async(key,bytes,mime)=>objects.set(key,{bytes:Buffer.from(bytes),mime}));
 await context.exposeFunction('__qaRemove',async key=>objects.delete(key));
 await context.exposeFunction('__qaWrite',async(table,operation,payload)=>writes.push({table,operation,payload}));
 await context.addInitScript(seed=>window.__qaSeed=seed,seed);
 await context.route('**/*',async route=>{
  const url=route.request().url();
  if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:sdk});
  if(url.includes('lucide@'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(deps,'lucide/dist/umd/lucide.min.js'))});
  if(url.includes('chart.js'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'verification/ui/chart.umd.min.js'))});
  if(url.includes('pdfjs-dist@'))return route.fulfill({contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:fs.readFileSync(path.join(deps,'pdfjs-dist/build',url.includes('worker')?'pdf.worker.mjs':'pdf.mjs'))});
  if(url.startsWith(base+'/qa-documents/')){const key=decodeURIComponent(new URL(url).pathname.replace('/qa-documents/','')),value=objects.get(key);return value?route.fulfill({contentType:value.mime,body:value.bytes}):route.fulfill({status:404,body:'Missing fixture'});}
  if(url.startsWith(base))return route.continue();
  return route.fulfill({status:200,body:'',contentType:'text/javascript'});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(filename+': '+e.message));page.on('dialog',d=>d.accept());
 await page.goto(base+'/'+filename);await page.waitForTimeout(200);return {context,page};
}
async function fillCommunication(page,control){
 await page.locator('#openEncodingModalBtn').click();await page.locator('#typeSelect').selectOption('Incoming');await page.locator('#controlNoInput').fill(control);
 await page.locator('#docTypeSelect').selectOption('Request Letter');await page.locator('#dateInput').fill('2026-10-01');await page.locator('#officeInput').fill('MARIA L. SANTOS');await page.locator('#subjectInput').fill('Reviewed technical assistance request');
}
async function waitRead(page){await page.waitForFunction(()=>document.getElementById('encodingModal').dataset.busy==='false',null,{timeout:45000});}
async function save(page){await page.locator('#saveRecordBtn').click();await page.waitForFunction(()=>!document.getElementById('encodingModal').classList.contains('open'));}
function pass(scenario){checks.push({scenario,result:'PASS'});console.log('PASS',scenario);}
(async()=>{
 service=spawn(process.env.PGENRO_PYTHON||'python',['-u','ocr_server.py'],{cwd:root,env:{...process.env,OCR_PORT:String(port),OCR_WORKERS:'1',OCR_DOCUMENT_WORKERS:'1'}});
 service.stdout.on('data',b=>log+=b);service.stderr.on('data',b=>log+=b);
 let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(base+'/health')).ok;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,log);
 browser=await chromium.launch({headless:true,executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-zygote']});
 let savedRow;
 {
  const {page,context}=await open('admin/admincommunication.html');await fillCommunication(page,'QA-SHARED-2026');await page.locator('#documentFileInput').setInputFiles(path.join(fixtures,'incoming.png'));await save(page);
  savedRow=await page.evaluate(()=>window.__db.communications.find(row=>row.data.controlNo==='QA-SHARED-2026'));
  assert(savedRow.data.fileUrl.includes('/storage/v1/object/authenticated/pgenro-documents/'));assert(objects.size===1);assert(savedRow.data.attachmentId);
  const rows=await page.locator('.kpi-card').evaluateAll(cards=>cards.map(card=>({top:card.getBoundingClientRect().top,y:card.querySelector('.kpi-body h3').getBoundingClientRect().top})));
  for(let i=0;i<rows.length-1;i++)if(Math.abs(rows[i].top-rows[i+1].top)<1)assert(Math.abs(rows[i].y-rows[i+1].y)<=1,JSON.stringify(rows));
  await page.screenshot({path:path.join(__dirname,'communications-mobile.png'),fullPage:true});pass('Communications upload persists a stable private document address and aligned mobile KPI values');await context.close();
 }
 {
  const {page,context}=await open('User/communication.html',{communications:[savedRow]});await page.locator('.view-record-btn').first().click();
  await page.waitForFunction(()=>document.getElementById('viewAttachmentLink').href.includes('/qa-documents/'));
  const value=await page.locator('#viewAttachmentLink').evaluate(async el=>Array.from(new Uint8Array(await (await fetch(el.href)).arrayBuffer())));
  assert(Buffer.from(value).equals(fs.readFileSync(path.join(fixtures,'incoming.png'))));
  const guard=await page.evaluate(async()=>{try{await window.PGENRO_API.uploadDocument(new File(['x'],'x.txt'),'communications');return false;}catch(e){return e.code==='PGENRO_ADMIN_REQUIRED';}});assert(guard);
  assert((await page.evaluate(()=>window.__signedRequests.length))>0);pass('A fresh user browser opens the administrator attachment; ordinary users cannot upload');await context.close();
 }
 {
  const {page,context}=await open('admin/admincommunication.html',{},320,600);await fillCommunication(page,'QA-RETRY-REMOTE');await page.locator('#documentFileInput').setInputFiles(path.join(fixtures,'incoming.png'));
  await page.evaluate(()=>window.__storageFail=true);await page.locator('#saveRecordBtn').click();await page.waitForFunction(()=>document.getElementById('encodingModal').dataset.busy==='false');
  assert(await page.locator('#encodingModal').evaluate(el=>el.classList.contains('open')));assert.equal(await page.locator('#officeInput').inputValue(),'MARIA L. SANTOS');assert(await page.locator('#saveRecordBtn').isEnabled());assert((await page.locator('.toast.error').innerText()).includes('upload failed'));
  await page.evaluate(()=>window.__storageFail=false);await save(page);pass('Storage failure retains the complete draft and selected file; retry saves successfully');await context.close();
 }
 {
  const key='pgenro-documents/office_memos/qa-multipage.pdf';objects.set(key,{bytes:fs.readFileSync(path.join(__dirname,'multipage-letter.pdf')),mime:'application/pdf'});
  const row={id:'qa-user-memo',data:{memoNo:'MEMO-QA-001',subject:'MULTIPAGE DOCUMENT',date:'2026-10-01',addressedTo:'ALL PERSONNEL',issuedBy:'ENRO',pdfUrl:'https://zssrxubajhqryrwijyzm.supabase.co/storage/v1/object/authenticated/'+key,pdfFileName:'multipage-letter.pdf'}};
  const {page,context}=await open('User/officememo.html',{office_memos:[row]},390,650);await page.locator('[data-view-index]').first().click();
  await page.waitForFunction(()=>document.getElementById('memoUserPdfCanvas').width>0&&document.getElementById('pdfFrame').getAttribute('aria-busy')==='false',null,{timeout:45000});
  assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.locator('#memoUserPageLabel').innerText(),'Page 1 of 3');await page.locator('#memoUserNextPage').click();await page.waitForFunction(()=>document.getElementById('memoUserPageLabel').textContent==='Page 2 of 3'&&document.getElementById('pdfFrame').getAttribute('aria-busy')==='false');
  const bytes=await page.locator('#memoUserDownload').evaluate(async el=>(await (await fetch(el.href)).arrayBuffer()).byteLength);assert.equal(bytes,objects.get(key).bytes.length);
  await page.screenshot({path:path.join(__dirname,'user-memo-viewer-mobile.png')});await page.locator('#closeViewModalBtn').click();
  pass('User memorandum PDF renders all pages with next/previous/download controls at a short mobile height');await context.close();
 }
 {
  const {page,context}=await open('admin/admincommunication.html',{},1440,900);let probes=0,posts=0,polls=0;
  page.on('request',r=>{const p=new URL(r.url()).pathname;if(p==='/health')probes++;if(p==='/ocr'&&r.method()==='POST')posts++;if(p.startsWith('/ocr/status/'))polls++;});
  await page.locator('#openEncodingModalBtn').click();await page.locator('#documentFileInput').setInputFiles(path.join(__dirname,'multipage-letter.pdf'));await page.locator('#subjectInput').fill('Reviewed manual subject');await page.locator('#runOcrBtn').click();await waitRead(page);
  assert.equal(await page.locator('#controlNoInput').inputValue(),'REF-2026-181');assert.equal(await page.locator('#dateInput').inputValue(),'2026-10-01');assert.equal(await page.locator('#subjectInput').inputValue(),'Reviewed manual subject');assert((await page.locator('#ocrStatsChip').innerText()).includes('3 pages'));assert.equal(probes,0);assert.equal(posts,1);assert(polls>0,'Live per-page progress is polled');
  pass('Same-origin OCR reads every page with live progress, no health-check delay, and preserved manual fields');await context.close();
 }
 {
  const {page,context}=await open('admin/admincommunication.html');await page.locator('#openEncodingModalBtn').click();
  const body='September 20, 2026\nTO: PROVINCIAL ENRO\n\nDear Sir:\n\nI respectfully request technical assistance for river rehabilitation.\n\nRespectfully yours, MARIA L. SANTOS\nMunicipal Mayor';
  await page.locator('#documentFileInput').setInputFiles({name:'unheaded-letter.txt',mimeType:'text/plain',buffer:Buffer.from(body)});await page.locator('#runOcrBtn').click();await waitRead(page);
  assert.equal(await page.locator('#officeInput').inputValue(),'MARIA L. SANTOS');assert.equal(await page.locator('#docTypeSelect').inputValue(),'Request Letter');assert((await page.locator('#subjectInput').inputValue()).includes('request technical assistance'));assert((await page.locator('#communicationOcrReview').innerText()).includes('Confirm the suggested subject'));
  await page.locator('#cancelEncodingBtn').click();await page.locator('#openEncodingModalBtn').click();
  const memo='MEMORANDUM\nDATE: October 1, 2026\nTO: ALL PERSONNEL\nFROM: PROVINCIAL ENRO\nSUBJECT: Monthly reports\n\nFor your compliance.';
  await page.locator('#documentFileInput').setInputFiles({name:'numberless-memo.txt',mimeType:'text/plain',buffer:Buffer.from(memo)});await page.locator('#runOcrBtn').click();await waitRead(page);
  assert.equal(await page.locator('#docTypeSelect').inputValue(),'Memorandum');assert(/^MEMO-\d{4}-\d+$/.test(await page.locator('#controlNoInput').inputValue()));assert((await page.locator('#saveRecordBtn').innerText()).includes('Office Memos'));
  const before=writes.length;await page.locator('#saveRecordBtn').click();await page.waitForURL('**/officememo-admin.html?memo=*');assert(writes.slice(before).some(x=>x.table==='office_memos'));
  pass('Native text infers letter purpose for review; a numberless memo generates a number and saves to Office Memos');await context.close();
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'app-regression-results.json'),JSON.stringify({passed:true,method:'Actual Chromium, production Flask and Tesseract; database and private Storage simulated; no live records changed',checks,errors},null,2));
})().catch(error=>{console.error(error);fs.writeFileSync(path.join(__dirname,'app-regression-results.json'),JSON.stringify({passed:false,checks,errors,error:error.message,serverLog:log},null,2));process.exitCode=1;}).finally(async()=>{await browser?.close();service?.kill();});

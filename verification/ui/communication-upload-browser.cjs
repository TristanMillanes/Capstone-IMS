const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert'),crypto=require('crypto');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright' : 'playwright');
const root=path.resolve(__dirname,'../..');
const typeKeys=['type','communicationType','communication_type','direction','recordType','record_type','commType','comm_type'];
const errors=[],scenarios=[];
const server=http.createServer((req,res)=>{
 const filename=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.pdf':'application/pdf'})[path.extname(filename)]||'application/octet-stream');
 res.end(fs.readFileSync(filename));
});
let browser,port;
async function open(typeKey,width){
 const context=await browser.newContext({viewport:{width,height:980},reducedMotion:'reduce'});
 let sdk=fs.readFileSync(path.join(__dirname,'mock-sdk.js'),'utf8');
 const before="if(window.__deny)return {data:[],error:null};";
 assert(sdk.includes(before),'Mock validation insertion point exists');
 sdk=sdk.replace(before,`if(table==='communications'&&['insert','update'].includes(state.operation)){
  const payload=state.payload.data||state.payload;
  if(window.__rejectCommunication||!['Incoming','Outgoing'].includes(payload[window.__communicationTypeKey]))
   return {data:null,error:{code:'P0001',message:'Invalid communication type. Use Incoming or Outgoing.'}};
 }\n${before}`);
 sdk+=`\nwindow.__communicationTypeKey=${JSON.stringify(typeKey)};window.__rejectCommunication=false;
 delete window.__db.communications[0].data.type;
 window.__db.communications[0].data[window.__communicationTypeKey]='Incoming';
 window.__db.communications[0].data.retainedReference={office:'QA archive',value:42};`;
 await context.route('**/*',async route=>{
  const u=route.request().url();
  if(u.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:sdk});
  if(u.includes('lucide@'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || path.resolve(__dirname,'node_modules'),'lucide/dist/umd/lucide.min.js'),'utf8')});
  if(u.startsWith('http://127.0.0.1:'+port))return route.continue();
  return route.fulfill({status:200,body:'',contentType:'text/javascript'});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+port+'/admin/admincommunication.html');
 await page.waitForFunction(()=>document.querySelector('#communicationTableBody [data-id="comm-1"]'));
 assert((await page.locator('#communicationTableBody').innerText()).includes('Incoming'),'Legacy direction renders');
 return {page,context};
}
async function fill(page,type,controlNo){
 await page.locator('#openEncodingModalBtn').click();
 await page.locator('#typeSelect').selectOption(type);
 await page.locator('#controlNoInput').fill(controlNo);
 await page.locator('#docTypeSelect').selectOption('Other Communication');
 await page.locator('#dateInput').fill('2025-01-02');
 await page.locator('#officeInput').fill('OFFICE OF THE PROVINCIAL GOVERNOR');
 await page.locator('#subjectInput').fill('WORK ASSIGNMENT AND DOCUMENT UPLOAD CHECK');
 await page.locator('#remarksInput').fill('Draft retained on failure.');
 await page.locator('#statusSelect').selectOption(type==='Incoming'?'Received':'Released');
}
async function saved(page,controlNo){
 await page.locator('#saveRecordBtn').click();
 await page.waitForFunction(()=>!document.querySelector('#encodingModal').classList.contains('open'));
 const row=await page.evaluate(no=>window.__db.communications.find(r=>r.data.controlNo===no),controlNo);
 assert(row,'Save produced a stored record');
 for(const key of typeKeys)assert.equal(row.data[key],row.data.type,key+' stays synchronized');
 assert.equal(row.data.docType,'Other Communication');
 assert.equal(row.data.office,'OFFICE OF THE PROVINCIAL GOVERNOR');
 assert.equal(row.data.date,'2025-01-02');
 assert.equal(await page.locator('.toast.error').count(),0,'Save shows no validation error');
 return row;
}
async function attachment(page,row,bytes,mime){
 const info=await page.evaluate(async id=>{
  const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('pgenro_communication_attachments',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  const blob=await new Promise((resolve,reject)=>{const req=db.transaction('files','readonly').objectStore('files').get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
  db.close();return {size:blob.size,type:blob.type,hash:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')};
 },row.data.attachmentId);
 assert.equal(info.size,bytes.length);assert.equal(info.type,mime);
 assert.equal(info.hash,crypto.createHash('sha256').update(bytes).digest('hex'));
 assert.equal(row.data.fileType,mime,'MIME remains separate from communication direction');
 await page.locator(`[data-action="file"][data-id="${row.id}"]`).click();
 await page.waitForFunction(()=>document.querySelector('#viewDocumentModal').classList.contains('open'));
 assert((await page.locator('#docViewerSubtitle').innerText()).includes(row.data.fileName));
 await page.waitForFunction(()=>!document.getElementById('docViewerDownloadBtn').hidden&&document.getElementById('docViewerDownloadBtn').href.startsWith('blob:'));
 const downloadSize=await page.locator('#docViewerDownloadBtn').evaluate(async el=>(await (await fetch(el.href)).blob()).size);
 assert.equal(downloadSize,bytes.length,'Attached document remains downloadable');
 await page.locator('#closeDocViewerBtn').click();
}
async function layout(page){
 const result=await page.locator('.communication-encoding-modal').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,pageWidth:document.documentElement.scrollWidth};});
 assert(result.left>=-1&&result.right<=result.width+1,JSON.stringify(result));
 assert(result.pageWidth<=result.width,'No horizontal page overflow');
}
async function run(name,fn){await fn();scenarios.push({scenario:name,result:'PASS'});console.log('PASS',name);}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-zygote']});
 await run('Incoming PNG saves and opens with communicationType validation at 390 px',async()=>{
  const {page,context}=await open('communicationType',390);
  await fill(page,'Incoming','QA-INCOMING-UPLOAD');
  const file=path.join(root,'verification/ocr/incoming.png');
  await page.locator('#documentFileInput').setInputFiles(file);await layout(page);
  await page.screenshot({path:path.join(__dirname,'communication-upload-mobile.png'),animations:'disabled'});
  const row=await saved(page,'QA-INCOMING-UPLOAD');await attachment(page,row,fs.readFileSync(file),'image/png');
  await page.screenshot({path:path.join(__dirname,'communication-upload-success.png'),animations:'disabled'});
  await context.close();
 });
 await run('Outgoing PDF saves and opens with communication_type validation at 1440 px',async()=>{
  const {page,context}=await open('communication_type',1440);await fill(page,'Outgoing','QA-OUTGOING-UPLOAD');
  const file=path.join(root,'User/uploads/tmp36gkc7tg.pdf');
  await page.locator('#documentFileInput').setInputFiles(file);await layout(page);
  const row=await saved(page,'QA-OUTGOING-UPLOAD');await attachment(page,row,fs.readFileSync(file),'application/pdf');await context.close();
 });
 await run('TXT upload and Incoming to Outgoing edit synchronize comm_type and preserve attachment at 320 px',async()=>{
  const {page,context}=await open('comm_type',320);await fill(page,'Incoming','QA-TEXT-UPLOAD');
  const bytes=Buffer.from('Incoming document with a retained attachment.');
  await page.locator('#documentFileInput').setInputFiles({name:'letter.txt',mimeType:'text/plain',buffer:bytes});await layout(page);
  const row=await saved(page,'QA-TEXT-UPLOAD');
  await page.locator(`[data-action="edit"][data-id="${row.id}"]`).click();await page.locator('#typeSelect').selectOption('Outgoing');
  await page.locator('#saveRecordBtn').click();await page.waitForFunction(()=>!document.querySelector('#encodingModal').classList.contains('open'));
  const edited=await page.evaluate(id=>window.__db.communications.find(r=>r.id===id),row.id);
  for(const key of typeKeys)assert.equal(edited.data[key],'Outgoing');
  assert.equal(edited.data.attachmentId,row.data.attachmentId);await attachment(page,edited,bytes,'text/plain');
  await page.locator('[data-action="edit"][data-id="comm-1"]').click();assert.equal(await page.locator('#docTypeSelect').inputValue(),'Letter');await page.locator('#typeSelect').selectOption('Outgoing');
  await page.locator('#saveRecordBtn').click();await page.waitForFunction(()=>!document.querySelector('#encodingModal').classList.contains('open'));
  assert.deepEqual(await page.evaluate(()=>window.__db.communications.find(r=>r.id==='comm-1').data.retainedReference),{office:'QA archive',value:42});
  assert.equal(await page.evaluate(()=>window.__db.communications.find(r=>r.id==='comm-1').data.docType),'Letter');
  await page.locator('#openEncodingModalBtn').click();assert.equal(await page.locator('#docTypeSelect option[data-existing-type]').count(),0);await page.locator('#cancelEncodingBtn').click();
  await context.close();
 });
 await run('Rejected save retains draft and attachment, unlocks the form, and retries once successfully',async()=>{
  const {page,context}=await open('direction',390);await fill(page,'Incoming','QA-RETRY-UPLOAD');
  const bytes=Buffer.from('Attachment retained for save retry.');await page.locator('#documentFileInput').setInputFiles({name:'retry.txt',mimeType:'text/plain',buffer:bytes});
  await page.evaluate(()=>window.__rejectCommunication=true);await page.locator('#saveRecordBtn').click();
  await page.waitForFunction(()=>document.querySelector('.toast.error')?.textContent==='Invalid communication type. Use Incoming or Outgoing.');
  assert(await page.locator('#encodingModal').evaluate(el=>el.classList.contains('open')));assert(await page.locator('#saveRecordBtn').isEnabled());
  assert.equal(await page.locator('#subjectInput').inputValue(),'WORK ASSIGNMENT AND DOCUMENT UPLOAD CHECK');
  assert.equal(await page.locator('#documentFileInput').evaluate(el=>el.files[0].name),'retry.txt');
  assert.equal(await page.evaluate(()=>window.__db.communications.length),1);
  await page.evaluate(()=>{window.__rejectCommunication=false;document.querySelectorAll('.toast').forEach(el=>el.remove());});
  const row=await saved(page,'QA-RETRY-UPLOAD');assert.equal(await page.evaluate(()=>window.__db.communications.length),2);
  await attachment(page,row,bytes,'text/plain');await context.close();
 });
 await run('Profile-based administrator guard blocks direct writes after role change',async()=>{
  const {page,context}=await open('communicationType',1440);
  const result=await page.evaluate(async()=>{
   window.__db.profiles[0].role='System Staff';window.__db.profiles[0].account_type='USER';
   const before=window.__mutations.length;
   try{await window.PGENRO_Module.write('communications',{type:'Incoming',subject:'Blocked'});return {blocked:false};}
   catch(error){return {blocked:error.code==='PGENRO_ADMIN_REQUIRED',message:error.message,writes:window.__mutations.length-before};}
  });assert(result.blocked,JSON.stringify(result));assert.equal(result.writes,0);await context.close();
 });
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(__dirname,'communication-upload-results.json'),JSON.stringify({passed:true,method:'Actual Chromium forms, strict simulated Supabase validation, real IndexedDB and byte-verified PNG/PDF/TXT attachments; no hosted records changed',scenarios,uncaughtErrors:errors},null,2));
})().catch(error=>{console.error(error);fs.writeFileSync(path.join(__dirname,'communication-upload-results.json'),JSON.stringify({passed:false,scenarios,uncaughtErrors:errors,error:error.message},null,2));process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});

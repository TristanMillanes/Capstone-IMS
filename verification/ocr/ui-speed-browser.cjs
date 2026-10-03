// Local verification: the test server exposes the existing reader only in served test copies.
const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert');
const project=path.resolve(__dirname,'../..'),baseline=process.env.PGENRO_BASELINE_ROOT;
const assets=process.env.PGENRO_READERS_ROOT||path.join(__dirname,'node_modules');
const mock=fs.readFileSync(path.join(__dirname,'mock.js'),'utf8');
const errors=[],measurements=[],checks=[];
let browser;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),isBaseline=url.pathname.startsWith('/baseline/');
 const base=isBaseline?baseline:path.join(project,'admin');
 const name=url.pathname.replace(/^\/(baseline|updated)\//,''),file=path.resolve(base||'',name);
 if(!base||!file.startsWith(path.resolve(base)+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
 let body=fs.readFileSync(file);if(file.endsWith('admincommunication.js'))body=body.toString().replace('const worker=await Tesseract.createWorker','window.__metrics.workers++;const worker=await Tesseract.createWorker').replace('worker=await Tesseract.createWorker',isBaseline?'window.__metrics.workers++;worker=await Tesseract.createWorker':'worker=await Tesseract.createWorker').replace('return (await worker.recognize','window.__metrics.passes++;return (await worker.recognize').replace('/* End full-document reader. */','window.__testReader=extractDocument;\n/* End full-document reader. */');
 res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[path.extname(file)]||'application/octet-stream');res.end(body);
});
async function context(wrapped=false){
 const c=await browser.newContext({viewport:{width:1440,height:1000}});
 await c.addInitScript(()=>window.__metrics={workers:0,passes:0,serviceCalls:0});
 await c.route('**/*',async route=>{
  const u=new URL(route.request().url());let file;
  if(u.hostname==='127.0.0.1'&&u.port==='5000'){await route.request().frame().evaluate(()=>window.__metrics.serviceCalls++).catch(()=>{});return route.abort();}
  if(u.hostname==='127.0.0.1')return route.continue();
  if(u.href.includes('jszip@'))file=path.join(assets,'jszip/dist/jszip.min.js');
  else if(u.href.includes('pako@'))file=path.join(assets,'pako/dist/pako.min.js');
  else if(u.href.includes('utif@'))file=path.join(assets,'utif/UTIF.js');
  else if(u.href.includes('pdfjs-dist'))file=path.join(assets,'pdfjs-dist/build',path.basename(u.pathname));
  else if(u.href.includes('tesseract.js-core'))file=path.join(assets,'tesseract.js-core',path.basename(u.pathname));
  else if(u.href.includes('tesseract.js@'))file=path.join(assets,'tesseract.js/dist',path.basename(u.pathname));
  else if(u.href.includes('eng.traineddata'))file=path.join(assets,'@tesseract.js-data/eng/4.0.0/eng.traineddata.gz');
  if(!file||!fs.existsSync(file))return route.fulfill({status:200,body:''});
  let body=fs.readFileSync(file);
  
  return route.fulfill({status:200,body,headers:{'Content-Type':file.endsWith('.wasm')?'application/wasm':file.endsWith('.gz')?'application/octet-stream':'text/javascript','Access-Control-Allow-Origin':'*'}});
 });
 await c.route('**/shared/supabase.js*',route=>route.fulfill({contentType:'text/javascript',body:mock+`\nmock();window.__db.communications=[];window.__wrapped=${wrapped};`}));
 return c;
}
async function page(c,version){const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(`http://127.0.0.1:8084/${version}/admincommunication.html`);await p.waitForFunction(()=>window.__testReader);return p;}
async function read(p,name,reuse=false){
 const bytes=[...fs.readFileSync(path.join(__dirname,name))];
 return p.evaluate(async({name,bytes,reuse})=>{
  const mime=name.endsWith('.pdf')?'application/pdf':name.endsWith('.png')?'image/png':'text/plain';
  const file=reuse?window.__lastTestFile:new File([new Uint8Array(bytes)],name,{type:mime});window.__lastTestFile=file;
  const before={...window.__metrics},started=performance.now(),result=await window.__testReader(file);
  return {name,ms:Math.round(performance.now()-started),workers:window.__metrics.workers-before.workers,passes:window.__metrics.passes-before.passes,serviceCalls:window.__metrics.serviceCalls-before.serviceCalls,cacheHit:!!result.cacheHit,text:result.text};
 },{name,bytes,reuse});
}
(async()=>{
 await new Promise(r=>server.listen(8084,'127.0.0.1',r));
 browser=await chromium.launch({headless:true,executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
 if(baseline)for(const version of ['baseline','updated']){
  const c=await context(),p=await page(c,version);
  for(const [scenario,name,reuse] of [['native PDF','incoming.pdf',false],['cold scanned letter','incoming.png',false],['same-file reread','incoming.png',true],['new scanned document with warm reader','memo.png',false]]){
   const r=await read(p,name,reuse);assert(r.text.includes('SUBJECT'),`${version} ${scenario} retains text`);
   measurements.push({version,scenario,...r,text:undefined});console.log(version,scenario,r.ms+' ms',r.passes+' passes',r.workers+' workers');
  }
  await c.close();
 }
 const c=await context(),p=await page(c,'updated');await p.locator('#openEncodingModalBtn').click();
 await p.locator('#documentFileInput').setInputFiles(path.join(__dirname,'incoming.png'));
 await p.locator('#subjectInput').fill('Keep this draft');
 await p.locator('#runOcrBtn').click();await p.locator('#cancelOcrBtn').waitFor({state:'visible'});
 const stop=Date.now();await p.locator('#cancelOcrBtn').click();await p.waitForFunction(()=>document.getElementById('encodingModal').dataset.busy==='false');
 assert(Date.now()-stop<1500,'Stop reading releases the UI promptly');assert.equal(await p.locator('#subjectInput').inputValue(),'Keep this draft');assert.equal(await p.locator('#ocrTextInput').inputValue(),'');
 checks.push('Stop reading unlocks controls promptly and keeps the draft');
 await p.locator('#runOcrBtn').click();await p.waitForFunction(()=>document.getElementById('encodingModal').dataset.busy==='false',null,{timeout:120000});
 assert.equal(await p.locator('#officeInput').inputValue(),'OFFICE OF THE MUNICIPAL MAYOR');checks.push('A stopped scan can be retried with accurate sender fields');
 await p.locator('#removeDocumentBtn').click();
 await p.evaluate(text=>{const transfer=new DataTransfer();transfer.items.add(new File([text],'dropped.txt',{type:'text/plain'}));document.getElementById('documentDropZone').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));},fs.readFileSync(path.join(__dirname,'signed-incoming.txt'),'utf8'));
 assert.equal(await p.locator('#fileNameDisplay').textContent(),'dropped.txt');await p.locator('#runOcrBtn').click();await p.waitForFunction(()=>document.getElementById('encodingModal').dataset.busy==='false');assert.equal(await p.locator('#officeInput').inputValue(),'MARIA L. SANTOS');checks.push('Drag and drop runs the same validation and printed sender extraction');
 await p.locator('#toastContainer').evaluate(el=>el.replaceChildren());await p.locator('#encodingModalBody').evaluate(el=>el.scrollTop=0);await p.screenshot({path:path.join(__dirname,'ui-reading-desktop.png'),animations:'disabled'});
 for(const width of [320,390,768,1440]){
  await p.setViewportSize({width,height:1000});await p.locator('#encodingModalBody').evaluate(el=>el.scrollTop=0);
  await p.waitForTimeout(300);if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)){console.log('OVERFLOW',await p.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getClientRects().length&&(el.getBoundingClientRect().right>innerWidth+1||el.getBoundingClientRect().left< -1)).map(el=>({id:el.id,cls:el.className,rect:el.getBoundingClientRect().toJSON(),scroll:el.scrollWidth,client:el.clientWidth})).slice(-25)));await p.screenshot({path:path.join(__dirname,'ui-overflow.png')});}assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No page overflow at '+width);
  assert.equal(await p.evaluate(()=>{const el=document.getElementById('encodingModalBody');return el.scrollWidth>el.clientWidth+1}),false,'No form overflow at '+width);
  assert(await p.locator('#saveRecordBtn').isVisible());if(width===390)await p.screenshot({path:path.join(__dirname,'ui-reading-mobile.png'),animations:'disabled'});
 }
 checks.push('The form and visible Save control fit 320, 390, 768 and 1440 px viewports');
 for(const name of ['incoming.csv','incoming-utf16.txt','incoming.xlsx','incoming.pptx']){
  await p.locator('#cancelEncodingBtn').click();await p.locator('#openEncodingModalBtn').click();await p.locator('#documentFileInput').setInputFiles(path.join(__dirname,name));await p.locator('#runOcrBtn').click();await p.waitForFunction(()=>document.getElementById('encodingModal').dataset.busy==='false');
  assert.equal(await p.locator('#controlNoInput').inputValue(),'REF-2026-181',name);assert.equal(await p.locator('#officeInput').inputValue(),'OFFICE OF THE MUNICIPAL MAYOR',name);assert.equal(await p.locator('#subjectInput').inputValue(),'REQUEST FOR TECHNICAL ASSISTANCE FOR RIVER REHABILITATION',name);
 }
 checks.push('CSV, UTF-16 text, Excel and PowerPoint retain native text and fill the form');
 await p.locator('#cancelEncodingBtn').click();await p.locator('#openEncodingModalBtn').click();
 await p.locator('#documentFileInput').setInputFiles({name:'signatories.txt',mimeType:'text/plain',buffer:Buffer.from('REQUEST LETTER\nTO: PROVINCIAL ENRO\nSUBJECT: Work\n\nFor your compliance.\nMARIA L. SANTOS\nDepartment Head\nPEDRO R. REYES\nDirector')});
 await p.locator('#runOcrBtn').click();await p.waitForFunction(()=>document.getElementById('encodingModal').dataset.busy==='false');
 assert.equal(await p.locator('#officeInput').inputValue(),'');await p.locator('#ocrSignatorySelect').selectOption('PEDRO R. REYES');assert.equal(await p.locator('#officeInput').inputValue(),'PEDRO R. REYES');assert((await p.locator('#communicationReviewFields').textContent()).includes('Manual correction kept'));assert.equal(await p.locator('#ocrSignatorySelect').inputValue(),'PEDRO R. REYES');checks.push('Ambiguous names require a choice and update the sender and review card together');
 await c.close();
 for(const wrapped of [false,true]){
  const memoContext=await context(wrapped),memoPage=await page(memoContext,'updated');await memoPage.locator('#openEncodingModalBtn').click();await memoPage.locator('#documentFileInput').setInputFiles(path.join(__dirname,'memo-fixture.txt'));await memoPage.locator('#runOcrBtn').click();await memoPage.waitForFunction(()=>document.getElementById('encodingModal').dataset.busy==='false');
  assert.equal(await memoPage.locator('#docTypeSelect').inputValue(),'Memorandum');assert.equal(await memoPage.locator('#memoRecipientInput').inputValue(),'ALL DIVISION HEADS');assert.equal(await memoPage.locator('#officeInput').isVisible(),false);assert.equal(await memoPage.locator('#officeInput').evaluate(el=>el.required),false);assert((await memoPage.locator('#saveRecordBtn').textContent()).includes('Save to Office Memos'));
  await memoPage.route('**/officememo-admin.html?memo=*',route=>route.fulfill({contentType:'text/html',body:'<h1>Memo destination</h1>'}));await memoPage.locator('#saveRecordBtn').click();await memoPage.waitForURL('**/officememo-admin.html?memo=*');checks.push(`Communications memorandum fields save and redirect to Office Memos (${wrapped?'JSON':'flat'} database mock)`);await memoContext.close();
 }
 assert.deepEqual(errors,[],'No uncaught browser errors');
 fs.writeFileSync(path.join(__dirname,'ui-speed-results.json'),JSON.stringify({method:'Real browser production readers; identical local pinned OCR assets; simulated database; baseline is the three supplied Communications files. Times depend on device, file and connection.',measurements,checks,uncaughtErrors:errors},null,2));
 console.log('PASS',checks.length,'UI/cancellation checks');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});

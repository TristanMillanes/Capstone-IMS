// Local verification: the test server exposes the existing reader only in served test copies.
const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert');
const project=path.resolve(__dirname,'../..'),baseline=process.env.PGENRO_BASELINE_ROOT;
const assets=process.env.PGENRO_READERS_ROOT||path.join(__dirname,'node_modules');
const mock=fs.readFileSync(path.join(__dirname,'mock.js'),'utf8');
const errors=[],measurements=[],checks=[];
let browser;
let pythonServer;
const serverLog=[];
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),isBaseline=url.pathname.startsWith('/baseline/');
 const base=isBaseline?baseline:path.join(project,'admin');
 const name=url.pathname.replace(/^\/(baseline|updated)\//,''),file=path.resolve(base||'',name);
 if(!base||!file.startsWith(path.resolve(base)+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
 let body=fs.readFileSync(file);if(file.endsWith('admincommunication.html'))body=body.toString().replace('http://127.0.0.1:5000/ocr','http://127.0.0.1:5051/ocr');if(file.endsWith('admincommunication.js'))body=body.toString().replace('const worker=await Tesseract.createWorker','window.__metrics.workers++;const worker=await Tesseract.createWorker').replace('worker=await Tesseract.createWorker',isBaseline?'window.__metrics.workers++;worker=await Tesseract.createWorker':'worker=await Tesseract.createWorker').replace('return (await worker.recognize','window.__metrics.passes++;return (await worker.recognize').replace('/* End full-document reader. */','window.__testReader=extractDocument;\n/* End full-document reader. */');
 res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[path.extname(file)]||'application/octet-stream');res.end(body);
});
async function context(wrapped=false){
 const c=await browser.newContext({viewport:{width:1440,height:1000}});
 await c.addInitScript(()=>window.__metrics={workers:0,passes:0,serviceCalls:0});
 await c.route('**/*',async route=>{
  const u=new URL(route.request().url());let file;
  if(u.hostname==='127.0.0.1'&&u.port==='5051'&&u.pathname==='/ocr'){await route.request().frame().evaluate(()=>window.__metrics.serviceCalls++).catch(()=>{});return route.continue();}
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
async function open(p,name){
 await p.locator('#openEncodingModalBtn').click();
 await p.locator('#documentFileInput').setInputFiles(path.resolve(__dirname,name));
}
async function finish(p){await p.waitForFunction(()=>document.getElementById('encodingModal').dataset.busy==='false',null,{timeout:120000});}
async function healthy(p){return p.evaluate(async()=>fetch('http://127.0.0.1:5051/health').then(r=>r.json()));}
(async()=>{
 pythonServer=require('child_process').spawn(process.env.PGENRO_PYTHON||'python3',['-u',path.join(project,'ocr_server.py')],{cwd:project,env:{...process.env,OCR_PORT:'5051'}});
 pythonServer.stdout.on('data',data=>serverLog.push(data.toString()));pythonServer.stderr.on('data',data=>serverLog.push(data.toString()));
 let ready=false;for(let attempt=0;attempt<100;attempt++){try{ready=(await (await fetch('http://127.0.0.1:5051/health')).json()).ready;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 assert(ready,'Python server failed to start: '+serverLog.join(''));
 await new Promise(r=>server.listen(8084,'127.0.0.1',r));
 browser=await chromium.launch({headless:true,executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
 const c=await context(),p=await page(c,'updated');
 assert((await healthy(p)).ready,'Start the real Python reader on port 5051 before this suite');
 await open(p,'../../User/uploads/tmp36gkc7tg.pdf');
 await p.locator('#runOcrBtn').click();
 await p.waitForFunction(async()=>{const r=await fetch('http://127.0.0.1:5051/health');return (await r.json()).activeReads>0});
 const stopped=Date.now();await p.locator('#cancelOcrBtn').click();await finish(p);
 assert(Date.now()-stopped<1500,'Stopping releases the form promptly');
 assert.equal(await p.locator('#ocrTextInput').inputValue(),'');
 await p.waitForFunction(async()=>{const r=await fetch('http://127.0.0.1:5051/health');return (await r.json()).activeReads===0});
 checks.push('Stop Reading cancels the actual Python job and keeps unread fields empty');
 await p.locator('#runOcrBtn').click();await finish(p);
 assert.equal(await p.locator('#officeInput').inputValue(),'EnP JOHN FRANCIS L. LUZANO, MPA');
 assert.equal(await p.locator('#docTypeSelect').inputValue(),'Office Order');
 assert.equal(await p.locator('#controlNoInput').inputValue(),'25-002, s. 2025');
 assert((await p.locator('#saveRecordBtn').textContent()).includes('Save Record'));
 checks.push('Real two-page printed Office Order retries accurately and stays in Communications');
 await p.locator('#cancelEncodingBtn').click();await open(p,'incoming.png');
 await p.locator('#subjectInput').fill('My corrected subject');
 await p.locator('#runOcrBtn').click();await finish(p);
 assert.equal(await p.locator('#officeInput').inputValue(),'OFFICE OF THE MUNICIPAL MAYOR');
 assert.equal(await p.locator('#subjectInput').inputValue(),'My corrected subject');
 assert.equal(await p.locator('#controlNoInput').inputValue(),'REF-2026-181');
 assert.equal(await p.locator('#dateInput').inputValue(),'2026-10-01');
 checks.push('Real Python scanned letter fills sender and registry date while keeping manual corrections');
 await p.locator('#cancelEncodingBtn').click();await p.locator('#openEncodingModalBtn').click();
 const unheaded=await p.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1800;
  const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='black';ctx.font='32px Arial';
  ['September 20, 2026','TO: PROVINCIAL ENRO','','Dear Sir:','','I respectfully request technical assistance for river rehabilitation.','','Respectfully yours,','MARIA L. SANTOS','Municipal Mayor'].forEach((line,index)=>ctx.fillText(line,100,120+index*65));
  return canvas.toDataURL('image/png').split(',')[1];
 });
 await p.locator('#documentFileInput').setInputFiles({name:'unheaded-request.png',mimeType:'image/png',buffer:Buffer.from(unheaded,'base64')});
 await p.locator('#runOcrBtn').click();await finish(p);
 assert.equal(await p.locator('#officeInput').inputValue(),'MARIA L. SANTOS');
 assert.equal(await p.locator('#docTypeSelect').inputValue(),'Request Letter');
 assert((await p.locator('#subjectInput').inputValue()).includes('request technical assistance'));
 assert((await p.locator('#communicationReviewFields').textContent()).match(/Suggested; confirm against the original/g).length>=2);
 checks.push('An unheaded printed request suggests type and subject and highlights them for confirmation');
 await p.locator('#cancelEncodingBtn').click();await open(p,'memo.png');
 await p.locator('#runOcrBtn').click();await finish(p);
 assert.equal(await p.locator('#docTypeSelect').inputValue(),'Memorandum');
 assert.equal(await p.locator('#memoRecipientInput').inputValue(),'ALL DIVISION HEADS');
 assert((await p.locator('#saveRecordBtn').textContent()).includes('Save to Office Memos'));
 await p.evaluate(()=>window.addEventListener('beforeunload',()=>sessionStorage.setItem('__testSavedMemos',JSON.stringify(window.__db.office_memos))));
 await p.route('**/officememo-admin.html?memo=*',route=>route.fulfill({contentType:'text/html',body:'<h1>Memo destination</h1>'}));
 await p.locator('#saveRecordBtn').click();await p.waitForURL('**/officememo-admin.html?memo=*');
 const records=await p.evaluate(()=>JSON.parse(sessionStorage.getItem('__testSavedMemos')||'[]'));
 assert(records.some(row=>row.memoNo==='2026-077'),'The memorandum is persisted in the simulated Office Memos table');
 checks.push('Real scanned memorandum fills its form, saves to Office Memos and redirects');
 await c.close();
 const down=await context(),fallback=await page(down,'updated');
 let healthCalls=0,ocrCalls=0;
 await down.route('http://127.0.0.1:5051/health',async route=>{healthCalls++;await new Promise(r=>setTimeout(r,4000));try{await route.fulfill({contentType:'application/json',body:'{"ok":true,"ready":true}'});}catch{}});
 await down.route('http://127.0.0.1:5051/ocr',route=>{ocrCalls++;return route.abort();});
 await open(fallback,'incoming.png');const started=Date.now();
 await fallback.locator('#runOcrBtn').click();await finish(fallback);
 assert.equal(await fallback.locator('#officeInput').inputValue(),'OFFICE OF THE MUNICIPAL MAYOR');
 assert.equal(await fallback.locator('#controlNoInput').inputValue(),'REF-2026-181');
 assert.equal(healthCalls,1);assert.equal(ocrCalls,0);
 assert(Date.now()-started<15000,'An unresponsive server falls back without a long connection timeout');
 checks.push('A stalled health check falls back to real browser OCR after the availability timeout');
 await down.close();
 assert.deepEqual(errors,[],'No uncaught browser errors');
 fs.writeFileSync(path.join(__dirname,'functional-service-browser-results.json'),JSON.stringify({method:'Real production browser form, local HTTP Flask service, Tesseract executable and Tesseract.js fallback; mock Supabase and real IndexedDB; no live data writes',checks,uncaughtErrors:errors},null,2));
 console.log('PASS',checks.length,'real-service browser scenarios');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();server.close();pythonServer?.kill();});

const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const {chromium:pw}=require('playwright'),portableRuntime=true;
const root=path.resolve(__dirname,'../..'),out=path.join(__dirname,'unified-navigation-results');fs.mkdirSync(out,{recursive:true});
const report={method:'Actual Chromium; production pages; real bundled Chart.js and PDF.js; simulated Supabase only',checks:[],errors:[],themes:[]};let browser,port;
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
 if(url.pathname==='/broken.pdf')return res.writeHead(200,{'Content-Type':'application/pdf'}).end('%PDF-1.7\ninvalid document');
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(fs.readFileSync(file));
});
function pass(name){report.checks.push({name,result:'PASS'});console.log('PASS',name);}
async function open(file,{pdf=false,broken=false}={}){
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Manila',reducedMotion:'reduce'});
 await context.addInitScript(()=>{if(localStorage.getItem('qa_theme_seeded'))return;localStorage.setItem('qa_theme_seeded','true');localStorage.setItem('pgenro_admin_theme','dark');localStorage.setItem('pgenro_user_theme','dark');localStorage.setItem('pgenro_preferences',JSON.stringify({theme:'dark'}));});
 let sdk=fs.readFileSync(path.join(root,'verification/ui/mock-sdk.js'),'utf8');
 if(pdf){const url=`http://127.0.0.1:${port}/`+(broken?'broken.pdf':'verification/current/multipage-letter.pdf');sdk+=`\nfor(const table of ['communications','office_memos'])Object.assign(window.__db[table][0].data,{fileUrl:${JSON.stringify(url)},pdfUrl:${JSON.stringify(url)},fileName:'three-pages.pdf',pdfFileName:'three-pages.pdf',attachmentName:'three-pages.pdf'});`;}
 await context.route('**/*',route=>{
  const url=route.request().url();
  if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:sdk});
  if(url.includes('lucide@'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(path.dirname(require.resolve('lucide')),'../umd/lucide.min.js'))});
  if(url.startsWith(`http://127.0.0.1:${port}`))return route.continue();
  return route.fulfill({contentType:url.includes('fonts.')?'text/css':'text/javascript',body:''});
 });
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push({file,error:e.message}));
 await page.goto(`http://127.0.0.1:${port}/${file}`);await page.waitForTimeout(300);return page;
}
async function geometry(page,selector){return page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,viewport:innerWidth,inHeader:!!el.closest('header')};});}
async function chartBounds(page){return page.evaluate(()=>Object.values(window.Chart?.instances||{}).map(c=>{const el=c.canvas,r=el.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect();return {id:c.id,canvas:el.id,width:r.width,height:r.height,viewport:innerWidth,chartWidth:c.width,chartHeight:c.height,boxes:c.legend?.legendHitBoxes,fit:r.left>=p.left-1&&r.right<=p.right+1&&r.top>=p.top-1&&r.bottom<=p.bottom+1,plot:c.chartArea.bottom>c.chartArea.top,legend:(c.legend?.legendHitBoxes||[]).every(b=>b.left+b.width<=c.width+1&&b.top+b.height<=c.height+1)};}));}
function validCharts(items){for(const c of items)assert(c.fit&&c.plot&&c.legend&&c.width>90&&c.height>150,JSON.stringify(c));}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;
 browser=await pw.launch({headless:true,...(process.env.PGENRO_CHROMIUM_EXECUTABLE?{executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 const modules=(process.argv[2]==='pdf'?[]:process.argv[2]==='user'?['User']:['admin','User']).flatMap(folder=>fs.readdirSync(path.join(root,folder)).filter(f=>f.endsWith('.html')&&!['login.html','requestacc.html'].includes(folder==='User'?f:'')).map(f=>folder+'/'+f));
 for(const file of modules){
  const page=await open(file),admin=file.startsWith('admin/'),button=admin?'#sidebarCollapseBtn':'#hamburgerMenu';
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark',file+' initial dark');
  const before=await geometry(page,button);assert(before.inHeader&&before.y>=0&&before.y<60&&before.width>=34,file+' top control');
  if(['admin/admin.html','User/homepage.html'].includes(file))await page.waitForFunction(expected=>Object.values(window.Chart?.instances||{}).length===expected,file.startsWith('admin')?5:2);
  const initial=await chartBounds(page);validCharts(initial);
  await page.locator(button).click();await page.waitForTimeout(180);
  assert(await page.locator('#sidebar').evaluate(e=>e.classList.contains('collapsed')),file+' collapse');validCharts(await chartBounds(page));
  assert.deepEqual((await chartBounds(page)).map(c=>c.id),initial.map(c=>c.id),file+' charts reused');
  await page.locator(button).click();await page.waitForTimeout(150);
  const appearance=admin?'#appearanceThemeBtn':'#userAppearanceBtn';await page.locator(appearance).click();await page.waitForTimeout(70);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light',file+' light toggle');
  await page.locator(appearance).click();await page.waitForTimeout(70);
  const dark=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,surface:getComputedStyle(document.body).getPropertyValue('--bg-surface').trim(),scheme:getComputedStyle(document.body).colorScheme,white:[...document.querySelectorAll('main *,header *')].filter(e=>e.getClientRects().length&&!e.closest('svg,.sidebar,canvas')&&e.getBoundingClientRect().width*e.getBoundingClientRect().height>1200).map(e=>({id:e.id,cls:String(e.className),bg:getComputedStyle(e).backgroundColor})).filter(e=>/rgb\(2[0-5][0-9], 2[0-5][0-9], 2[0-5][0-9]\)/.test(e.bg)).slice(0,15)}));
  report.themes.push({file,...dark});assert.equal(dark.surface,'#142c23');assert.equal(dark.scheme,'dark');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);
  const mobile=admin?'#mobileMenuBtn':'#hamburgerMenu';assert((await geometry(page,mobile)).inHeader);
  await page.locator(mobile).click();await page.waitForTimeout(180);assert(await page.locator('#sidebar').evaluate(e=>!e.inert),'mobile drawer opens');
  await page.keyboard.press('Escape');await page.waitForTimeout(80);assert(await page.locator('#sidebar').evaluate(e=>e.inert),'mobile drawer closes');
  for(const width of [390,320,1024,1816]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(130);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),file+' page width '+width);validCharts(await chartBounds(page));}
  if(['admin/admin.html','User/homepage.html','admin/travelOR-admin.html','User/travelOR.html'].includes(file))await page.screenshot({path:path.join(out,file.replaceAll('/','-')+'-dark.png'),animations:'disabled'});
  pass(file+' top navigation, themes, drawer and width containment');
 }
 {
  const page=await open('User/homepage.html');await page.locator('#userAppearanceBtn').click();await page.reload();await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light','Light preference survives reload');
  await page.locator('#userAppearanceBtn').click();await page.goto(`http://127.0.0.1:${port}/SettingIMS/Settings.html`);await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');assert.equal(await page.locator('input[name="theme"][value="dark"]').isChecked(),true);pass('Account Settings and user appearance use the same preference');
 }
 const viewers=[
  {file:'admin/admincommunication.html',open:'[data-action="file"]',modal:'#viewDocumentModal',canvas:'#commPdfCanvas',label:'#commPdfPageLabel',next:'#commPdfNextPage',zoom:'#commPdfZoom',stage:'#commPdfStage',download:'#docViewerDownloadBtn',close:'#closeDocViewerBtn'},
  {file:'admin/officememo-admin.html',open:'.preview-pdf-btn',modal:'#viewPdfModal',canvas:'#memoPdfCanvas',label:'#memoPdfPageLabel',next:'#memoPdfNextPage',zoom:'#memoPdfZoom',stage:'#memoPdfStage',download:'#downloadPdfBtn',close:'#closeViewPdfBtn'},
  {file:'User/officememo.html',open:'[data-view-index]',modal:'#viewMemoModal',canvas:'#memoUserPdfCanvas',label:'#memoUserPageLabel',next:'#memoUserNextPage',zoom:'#memoUserZoom',stage:'#pdfFrame',download:'#memoUserDownload',close:'#closeViewModalBtn'},
  {file:'User/communication.html',open:'.view-record-btn',modal:'#viewModal',canvas:'#communicationUserPreview canvas',label:'.reader-page-label',next:'[data-reader-next]',zoom:'#communicationUserPreview select',stage:'#communicationUserPreview .pdf-preview-stage',download:'[data-reader-download]',close:'#viewModalClose',inline:true}
 ];
 for(const v of viewers){
  const page=await open(v.file,{pdf:true});await page.locator(v.open).first().click();if(v.inline){await page.locator('#viewAttachmentLink').waitFor({state:'visible'});await page.waitForTimeout(80);await page.locator('#viewAttachmentLink').click();}
  await page.waitForFunction(sel=>{const c=document.querySelector(sel);return c&&!c.hidden&&c.width>100;},v.canvas,{timeout:30000});
  await page.waitForFunction(sel=>document.querySelector(sel)?.getAttribute('aria-busy')!=='true',v.stage);
  assert(await page.locator(v.stage).isVisible(),v.file+' PDF stage visible');
  assert(await page.locator(v.canvas).evaluate(c=>{const ctx=c.getContext('2d'),pixels=ctx.getImageData(0,0,Math.min(512,c.width),Math.min(512,c.height)).data;let ink=0;for(let i=0;i<pixels.length;i+=136)if(pixels[i+3]>0&&pixels[i]+pixels[i+1]+pixels[i+2]<620)ink++;return ink>10;}),v.file+' real PDF pixels rendered');
  assert.match(await page.locator(v.label).textContent(),/1 of 3/);
  await page.locator(v.next).click();await page.waitForTimeout(180);assert.match(await page.locator(v.label).textContent(),/2 of 3/);
  await page.locator(v.zoom).selectOption('1.5');await page.waitForTimeout(200);await page.locator(v.zoom).selectOption('fit');await page.waitForTimeout(200);
  for(const width of [390,320,1440]){
   await page.setViewportSize({width,height:844});await page.waitForTimeout(220);
   const fit=await page.locator(v.stage).evaluate(el=>{const c=el.querySelector('canvas'),r=c.getBoundingClientRect(),p=el.getBoundingClientRect();return {fit:r.width<=el.clientWidth+1&&r.left>=p.left-1&&r.right<=p.right+1,scroll:document.documentElement.scrollWidth,viewport:innerWidth,bg:getComputedStyle(el).backgroundColor};});
   assert(fit.fit&&fit.scroll<=fit.viewport,v.file+' PDF fit '+JSON.stringify(fit));assert(!['rgb(255, 255, 255)','rgb(232, 238, 234)'].includes(fit.bg));
  }
  assert(await page.locator(v.download).getAttribute('href'));await page.setViewportSize({width:390,height:844});await page.waitForTimeout(180);await page.screenshot({path:path.join(out,v.file.replaceAll('/','-')+'-pdf.png'),animations:'disabled'});
  // Close using the production dialog button and verify the canvas is released.
  const close=page.locator(v.close);if(await close.count())await close.click();else await page.keyboard.press('Escape');await page.waitForTimeout(100);
  assert.equal(await page.locator(v.canvas).evaluate(c=>c.width),0,v.file+' closed reader releases canvas');
  pass(v.file+' real three-page PDF, paging, zoom, fit width, dark viewer and cleanup');
 }
 {
  const page=await open('admin/admincommunication.html',{pdf:true,broken:true});await page.locator('[data-action="file"]').click();await page.waitForFunction(()=>document.querySelector('#docViewerFallback')?.dataset.state==='error');assert(await page.locator('#docViewerDownloadBtn').isVisible());pass('A damaged PDF shows a readable error and retains Download');
 }
 {
  const page=await open('admin/travelOR-admin.html');assert.equal(await page.locator('#printDocBtn,[data-print]').count(),0);await page.locator('[data-preview]').first().click();await page.setViewportSize({width:320,height:844});await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);assert(await page.locator('#printModalTitle').isVisible());pass('Travel order details remain available without Print and fit 320 px');
 }
 assert.deepEqual(report.themes.filter(t=>t.white.length).map(t=>({file:t.file,white:t.white})),[],'All module surfaces follow dark mode');
 assert.deepEqual(report.errors,[]);report.passed=true;
})().catch(error=>{report.passed=false;report.failure=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));await browser?.close();server.close();});

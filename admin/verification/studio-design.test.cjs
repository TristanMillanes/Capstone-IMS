// Current emerald design requirements and form usability, with local fixture data only.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');
const {installFixture}=require('./navigation-charts.test.cjs');
const root=path.resolve(__dirname,'../..');
const pages=fs.readdirSync(path.join(root,'admin')).filter(name=>name.endsWith('.html')&&(!process.env.UI_PAGES||process.env.UI_PAGES.split(',').includes(name))).sort();
const forms={
 'admincommunication.html':['openEncodingModalBtn','encodingModal'],
 'employee-admin.html':['addEmployeeBtn','employeeFormModal'],
 'travelOR-admin.html':['addOrderBtn','orderModal'],
 'officememo-admin.html':['openCreateModalBtn','memoFormModal'],
 'invetoryadmin.html':['addItemBtn','itemModal'],
 'visitors-admin.html':['addVisitorBtn','visitorModalBackdrop'],
 'serviceAdmin.html':['btnNewRecord','serviceFormModal'],
 'ics-admin.html':['addIcsBtn','editorModal'],
 'Usermanagement.html':['openAddUserModalBtn','userModal']
};
const results=[];
(async()=>{
 const server=require('http').createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,...(process.env.UI_BROWSER_PATH?{executablePath:process.env.UI_BROWSER_PATH}:{}),args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-zygote']});
 const origin=`http://127.0.0.1:${server.address().port}`;
 try{
  for(const file of pages)for(const width of [390,1440])for(const theme of ['light','dark']){
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
   await context.addInitScript(installFixture,{theme});
   await context.route('**/*',r=>{const u=new URL(r.request().url());return u.hostname!=='127.0.0.1'||u.pathname.startsWith('/shared/')?r.fulfill({status:200,contentType:r.request().resourceType()==='stylesheet'?'text/css':'text/javascript',body:''}):r.continue()});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   try{
    await page.goto(`${origin}/admin/${file}`,{waitUntil:'load'});await page.waitForFunction(()=>window.PGENRO_Module);await page.waitForTimeout(170);
    assert.equal(await page.locator('body').getAttribute('data-design'),'emerald-v6');
    assert.equal(await page.locator('.lucide-leaf,[data-lucide="leaf"],.depth-scene,.depth-ambient,.page-heading-mark,.kpi-icon').count(),0,'Removed decorative glyphs stay absent');
    assert.equal(await page.locator('.nav-item svg').count(),14,'Functional navigation icons remain');
    assert(await page.locator('.logo-icon').evaluate(el=>el.textContent.trim()==='P'||getComputedStyle(el,'::after').content==='"P"'),'Missing seal uses a letter instead of a leaf');
    const metrics=await page.evaluate(()=>({
     width:innerWidth,overflow:document.documentElement.scrollWidth,
     heading:document.querySelector('.header-title h1').getBoundingClientRect().toJSON(),
     topbar:[...document.querySelectorAll('.topbar-left>*,.topbar-right>*')].filter(el=>getComputedStyle(el).display!=='none').map(el=>({rect:el.getBoundingClientRect().toJSON(),opacity:getComputedStyle(el).opacity})),
     background:getComputedStyle(document.body).backgroundColor,sidebar:getComputedStyle(document.querySelector('.sidebar')).backgroundColor,
     menu:(()=>{const el=document.getElementById('sidebarCollapseBtn');return {rect:el.getBoundingClientRect().toJSON(),display:getComputedStyle(el).display,opacity:getComputedStyle(el).opacity,visibility:getComputedStyle(el).visibility};})()
    }));
    assert(metrics.overflow<=width+1,'No page-wide horizontal overflow');
    assert(metrics.heading.left>=0&&metrics.heading.right<=width,'Heading stays inside viewport');
    if(width===390)assert(await page.locator('.unified-page-header').evaluate(el=>el.getBoundingClientRect().height<360),'Phone header does not retain desktop flex spacing');
    const alignedMetrics=await page.locator('.kpi-grid').first().evaluateAll(grids=>{
     if(!grids.length)return true;
     const cards=[...grids[0].querySelectorAll('.kpi-card')],top=cards[0]?.getBoundingClientRect().top;
     const ys=cards.filter(card=>Math.abs(card.getBoundingClientRect().top-top)<2).map(card=>card.querySelector('.kpi-body h3')?.getBoundingClientRect().top).filter(y=>y!==undefined);
     return !ys.length||Math.max(...ys)-Math.min(...ys)<2;
    });
    assert(alignedMetrics,'Values on the same metric row line up');
    assert.equal(metrics.sidebar,'rgb(6, 61, 50)','Emerald navigation');
    assert.equal(metrics.background,theme==='dark'?'rgb(9, 28, 23)':'rgb(242, 247, 244)','Appearance uses the correct background');
    if(width>900){assert.notEqual(metrics.menu.display,'none');assert.equal(metrics.menu.opacity,'1');assert.equal(metrics.menu.visibility,'visible');assert(metrics.menu.rect.left>=254&&metrics.menu.rect.right<width,'Menu is accessible beside sidebar');}
    const profile=page.locator('#profileBtn');await profile.click();assert(await page.locator('#profileDropdown').isVisible());await page.keyboard.press('Escape');
    if(process.env.STUDIO_SNAPSHOTS&&['admin.html','admincommunication.html','officememo-admin.html','employee-admin.html','backup-admin.html'].includes(file)){
     fs.mkdirSync(process.env.STUDIO_SNAPSHOTS,{recursive:true});await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
     await page.screenshot({path:path.join(process.env.STUDIO_SNAPSHOTS,`${file}-${width}-${theme}.png`)});
    }
    if(forms[file]){
     const [button,id]=forms[file];await page.locator('#'+button).click();await page.waitForTimeout(70);
     const overlay=page.locator('#'+id);assert(await overlay.isVisible(),'Record form opens');
     const dialog=overlay.locator('.unified-dialog').first();assert(await dialog.count(),'Shared form styling is present');
     const bounds=await dialog.boundingBox();assert(bounds&&bounds.x>=-1&&bounds.x+bounds.width<=width+1&&bounds.y>=-1&&bounds.y+bounds.height<=901,'Form remains inside viewport');
     const inputs=await dialog.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]),textarea,select').evaluateAll(fields=>fields.filter(e=>e.getClientRects().length).map(e=>({width:e.getBoundingClientRect().width,font:parseFloat(getComputedStyle(e).fontSize),color:getComputedStyle(e).color})));
     assert(inputs.length>0,'Visible form fields remain available');assert(inputs.every(input=>input.width>40),'Form fields retain usable widths');
     if(width===390)assert(inputs.every(input=>input.font>=16),'Phone fields avoid tiny text and automatic zoom');
     if(process.env.STUDIO_SNAPSHOTS&&['admincommunication.html','officememo-admin.html'].includes(file))await page.screenshot({path:path.join(process.env.STUDIO_SNAPSHOTS,`form-${file}-${width}-${theme}.png`)});
     await page.keyboard.press('Escape');assert(await overlay.isHidden(),'Form closes with Escape');
    }
    assert.deepEqual(errors,[],'No script errors');results.push({page:file,width,theme,form:!!forms[file],result:'PASS'});
   }catch(error){error.message=`${file} ${width}px ${theme}: ${error.message}`;throw error;}finally{await context.close();}
  }
  fs.writeFileSync(path.join(__dirname,'studio-design-results.json'),JSON.stringify({method:'Local Chromium with simulated records and missing-logo fallback',scenarios:results},null,2));
  console.log(`${results.length} design scenarios passed, including ${results.filter(row=>row.form).length} form checks`);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1});

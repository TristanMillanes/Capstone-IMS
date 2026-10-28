// Actual local UI interactions with motion enabled; no production services or writes.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');
const {installFixture}=require('./navigation-charts.test.cjs');
const root=path.resolve(__dirname,'../..');
const pages=fs.readdirSync(path.join(root,'admin')).filter(name=>name.endsWith('.html')).sort();
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
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

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
  for(const file of pages)for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'no-preference'});
   await context.addInitScript(installFixture);
   await context.addInitScript(()=>{
    window.__motionEvents=[];
    document.addEventListener('animationstart',event=>{
     const row={name:event.animationName,id:event.target.id,classes:event.target.className};
     window.__motionEvents.push(row);
     if(event.animationName==='emerald-page-out')sessionStorage.setItem('emerald-leave-observed','true');
    },true);
   });
   await context.route('**/*',r=>{const u=new URL(r.request().url());return u.hostname!=='127.0.0.1'||u.pathname.startsWith('/shared/')?r.fulfill({status:200,contentType:r.request().resourceType()==='stylesheet'?'text/css':'text/javascript',body:''}):r.continue()});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   try{
    await page.goto(`${origin}/admin/${file}`,{waitUntil:'load'});
    await page.waitForFunction(()=>window.PGENRO_Module&&window.__motionEvents.some(e=>e.name==='emerald-rise-in'));
    const mainTransform=await page.locator('main').evaluate(el=>getComputedStyle(el).transform);
    assert.equal(mainTransform,'none','Page entrance preserves fixed chart and overlay coordinate spaces');
    await page.waitForTimeout(650);
    assert(await page.locator('.unified-page-header').evaluate(el=>getComputedStyle(el).opacity==='1'&&getComputedStyle(el).transform==='none'),'Header settles into the layout');
    assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0,'No perpetual UI animations');
    if(width===1440){
     await page.locator('#sidebarCollapseBtn').click();await page.waitForTimeout(230);
     const bounds=await page.evaluate(()=>({sidebar:document.querySelector('.sidebar').getBoundingClientRect().width,main:document.querySelector('.main-wrapper').getBoundingClientRect().left}));
     assert.equal(bounds.sidebar,78);assert.equal(bounds.main,78,'Content follows the animated sidebar');
     await page.locator('#sidebarCollapseBtn').click();await page.waitForTimeout(230);
    }else{
     await page.locator('#mobileMenuBtn').click();await page.waitForTimeout(220);
     assert(await page.locator('.sidebar .nav-item.active').isVisible(),'Mobile navigation opens');
     await page.keyboard.press('Escape');await page.waitForTimeout(220);
     assert(await page.locator('#mobileMenuBtn').evaluate(el=>document.activeElement===el),'Menu returns focus after animated close');
    }
    await page.evaluate(()=>window.__motionEvents=[]);
    await page.locator('#profileBtn').click();await frames(page);
    assert(await page.evaluate(()=>window.__motionEvents.some(e=>e.name==='emerald-menu-in'&&e.id==='profileDropdown')),'Profile menu really animates when opened');
    await page.waitForTimeout(220);
    const menu=page.locator('#profileDropdown');assert(await menu.isVisible());
    const menuBounds=await menu.boundingBox();assert(menuBounds.x>=0&&menuBounds.x+menuBounds.width<=width+1,'Animated menu fits viewport');
    await page.keyboard.press('Escape');assert(await menu.isHidden());
    if(forms[file]){
     const [button,id]=forms[file];await page.evaluate(()=>window.__motionEvents=[]);
     await page.locator('#'+button).click();
     await page.waitForFunction(()=>window.__motionEvents.some(e=>e.name==='emerald-dialog-in'),{},{timeout:1000});
     await page.waitForTimeout(290);
     const dialog=page.locator('#'+id+' .unified-dialog').first();
     const box=await dialog.boundingBox();assert(box&&box.x>=-1&&box.y>=-1&&box.x+box.width<=width+1&&box.y+box.height<=901,'Animated dialog fits viewport after settling');
     await page.keyboard.press('Escape');await page.locator('#'+id).waitFor({state:'hidden',timeout:1000});
     assert(await page.locator('#'+id).isHidden(),'Animation keeps Escape close behavior');
     if(file==='employee-admin.html'){
      await page.evaluate(()=>window.__motionEvents=[]);await page.locator('#'+button).click();
      await page.waitForFunction(()=>window.__motionEvents.some(e=>e.name==='emerald-dialog-in'),{},{timeout:1000});
      await page.keyboard.press('Escape');await page.locator('#'+id).waitFor({state:'hidden',timeout:1000});
      assert(await page.locator('#'+button).evaluate(el=>document.activeElement===el),'Reopened form still restores focus');
     }
    }
    if(file==='admin.html'&&width===1440){
     const button=page.locator('.modern-dashboard-hero .btn-primary');
     await button.hover();await page.waitForTimeout(220);
     assert(await button.evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m42<0),'Mouse hover lifts the action');
     await page.mouse.down();await page.waitForTimeout(100);
     assert(await button.evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).a<1),'Pressed action gives tactile feedback');
     await page.mouse.move(280,85);await page.mouse.up();
     await Promise.all([page.waitForURL('**/admincommunication.html'),page.locator('.workspace-quick-links a').first().click()]);
     assert.equal(await page.evaluate(()=>sessionStorage.getItem('emerald-leave-observed')),'true','Navigation plays its finite exit animation');
    }
    // OS preference changes apply immediately, including a menu reopened in this state.
    await page.emulateMedia({reducedMotion:'reduce'});await frames(page);await page.evaluate(()=>window.__motionEvents=[]);
    await page.locator('#profileBtn').click();await frames(page);
    assert(await page.locator('#profileDropdown').isVisible(),'Reduced-motion menu still opens');
    assert.equal(await page.locator('#profileDropdown').evaluate(el=>getComputedStyle(el).animationName),'none');
    assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0,'Reduced motion suppresses running UI animations');
    assert.equal(await page.evaluate(()=>window.__motionEvents.filter(e=>e.name==='emerald-menu-in').length),0,'Reduced motion suppresses animated menu reveals');
    await page.keyboard.press('Escape');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow after interactions');
    assert.deepEqual(errors,[],'No script errors during animated interactions');
    results.push({page:file,width,form:!!forms[file],result:'PASS'});
   }catch(error){console.error('Motion scenario failed:',file,width,await page.evaluate(()=>window.__motionEvents));throw error;}finally{await context.close();}
  }
  fs.writeFileSync(path.join(__dirname,'emerald-motion-results.json'),JSON.stringify({method:'Actual Chromium UI interactions with motion enabled, then OS reduced-motion preference',scenarios:results},null,2));
  console.log(`${results.length} motion scenarios passed, including ${results.filter(r=>r.form).length} animated form checks`);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1});

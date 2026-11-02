// Production UI + simulated auth; never sends live writes or signs out real accounts.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const deps=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||path.resolve(__dirname,'node_modules');
const {chromium}=require(deps+'/playwright');
const root=path.resolve(__dirname,'../..');
const report={method:'Chromium with simulated Supabase, including sign-out failure/delay; no live data',checks:[],errors:[]};
const pages=['admin','User','SettingIMS'].flatMap(folder=>fs.readdirSync(path.join(root,folder)).filter(name=>name.endsWith('.html')&& !['login.html','requestacc.html'].includes(name) || folder==='admin'&&name==='requestacc.html').map(name=>folder+'/'+name));
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
let browser,port;
async function open(file,motion='reduce'){
 const context=await browser.newContext({viewport:{width:1440,height:980},reducedMotion:motion});
 await context.addInitScript(()=>{
  window.__nativeConfirmations=0;window.confirm=()=>{window.__nativeConfirmations++;return false;};
  window.__slideStates=[];
  new MutationObserver(changes=>changes.forEach(change=>{
   if(change.attributeName==='data-page-transition')window.__slideStates.push(document.body?.dataset.pageTransition);
  })).observe(document,{subtree:true,attributes:true,attributeFilter:['data-page-transition']});
 });
 await context.route('**/*',route=>{
  const url=route.request().url();
  if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'mock-sdk.js'))});
  if(url.includes('lucide@'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(deps,'lucide/dist/umd/lucide.min.js'))});
  if(url.includes('chart.js'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'chart.umd.min.js'))});
  if(url.startsWith('http://127.0.0.1:'+port))return route.continue();
  return route.fulfill({contentType:url.includes('fonts.')?'text/css':'text/javascript',body:''});
 });
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(file+': '+e.message));
 await page.goto(`http://127.0.0.1:${port}/${file}`);
 await page.waitForFunction(()=>document.body.dataset.navigationReady==='true');
 await page.waitForTimeout(350);
 return {page,context};
}
async function openLogout(page){
 const profile=page.locator('#profileBtn');
 if(await profile.count()){
  if(!await page.locator('#logoutBtn').isVisible())await profile.click();
  await page.locator('#logoutBtn').click();
 }else await page.locator('[data-pgenro-logout]').click();
 await page.locator('#workspaceLogoutDialog').waitFor({state:'visible'});
}
const calls=page=>page.evaluate(()=>Number(sessionStorage.getItem('qa_signout_count')||0));
function pass(scenario){report.checks.push({scenario,result:'PASS'});console.log('PASS',scenario);}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
 for(const file of pages){
  const {page,context}=await open(file);const original=page.url();
  await openLogout(page);
  assert.equal(await calls(page),0,file+' asks before calling auth');
  assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-workspace-logout-cancel')),true,'Cancel receives initial focus');
  await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-workspace-logout-confirm')),true,'Focus wraps to confirm');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-workspace-logout-cancel')),true,'Focus wraps to Cancel');
  await page.locator('[data-workspace-logout-cancel]').click();
  assert(await page.locator('#workspaceLogoutDialog').isHidden());assert.equal(page.url(),original);assert.equal(await calls(page),0);
  await openLogout(page);await page.keyboard.press('Escape');assert(await page.locator('#workspaceLogoutDialog').isHidden());assert.equal(await calls(page),0);
  await openLogout(page);await page.mouse.click(10,10);assert(await page.locator('#workspaceLogoutDialog').isHidden());assert.equal(await calls(page),0);
  await openLogout(page);
  for(const width of [390,320]){
   await page.setViewportSize({width,height:844});
   const r=await page.locator('#workspaceLogoutDialog').boundingBox();
   assert(r.x>=0&&r.x+r.width<=width&&r.y>=0&&r.y+r.height<=844,file+' dialog fits '+width);
  }
  if(['admin/admin.html','User/communication.html','SettingIMS/Settings.html'].includes(file))await page.screenshot({path:path.join(__dirname,'slide-confirm-'+file.replaceAll('/','-')+'-320.png'),animations:'disabled'});
  await page.setViewportSize({width:1440,height:980});
  if(file==='admin/admin.html')await page.screenshot({path:path.join(__dirname,'slide-confirm-admin-logout-1440.png'),animations:'disabled'});
  await page.evaluate(()=>window.__signOutDelay=250);
  await page.locator('[data-workspace-logout-confirm]').click();
  assert(await page.locator('[data-workspace-logout-confirm]').isDisabled());
  assert(await page.locator('[data-workspace-logout-cancel]').isDisabled());
  await page.keyboard.press('Escape');assert(await page.locator('#workspaceLogoutDialog').isVisible(),'Busy dialog cannot be dismissed');
  await page.waitForURL('**/User/login.html');
  assert.equal(await calls(page),1,file+' calls auth exactly once');
  assert.equal(await page.evaluate(()=>window.__nativeConfirmations),0,file+' never uses browser confirmation');
  pass(file+' custom confirmation, cancellation, focus, responsive bounds and one confirmed logout');
  await context.close();
 }
 for(const file of ['admin/admin.html','User/communication.html','SettingIMS/Settings.html']){
  const {page,context}=await open(file);const original=page.url();
  await page.evaluate(()=>window.__signOutFailure=true);await openLogout(page);
  await page.locator('[data-workspace-logout-confirm]').click();
  await page.locator('.workspace-logout-error').waitFor({state:'visible'});
  assert.equal(page.url(),original);assert.equal(await calls(page),1);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('qa_signed_out')),null,'Failed signout keeps session');
  assert(!await page.locator('[data-workspace-logout-confirm]').isDisabled());
  await page.evaluate(()=>window.__signOutFailure=false);
  await page.locator('[data-workspace-logout-confirm]').click();await page.waitForURL('**/User/login.html');
  assert.equal(await calls(page),2,'Retry signs out once without a second prompt');
  pass(file+' logout failure stays open and retry succeeds');await context.close();
 }
 for(const [from,to] of [['admin/admincommunication.html','employee-admin.html'],['User/communication.html','inventory.html'],['SettingIMS/Settings.html?from=user','../User/homepage.html']]){
  const {page,context}=await open(from,'no-preference');
  assert((await page.evaluate(()=>window.__slideStates)).includes('entering'),'Initial entrance runs');
  const link=page.locator('a[href="'+to+'"]').first();
  await link.click();
  const leaving=await page.evaluate(()=>document.body.dataset.pageTransition==='leaving'&&getComputedStyle(document.querySelector('main')).animationName==='workspace-slide-out');
  assert(leaving,from+' leaves with a slide');
  await page.waitForURL('**/'+to.split('/').at(-1));
  await page.waitForFunction(()=>document.body.dataset.navigationReady==='true');
  assert((await page.evaluate(()=>window.__slideStates)).includes('entering'),'Destination entrance runs');
  await page.waitForFunction(()=>document.body.dataset.pageTransition==='idle');
  assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.effect.getTiming().iterations===Infinity&&a.playState==='running').length),0,'No infinite decoration');
  await page.goBack();await page.waitForFunction(()=>document.body.dataset.navigationReady==='true'&&document.body.dataset.pageTransition==='idle');
  assert(!await page.locator('main').evaluate(el=>el.classList.contains('workspace-slide-leave')),'Back navigation clears the exit state');
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('a[href="'+to+'"]').first().click();await page.waitForURL('**/'+to.split('/').at(-1));
  await page.waitForFunction(()=>document.body.dataset.navigationReady==='true');
  assert.equal(await page.evaluate(()=>document.body.dataset.pageTransition),'idle','Reduced motion skips transitions');
  pass(from+' slide navigation, arrival, browser back and reduced motion');await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
})().catch(error=>{report.passed=false;report.failure=error.message;console.error(error);process.exitCode=1;}).finally(async()=>{
 fs.writeFileSync(path.join(__dirname,'navigation-logout-results.json'),JSON.stringify(report,null,2));await browser?.close();server.close();
});

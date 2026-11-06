const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const deps=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const {chromium}=require(deps?deps+'/playwright':'playwright');
const root=path.resolve(__dirname,'../..'),pages=[];for(const folder of ['admin','User','SettingIMS','VisitorsLog'])for(const file of fs.readdirSync(path.join(root,folder)))if(file.endsWith('.html'))pages.push(folder+'/'+file);
if(process.env.THEME_PAGES){const chosen=JSON.parse(process.env.THEME_PAGES);pages.splice(0,pages.length,...chosen);}
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.mjs':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ttf':'font/ttf','.pdf':'application/pdf'};
const server=http.createServer((req,res)=>{const f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!f.startsWith(root+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',types[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));});
let browser;const checks=[],errors=[],missing=[];
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,args:process.env.PGENRO_CHROMIUM_ARGS?JSON.parse(process.env.PGENRO_CHROMIUM_ARGS):['--no-sandbox','--disable-dev-shm-usage']});
 for(const file of pages){
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});context.setDefaultTimeout(7000);
  await context.addInitScript(fs.readFileSync(path.join(root,'verification/ui/mock-sdk.js'),'utf8'));
  await context.addInitScript(()=>{if(!localStorage.getItem('pgenro_user_theme'))localStorage.setItem('pgenro_user_theme','light');if(!localStorage.getItem('pgenro_admin_theme'))localStorage.setItem('pgenro_admin_theme','light');});
  await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(base))return route.continue();if(url.includes('lucide@'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'User/vendor/lucide/lucide.min.js'))});if(url.includes('/functions/v1/admin-users'))return route.fulfill({status:405,json:{error:'Use POST'},headers:{'Access-Control-Allow-Origin':'*'}});return route.fulfill({contentType:url.includes('fonts.')?'text/css':'text/javascript',body:''});});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(file+': '+e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()===404)missing.push(r.url());});
  await page.goto(base+'/'+file,{waitUntil:'networkidle'});let button=page.locator('#appearanceThemeBtn,.user-appearance-toggle').first();assert(await button.isVisible(),file+' appearance button is available');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');await button.click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  const scheme=await page.evaluate(()=>getComputedStyle(document.body).colorScheme);assert(scheme.includes('dark'),file+' native control scheme follows dark mode, got '+scheme);
  if(file==='SettingIMS/Settings.html')assert(await page.locator('input[name=theme][value=dark]').isChecked(),'Settings radio follows header appearance button');
  if(!file.startsWith('admin/')){await page.evaluate(()=>dispatchEvent(new StorageEvent('storage',{key:'pgenro_preferences',newValue:'{"theme":"light"}'})));assert.equal(await page.locator('html').getAttribute('data-theme'),'dark','Another role preference cannot replace the selected User theme');}
  await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('html').getAttribute('data-theme'),'dark',file+' theme survives reload');
  if(file==='admin/admin.html'&&process.env.PGENRO_SCREENSHOT_DIR){fs.mkdirSync(process.env.PGENRO_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.PGENRO_SCREENSHOT_DIR,'dashboard-dark-full.png'),fullPage:true});}
  button=page.locator('#appearanceThemeBtn,.user-appearance-toggle').first();await button.click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  assert((await page.evaluate(()=>getComputedStyle(document.body).colorScheme)).includes('light'),file+' native control scheme follows light mode');
  checks.push({file,result:'PASS',checks:['Actual light/dark toggle','Reload persistence','Native control appearance','Return to light']});console.log('PASS',file);await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);fs.writeFileSync(process.env.THEME_BEHAVIOR_RESULT||path.join(__dirname,'behavior-results.json'),JSON.stringify({passed:true,checks,errors,missing},null,2));
})().catch(e=>{console.error(e);fs.writeFileSync(process.env.THEME_BEHAVIOR_RESULT||path.join(__dirname,'behavior-results.json'),JSON.stringify({passed:false,checks,errors,missing,error:e.stack},null,2));process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});

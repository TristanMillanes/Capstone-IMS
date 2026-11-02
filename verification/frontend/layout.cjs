const fs=require('fs'),path=require('path'),http=require('http');
const deps=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const {chromium}=require(deps?deps+'/playwright':'playwright');
const root=path.resolve(__dirname,'../..'),pages=[];
const screenshotDir=process.env.PGENRO_SCREENSHOT_DIR;
if(screenshotDir)fs.mkdirSync(screenshotDir,{recursive:true});
for(const folder of ['admin','User','SettingIMS','VisitorsLog'])for(const name of fs.readdirSync(path.join(root,folder)))if(name.endsWith('.html'))pages.push(`${folder}/${name}`);
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json','.pdf':'application/pdf','.ttf':'font/ttf'};
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end('Missing');}res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
let browser;const reports=[];
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,headless:true,args:process.env.PGENRO_CHROMIUM_ARGS?JSON.parse(process.env.PGENRO_CHROMIUM_ARGS):['--no-sandbox','--disable-dev-shm-usage']});
 const mock=fs.readFileSync(path.join(root,'verification/ui/mock-sdk.js'),'utf8');
 for(const file of pages){
  const context=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'reduce'});const page=await context.newPage();page.setDefaultTimeout(5000);const errors=[],missing=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()===404)missing.push(new URL(r.url()).pathname)});page.on('dialog',d=>d.dismiss());
  await context.addInitScript(mock);
  await context.addInitScript(()=>{localStorage.setItem('pgenro_user_theme','dark');localStorage.setItem('pgenro_admin_theme','light');localStorage.setItem('pgenro_preferences',JSON.stringify({theme:'light'}));});
  await context.route('**/*',route=>{const url=route.request().url();if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:''});if(url.includes('lucide@'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'User/vendor/lucide/lucide.min.js'))});if(url.startsWith(base))return route.continue();return route.fulfill({status:200,contentType:url.includes('fonts.')?'text/css':'application/json',body:url.includes('fonts.')?'':'[]'});});
  const layouts=[];let appearance={};
  try{
   await page.goto(base+'/'+file,{waitUntil:'networkidle',timeout:15000});await page.waitForTimeout(150);
   const actual=new URL(page.url()).pathname;
   appearance=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,legacy:document.documentElement.dataset.pgenroTheme,buttons:document.querySelectorAll('#appearanceThemeBtn,#userAppearanceBtn').length}));
   const theme=page.locator('#appearanceThemeBtn,#userAppearanceBtn').first();
   if(await theme.count()&&await theme.isVisible()){const before=await page.locator('html').getAttribute('data-theme');await theme.click();await page.waitForTimeout(70);appearance.before=before;appearance.after=await page.locator('html').getAttribute('data-theme');}
   for(const width of [1440,1024,768,390,320]){await page.setViewportSize({width,height:950});await page.waitForTimeout(40);layouts.push(await page.evaluate(()=>{
    const alignment=[];
    const back=document.querySelector('.settings-back'),actions=document.querySelector('.settings-topbar-actions');
    if(back&&actions){const a=back.getBoundingClientRect(),b=actions.getBoundingClientRect();if(Math.abs(a.y+a.height/2-b.y-b.height/2)>2)alignment.push('Settings header actions wrap onto a separate row');}
    if(innerWidth>1200){const filters=[...document.querySelectorAll('.account-directory-filters .controls-left>*')].map(el=>el.getBoundingClientRect());if(filters.length&&Math.max(...filters.map(r=>r.y))-Math.min(...filters.map(r=>r.y))>2)alignment.push('Desktop account filters stack instead of sharing one row');}
    return {width:innerWidth,scroll:document.documentElement.scrollWidth,unrendered:document.querySelectorAll('i[data-lucide]').length,main:document.querySelector('main')?.getBoundingClientRect().toJSON(),alignment};
   }));}
   await page.setViewportSize({width:1440,height:950});if(screenshotDir)await page.screenshot({path:path.join(screenshotDir,file.replaceAll('/','-')+'.png')});
   reports.push({file,actual,errors,missing:[...new Set(missing)],appearance,layouts});
  }catch(e){reports.push({file,errors:[...errors,e.message],missing,appearance,layouts});}
  console.log(file,JSON.stringify({errors:reports.at(-1).errors,missing:reports.at(-1).missing,theme:appearance,overflow:layouts.filter(x=>x.scroll>x.width+1).map(x=>x.width)}));await context.close();
 }
 const passed=reports.every(r=>!r.errors.length&&!r.missing.length&&r.layouts.every(v=>v.scroll<=v.width+1&&!v.alignment.length)&&(!r.appearance.before||r.appearance.before!==r.appearance.after));
 fs.writeFileSync(path.join(__dirname,'layout-results.json'),JSON.stringify({passed,method:'Production frontend and local fixture backend',pages:reports},null,2));
 if(!passed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();server.close();});

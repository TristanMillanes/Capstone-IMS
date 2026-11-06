const fs=require('fs'),path=require('path'),http=require('http');
const deps=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const {chromium}=require(deps?deps+'/playwright':'playwright');
const root=path.resolve(__dirname,'../..'),phase=process.argv[2]||'before',out=path.resolve(process.env.PGENRO_SCREENSHOT_DIR||path.join(__dirname,'screenshots-'+phase));fs.mkdirSync(out,{recursive:true});
const pages=[];for(const folder of ['admin','User','SettingIMS','VisitorsLog'])for(const file of fs.readdirSync(path.join(root,folder)))if(file.endsWith('.html'))pages.push(folder+'/'+file);
const chosen=process.env.THEME_PAGES?JSON.parse(process.env.THEME_PAGES):pages;
const editors={'admin/admincommunication.html':'#openEncodingModalBtn','admin/employee-admin.html':'#addEmployeeBtn','admin/ics-admin.html':'#addIcsBtn','admin/invetoryadmin.html':'#addItemBtn','admin/officememo-admin.html':'#openCreateModalBtn','admin/serviceAdmin.html':'#btnNewRecord','admin/travelOR-admin.html':'#addOrderBtn','admin/visitors-admin.html':'#addVisitorBtn','admin/Usermanagement.html':'#openAddUserModalBtn','admin/backup-admin.html':'#createBackupBtn'};
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json','.pdf':'application/pdf','.wasm':'application/wasm','.ttf':'font/ttf'};
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
const measure=()=>{
 const color=s=>{const x=s.match(/[\d.]+/g)?.map(Number);return x?.length>=3?[x[0],x[1],x[2],x[3]??1]:[0,0,0,0];};
 const blend=(a,b)=>[0,1,2].map(i=>a[i]*a[3]+b[i]*(1-a[3]));
 const lum=c=>c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 const selector=el=>el.id?'#'+el.id:el.tagName.toLowerCase()+'.'+[...el.classList].slice(0,3).join('.');
 const bg=el=>{const chain=[];let gradient=false;for(let p=el;p;p=p.parentElement){const st=getComputedStyle(p);if(st.backgroundImage!=='none')gradient=true;chain.push(color(st.backgroundColor));}let base=[255,255,255];for(const c of chain.reverse())base=blend(c,base);return {base,gradient};};
 const found=[],seen=new Set();
 function inspect(el,text,pseudo){
  const st=getComputedStyle(el,pseudo),r=el.getBoundingClientRect();if(r.width<2||r.height<2||st.visibility!=='visible'||+st.opacity<.4||st.clipPath!=='none'||el.closest('[aria-hidden="true"],.sr-only,.visually-hidden,script,style,svg,option,[inert]')||el.matches(':disabled')||el.closest('button:disabled'))return;
  if(pseudo===undefined&&getComputedStyle(el).overflow==='hidden'&&r.height<3)return;
  const b=bg(el);if(b.gradient)return;const fg=color(st.color);fg[3]*=+st.opacity;const actual=blend(fg,b.base),a=lum(actual),bL=lum(b.base),ratio=(Math.max(a,bL)+.05)/(Math.min(a,bL)+.05);
  const size=parseFloat(st.fontSize),weight=Number(st.fontWeight)||400,min=size>=24||size>=18.66&&weight>=700?3:4.5;
  if(ratio<min-.1){const key=selector(el)+'|'+st.color+'|'+b.base.map(Math.round);if(seen.has(key))return;seen.add(key);found.push({selector:selector(el),text:text.trim().slice(0,100),ratio:+ratio.toFixed(2),min,color:st.color,background:b.base.map(Math.round),size,weight});}
 }
 const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);for(let n; n=walk.nextNode();)if(n.textContent.trim())inspect(n.parentElement,n.textContent);
 for(const el of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea,select'))if(el.getClientRects().length){const value=el.tagName==='SELECT'?el.options[el.selectedIndex]?.text:el.value;if(value)inspect(el,value);else if(el.placeholder)inspect(el,el.placeholder,'::placeholder');}
 const cut=[...document.querySelectorAll('label,.kpi-label,.profile-button-name,.btn,.primary-action,.settings-tabs button')].filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>2&&r.height>2&&s.textOverflow!=='ellipsis'&&s.overflowX!=='auto'&&s.overflowX!=='scroll'&&(el.scrollWidth>el.clientWidth+3||el.scrollHeight>el.clientHeight+4);}).map(el=>({selector:selector(el),text:el.textContent.trim().slice(0,80),width:el.clientWidth,scroll:el.scrollWidth,height:el.clientHeight,scrollHeight:el.scrollHeight}));
 return {width:innerWidth,scroll:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme,legacyTheme:document.documentElement.dataset.pgenroTheme,contrast:found,clipped:cut};
};
let browser;const results=[];
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,args:process.env.PGENRO_CHROMIUM_ARGS?JSON.parse(process.env.PGENRO_CHROMIUM_ARGS):['--no-sandbox','--disable-dev-shm-usage']});
 const sdk=fs.readFileSync(path.join(root,'verification/ui/mock-sdk.js'),'utf8');
 for(const file of chosen){
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});context.setDefaultTimeout(15000);await context.addInitScript(sdk);await context.addInitScript(()=>{localStorage.setItem('pgenro_admin_theme','light');localStorage.setItem('pgenro_user_theme','light');localStorage.setItem('pgenro_preferences','{"theme":"light"}');});
  await context.route('**/*',route=>{const u=route.request().url();if(u.startsWith(base))return route.continue();if(u.includes('lucide@'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'User/vendor/lucide/lucide.min.js'))});if(u.includes('/functions/v1/admin-users'))return route.fulfill({status:405,json:{error:'Use POST'},headers:{'Access-Control-Allow-Origin':'*'}});return route.fulfill({contentType:u.includes('fonts.')?'text/css':'text/javascript',body:''});});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  try{
   await page.goto(base+'/'+file,{waitUntil:'networkidle'});
   for(const theme of ['light','dark']){
    await page.evaluate(theme=>{if(window.PGENRO_UserTheme)window.PGENRO_UserTheme.set(theme);else{localStorage.setItem('pgenro_admin_theme',theme);document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;document.dispatchEvent(new CustomEvent('pgenro:themechange',{detail:{theme}}));}},theme);
    await page.screenshot({path:path.join(out,file.replaceAll('/','-')+'-'+theme+'.png')});
    const main=await page.evaluate(measure);results.push({file,theme,surface:'page',...main,errors:[...errors]});
    if(editors[file]&&await page.locator(editors[file]).isVisible().catch(()=>false)){
     await page.locator(editors[file]).click();await page.waitForTimeout(60);results.push({file,theme,surface:'editor',...await page.evaluate(measure),errors:[...errors]});
     await page.screenshot({path:path.join(out,file.replaceAll('/','-')+'-'+theme+'-editor.png')});
     for(const width of [390,320]){await page.setViewportSize({width,height:1000});results.push({file,theme,surface:'editor-mobile',...await page.evaluate(measure),errors:[...errors]});}await page.setViewportSize({width:1440,height:1000});
     await page.keyboard.press('Escape');await page.evaluate(()=>{document.querySelectorAll('.modal-overlay.open,.modal-backdrop.open,.admin-modal.open').forEach(el=>window.PGENRO_Module?.closeModal(el.id));});
    }
    const extraSurfaces=file==='SettingIMS/Settings.html'?['#preferencesPanel','#securityPanel']:[];
    for(const surface of extraSurfaces){
      await page.locator('[data-tab="'+surface.slice(1)+'"]').click();
      results.push({file,theme,surface,...await page.evaluate(measure),errors:[...errors]});
      if(surface==='#preferencesPanel')await page.screenshot({path:path.join(out,'Settings-preferences-'+theme+'.png')});
    }
    if(file==='SettingIMS/Settings.html')await page.locator('[data-tab="accountPanel"]').click();
    if(file==='User/service-request-form.html'){
      for(let i=0;i<3;i++)await page.locator('#requestNextBtn').click();
      results.push({file,theme,surface:'review',...await page.evaluate(measure),errors:[...errors]});
      await page.locator('#requestBackBtn').click();results.push({file,theme,surface:'requestDetails',...await page.evaluate(measure),errors:[...errors]});
      await page.screenshot({path:path.join(out,'Service-request-details-'+theme+'.png'),fullPage:true});
      await page.locator('#requestBackBtn').click();await page.locator('#requestBackBtn').click();
    }
    if(file.startsWith('User/')&&!['homepage.html','login.html','requestacc.html','ics-form.html','service-request-form.html'].some(n=>file.endsWith(n))){
      const first=page.locator('tbody button:not(.viewer-bookmark-button)').first();
      if(await first.isVisible().catch(()=>false)){
        await first.click();results.push({file,theme,surface:'details',...await page.evaluate(measure),errors:[...errors]});
        await page.screenshot({path:path.join(out,file.replaceAll('/','-')+'-'+theme+'-details.png')});for(const width of [390,320]){await page.setViewportSize({width,height:1000});results.push({file,theme,surface:'details-mobile',...await page.evaluate(measure),errors:[...errors]});}await page.setViewportSize({width:1440,height:1000});await page.keyboard.press('Escape');
      }
    }
    for(const width of [1024,768,390,320]){await page.setViewportSize({width,height:1000});const m=await page.evaluate(measure);results.push({file,theme,surface:'responsive',...m,errors:[...errors]});}
    await page.setViewportSize({width:1440,height:1000});
   }
   console.log(file,JSON.stringify(results.filter(r=>r.file===file&&r.surface!=='responsive').map(r=>({theme:r.theme,surface:r.surface,contrast:r.contrast.length,clipped:r.clipped.length,errors:r.errors}))));
  }catch(e){results.push({file,error:e.message});console.log('FAIL',file,e.message);}
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));await context.close();
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});

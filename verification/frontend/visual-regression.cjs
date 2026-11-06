/* Frontend regression: no hosted records are read or changed. */
const fs=require('fs'),path=require('path'),http=require('http');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const root=path.resolve(__dirname,'../..'),out=path.join(__dirname,'visual-regression');fs.mkdirSync(out,{recursive:true});
if(process.env.PGENRO_SCREENSHOT_DIR)fs.mkdirSync(process.env.PGENRO_SCREENSHOT_DIR,{recursive:true});
const pages=['admin','User','SettingIMS','VisitorsLog'].flatMap(folder=>fs.readdirSync(path.join(root,folder)).filter(n=>n.endsWith('.html')).sort().map(n=>folder+'/'+n));
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
function measure(){
 const rgb=s=>{const m=s.match(/[\d.]+/g)?.map(Number);return m?.length>=3?[...m.slice(0,3),m[3]??1]:[0,0,0,0];};
 const blend=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3]));
 const lum=c=>c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 const sel=e=>e.id?'#'+e.id:e.tagName.toLowerCase()+'.'+[...e.classList].slice(0,3).join('.');
 const backgrounds=e=>{const chain=[];for(let p=e;p;p=p.parentElement)chain.unshift(p);let bs=[[255,255,255]];for(const p of chain){const s=getComputedStyle(p),c=rgb(s.backgroundColor);bs=c[3]===1?[c.slice(0,3)]:bs.map(b=>blend(c,b));if(s.backgroundImage!=='none'){const cs=[...s.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map(m=>rgb(m[0]));if(cs.length)bs=bs.flatMap(b=>cs.map(c=>blend(c,b))).slice(0,12);}}return bs;};
 const contrast=[],seen=new Set(),walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 for(let n;n=walk.nextNode();){const e=n.parentElement,text=n.textContent.trim();if(!text||e.closest('svg,script,style,option,[aria-hidden=true],.sr-only,.visually-hidden,:disabled'))continue;
  const r=e.getBoundingClientRect(),s=getComputedStyle(e);if(!e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})||r.width<2||r.height<2||r.right<0||r.left>innerWidth)continue;
  const fg=rgb(s.color),ratios=backgrounds(e).map(b=>{const a=lum(blend(fg,b)),v=lum(b);return(Math.max(a,v)+.05)/(Math.min(a,v)+.05);}),ratio=Math.min(...ratios),size=parseFloat(s.fontSize),weight=+s.fontWeight||400,min=size>=24||size>=18.66&&weight>=700?3:4.5;
  const key=sel(e)+'|'+s.color;if(ratio<min-.05&&!seen.has(key)){seen.add(key);contrast.push({selector:sel(e),text:text.slice(0,80),ratio:+ratio.toFixed(2),min,color:s.color,backgrounds:backgrounds(e),gradient:e.closest('.kpi-card,.analytics-metric,.modern-dashboard-hero')?.className});}
 }
 const icons=[];for(const e of document.querySelectorAll('.ui-affixed-control')){const icon=e.querySelector(':scope>.ui-field-icon'),input=e.querySelector(':scope>input');if(!icon||!input||!input.checkVisibility())continue;const a=icon.getBoundingClientRect(),b=input.getBoundingClientRect(),delta=Math.abs(a.top+a.height/2-b.top-b.height/2);if(delta>2)icons.push({selector:sel(e),delta,parent:e.getBoundingClientRect().toJSON(),input:b.toJSON(),icon:a.toJSON(),inputStyles:{margin:getComputedStyle(input).margin,transform:getComputedStyle(input).transform},parentStyles:{height:getComputedStyle(e).height,padding:getComputedStyle(e).padding,display:getComputedStyle(e).display}});}
 const clipped=[];for(const e of document.querySelectorAll('button,.viewer-toolbar,label,.tab-btn,.stock-summary,.user-shortcuts')){if(!e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))continue;const s=getComputedStyle(e);if(e.clientWidth>2&&e.scrollWidth>e.clientWidth+3&&!['auto','scroll'].includes(s.overflowX)&&s.textOverflow!=='ellipsis')clipped.push({selector:sel(e),text:e.textContent.trim().slice(0,65),width:e.clientWidth,scroll:e.scrollWidth});}
 const oversized=[...document.querySelectorAll('select:not([multiple])')].filter(e=>e.checkVisibility()&&(!e.size||e.size===1)&&e.getBoundingClientRect().height>64).map(e=>({selector:sel(e),height:e.getBoundingClientRect().height}));
 const geometry=[];
 const stock=document.querySelector('#mainContent td.stock-cell');
 if(stock&&innerWidth>700&&getComputedStyle(stock).display!=='table-cell')geometry.push('Stock balance breaks table row alignment');
 const shortcuts=document.querySelector('.user-shortcuts');
 if(shortcuts&&parseFloat(getComputedStyle(shortcuts).paddingLeft)<16)geometry.push('Dashboard shortcuts have no inner spacing');
 const empty=document.querySelector('#movementBody .modern-empty-state p');
 if(empty){const range=document.createRange();range.selectNodeContents(empty);const r=range.getBoundingClientRect();if(r.left<0||r.right>innerWidth)geometry.push('Empty movement message is outside the viewport');}
 return {theme:document.documentElement.dataset.theme,width:innerWidth,contrast,icons,clipped,oversized,geometry};
}
let browser;const results=[],errors=[],missing=[],redirects=[];
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
browser=await chromium.launch({headless:true,executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,args:process.env.PGENRO_CHROMIUM_ARGS?JSON.parse(process.env.PGENRO_CHROMIUM_ARGS):['--no-sandbox','--disable-dev-shm-usage']});
for(const file of pages){const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.addInitScript(fs.readFileSync(root+'/verification/ui/mock-sdk.js','utf8'));await context.addInitScript(()=>{localStorage.setItem('pgenro_user_theme','light');localStorage.setItem('pgenro_admin_theme','light');});
await context.route('**/*',route=>{const u=route.request().url();if(u.startsWith(base))return route.continue();if(u.includes('lucide'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(root+'/User/vendor/lucide/lucide.min.js')});return route.fulfill({contentType:u.includes('fonts.')?'text/css':'text/javascript',body:''});});
const page=await context.newPage();page.on('pageerror',e=>errors.push(file+': '+e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()===404)missing.push(new URL(r.url()).pathname);});page.on('dialog',d=>d.dismiss());await page.goto(base+'/'+file,{waitUntil:'networkidle'});
for(const theme of ['light','dark']){await page.evaluate(t=>{if(window.PGENRO_UserTheme)window.PGENRO_UserTheme.set(t);else{document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}},theme);await page.waitForTimeout(260);
for(const width of [1440,1024,768,390,320]){await page.setViewportSize({width,height:1000});const r={file,...await page.evaluate(measure)};results.push(r);if(r.contrast.length||r.icons.length||r.clipped.length||r.oversized.length||r.geometry.length)console.log(JSON.stringify(r));if(process.env.PGENRO_SCREENSHOT_DIR&&[1440,390].includes(width))await page.screenshot({path:path.join(process.env.PGENRO_SCREENSHOT_DIR,file.replaceAll('/','-')+'-'+theme+'-'+width+'.png'),fullPage:true});}}
await context.close();fs.writeFileSync(out+'/scenarios.json',JSON.stringify(results,null,2));}
for(const [folder,target] of [['User/admin','admin'],['User/User','User']]){
 const context=await browser.newContext({reducedMotion:'reduce'});
 await context.addInitScript(fs.readFileSync(root+'/verification/ui/mock-sdk.js','utf8'));
 // The sign-in page normally forwards an approved signed-in account to its
 // dashboard. Check the legacy login bookmark as a signed-out visitor.
 await context.addInitScript(()=>{if(location.pathname.endsWith('/login.html'))sessionStorage.setItem('qa_signed_out','true');else sessionStorage.removeItem('qa_signed_out');});
 await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.fulfill({contentType:'text/javascript',body:''}));
 for(const file of fs.readdirSync(path.join(root,folder)).filter(n=>n.endsWith('.html'))){
  const page=await context.newPage(),expected='/'+target+'/'+file;
  await page.goto(base+'/'+folder+'/'+file+'?qa=legacy#qa-navigation',{waitUntil:'networkidle'});
  if(new URL(page.url()).pathname!==expected)console.log(JSON.stringify({legacy:folder+'/'+file,expected,actual:page.url()}));
  await page.waitForURL(u=>u.pathname===expected,{timeout:5000});
  const actual=new URL(page.url());
  if(actual.search!=='?qa=legacy'||actual.hash!=='#qa-navigation')throw new Error('Legacy bookmark lost its query/hash: '+folder+'/'+file);
  redirects.push({file:folder+'/'+file,target:expected,result:'PASS'});await page.close();
 }
 await context.close();
}
const passed=results.every(r=>!r.contrast.length&&!r.icons.length&&!r.clipped.length&&!r.oversized.length&&!r.geometry.length)&&!errors.length&&!missing.length;
const report={passed,method:'Actual Chromium; production frontend; local fixture Auth/database; computed solid and gradient-stop contrast, control geometry and legacy navigation',pages:pages.length,appearances:['light','dark'],widths:[1440,1024,768,390,320],scenarios:results.length,redirects,errors,missing,results};
fs.writeFileSync(out+'/results.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({passed,pages:pages.length,scenarios:results.length,legacyRedirects:redirects.length,errors,missing}));
if(!passed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});

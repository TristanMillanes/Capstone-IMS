const fs=require('fs'),path=require('path'),http=require('http');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright' : 'playwright');
const root=path.resolve(__dirname,'../..'),label=process.argv[2]||'baseline';
const pages=[];
for(const folder of ['admin','User','SettingIMS','VisitorsLog'])for(const filename of fs.readdirSync(path.join(root,folder)))if(/\.html$/i.test(filename))pages.push(folder+'/'+filename);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'};
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost'),filename=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404);return res.end('Not found');}res.setHeader('Content-Type',mime[path.extname(filename).toLowerCase()]||'application/octet-stream');res.end(fs.readFileSync(filename));});
let browser;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
 const results=[];
 for(const filename of pages){
  const context=await browser.newContext({viewport:{width:1440,height:980},reducedMotion:'reduce'});
  const errors=[],missing=[];
  await context.route('**/*',async route=>{
   const url=route.request().url();
   if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'mock-sdk.js'),'utf8')});
   if(url.includes('lucide@'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || path.resolve(__dirname,'node_modules'),'lucide/dist/umd/lucide.min.js'),'utf8')});
   if(url.includes('chart.js@'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'chart.umd.min.js'),'utf8')});
   if(url.startsWith('http://127.0.0.1:'+port))return route.continue();
   return route.fulfill({status:200,body:'',contentType:url.includes('fonts.')?'text/css':'text/javascript'});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()===404)missing.push(new URL(r.url()).pathname)});page.on('dialog',d=>d.dismiss());
  await page.goto('http://127.0.0.1:'+port+'/'+filename);await page.waitForTimeout(650);
  const layouts=[];
  for(const width of [1440,1024,768,390,320]){
   await page.setViewportSize({width,height:980});await page.waitForTimeout(70);
   layouts.push(await page.evaluate(()=>{
    const rect=sel=>{const el=document.querySelector(sel);if(!el)return null;const r=el.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};};
    const overflow=[...document.querySelectorAll('main *')].filter(el=>el.getClientRects().length&&getComputedStyle(el).position!=='fixed').filter(el=>{const r=el.getBoundingClientRect();let right=r.right,left=r.left;for(let p=el.parentElement;p;p=p.parentElement){if(/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)){const clip=p.getBoundingClientRect();right=Math.min(right,clip.right);left=Math.max(left,clip.left);}}return right>innerWidth+1||left< -1}).map(el=>({tag:el.tagName,id:el.id,class:typeof el.className==='string'?el.className:'svg',right:Math.round(el.getBoundingClientRect().right)}));
    return {width:innerWidth,pageWidth:document.documentElement.scrollWidth,sidebar:rect('.sidebar'),main:rect('.main-content'),topbar:rect('.topbar'),overflow:overflow.slice(0,12),unrenderedIcons:document.querySelectorAll('i[data-lucide]').length};
   }));
   if([1440,390].includes(width))await page.screenshot({path:path.join(__dirname,label+'-'+filename.replaceAll('/','-')+'-'+width+'.png'),fullPage:width===1440,animations:'disabled'});
  }
  results.push({page:filename,url:new URL(page.url()).pathname,errors,missing:[...new Set(missing)],layouts});
  console.log(filename,'errors:',errors.join(' | ')||'none','missing:',[...new Set(missing)].join(',')||'none','overflow:',layouts.filter(x=>x.pageWidth>x.width||x.overflow.length).map(x=>x.width).join(',')||'none');
  await context.close();
 }
 fs.writeFileSync(path.join(__dirname,label+'-browser.json'),JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});

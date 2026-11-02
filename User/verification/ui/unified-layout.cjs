/* Actual application pages, real Chart.js, simulated Supabase, no live writes. */
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium: playwright } = require('playwright');

const root = path.resolve(__dirname, '../..');
const out = path.resolve(__dirname, 'unified-results'); fs.mkdirSync(out, {recursive:true});
const mode = process.argv[2] || 'verified';
const pages = ['admin','User','SettingIMS','VisitorsLog'].flatMap(folder => fs.readdirSync(path.join(root, folder)).filter(f=>f.endsWith('.html')).map(f=>folder+'/'+f));
const report = {mode, method:'Chromium, production HTML/CSS/JS, real Chart.js, simulated Supabase only', pages:[], errors:[]};
const server = http.createServer((req,res)=>{
  const file = path.resolve(root, '.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.pdf':'application/pdf','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'})[path.extname(file)]||'application/octet-stream');
  res.end(fs.readFileSync(file));
});
function snapshot(){
  const visible = el => el.getClientRects().length && getComputedStyle(el).display!=='none' && getComputedStyle(el).visibility!=='hidden' && !el.closest('[hidden]');
  const name = el => el.tagName.toLowerCase()+(el.id?'#'+el.id:'.'+String(el.className).split(' ').slice(0,2).join('.'));
  const rect = el => {const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
  const isClipped = el => {for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p);if(['auto','scroll','hidden','clip'].includes(s.overflowX))return true;}return false;};
  const outside=[...document.querySelectorAll('main *,header *,form *')].filter(el=>visible(el)&&el.tagName!=='OPTION'&&!el.closest('.sidebar,.icon-definitions,svg,.pdf-preview,.document-preview,.canvas-preview')).map(el=>({el,r:rect(el)})).filter(({el,r})=>r.w>0&&(r.x < -1||r.right>innerWidth+1)&&!isClipped(el)).map(({el,r})=>({name:name(el),...r}));
  const overlaps=[];
  for(const sel of ['.topbar','.topbar-left','.topbar-right','.depth-user-topbar','.header-actions','.filter-bar','.toolbar','.table-toolbar','.records-header','.stats-grid','.kpi-grid','.analytics-grid','.dashboard-charts-grid','.form-grid','.input-group','.registry-page-controls']){
    for(const parent of document.querySelectorAll(sel)){
      const children=[...parent.children].filter(el=>visible(el)&&getComputedStyle(el).position!=='absolute'&&getComputedStyle(el).position!=='fixed');
      for(let i=0;i<children.length;i++)for(let j=i+1;j<children.length;j++){
        const a=rect(children[i]),b=rect(children[j]);
        if(Math.min(a.right,b.right)-Math.max(a.x,b.x)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>2)overlaps.push({parent:name(parent),a:name(children[i]),b:name(children[j])});
      }
    }
  }
  const charts=[...document.querySelectorAll('canvas')].filter(el=>visible(el)&&!el.id.toLowerCase().includes('pdf')).map(el=>{
    const r=rect(el),p=rect(el.parentElement),c=window.Chart?.getChart?.(el);return {id:el.id,r,p,instance:!!c,fit:r.w>0&&r.h>0&&r.x>=p.x-1&&r.y>=p.y-1&&r.right<=p.right+1&&r.bottom<=p.bottom+1};
  });
  return {width:innerWidth,scroll:document.documentElement.scrollWidth,outside:outside.slice(0,12),overlaps,charts,duplicateIds:[...document.querySelectorAll('[id]')].map(e=>e.id).filter((id,i,arr)=>arr.indexOf(id)!==i)};
}
let browser;
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  browser=await playwright.launch({headless:true,executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Manila',reducedMotion:'reduce'});
  const sdk=fs.readFileSync(path.join(root,'verification/ui/mock-sdk.js'),'utf8').replace("const session=()=>sessionStorage", "const session=()=>location.pathname.endsWith('/login.html')?null:sessionStorage");
  await context.route('**/*',route=>{
    const url=route.request().url();
    if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:sdk});
    if(url.includes('chart.js'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'verification/ui/chart.umd.min.js'))});
    if(url.includes('lucide@'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(path.dirname(require.resolve('lucide')),'../umd/lucide.min.js'))});
    if(url.startsWith('http://127.0.0.1:'+port))return route.continue();
    return route.fulfill({contentType:url.includes('fonts.')?'text/css':'text/javascript',body:''});
  });
  const page=await context.newPage();let current='';page.on('pageerror',e=>report.errors.push({file:current,error:e.message}));
  for(const file of pages){
    current=file;
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(`http://127.0.0.1:${port}/${file}`,{waitUntil:'load'});
    await page.waitForTimeout(350);
    const item={file,url:page.url(),views:[],dialogs:[]};
    for(const width of (mode==='baseline'?[1440,390]:[1440,1024,768,390,320])){
      await page.setViewportSize({width,height:1000});await page.waitForTimeout(110);
      item.views.push(await page.evaluate(snapshot));
      if([1440,390].includes(width))await page.screenshot({path:path.join(out,`${mode}-${file.replaceAll('/','-')}-${width}.png`),animations:'disabled'});
    }
    if(mode!=='baseline'){
      const menu=page.locator(file.startsWith('admin/')?'#mobileMenuBtn':'#hamburgerMenu');
      if(await menu.isVisible()){
        await menu.click();await page.waitForTimeout(150);item.mobileMenu=await page.locator('#sidebar').evaluate(el=>{const r=el.getBoundingClientRect();return {fits:r.x>=-1&&r.right<=innerWidth+1,visible:getComputedStyle(el).visibility!=='hidden',expanded:document.querySelector('#mobileMenuBtn,#hamburgerMenu')?.getAttribute('aria-expanded')}});await page.keyboard.press('Escape');
      }
      await page.setViewportSize({width:1440,height:1000});
      const selector=file.startsWith('admin/')?'#addEmployeeBtn,#addItemBtn,#addVisitorBtn,#addIcsBtn,#addOrderBtn,#openAddUserModalBtn,#openCreateModalBtn,#btnNewRecord,#openEncodingModalBtn':'tbody button[data-action="view"],tbody .view-btn,tbody .btn-view,tbody button[title*="View"]';
      for(const loc of await page.locator(selector).all()){
        if(!await loc.isVisible()||await loc.isDisabled()||await loc.getAttribute('id')==='viewModal')continue;
        await loc.click();await page.waitForTimeout(100);
        const dialog=page.locator('.modal-overlay.open,.modal-backdrop.open,.admin-modal.open,dialog[open],.modal.open').first();
        if(await dialog.isVisible()){
          for(const width of [1440,390,320]){
            await page.setViewportSize({width,height:844});await page.waitForTimeout(70);
            item.dialogs.push({width,geometry:await page.evaluate(snapshot)});
            if(width===390)await page.screenshot({path:path.join(out,`${mode}-form-${file.replaceAll('/','-')}-${width}.png`),animations:'disabled'});
          }
          await page.keyboard.press('Escape');
        }
        break;
      }
    }
    for(const view of item.views){
      if(view.scroll>view.width+1||view.outside.length||view.overlaps.length||view.duplicateIds.length||view.charts.some(chart=>!chart.fit||!chart.instance))throw Error(file+' has a layout failure at '+view.width);
    }
    for(const dialog of item.dialogs)if(dialog.geometry.outside.length||dialog.geometry.overlaps.length)throw Error(file+' dialog has a layout failure');
    if(item.mobileMenu&&!item.mobileMenu.fits)throw Error(file+' menu is outside the viewport');
    if(!item.url.split('#')[0].endsWith(file))throw Error(file+' redirected unexpectedly');
    report.pages.push(item);
    console.log(file,JSON.stringify({overlaps:item.views.flatMap(v=>v.overlaps),outside:item.views.flatMap(v=>v.outside).slice(0,3),charts:item.views.flatMap(v=>v.charts.filter(c=>!c.fit)),duplicates:item.views[0].duplicateIds}));
  }
  if(report.errors.length)throw Error(JSON.stringify(report.errors));report.passed=true;
})().catch(e=>{report.failure=e.stack;process.exitCode=1;console.error(e);}).finally(async()=>{fs.writeFileSync(path.join(out,`${mode}-results.json`),JSON.stringify(report,null,2));await browser?.close();server.close();});

const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const {chromium:pw}=require('playwright');
const root=path.resolve(__dirname,'../..'),out=path.join(__dirname,'unified-results');
const report={method:'Actual Chromium, real Chart.js, production scripts, simulated Supabase only',checks:[],errors:[]};
fs.mkdirSync(out,{recursive:true});
let browser,port;
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
const sdk=fs.readFileSync(path.join(root,'verification/ui/mock-sdk.js'),'utf8');
async function open(file,options={}){
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:options.timezone||'Asia/Manila',reducedMotion:'reduce',acceptDownloads:true});
 await context.route('**/*',route=>{
  const url=route.request().url();
  if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:sdk});
  if((url.includes('chart.js')||url.endsWith('/vendor/chart.umd.min.js')))return route.fulfill({contentType:'text/javascript',body:options.noChart?'':fs.readFileSync(path.join(root,'verification/ui/chart.umd.min.js'))});
  if(url.includes('lucide@'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(path.dirname(require.resolve('lucide')),'../umd/lucide.min.js'))});
  if(url.startsWith('http://127.0.0.1:'+port))return route.continue();
  return route.fulfill({contentType:url.includes('fonts.')?'text/css':'text/javascript',body:''});
 });
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push({file,error:e.message}));await page.goto(`http://127.0.0.1:${port}/${file}`);await page.waitForTimeout(300);return {page,context};
}
function pass(name){report.checks.push({name,result:'PASS'});console.log('PASS',name);}
async function charts(page,ids){
 return page.evaluate(ids=>ids.map(id=>{
   const c=Chart.getChart(id),el=document.getElementById(id),r=el.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect();
   return {id,instance:c.id,width:r.width,height:r.height,onlyCanvas:el.parentElement.children.length===1,fits:r.x>=p.x-1&&r.right<=p.right+1&&r.y>=p.y-1&&r.bottom<=p.bottom+1,area:c.chartArea,legend:(c.legend?.legendHitBoxes||[]).every(b=>b.left>=-1&&b.top>=-1&&b.left+b.width<=c.width+1&&b.top+b.height<=c.height+1),total:c.data.datasets.reduce((sum,d)=>sum+d.data.reduce((a,v)=>a+(Number(v)||0),0),0)};
 }),ids);
}
function assertCharts(items){for(const c of items){assert(c.width>100&&c.height>180,c.id+' dimensions');assert(c.fits&&c.onlyCanvas,c.id+' isolated canvas parent');assert(c.legend,c.id+' legend bounds');assert(c.area.bottom>c.area.top,c.id+' plot has height');}}
async function bounds(locator){return locator.evaluate(el=>{const r=el.getBoundingClientRect();return {fits:r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1,width:r.width,height:r.height};});}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;
 browser=await pw.launch({executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});
 for(const [file,ids,range] of [['admin/admin.html',['monthlyChart','categoryChart','statusChart','personnelChart','commChart'],'#analyticsPeriod'],['User/homepage.html',['commCompareChart','operationsDistChart'],'#dashboardChartRange']]){
   const {page}=await open(file);await page.waitForFunction(ids=>ids.every(id=>window.Chart?.getChart(id)),ids);
   const before=await charts(page,ids);assertCharts(before);
   const period=page.locator(range);assert.equal(await period.count(),1);{
     await period.selectOption('30');await page.waitForTimeout(200);assert.deepEqual((await charts(page,ids)).map(c=>c.instance),before.map(c=>c.instance));
     await period.selectOption(file.startsWith('admin')?'all':'365');await page.waitForTimeout(200);assertCharts(await charts(page,ids));
   }
   await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.waitForTimeout(200);
   const theme=await page.evaluate(id=>({surface:getComputedStyle(document.body).getPropertyValue('--bg-surface').trim(),legend:Chart.getChart(id).options.plugins.legend.labels.color}),ids[0]);assert.equal(theme.surface,'#142c23');assert(theme.legend&&theme.legend!=='#718379','theme updates chart legend');
   for(const width of [768,390,320]){await page.setViewportSize({width,height:844});await page.waitForTimeout(150);assertCharts(await charts(page,ids));}
   await page.locator('#'+ids[0]).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,file.startsWith('admin')?'admin-charts-mobile.png':'user-charts-mobile.png'),animations:'disabled'});
   pass(file+' chart containers, legends, period reuse, dark mode and 320–1440 px sizes');
   if(file.startsWith('admin')){
     const prior=await page.evaluate(()=>Chart.getChart('commChart').data.datasets[0].data.reduce((s,v)=>s+v,0));
     await page.evaluate(()=>{for(let i=0;i<12;i++)window.__db.communications.push({id:'burst-'+i,data:{date:'2026-10-11',type:'Incoming',status:'Pending'}});for(let i=0;i<24;i++)for(const ch of window.__channels)if(ch.table==='communications')ch.callback?.({eventType:'INSERT'});});
     await page.waitForFunction(prior=>Chart.getChart('commChart').data.datasets[0].data.reduce((s,v)=>s+v,0)===prior+12,prior);
     assert.deepEqual((await charts(page,ids)).map(c=>c.instance),before.map(c=>c.instance));pass('Dashboard realtime bursts update existing chart instances');
   }
 }
 for(const [file,selector,count]of [['admin/admin.html','.native-chart',5],['User/homepage.html','.homepage-chart-fallback',2]]){
   const {page}=await open(file,{noChart:true});await page.locator(selector).first().waitFor({state:'visible'});assert.equal(await page.locator(selector).count(),count);await page.setViewportSize({width:320,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);pass(file+' renders a native fallback when Chart.js is unavailable');
 }
 {
   const {page}=await open('admin/backup-admin.html');
   await page.evaluate(()=>{localStorage.setItem('pgenro_communications',JSON.stringify([{controlNo:'BACKUP-TEST',subject:'Fixture'}]));localStorage.setItem('sb-secret-auth-token','do-not-export');localStorage.setItem('pgenro_current_user',JSON.stringify({id:'keep-session',role:'Admin'}));});
   await page.locator('#refreshBackupBtn').click();
   const download=page.waitForEvent('download');await page.locator('#downloadLocalBackupBtn').click();const d=await download;
   const backup=JSON.parse(fs.readFileSync(await d.path(),'utf8'));assert.equal(backup.meta.system,'PGENRO IMS');assert(backup.storage.pgenro_communications);assert(!('sb-secret-auth-token'in backup.storage));assert(!('pgenro_current_user'in backup.storage));
   pass('Backup export includes workspace data and excludes session keys');
   const data={meta:{system:'PGENRO IMS',exportedAt:'2026-10-11T03:00:00Z'},storage:{pgenro_communications:JSON.stringify([{controlNo:'RESTORED-FIXTURE'}]),pgenro_current_user:'overwrite-attempt','sb-secret-auth-token':'overwrite-attempt'}};
   await page.locator('#restoreBackupInput').setInputFiles({name:'a-long-backup-filename-for-responsive-review-2026.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
   await page.locator('#backupReviewModal').waitFor({state:'visible'});assert.equal(await page.locator('#backupRestoreKeys').textContent(),'1');assert.equal(await page.locator('#backupIgnoredKeys').textContent(),'2');
   for(const width of [1440,390,320]){await page.setViewportSize({width,height:844});const b=await bounds(page.locator('#backupReviewModal .modal-container'));assert(b.fits,'backup review fits '+width);}
   await page.screenshot({path:path.join(out,'backup-review-mobile.png'),animations:'disabled'});
   await page.locator('#backupReviewCancel').click();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pgenro_communications'))[0].controlNo),'BACKUP-TEST');
   await page.locator('#restoreBackupInput').setInputFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await page.locator('#confirmRestoreBtn').click();await page.locator('#backupReviewModal').waitFor({state:'hidden'});
   const restored=await page.evaluate(()=>({record:JSON.parse(localStorage.getItem('pgenro_communications'))[0].controlNo,user:JSON.parse(localStorage.getItem('pgenro_current_user')).id,token:localStorage.getItem('sb-secret-auth-token'),cloudWrites:window.__mutations.filter(x=>!['audit_logs','admin_logs'].includes(x.table)).length}));
   assert.equal(restored.record,'RESTORED-FIXTURE');assert.equal(restored.user,'keep-session');assert.equal(restored.token,'do-not-export');assert.equal(restored.cloudWrites,0);
   await page.locator('#restoreBackupInput').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{broken')});await page.locator('#backupError').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pgenro_communications'))[0].controlNo),'RESTORED-FIXTURE');
   pass('Backup review fits mobile; cancel, restore and invalid JSON preserve the expected data');
   await page.evaluate(()=>{const original=Storage.prototype.setItem;let fail=true;Storage.prototype.setItem=function(key,value){if(key==='officeMemos'&&fail){fail=false;throw new DOMException('Simulated full storage','QuotaExceededError');}return original.call(this,key,value);};});
   const quota={meta:{system:'PGENRO IMS'},storage:{pgenro_communications:JSON.stringify([{controlNo:'SHOULD-ROLL-BACK'}]),officeMemos:'[]'}};
   await page.locator('#restoreBackupInput').setInputFiles({name:'quota.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(quota))});await page.locator('#confirmRestoreBtn').click();await page.locator('#backupRestoreError').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pgenro_communications'))[0].controlNo),'RESTORED-FIXTURE');await page.locator('#backupReviewCancel').click();pass('Backup restores roll back earlier writes if browser storage fills up');
 }
 for(const hash of ['audit','backup']){
   const {page}=await open('admin/admin.html#'+hash);await page.waitForURL('**/'+(hash==='audit'?'audittrail-admin.html':'backup-admin.html'));pass('Legacy #'+hash+' bookmark redirects to its dedicated module');
 }
 for(const file of ['admin/admincommunication.html','User/communication.html','admin/backup-admin.html','SettingIMS/Settings.html']){
   const {page}=await open(file);const profile=page.locator('#profileBtn');
   if(await profile.count())await profile.click();const logout=page.locator('#logoutBtn,[data-pgenro-logout]').first();await logout.click();
   await page.locator('#workspaceLogoutDialog').waitFor({state:'visible'});await page.setViewportSize({width:320,height:844});assert((await bounds(page.locator('#workspaceLogoutDialog'))).fits);await page.locator('[data-workspace-logout-cancel]').click();assert.equal(await page.evaluate(()=>Number(sessionStorage.getItem('qa_signout_count')||0)),0);
   pass(file+' logout confirmation and cancellation fit mobile');
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
})().catch(e=>{report.passed=false;report.failure=e.stack;console.error(e);process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(out,'workflow-results.json'),JSON.stringify(report,null,2));await browser?.close();server.close();});

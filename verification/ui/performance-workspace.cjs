// Reproducible large-registry benchmark. Mocked data; no production writes.
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const deps = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || path.resolve(__dirname, 'node_modules');
const {chromium} = require(deps + '/playwright');
const root = path.resolve(__dirname, '../..');
const label = process.argv[2] || 'after';
const count = 800;
const report = {method:'Headless Chromium, 4× CPU slowdown, 800 simulated records per registry; no live data',label,results:[]};
const sdk = fs.readFileSync(path.join(__dirname,'mock-sdk.js'),'utf8') + `
  for (const name of ['communications','employees','inventory','office_memos','ics_records','service_requests','travel_orders']) {
    const original = window.__db[name][0];
    window.__db[name] = Array.from({length:${count}}, (_,n) => ({...original,id:name+'-'+n,
      employee_id:'EMP-'+n,first_name:'REQUEST',last_name:'PERSON '+n,item_name:'REQUEST ITEM '+n,
      control_no:'INV-'+n,data:{...original.data,controlNo:'COMM-'+n,serviceNo:'SR-'+n,subject:'REQUEST RECORD '+n,employeeName:'REQUEST PERSON '+n,traveler:'REQUEST PERSON '+n,article:'REQUEST ITEM '+n,clientName:'REQUEST PERSON '+n,requesterName:'REQUEST PERSON '+n}}));
  }
`;
const server = http.createServer((req,res)=>{
  const file = path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');
  res.end(fs.readFileSync(file));
});
let browser;
const fields = ['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'];
async function metrics(cdp){const r=await cdp.send('Performance.getMetrics');return Object.fromEntries(r.metrics.filter(x=>fields.includes(x.name)).map(x=>[x.name,x.value]));}
function delta(before,after){return Object.fromEntries(fields.map(k=>[k,Math.round((after[k]-before[k])*(k.endsWith('Duration')?1000:1)*10)/10]));}
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
  for(const file of ['User/communication.html','User/inventory.html','User/employee.html','User/ics.html','User/service.html','User/officememo.html','User/travelOR.html','admin/admin.html','User/homepage.html']){
    const context=await browser.newContext({viewport:{width:1440,height:980},reducedMotion:'no-preference'});
    await context.route('**/*',route=>{
      const url=route.request().url();
      if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:sdk});
      if(url.includes('lucide@'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(deps,'lucide/dist/umd/lucide.min.js'))});
      if(url.includes('chart.js'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'chart.umd.min.js'))});
      if(url.startsWith('http://127.0.0.1:'+port))return route.continue();
      return route.fulfill({contentType:url.includes('fonts.')?'text/css':'text/javascript',body:''});
    });
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await cdp.send('Performance.enable');
    await page.goto(`http://127.0.0.1:${port}/${file}`);
    await page.waitForFunction(()=>document.body.dataset.depthReady==='true');
    await page.waitForTimeout(1200);
    const initialRows=await page.locator('main tbody tr').count();
    const beforeIdle=await metrics(cdp);await page.waitForTimeout(1200);const idle=delta(beforeIdle,await metrics(cdp));
    await page.evaluate(()=>{
      window.__perf={svgChanges:0,longTasks:[]};
      const sidebar=document.getElementById('sidebar');
      new MutationObserver(changes=>window.__perf.svgChanges+=changes.reduce((n,c)=>n+[...c.removedNodes].filter(e=>e.nodeName==='svg').length,0)).observe(sidebar,{childList:true,subtree:true});
      new PerformanceObserver(list=>window.__perf.longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask'});
    });
    const search=page.locator('#searchInput, #search, #tableSearchInput').first();let typing=null;
    if(await search.count()){
      const before=await metrics(cdp);const start=Date.now();
      await search.pressSequentially('REQUEST',{delay:12});await page.waitForTimeout(250);
      typing={elapsedMs:Date.now()-start,...delta(before,await metrics(cdp))};
    }
    const details=await page.evaluate(()=>({
      ...window.__perf,
      activeInfiniteAnimations:document.getAnimations().filter(a=>a.effect.getTiming().iterations===Infinity&&a.playState==='running').length,
      registryRows:document.querySelectorAll('main tbody tr').length,
      pagination:document.querySelector('.registry-pagination')?.textContent.trim()||null
    }));
    const result={file,initialRows,idle,typing,...details,errors};report.results.push(result);
    console.log(file,JSON.stringify(result));
    assert.deepEqual(errors,[],file+' browser errors');
    if(label!=='before' && !file.includes('homepage')&&!file.includes('admin.html')){
      assert(initialRows<=25,file+' renders at most one 25-row page');
      assert.equal(details.svgChanges,0,file+' preserves sidebar icons while typing');
      assert(details.pagination?.includes('800'),file+' keeps all matching records reachable');
      const firstRow=await page.locator('main tbody tr').first().textContent();
      await page.locator('.registry-pagination [data-page="next"]').click();
      assert.notEqual(await page.locator('main tbody tr').first().textContent(),firstRow,file+' next page contains different records');
      assert((await page.locator('.registry-pagination').textContent()).includes('26–50'),file+' next page shows correct range');
      const button=page.locator('main tbody tr').first().locator('button').first();
      const modalId={
        'User/communication.html':'viewModal', 'User/employee.html':'profileModal',
        'User/ics.html':'viewDetailsModal', 'User/service.html':'inspectModal',
        'User/officememo.html':'viewMemoModal'
      }[file];
      if(modalId && await button.count()){
        const code=(await page.locator('main tbody tr').first().locator('td').first().innerText()).trim().split(/\s+/)[0];
        await button.click();
        await page.locator('#'+modalId).waitFor({state:'visible'});
        assert((await page.locator('#'+modalId).textContent()).includes(code),file+' opens the selected second-page record');
        await page.keyboard.press('Escape');await page.locator('#'+modalId).waitFor({state:'hidden'});
      }
      await page.locator('.registry-pagination [data-page="last"]').click();
      assert((await page.locator('.registry-pagination').textContent()).includes('776–800'),file+' last page remains reachable');
      if(await search.count()){
        await search.fill('NO MATCHING RECORD');await page.waitForTimeout(160);
        assert.equal(await page.locator('main tbody tr').count(),1,file+' empty search renders the empty state');
        assert(await page.locator('.registry-pagination').isHidden(),file+' hides pagination for an empty search');
        await search.fill('REQUEST');await page.waitForTimeout(160);
        assert((await page.locator('.registry-pagination').textContent()).includes('1–25'),file+' changed search resets page one');
      }
      const totalMutations=await page.evaluate(()=>window.__mutations.length);
      assert.equal(totalMutations,0,file+' remains read only');
      await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
      assert.equal(await page.locator('main tbody tr').count(),800,file+' print renders the complete filtered registry');
      await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
      assert.equal(await page.locator('main tbody tr').count(),25,file+' print cleanup restores pagination');
      if(file==='User/communication.html'){
        await page.screenshot({path:path.join(__dirname,'modern-smooth-large-registry-1440.png'),animations:'disabled'});
        await page.setViewportSize({width:390,height:844});
        await page.locator('.registry-pagination').scrollIntoViewIfNeeded();
        const width=await page.evaluate(()=>document.documentElement.scrollWidth);
        assert(width<=390,'large registry fits the mobile viewport');
        await page.screenshot({path:path.join(__dirname,'modern-smooth-large-registry-390.png'),animations:'disabled'});
      }
    }
    await context.close();
  }
  report.passed=true;
})().catch(e=>{report.passed=false;report.failure=e.message;console.error(e);process.exitCode=1;}).finally(async()=>{
  fs.writeFileSync(path.join(__dirname,'performance-'+label+'.json'),JSON.stringify(report,null,2));await browser?.close();server.close();
});

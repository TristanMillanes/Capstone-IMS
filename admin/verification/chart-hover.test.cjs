// Actual mouse/touch interaction checks. No production service is contacted.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');
const {installFixture}=require('./navigation-charts.test.cjs');
const root=path.resolve(__dirname,'../..'),results=[];
const ids=['monthlyChart','statusChart','personnelChart','categoryChart','commChart'];
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

// CSS pixels are converted through the displayed canvas, independently of DPR.
async function targetFor(page,id,index=0,fraction=.5,dataset=0) {
  return page.evaluate(({id,index,fraction,dataset})=>{
    const chart=Chart.getChart(id),el=chart.getDatasetMeta(dataset).data[index],rect=chart.canvas.getBoundingClientRect();
    const point=el.getCenterPoint();
    if(chart.config.type==='bar')point.x=el.base+(el.x-el.base)*fraction;
    if(chart.config.type==='doughnut') {
      const angle=el.startAngle+(el.endAngle-el.startAngle)*fraction,radius=(el.innerRadius+el.outerRadius)/2;
      point.x=el.x+Math.cos(angle)*radius;point.y=el.y+Math.sin(angle)*radius;
    }
    return {x:rect.left+point.x*rect.width/chart.width,y:rect.top+point.y*rect.height/chart.height,index,
      title:chart.data.labels[index],value:chart.data.datasets[dataset].data[index],rect:rect.toJSON()};
  },{id,index,fraction,dataset});
}

async function inspectPointer(page,id,target,{touch=false}={}) {
  if(touch) await page.touchscreen.tap(target.x,target.y);
  else await page.mouse.move(target.x,target.y);
  await frames(page);
  const result=await page.evaluate(({id,x,y})=>{
    const chart=Chart.getChart(id),tooltip=chart.tooltip,rect=chart.canvas.getBoundingClientRect();
    const node=document.getElementById('analyticsPointerTooltip'),bounds=node?.getBoundingClientRect();
    const rows=[...node?.querySelectorAll('.analytics-tooltip-row')||[]].map(row=>({label:row.querySelector('span').textContent,value:row.querySelector('strong').textContent}));
    return {visible:!!node&&!node.hidden,tooltip:bounds?.toJSON(),title:node?.querySelector('.analytics-tooltip-title')?.textContent,
      rows,canvas:rect.toJSON(),scrollWidth:node?.scrollWidth,clientWidth:node?.clientWidth,point:{x:rect.left+tooltip.caretX*rect.width/chart.width,y:rect.top+tooltip.caretY*rect.height/chart.height},
      active:chart.getActiveElements().map(item=>({index:item.index,dataset:item.datasetIndex})),
      nativeTooltipEnabled:chart.options.plugins.tooltip.enabled,animations:chart.options.plugins.tooltip.animations,
      hit:document.elementFromPoint(x,y)?.id};
  },{id,x:target.x,y:target.y});
  assert(result.visible,`${id}: visible tooltip at ${JSON.stringify({target,result})}`);
  assert.equal(result.hit,id,'Tooltip never captures the pointer or covers the hit target');
  assert(Math.abs(result.point.x-target.x)<=1.2&&Math.abs(result.point.y-target.y)<=1.2,`${id}: tooltip anchor matches pointer ${JSON.stringify({point:result.point,target})}`);
  assert(result.active.length>0&&result.active.every(item=>item.index===target.index),`${id}: the correct item is highlighted`);
  assert.equal(result.title,target.title,`${id}: full untruncated tooltip title`);
  assert.equal(result.nativeTooltipEnabled,false,'Only one tooltip is rendered');
  assert.equal(result.animations,false,'No tooltip animation lag');
  assert.equal(result.rows.length,id==='monthlyChart'?4:1,'Tooltip row count');
  assert(result.scrollWidth<=result.clientWidth+1,'Long names wrap inside the tooltip');
  assert(result.tooltip.left>=7&&result.tooltip.top>=7&&result.tooltip.right<=page.viewportSize().width-7&&result.tooltip.bottom<=page.viewportSize().height-7,'Tooltip remains inside viewport');
  const gapX=Math.max(result.tooltip.left-target.x,0,target.x-result.tooltip.right);
  const gapY=Math.max(result.tooltip.top-target.y,0,target.y-result.tooltip.bottom);
  assert(Math.hypot(gapX,gapY)<=20,'Tooltip stays beside the pointer');
  assert(Math.abs(result.canvas.width-target.rect.width)<.1&&Math.abs(result.canvas.height-target.rect.height)<.1,'Hover does not resize the chart');
  const value=result.rows.find(row=>row.label===(id==='monthlyChart'?'Documents & ICS':id==='personnelChart'?'Personnel':'Records'));
  if(id!=='monthlyChart') assert.equal(Number(value.value.replaceAll(',','')),target.value,'Tooltip uses the hovered value');
  return result;
}

(async()=>{
  const server=require('http').createServer((req,res)=>{
    const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,...(process.env.UI_BROWSER_PATH?{executablePath:process.env.UI_BROWSER_PATH}:{}),args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-zygote']});
  const origin=`http://127.0.0.1:${server.address().port}`;
  async function open(options={}) {
    const context=await browser.newContext({viewport:{width:options.width||1440,height:900},deviceScaleFactor:options.dpr||1,reducedMotion:'no-preference',hasTouch:!!options.touch});
    await context.addInitScript(installFixture,{mode:options.mode||'populated',theme:options.theme||'light'});
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.hostname!=='127.0.0.1'||url.pathname.startsWith('/shared/'))return route.fulfill({status:200,contentType:route.request().resourceType()==='stylesheet'?'text/css':'text/javascript',body:''});
      return route.continue();
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${origin}/admin/admin.html`,{waitUntil:'load'});
    await page.waitForFunction(()=>window.Chart&&Chart.getChart('monthlyChart')?.data.labels.length>0);
    await page.waitForTimeout(250);
    if(options.collapsed){await page.locator('#sidebarCollapseBtn').click();await page.waitForTimeout(250);}
    return {context,page,errors};
  }
  async function prepare(page,id) {
    await page.mouse.move(2,80);
    await page.locator('#'+id).scrollIntoViewIfNeeded();
    await frames(page);
  }
  let pointers=0,maxError=0;
  try{
    for(const config of [
      {width:320,dpr:1},{width:390,dpr:3},{width:768,dpr:2,theme:'dark'},
      {width:1024,dpr:1.25},{width:1440,dpr:1},{width:1440,dpr:2,theme:'dark'},
      {width:1440,dpr:2,collapsed:true},{width:1916,dpr:1.25,collapsed:true}
    ].filter(()=>!process.env.HOVER_ONLY||process.env.HOVER_ONLY==='targets')) {
      const {context,page,errors}=await open(config);
      try{
        for(const id of ids){
          await prepare(page,id);
          const count=await page.evaluate(id=>Chart.getChart(id).data.labels.length,id);
          const targets=[];
          if(id==='monthlyChart')for(let dataset=0;dataset<4;dataset++)targets.push({index:count-1,dataset});
          else for(let index=0;index<count;index++)for(const fraction of [.25,.8])targets.push({index,fraction});
          for(const target of targets){
            const point=await targetFor(page,id,target.index,target.fraction,target.dataset),observed=await inspectPointer(page,id,point);
            maxError=Math.max(maxError,Math.abs(observed.point.x-point.x),Math.abs(observed.point.y-point.y));pointers++;
          }
          await page.mouse.move(2,80);await frames(page);
          assert(await page.locator('#analyticsPointerTooltip').isHidden(),'Leaving the canvas hides the tooltip');
        }
        assert.deepEqual(errors,[]);results.push({...config,scenario:'all chart targets',result:'PASS'});
      } catch(error){error.message=`${JSON.stringify(config)}: ${error.message}`;throw error;}
      finally{await context.close();}
    }
    // Scroll inside a large personnel chart, including near the clip boundary.
    if(!process.env.HOVER_ONLY||process.env.HOVER_ONLY==='scroll') {
      const {context,page,errors}=await open({width:390,dpr:2,mode:'many-divisions'});
      try{
        await page.locator('.analytics-personnel-card').evaluate(el=>el.scrollIntoView({behavior:'instant',block:'start'}));await frames(page);
        for(const index of [0,10,20,39]){
          await page.evaluate(index=>{
            const chart=Chart.getChart('personnelChart'),wrap=chart.canvas.closest('.analytics-chart-wrap');
            wrap.scrollTop=Math.max(0,chart.getDatasetMeta(0).data[index].y-wrap.clientHeight+18);
          },index);await frames(page);
          const point=await targetFor(page,'personnelChart',index,.8);await inspectPointer(page,'personnelChart',point);pointers++;
          if(index===20&&process.env.HOVER_SNAPSHOTS){fs.mkdirSync(process.env.HOVER_SNAPSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.HOVER_SNAPSHOTS,'personnel-scroll-hover.png')});}
          await page.locator('.analytics-personnel-card .analytics-chart-wrap').evaluate(el=>el.scrollTop+=1);await frames(page);
          assert(await page.locator('#analyticsPointerTooltip').isHidden(),'Internal scrolling hides stale tooltip');
        }
        assert.deepEqual(errors,[]);results.push({scenario:'personnel inner scroll and long labels',result:'PASS'});
      }finally{await context.close();}
    }
    // Recalculate coordinates after zoom, sidebar resize and reporting-period changes.
    if(!process.env.HOVER_ONLY||process.env.HOVER_ONLY==='zoom') {
      const {context,page,errors}=await open({width:1440,dpr:1.25,mode:'history'});
      try{
        for(const zoom of [.8,1.25]){
          await page.evaluate(zoom=>document.body.style.zoom=zoom,zoom);await page.waitForTimeout(250);
          await prepare(page,'monthlyChart');
          const count=await page.evaluate(()=>Chart.getChart('monthlyChart').data.labels.length);
          await inspectPointer(page,'monthlyChart',await targetFor(page,'monthlyChart',count-1));pointers++;
        }
        await page.evaluate(()=>document.body.style.zoom='');await page.locator('#sidebarCollapseBtn').click();await page.waitForTimeout(250);
        await prepare(page,'statusChart');await inspectPointer(page,'statusChart',await targetFor(page,'statusChart',2,.8));pointers++;
        await page.locator('#analyticsPeriod').selectOption('30');await page.waitForTimeout(250);await prepare(page,'monthlyChart');
        await inspectPointer(page,'monthlyChart',await targetFor(page,'monthlyChart',29));pointers++;
        assert.deepEqual(errors,[]);results.push({scenario:'CSS zoom, sidebar resize and new period',result:'PASS'});
      }finally{await context.close();}
    }
    if(!process.env.HOVER_ONLY||process.env.HOVER_ONLY==='touch') {
      const {context,page,errors}=await open({width:390,dpr:3,touch:true});
      try{
        await prepare(page,'categoryChart');await inspectPointer(page,'categoryChart',await targetFor(page,'categoryChart',2),{touch:true});pointers++;
        await page.touchscreen.tap(2,80);await frames(page);
        assert(await page.locator('#analyticsPointerTooltip').isHidden(),'Tapping outside dismisses touch selection');
        assert.deepEqual(errors,[]);results.push({scenario:'touch selection',result:'PASS'});
      }finally{await context.close();}
    }
    if(!process.env.HOVER_ONLY) fs.writeFileSync(path.join(__dirname,'chart-hover-results.json'),JSON.stringify({method:'Actual Playwright mouse movements and touch tap in local Chromium with fixture data',pointerTargets:pointers,maxPointerAnchorErrorCssPixels:maxError,scenarios:results},null,2));
    console.log(`${pointers} pointer/touch targets passed in ${results.length} scenarios; max anchor error ${maxError.toFixed(3)} CSS px`);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});

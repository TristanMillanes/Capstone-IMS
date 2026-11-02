// Local fixture checks only: no production sign-in, database, or record writes.
// Run with Playwright installed: node verification/navigation-charts.test.cjs
// Set UI_BROWSER_PATH if Chromium is installed outside Playwright's cache.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const pages = fs.readdirSync(path.join(root, 'admin')).filter(name => name.endsWith('.html')).sort();
const chartIds = ['monthlyChart', 'categoryChart', 'statusChart', 'personnelChart', 'commChart'];
const results = [];

function installFixture({mode = 'populated', theme = 'light'} = {}) {
  const day = offset => {
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const get = type => Number(parts.find(p => p.type === type).value);
    return new Date(Date.UTC(get('year'), get('month') - 1, get('day') + offset)).toISOString().slice(0,10);
  };
  const date = day(0), make = (prefix, count, fields) => Array.from({length:count}, (_,i) => ({id:prefix+i,created_at:date,...fields(i)}));
  const tables = {
    communications: make('c',19,i => ({receivedDate:date,direction:['incoming','outgoing','internal','other'][i%4],subject:'Document '+i,status:'Pending'})),
    office_memos: make('m',11,i => ({memoDate:date,subject:'Memorandum '+i,memoNo:'M-'+i})),
    travel_orders: make('t',8,() => ({departureDate:date})),
    visitors: make('v',17,() => ({visitDate:date})),
    service_requests: make('s',13,i => ({requestDate:date,status:['Completed','In progress','Pending','Archived','Other'][i%5]})),
    ics_records: make('i',6,() => ({dateIssued:date})),
    employees: make('e',17,i => ({fullName:'Employee '+i,division:['Environmental Management and Monitoring Division','Forest and Natural Resources Division','Administration','Planning and Research'][i%4]})),
    inventory:[{id:'a',quantity:0,threshold:5},{id:'b',quantity:2,threshold:5},{id:'c',quantity:20,threshold:5}],
    profiles:[],users:[],access_requests:[],audit_logs:[]
  };
  if (mode === 'history') tables.communications.push({id:'older',receivedDate:day(-45),direction:'incoming'}, {id:'oldest',receivedDate:day(-200),direction:'outgoing'});
  if (mode === 'many-divisions') tables.employees = make('e',40,i => ({fullName:'Employee '+i,division:`Functional Division ${String(i+1).padStart(2,'0')} with a long descriptive name`}));
  if (mode === 'empty') for (const name of Object.keys(tables)) tables[name] = [];
  const user = {id:'test-admin',email:'admin@example.test',user_metadata:{full_name:'Test Administrator'}};
  localStorage.setItem('pgenro_current_user', JSON.stringify({...user,fullName:'Test Administrator',role:'admin'}));
  localStorage.setItem('pgenro_admin_theme', theme);
  localStorage.setItem('pgenro_admin_sidebar', 'expanded');
  // This mode deliberately uses only existing cache keys, without a database client.
  if (mode === 'cache') {
    localStorage.setItem('pgenro_communications',JSON.stringify(tables.communications));
    localStorage.setItem('pgenro_admin_inventory_live_cache_v2',JSON.stringify(tables.inventory));
    return;
  }
  function from(table) {
    let columns = '*', single = false, start = 0, end = Infinity;
    const q = {};
    for (const name of ['order','eq','in','gte','lte','lt','gt','neq','ilike','or','not','match','filter']) q[name] = () => q;
    q.select = value => (columns = value || '*', q);
    q.range = (a,b) => (start = a, end = b, q);
    q.limit = n => (end = n-1, q);
    q.single = q.maybeSingle = () => (single = true, q);
    q.then = (resolve,reject) => {
      const rows = (tables[table] || []).slice(start,end+1);
      return Promise.resolve(columns === 'data'
        ? {data:null,error:{code:'42703',message:'Flat fixture schema'}}
        : {data:single ? rows[0] || null : rows,count:(tables[table] || []).length,error:null}).then(resolve,reject);
    };
    return q;
  }
  const sb = {from,auth:{
    getUser:async()=>({data:{user},error:null}),getSession:async()=>({data:{session:{user,access_token:'test'}},error:null}),
    onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})
  },rpc:async (name,args)=>({data:name==='pgenro_is_admin'?true
      :name==='pgenro_um_context'?{authorized:true,profile:{user_id:user.id,role:'Admin',status:'active',full_name:'Test Administrator'}}
      :name==='pgenro_um_directory'?{items:[],offset:args?.p_offset||0,total:0,pending:0,hasMore:false}:[],error:null}),
    channel:()=>{const c={on:()=>c,subscribe:()=>c,unsubscribe(){}};return c},removeChannel(){},functions:{invoke:async()=>({data:[],error:null})}};
  window.pgenroSupabase = sb; window.PGENRO_DB = {client:sb};
  window.PGENRO_API = {requireAdmin:async()=>({client:sb,user}),invokeAdmin:async()=>({data:[],error:null})};
  window.PGENRO_ICS = {requireProfile:async()=>({user_id:user.id,full_name:'Test Administrator',email:user.email,role:'admin',authUser:user}),list:async()=>tables.ics_records};
}

async function navigationGeometry(page, collapsed = false) {
  const data = await page.evaluate(() => {
    const rect = el => el.getBoundingClientRect().toJSON();
    const nav = document.querySelector('.sidebar-nav');
    return {
      width:innerWidth,overflow:document.documentElement.scrollWidth,sidebar:rect(document.querySelector('.sidebar')),
      main:rect(document.querySelector('.main-wrapper')),header:rect(document.querySelector('.sidebar-header')),
      groups:[...nav.querySelectorAll('.nav-group')].map(el => ({...rect(el),margin:getComputedStyle(el).marginBottom})),
      lists:[...nav.querySelectorAll('ul')].map(el => [...el.querySelectorAll('.nav-item')].map(a => rect(a))),
      destinations:[...nav.querySelectorAll('a')].map(a=>a.getAttribute('href')),
      active:[...nav.querySelectorAll('a[aria-current="page"]')].map(a=>a.getAttribute('href')),
      navWidth:nav.clientWidth,navScrollWidth:nav.scrollWidth
    };
  });
  assert(data.overflow <= data.width+1, `Page overflow: ${JSON.stringify(data)}`);
  assert.equal(Math.round(data.header.height),76,'Sidebar header stays the same height');
  assert.equal(data.destinations.length,14,'All fourteen destinations remain available');
  assert.equal(data.active.length,1,'One current navigation destination');
  assert(data.navScrollWidth <= data.navWidth+1,'Navigation does not overflow horizontally');
  for (const group of data.groups) assert.equal(group.margin,'0px','No additional group margins');
  for (let i=1;i<data.groups.length;i++) assert(Math.abs(data.groups[i].top-data.groups[i-1].bottom-(collapsed?4:16))<1,'Consistent space between groups');
  for (const list of data.lists) {
    for (const row of list) {
      assert(row.height >= 44 && row.height < 47,'Consistent touch target height');
      assert(row.left >= data.sidebar.left && row.right <= data.sidebar.right+1,'Navigation item stays inside sidebar');
    }
    for (let i=1;i<list.length;i++) assert(Math.abs(list[i].top-list[i-1].bottom-4)<1,'No skipped navigation rows');
  }
  if (data.width > 900) {
    assert.equal(Math.round(data.sidebar.width), collapsed?78:254,'Sidebar width');
    assert.equal(Math.round(data.main.left), collapsed?78:254,'Main content follows sidebar');
  }
  const last = page.locator('.sidebar-nav .nav-item').last();
  await last.scrollIntoViewIfNeeded();
  const lastInside = await last.evaluate(el => {
    const nav = el.closest('nav').getBoundingClientRect(), row=el.getBoundingClientRect();
    return row.top >= nav.top-1 && row.bottom <= nav.bottom+1;
  });
  assert(lastInside,'Preferences remains reachable by scrolling');
}

async function chartGeometry(page) {
  const data = await page.evaluate(ids => ids.map(id => {
    const canvas=document.getElementById(id),chart=Chart.getChart(canvas),host=canvas.parentElement.getBoundingClientRect();
    return {id,hidden:canvas.hidden,width:chart.width,height:chart.height,hostWidth:host.width,hostHeight:host.height,
      areaWidth:chart.chartArea.right-chart.chartArea.left,labels:chart.scales.y?.ticks.map(t=>t.label)||[],rect:canvas.getBoundingClientRect().toJSON()};
  }),chartIds);
  for (const chart of data) {
    assert(!chart.hidden && chart.width>120 && chart.height>=200,'Visible, bounded chart '+chart.id);
    assert(Math.abs(chart.width-chart.hostWidth)<2,'Chart follows container width '+chart.id);
    assert(Math.abs(chart.height-chart.hostHeight)<2,'Chart follows container height '+chart.id);
    assert(chart.areaWidth>80,'Readable plot area '+chart.id);
    assert(chart.rect.left>=0 && chart.rect.right<=page.viewportSize().width+1,'Chart stays within page '+chart.id);
  }
  const personnel=data.find(c=>c.id==='personnelChart');
  assert(personnel.labels.every(label=>String(label).length<29),'Long division names are shortened on the axis');
  assert(personnel.labels.some(label=>String(label).endsWith('…')),'Long names have an explicit ellipsis');
  const legendWidths = await page.locator('.analytics-chart-legend:not([hidden]) .analytics-legend-item').evaluateAll(items=>items.map(el=>el.getBoundingClientRect().width));
  assert(legendWidths.every(width=>width>=139),'Legend columns leave room for complete category words');
}

module.exports = {installFixture};
if (require.main === module) (async()=>{
  const server=require('http').createServer((req,res)=>{
    const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,...(process.env.UI_BROWSER_PATH?{executablePath:process.env.UI_BROWSER_PATH}:{}),args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-zygote']});
  const origin=`http://127.0.0.1:${server.address().port}`;
  async function open(file,width,options={}) {
    const context=await browser.newContext({viewport:{width,height:options.height||900},reducedMotion:'reduce'});
    await context.addInitScript(installFixture,options);
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if (options.noCharts && url.pathname.endsWith('/chart.umd.min.js')) return route.abort();
      if(url.hostname!=='127.0.0.1'||url.pathname.startsWith('/shared/'))return route.fulfill({status:200,contentType:route.request().resourceType()==='stylesheet'?'text/css':'text/javascript',body:''});
      return route.continue();
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${origin}/admin/${file}`,{waitUntil:'load'});
    await page.waitForFunction(()=>window.PGENRO_Module);
    if(file==='admin.html') await page.waitForFunction(()=>document.querySelector('#analyticsSourceStatus').textContent!=='Waiting for data');
    if(file==='admin.html'&&!options.noCharts) await page.waitForFunction(()=>window.Chart&&Object.keys(Chart.instances).length===5);
    // The application's analytics queue settles after a 120 ms data batch.
    await page.waitForTimeout(180);
    return {context,page,errors};
  }
  try {
    for(const file of pages) for(const width of [320,390,768,1024,1440]) {
      const {context,page,errors}=await open(file,width);
      try {
        if(width<=900) {
          await page.locator('#mobileMenuBtn').click();
          await page.waitForFunction(()=>document.querySelector('.sidebar').classList.contains('mobile-open'));
          await navigationGeometry(page);
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('#mobileMenuBtn').getAttribute('aria-expanded'),'false');
          assert(await page.locator('#mobileMenuBtn').evaluate(el=>document.activeElement===el),'Menu focus returns');
        } else {
          await navigationGeometry(page);
          await page.locator('#sidebarCollapseBtn').click();
          await page.waitForTimeout(220);
          await navigationGeometry(page,true);
          await page.locator('#sidebarCollapseBtn').click();
          await page.waitForTimeout(220);
        }
        if(file==='admin.html') {
          assert.equal(await page.locator('#analyticsVolume').textContent(),'74');
          await chartGeometry(page);
          assert.equal(await page.locator('#categoryChartLegend button').count(),6);
          assert.equal(await page.locator('#commChartLegend button').count(),4);
          await page.locator('#categoryChartLegend button').first().click();
          assert.equal(await page.locator('#categoryChartLegend button').first().getAttribute('aria-pressed'),'false');
          assert.equal(await page.evaluate(()=>Chart.getChart('categoryChart').getDataVisibility(0)),false);
          await page.keyboard.press('Space');
          assert.equal(await page.evaluate(()=>Chart.getChart('categoryChart').getDataVisibility(0)),true);
          await page.locator('#appearanceThemeBtn').click();
          await page.waitForFunction(()=>Chart.getChart('monthlyChart').options.plugins.legend.labels.color==='#a5c1b1');
          await chartGeometry(page);
          if(process.env.NAV_CHART_SNAPSHOTS) {
            fs.mkdirSync(process.env.NAV_CHART_SNAPSHOTS,{recursive:true});
            await page.locator('.analytics-visual-grid').screenshot({path:path.join(process.env.NAV_CHART_SNAPSHOTS,`charts-${width}-dark.png`),style:'.topbar { visibility: hidden !important; }'});
          }
        }
        assert.deepEqual(errors,[],'No script errors');
        results.push({page:file,width,result:'PASS'});
      } catch(error) { error.message=`${file} at ${width}px: ${error.message}`;throw error; }
      finally { await context.close(); }
    }
    // Dark navigation, plus short landscape menus, use the same bounded geometry.
    for(const file of pages) {
      const {context,page,errors}=await open(file,1440,{theme:'dark'});
      try { await navigationGeometry(page);assert.deepEqual(errors,[]);results.push({page:file,theme:'dark',result:'PASS'}); }
      finally { await context.close(); }
    }
    for(const file of ['admin.html','admincommunication.html']) {
      const {context,page}=await open(file,844,{height:390});
      try { await page.locator('#mobileMenuBtn').click();await navigationGeometry(page);results.push({page:file,width:844,height:390,result:'PASS'}); }
      finally { await context.close(); }
    }
    for(const mode of ['history','empty','many-divisions','cache','fallback']) {
      const {context,page,errors}=await open('admin.html',390,{mode,noCharts:mode==='fallback'});
      try {
        if(mode==='history') {
          assert.equal(await page.locator('#analyticsVolume').textContent(),'75');
          await page.locator('#analyticsPeriod').selectOption('30');
          await page.waitForFunction(()=>document.querySelector('#analyticsVolume').textContent==='74');
          assert.equal(await page.evaluate(()=>Chart.getChart('monthlyChart').data.labels.length),30);
          await page.locator('#analyticsPeriod').selectOption('all');
          await page.waitForFunction(()=>document.querySelector('#analyticsVolume').textContent==='76');
          assert.equal(await page.evaluate(()=>Chart.getChart('categoryChart').data.datasets[0].data.reduce((a,b)=>a+b,0)),76);
          await page.locator('#refreshAnalyticsBtn').click();
          await page.waitForFunction(()=>!document.querySelector('#refreshAnalyticsBtn').disabled);
          assert.equal(await page.locator('#analyticsVolume').textContent(),'76');
        } else if(mode==='empty') {
          assert.equal(await page.locator('#analyticsVolume').textContent(),'0');
          assert.equal(await page.locator('.analytics-chart-empty:not([hidden])').count(),5);
          assert.equal(await page.locator('.analytics-chart-legend:not([hidden])').count(),0);
        } else if(mode==='many-divisions') {
          assert.equal(await page.evaluate(()=>Chart.getChart('personnelChart').data.labels.length),40);
          assert(await page.locator('.analytics-personnel-card .analytics-chart-wrap').evaluate(el=>el.clientHeight<=420&&el.scrollHeight>el.clientHeight),'Many divisions scroll inside chart card');
        } else if(mode==='cache') {
          assert.equal(await page.locator('#analyticsVolume').textContent(),'19');
          assert((await page.locator('#analyticsSourceStatus').textContent()).includes('cached'));
          assert.equal(await page.locator('#analyticsPersonnelEmpty').isVisible(),true);
        } else {
          assert.equal(await page.locator('.native-chart').count(),5,'Missing library keeps all native fallbacks');
          assert.equal(await page.locator('#analyticsVolume').textContent(),'74');
          assert.equal(await page.locator('canvas[hidden]').count(),5);
        }
        assert.deepEqual(errors,[]);
        results.push({scenario:mode,result:'PASS'});
      } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(__dirname,'navigation-charts-results.json'),JSON.stringify({method:'Local Chromium with simulated Supabase responses; production services were not contacted',scenarios:results},null,2));
    console.log(`${results.length} navigation/chart scenarios passed`);
  } finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {chromium} = require('playwright');
const root = path.resolve(__dirname,'..');
const appRoot = path.dirname(root);
const output = path.join(__dirname,'previews');
fs.mkdirSync(output,{recursive:true});
const forms = {
  'admincommunication.html': ['openEncodingModalBtn','encodingModal'],
  'employee-admin.html': ['addEmployeeBtn','employeeFormModal'],
  'travelOR-admin.html': ['addOrderBtn','orderModal'],
  'officememo-admin.html': ['openCreateModalBtn','memoFormModal'],
  'invetoryadmin.html': ['addItemBtn','itemModal'],
  'visitors-admin.html': ['addVisitorBtn','visitorModalBackdrop'],
  'serviceAdmin.html': ['btnNewRecord','serviceFormModal'],
  'ics-admin.html': ['addIcsBtn','editorModal'],
  'Usermanagement.html': ['openAddUserModalBtn','userModal'],
  'requestacc.html': null,
  'admin.html': null,
};
const widths = [320,390,768,1024,1440];
const results=[];
function installFixture() {
  const user={id:'fixture-admin',email:'admin@example.test',user_metadata:{full_name:'PGENRO Administrator'}};
  localStorage.setItem('pgenro_current_user', JSON.stringify({id:user.id,fullName:'PGENRO Administrator',email:user.email,role:'admin'}));
  function from(table) {
    const state={cols:'*',single:false};
    const query={};
    for(const name of ['order','range','limit','eq','in','gte','lte','lt','gt','neq','ilike','or','not','match','filter']) query[name]=()=>query;
    query.select=(columns)=>{state.cols=columns||'*';return query};
    query.single=query.maybeSingle=()=>{state.single=true;return query};
    query.then=(resolve,reject)=>Promise.resolve(state.cols==='data'
      ? {data:null,count:0,error:{code:'42703',message:'Flat fixture schema'}}
      : {data:state.single?null:[],count:0,error:null}).then(resolve,reject);
    return query;
  }
  const sb={from,auth:{
    getUser:async()=>({data:{user},error:null}),
    getSession:async()=>({data:{session:{user,access_token:'fixture'}},error:null}),
    onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
    signOut:async()=>({error:null}),
  },rpc:async name=>({data:name==='pgenro_is_admin'?true:[],error:null}),
  channel:()=>{const c={on:()=>c,subscribe:()=>c,unsubscribe(){}};return c},removeChannel(){},
  functions:{invoke:async()=>({data:[],error:null})},
  };
  window.pgenroSupabase=sb;
  window.PGENRO_DB={client:sb};
  window.PGENRO_API={requireAdmin:async()=>({client:sb,user}),invokeAdmin:async()=>({data:[],error:null})};
}
async function inside(page,locator,label) {
  const rect=await locator.boundingBox();
  assert(rect,label+' must be visible');
  const {width,height}=page.viewportSize();
  assert(rect.x>=-1 && rect.x+rect.width<=width+1,label+' horizontal bounds '+JSON.stringify(rect));
  assert(rect.y>=-1 && rect.y+rect.height<=height+1,label+' vertical bounds '+JSON.stringify(rect));
}
(async()=>{
  const server=require('http').createServer((req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.join(appRoot,pathname);
    if(!file.startsWith(appRoot+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png'})[path.extname(file)]||'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  let browserPath=process.env.UI_BROWSER_PATH;
  let browserArgs=['--no-sandbox'];
  if(process.env.UI_CHROMIUM_PACKAGE){const pack=(await import(process.env.UI_CHROMIUM_PACKAGE+'/build/index.js')).default;browserPath=await pack.executablePath();browserArgs=['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-zygote'];}
  const browser=await chromium.launch({headless:true,...(browserPath?{executablePath:browserPath}:{}),args:browserArgs});
  for(const [file,form] of Object.entries(forms).filter(([name])=>!process.env.UI_PAGES||process.env.UI_PAGES.split(',').includes(name))) {
    for(const width of widths) { for(const theme of ['light','dark']) {
      const context=await browser.newContext({viewport:{width,height:860},reducedMotion:'no-preference'});
      await context.addInitScript(installFixture);
      await context.addInitScript(value=>localStorage.setItem('pgenro_admin_theme',value),theme);
      await context.route('**/*',route=>{
        const url=new URL(route.request().url());
        if(url.hostname!=='127.0.0.1') return route.fulfill({status:200,contentType:route.request().resourceType()==='stylesheet'?'text/css':'text/javascript',body:''});
        if(url.pathname.startsWith('/shared/')) return route.fulfill({status:200,contentType:url.pathname.endsWith('.css')?'text/css':'text/javascript',body:''});
        return route.continue();
      });
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin+'/admin/'+file,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.PGENRO_Module && document.querySelector('.page-heading-mark svg'));
      await page.waitForFunction(()=>document.querySelectorAll('i[data-lucide]').length===0);
      assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
      await page.locator('#appearanceThemeBtn').click();
      assert.equal(await page.locator('html').getAttribute('data-theme'),theme==='dark'?'light':'dark');
      assert.equal(await page.evaluate(()=>localStorage.getItem('pgenro_admin_theme')),theme==='dark'?'light':'dark');
      await page.locator('#appearanceThemeBtn').click();
      const density=page.locator('.modern-density-switch').first();
      assert(await density.count(),'A registry density control must exist');
      const rowCell=page.locator('.data-table tbody td:not([colspan]),.analytics-table tbody td:not([colspan])').first();
      const densityCell=await rowCell.count()?rowCell:page.locator('.data-table th,.analytics-table th').first();
      const beforePadding=await densityCell.evaluate(el=>parseFloat(getComputedStyle(el).paddingTop));
      await density.click();
      assert(await page.locator('body').evaluate(el=>el.classList.contains('compact-mode')),'Compact state');
      const afterPadding=await densityCell.evaluate(el=>parseFloat(getComputedStyle(el).paddingTop));
      assert(afterPadding<beforePadding,'Density must reduce actual row padding');
      await density.click();
      const layout=await page.evaluate(()=>({
        width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
        iconsLeft:document.querySelectorAll('i[data-lucide]').length,
        main:document.querySelector('main').getBoundingClientRect().toJSON(),
        kpis:[...document.querySelectorAll('.kpi-card')].map(e=>e.getBoundingClientRect().toJSON()),
        toolbar:[...document.querySelectorAll('.topbar-right > *')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.getBoundingClientRect().toJSON()),
      }));
      assert(layout.scrollWidth<=width,'Page overflow: '+file+' '+width+' '+layout.scrollWidth);
      assert.equal(layout.iconsLeft,0,'Unrendered icons');
      await page.evaluate(()=>{const icon=document.createElement('i');icon.dataset.lucide='paperclip';icon.className='fixture-dynamic-icon';icon.style.width='15px';document.querySelector('main').append(icon)});
      await page.waitForFunction(()=>!!document.querySelector('svg.fixture-dynamic-icon'));
      assert.equal(await page.locator('svg.fixture-dynamic-icon').evaluate(e=>getComputedStyle(e).width),'15px');
      await page.locator('svg.fixture-dynamic-icon').evaluate(e=>e.remove());
      assert(layout.main.x>=-1 && layout.main.right<=width+1,'Main bounds '+file+' '+width);
      for(const r of layout.kpis) assert(r.x>=-1&&r.right<=width+1,'KPI overflow');
      for(let i=1;i<layout.toolbar.length;i++) assert(layout.toolbar[i].x>=layout.toolbar[i-1].right-1,'Toolbar controls overlap');
      const profileOverflow=await page.locator('#profileBtn').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));
      assert(profileOverflow.scroll<=profileOverflow.client+1,'Profile content overflows: '+JSON.stringify(profileOverflow));
      await page.locator('#profileBtn').click();
      await inside(page,page.locator('#profileDropdown'),'Profile menu');
      const logout=await page.locator('#logoutBtn').evaluate(el=>{
        const icon=el.querySelector('svg').getBoundingClientRect(),label=el.querySelector('span').getBoundingClientRect();
        return {iconRight:icon.right,labelLeft:label.left};
      });
      assert(logout.labelLeft>=logout.iconRight,'Logout icon must not overlap its label');
      await page.keyboard.press('Escape');
      assert(await page.locator('#profileBtn').evaluate(el=>document.activeElement===el),'Profile focus must return');
      await page.locator('#notificationsBtn').click();
      await inside(page,page.locator('#notificationDropdown'),'Notification menu');
      await page.keyboard.press('Escape');
      if(width<=900) {
        await page.locator('#mobileMenuBtn').click();
        await page.waitForFunction(()=>document.getElementById('sidebar').getBoundingClientRect().left>=-.5);
        await inside(page,page.locator('#sidebar'),'Mobile navigation');
        assert.equal(await page.locator('#sidebar').evaluate(el=>el.inert),false);
        await page.keyboard.press('Escape');
        assert(await page.locator('#mobileMenuBtn').evaluate(el=>document.activeElement===el),'Mobile focus must return');
      } else {
        await page.locator('#sidebarCollapseBtn').click();
        await page.waitForFunction(()=>document.body.classList.contains('sidebar-collapsed'));
        await page.locator('#sidebarCollapseBtn').click();
      }
      await page.locator('#workspaceJumpBtn').click();
      await inside(page,page.locator('.workspace-jump-dialog'),'Module switcher');
      assert.equal(await page.locator('#workspaceJumpResults a').count(),14);
      await page.keyboard.press('Escape');
      if(form) {
        await page.locator('#'+form[0]).click();
        await page.waitForFunction(id=>document.getElementById(id)?.classList.contains('open'),form[1]);
        const dialog=page.locator('#'+form[1]+' [role="dialog"]');
        await inside(page,dialog,'Registry form');
        const overflow=await dialog.evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth}));
        assert(overflow.scroll<=overflow.client+1,'Form horizontal overflow: '+file+' '+width+' '+JSON.stringify(overflow));
        const actions=page.locator('#'+form[1]+' .modal-action-buttons');
        if(await actions.count()) await inside(page,actions.first(),'Form action buttons');
        if(width===390 && file==='officememo-admin.html') await page.screenshot({animations:'disabled',path:path.join(output,'modern-memo-form-'+theme+'.png')});
        await page.keyboard.press('Escape');
      }
      assert.equal(errors.length,0,file+' runtime errors: '+errors.join('; '));
      if(width===1440 || ((file==='admin.html'||file==='officememo-admin.html') && width===390)) {
        await page.evaluate(()=>{document.activeElement?.blur();scrollTo({top:0,behavior:'instant'});});
        await page.screenshot({animations:'disabled',path:path.join(output,'modern-'+file.replace('.html','')+'-'+width+'-'+theme+'.png')});
      }
      results.push({file,width,theme,result:'PASS'});
      console.log('PASS',file,width,theme);
      await context.close();
    } }
  }
  // Verify the desktop dropdown remains usable on short screens and motion is disabled on request.
  const context=await browser.newContext({viewport:{width:1440,height:480},reducedMotion:'reduce'});
  await context.addInitScript(installFixture);
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.fulfill({status:200,body:''}));
  const page=await context.newPage();
  await page.goto(origin+'/admin/admin.html');
  await page.locator('#profileBtn').click();
  await inside(page,page.locator('#profileDropdown'),'Short-screen profile');
  assert.equal(await page.locator('.page-header').evaluate(e=>getComputedStyle(e).animationName),'none');
  results.push({file:'admin.html',width:1440,height:480,reducedMotion:true,result:'PASS'});
  await context.close();
  // Appearance and table spacing must survive navigation and update other open modules.
  const preferencesContext=await browser.newContext({viewport:{width:1440,height:860}});
  await preferencesContext.addInitScript(installFixture);
  await preferencesContext.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='127.0.0.1'||url.pathname.startsWith('/shared/')) return route.fulfill({status:200,body:''});
    return route.continue();
  });
  const preferencesPage=await preferencesContext.newPage();
  await preferencesPage.goto(origin+'/admin/admin.html');
  await preferencesPage.locator('#appearanceThemeBtn').click();
  await preferencesPage.evaluate(()=>localStorage.setItem('pgenro_admin_preferences',JSON.stringify({compact:false,showDb:false})));
  await preferencesPage.locator('.modern-density-switch').first().click();
  assert.equal(await preferencesPage.evaluate(()=>JSON.parse(localStorage.getItem('pgenro_admin_preferences')).showDb),false,'Density preserves other preferences');
  await preferencesPage.goto(origin+'/admin/officememo-admin.html');
  await preferencesPage.waitForFunction(()=>document.documentElement.dataset.theme==='dark'&&document.body.classList.contains('compact-mode'));
  const settingsPage=await preferencesContext.newPage();
  await settingsPage.goto(origin+'/admin/admin.html');
  await settingsPage.waitForFunction(()=>document.querySelector('.modern-density-switch')?.getAttribute('aria-pressed')==='true');
  await settingsPage.locator('#appearanceThemeSelect').selectOption('light');
  await preferencesPage.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await settingsPage.locator('#compactModeToggle').uncheck();
  await preferencesPage.waitForFunction(()=>!document.body.classList.contains('compact-mode'));
  await settingsPage.locator('#compactModeToggle').check();
  await preferencesPage.waitForFunction(()=>document.body.classList.contains('compact-mode'));
  await settingsPage.locator('#appearanceThemeSelect').selectOption('dark');
  await preferencesPage.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await settingsPage.locator('#resetAdminPrefsBtn').click();
  await preferencesPage.waitForFunction(()=>document.documentElement.dataset.theme==='light'&&!document.body.classList.contains('compact-mode'));
  assert.equal(await settingsPage.locator('.modern-density-switch').first().getAttribute('aria-pressed'),'false');
  assert.equal(await settingsPage.locator('#appearanceThemeSelect').inputValue(),'light');
  results.push({file:'admin.html + officememo-admin.html',width:1440,preferenceSync:true,result:'PASS'});
  console.log('PASS preference persistence, settings reset and cross-tab synchronization');
  await preferencesContext.close();await browser.close();await new Promise(resolve=>server.close(resolve));
  fs.writeFileSync(path.join(root,'verification/ui-modern.json'),JSON.stringify({date:'2026-10-06',browser:'Chromium',fixture:'Empty simulated Supabase; external assets blocked; no hosted database calls.',results},null,2));
  console.log(results.length+' UI scenarios passed');
})().catch(error=>{console.error(error.stack);process.exit(1)});

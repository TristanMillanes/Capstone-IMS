// Production pages with a simulated SDK; this suite never contacts live records.
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const deps = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || path.resolve(__dirname, 'node_modules');
const { chromium } = require(deps + '/playwright');
const root = path.resolve(__dirname, '../..');
const report = { method: 'Actual Chromium; simulated Supabase; no live records changed', checks: [], errors: [] };
const pages = ['admin', 'User'].flatMap(folder => fs.readdirSync(path.join(root, folder)).filter(file => /\.html$/.test(file) && !['login.html'].includes(file) && !(folder === 'User' && file === 'requestacc.html')).map(file => folder + '/' + file));
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', ({'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png'})[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
let browser, port;
async function open(file, motion = 'no-preference') {
  const context = await browser.newContext({viewport:{width:1440,height:980}, reducedMotion:motion});
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('@supabase/supabase-js')) return route.fulfill({contentType:'text/javascript', body:fs.readFileSync(path.join(__dirname,'mock-sdk.js'))});
    if (url.includes('lucide@')) return route.fulfill({contentType:'text/javascript', body:fs.readFileSync(path.join(deps,'lucide/dist/umd/lucide.min.js'))});
    if (url.includes('chart.js')) return route.fulfill({contentType:'text/javascript', body:fs.readFileSync(path.join(__dirname,'chart.umd.min.js'))});
    if (url.startsWith('http://127.0.0.1:' + port)) return route.continue();
    return route.fulfill({contentType:'text/javascript',body:''});
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(file + ': ' + error.message));
  await page.goto(`http://127.0.0.1:${port}/${file}`);
  await page.waitForFunction(() => document.body.dataset.depthReady === 'true');
  await page.waitForTimeout(850);
  return {page, context};
}
function pass(scenario, details) { report.checks.push({scenario,result:'PASS',details}); console.log('PASS',scenario); }
async function checkBounds(locator) {
  return locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    return {visible: !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden', left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:innerWidth, height:innerHeight};
  });
}
(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); port = server.address().port;
  browser = await chromium.launch({headless:true, executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE, args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
  for (const file of pages) {
    console.log('CHECK',file);
    const {page,context} = await open(file);
    const scene = await page.locator('.depth-stack').evaluate(el => ({animation:getComputedStyle(el).animationName, transform:getComputedStyle(el).transform}));
    assert.equal(scene.animation,'depth-stack-arrive', file + ' has a brief entrance animation');
    assert(scene.transform.startsWith('matrix3d'), file + ' uses native 3D transforms');
    assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.effect.getTiming().iterations === Infinity && a.playState === 'running').length), 0, file + ' has no continuous decorative animation');
    const firstCard = page.locator('.depth-tilt').first();
    if (await firstCard.count()) {
      await firstCard.hover({position:{x:14,y:15}});
      await page.waitForFunction(() => {
        const el = document.querySelector('.depth-tilt');
        return getComputedStyle(el).transform !== 'none';
      });
      await page.mouse.move(1420,20);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.depth-tilt')).transform === 'none');
    }
    await page.locator('#profileBtn').click();
    await page.waitForFunction(() => getComputedStyle(document.getElementById('profileDropdown')).visibility === 'visible');
    const bounds = await checkBounds(page.locator('#profileDropdown'));
    assert(bounds.visible && bounds.left >= -1 && bounds.right <= bounds.width+1 && bounds.top >= -1 && bounds.bottom <= bounds.height+1, file + ' desktop profile fits ' + JSON.stringify(bounds));
    assert(await page.locator('#logoutBtn').isVisible(), file + ' sign out stays reachable');
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:390,height:844});
    const menuButton = page.locator(file.startsWith('admin/') ? '#mobileMenuBtn' : '#hamburgerMenu');
    await menuButton.click();
    await page.waitForTimeout(350);
    const navBounds = await checkBounds(page.locator('#sidebar'));
    assert(navBounds.left >= -1 && navBounds.right <= 391, file + ' mobile navigation fits');
    if (file.startsWith('admin/')) { await page.keyboard.press('Escape'); await page.waitForTimeout(350); }
    await page.locator('#profileBtn').click();
    await page.waitForFunction(() => getComputedStyle(document.getElementById('profileDropdown')).visibility === 'visible');
    const mobileProfile = await checkBounds(page.locator('#profileDropdown'));
    assert(mobileProfile.visible && mobileProfile.left >= -1 && mobileProfile.right <= 391 && mobileProfile.top >= -1 && mobileProfile.bottom <= 845, file + ' mobile profile fits ' + JSON.stringify(mobileProfile));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.emulateMedia({reducedMotion:'reduce'});
    const reduced = await page.locator('.depth-stack').evaluate(el => getComputedStyle(el).animationName);
    assert.equal(reduced,'none', file + ' respects reduced motion');
    await page.setViewportSize({width:1440,height:980});
    const labels = await page.locator('.kpi-card, .stat-card, .metric-card').evaluateAll(cards => cards.map(card => {
      const n = card.querySelector('.kpi-body h3, .stat-copy h2, .metric-info h3, .kpi-copy > strong');
      return n ? {top:card.getBoundingClientRect().top, number:n.getBoundingClientRect().top} : null;
    }).filter(Boolean));
    for (let a=0;a<labels.length;a++) for(let b=a+1;b<labels.length;b++) {
      if(Math.abs(labels[a].top-labels[b].top)<1) assert(Math.abs(labels[a].number-labels[b].number)<2, file + ' metric values align');
    }
    pass(file + ' 3D motion, hover reset, profiles, mobile navigation, reduced motion and aligned metrics');
    await context.close();
  }
  {
    const {page,context} = await open('admin/admin.html','reduce');
    await page.locator('#appearanceThemeBtn').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    const colors = await page.evaluate(() => ({surface:getComputedStyle(document.body).getPropertyValue('--depth-surface').trim(), title:getComputedStyle(document.querySelector('.depth-hero h1')).color}));
    assert.equal(colors.surface,'#173128');
    await page.screenshot({path:path.join(__dirname,'modern-smooth-admin-dark.png'),animations:'disabled'});
    await page.locator('#appearanceThemeBtn').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    await page.locator('#sidebarCollapseBtn').click(); await page.waitForTimeout(250);
    const content = await page.locator('.main-wrapper').evaluate(el => ({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,viewport:Math.round(document.querySelector('.app-layout').getBoundingClientRect().right),width:parseFloat(getComputedStyle(document.body).getPropertyValue('--sidebar-collapsed-width'))}));
    assert.equal(Math.round(content.left),content.width); assert.equal(Math.round(content.right),content.viewport);
    await page.keyboard.press('Control+k'); assert(await page.locator('#workspaceJumpModal').evaluate(el => el.classList.contains('open')));
    await page.keyboard.press('Escape');
    pass('Admin dark/light appearance, sidebar collapse and keyboard module navigation',colors);
    await context.close();
  }
  for (const file of ['User/homepage.html','User/communication.html']) {
    const {page,context} = await open(file,'reduce');
    await page.locator('.depth-settings-link').click(); await page.waitForURL('**/SettingIMS/Settings.html?from=user');
    assert(await page.locator('#profileForm').isVisible());
    await page.locator('#backToWorkspace').click(); await page.waitForURL('**/User/homepage.html');
    pass(file + ' account settings and return navigation'); await context.close();
  }
  assert.deepEqual(report.errors,[]); report.passed = true;
})().catch(error => { report.passed=false; report.failure=error.message; console.error(error); process.exitCode=1; }).finally(async () => {
  fs.writeFileSync(path.join(__dirname,'depth-workspace-results.json'),JSON.stringify(report,null,2));
  await browser?.close(); server.close();
});

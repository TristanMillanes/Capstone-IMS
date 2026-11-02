const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { setupDatabase, submit } = require('./database.test.cjs');

async function main() {
  const root = path.resolve(__dirname,'../..');
  const db = await setupDatabase();
  const sdk = fs.readFileSync(path.join(root,'verification/ui/mock-sdk.js'),'utf8');
  const server = http.createServer((request,response) => {
    const filename = path.resolve(root,'.' + new URL(request.url,'http://localhost').pathname);
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      response.writeHead(404); response.end(); return;
    }
    const type = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png' };
    response.setHeader('Content-Type',type[path.extname(filename)] || 'application/octet-stream');
    response.end(fs.readFileSync(filename));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let executablePath = process.env.PGENRO_CHROMIUM_EXECUTABLE;
  let args = ['--no-sandbox','--disable-dev-shm-usage'];
  if (!executablePath && !fs.existsSync(chromium.executablePath())) {
    try {
      const chromiumModule = require('@sparticuz/chromium');
      const packagedChromium = chromiumModule.default || chromiumModule;
      executablePath = await packagedChromium.executablePath();
      args = packagedChromium.args;
    } catch { /* Use the browser installed with Playwright. */ }
  }
  let browser;
  const errors = [];
  let attempts = 0;
  let loseResponse = false;
  let unavailable = false;
  let pendingRows = [];
  try {
    browser = await chromium.launch({ headless:true, executablePath, args });
    async function contextFor(signedIn = false) {
      const context = await browser.newContext({ viewport:{width:1440,height:1000}, reducedMotion:'reduce' });
      context.setDefaultTimeout(10000);
      if (!signedIn) await context.addInitScript(() => {
        try { sessionStorage.setItem('qa_signed_out','true'); } catch { /* A transient document may not have an origin. */ }
      });
      await context.route('**/*',async route => {
        const url = route.request().url();
        if (url.includes('/rest/v1/rpc/submit_public_ics')) {
          attempts++;
          assert.equal(route.request().headers().authorization,undefined);
          if (unavailable) return route.fulfill({ status:404, json:{code:'PGRST202'} });
          const body = route.request().postDataJSON();
          try {
            const receipt = await submit(db,body.p_data,body.p_submission_id);
            if (loseResponse) {
              loseResponse = false;
              return route.fulfill({ status:503, json:{code:'503'} });
            }
            return route.fulfill({ json:receipt });
          } catch (error) { return route.fulfill({ status:400, json:{code:error.code,message:error.message} }); }
        }
        if (url.includes('@supabase/supabase-js')) {
          return route.fulfill({ contentType:'text/javascript', body:sdk + '\nwindow.__db.ics_records=' + JSON.stringify(pendingRows) + ';' });
        }
        if (url.startsWith(origin)) return route.continue();
        return route.fulfill({ status:200, contentType:'text/javascript', body:'' });
      });
      context.on('page',page => page.on('pageerror',error => errors.push(error.message)));
      return context;
    }

    const context = await contextFor();
    const page = await context.newPage();
    const externalRequests = [];
    page.on('request',request => { if (!request.url().startsWith(origin)) externalRequests.push(request.url()); });
    await page.goto(`${origin}/User/login.html`);
    assert.equal(await page.locator('#icsAccessBtn').getAttribute('href'),'ics-form.html');
    await page.locator('#icsAccessBtn').click();
    await page.waitForURL('**/User/ics-form.html');
    await page.locator('#submission-controlNo').waitFor({state:'visible'});
    assert.equal(await page.locator('#loginForm').count(),0);

    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:900});
      const dimensions = await page.evaluate(() => ({width:innerWidth,scroll:document.documentElement.scrollWidth}));
      assert.ok(dimensions.scroll <= dimensions.width,`Form fits ${width}px`);
    }
    const screenshotDirectory = process.env.PGENRO_QA_SCREENSHOTS;
    if (screenshotDirectory) {
      fs.mkdirSync(screenshotDirectory,{recursive:true});
      await page.setViewportSize({width:390,height:900});
      await page.screenshot({path:path.join(screenshotDirectory,'ics-form-mobile.png'),fullPage:true});
      await page.setViewportSize({width:1440,height:1000});
      await page.screenshot({path:path.join(screenshotDirectory,'ics-form-desktop.png'),fullPage:true});
    }
    await page.locator('#submitIcsBtn').click();
    assert.equal(attempts,0,'Empty required fields cannot submit');
    for (const [key,value] of Object.entries({
      controlNo:'ICS-PUBLIC-BROWSER', icsNo:'ICS-BROWSER', article:'Laptop',
      itemDescription:'Public form browser test', quantity:'2', unitCost:'1234.56',
      accountablePerson:'Juan Dela Cruz', division:'Administration'
    })) await page.locator(`[name="${key}"]`).fill(value);
    assert.match(await page.locator('#submissionTotalValue').textContent(),/2,469\.12/);
    await page.locator('#submission-quantity').fill('-1');
    await page.locator('#submitIcsBtn').click();
    assert.equal(attempts,0,'Invalid numbers cannot submit');
    await page.locator('#submission-quantity').fill('2');
    await page.locator('#submission-controlNo').fill('   ');
    await page.locator('#submitIcsBtn').click();
    assert.equal(attempts,0,'Whitespace-only required fields cannot submit');
    await page.locator('#submission-controlNo').fill('ICS-PUBLIC-BROWSER');

    await context.setOffline(true);
    await page.locator('#submitIcsBtn').click();
    assert.match(await page.locator('#icsSubmissionFeedback').textContent(),/offline/);
    assert.equal(attempts,0);
    await context.setOffline(false);
    unavailable = true;
    await page.locator('#submitIcsBtn').click();
    await page.waitForFunction(() => !document.getElementById('submitIcsBtn').disabled);
    assert.match(await page.locator('#icsSubmissionFeedback').textContent(),/ask the administrator/);
    assert.equal(await page.locator('#submission-accountablePerson').inputValue(),'Juan Dela Cruz');
    unavailable = false;
    loseResponse = true;
    await page.locator('#submitIcsBtn').click();
    await page.waitForFunction(() => !document.getElementById('submitIcsBtn').disabled);
    assert.match(await page.locator('#icsSubmissionFeedback').textContent(),/try again/);
    assert.equal((await db.query('select count(*)::int as count from public.ics_records')).rows[0].count,1);
    // Synchronous duplicate submit events must produce only one request.
    const beforeRetry = attempts;
    await page.locator('#icsSubmissionForm').evaluate(form => {
      form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    });
    await page.locator('#icsReceipt').waitFor({state:'visible'});
    assert.equal(attempts,beforeRetry + 1);
    assert.equal((await db.query('select count(*)::int as count from public.ics_records')).rows[0].count,1);
    assert.equal(await page.locator('#receiptControlNo').textContent(),'ICS-PUBLIC-BROWSER');
    assert.ok(externalRequests.filter(url => !url.includes('@supabase/')).every(url => !/\/auth\/|\/profiles\b/.test(url)));
    await page.locator('#anotherIcsBtn').click();
    assert.equal(await page.locator('#submission-controlNo').inputValue(),'');
    assert.equal(await page.locator('#submission-quantity').inputValue(),'1');
    await page.goto(`${origin}/User/login.html?next=ics`);
    await page.waitForURL('**/User/ics-form.html');
    await page.goto(`${origin}/User/ics.html`);
    await page.waitForURL(url => /\/User\/(?:login|ics-form)\.html$/.test(url.pathname));
    assert.equal(await page.locator('#slipTableBody').count(),0,'Signed-out visitors cannot open the registry');
    await context.close();

    pendingRows = (await db.query('select * from public.ics_records')).rows;
    const adminContext = await contextFor(true);
    const admin = await adminContext.newPage();
    await admin.goto(`${origin}/admin/ics-admin.html`);
    await admin.waitForFunction(() => document.getElementById('icsTableBody').textContent.includes('ICS-PUBLIC-BROWSER'));
    assert.match(await admin.locator('#icsTableBody').textContent(),/Public form/);
    assert.match(await admin.locator('#icsTableBody').textContent(),/Pending review/);
    await admin.locator('[data-action="view"]').first().click();
    await admin.locator('#approveIcsBtn').click();
    await admin.waitForFunction(() => window.__db.ics_records[0].data.status === 'Active');
    assert.equal(await admin.evaluate(() => window.__db.ics_records[0].data.reviewedBy),'QA Office Personnel');
    await adminContext.close();

    const userContext = await contextFor(true);
    const user = await userContext.newPage();
    await user.goto(`${origin}/User/ics.html`);
    await user.waitForFunction(() => Boolean(window.PGENRO_ICS));
    const denied = await user.evaluate(async () => {
      try { await window.PGENRO_ICS.save({status:'Active'},'forged'); return null; }
      catch (error) { return error.code; }
    });
    assert.equal(denied,'ICS_ADMIN_REQUIRED');
    await userContext.close();
    assert.deepEqual(errors,[],'No browser script errors');
    console.log('PASS: direct ICS button, legacy links, guest access, mobile layout, validation, offline and setup errors, retry deduplication, receipt/reset, protected registry, admin review, ordinary-user write denial.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await db.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

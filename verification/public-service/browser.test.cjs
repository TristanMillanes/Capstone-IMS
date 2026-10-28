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
    const type = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.css':'text/css', '.png':'image/png', '.pdf':'application/pdf' };
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
        if (url.includes('/rest/v1/rpc/submit_public_service_request')) {
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
          return route.fulfill({ contentType:'text/javascript', body:sdk + '\nwindow.__db.service_requests=' + JSON.stringify(pendingRows) + ';' });
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
    assert.equal(await page.locator('#icsAccessBtn').count(),0);
    assert.equal(await page.locator('#serviceRequestAccessBtn').getAttribute('href'),'service-request-form.html');
    await page.locator('#serviceRequestAccessBtn').click();
    await page.waitForURL('**/User/service-request-form.html');
    await page.locator('#request-clientName').waitFor({state:'visible'});
    assert.equal(await page.locator('#loginForm').count(),0);
    assert.equal(await page.locator('[name="serviceStatus"],[name="serviceNo"],[name="pgdhAction"]').count(),0);

    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:900});
      const dimensions = await page.evaluate(() => ({width:innerWidth,scroll:document.documentElement.scrollWidth}));
      assert.ok(dimensions.scroll <= dimensions.width,`Form fits ${width}px`);
    }
    if (process.env.PGENRO_QA_SCREENSHOTS) {
      fs.mkdirSync(process.env.PGENRO_QA_SCREENSHOTS,{recursive:true});
      for (const [width,label] of [[390,'mobile'],[1440,'desktop']]) {
        await page.setViewportSize({width,height:1000});
        await page.screenshot({path:path.join(process.env.PGENRO_QA_SCREENSHOTS,`service-request-${label}.png`),fullPage:true});
      }
    }
    await page.locator('#submitServiceRequestBtn').click();
    assert.equal(attempts,0,'Empty required fields cannot submit');
    for (const [key,value] of Object.entries({
      clientName:'PUBLIC SERVICE CLIENT',organization:'Barangay Example',contactNo:'09123456789',
      requestDetails:'Requesting 25 seedlings for our school.',location:'Lucena City'
    })) await page.locator(`[name="${key}"]`).fill(value);
    await page.locator('#submitServiceRequestBtn').click();
    assert.equal(attempts,0,'A service category or other-service description is required');
    await page.locator('#request-technicalAssistance').selectOption('Tree Growing');
    await page.locator('#request-clientName').fill('   ');
    await page.locator('#submitServiceRequestBtn').click();
    assert.equal(attempts,0,'Whitespace-only required fields cannot submit');
    await page.locator('#request-clientName').fill('PUBLIC SERVICE CLIENT');
    await page.locator('#request-emailAddress').fill('invalid');
    await page.locator('#submitServiceRequestBtn').click();
    assert.equal(attempts,0,'Invalid email cannot submit');
    await page.locator('#request-emailAddress').fill('client@example.com');
    await page.locator('#request-dateNeeded').fill('2000-01-01');
    await page.locator('#submitServiceRequestBtn').click();
    assert.equal(attempts,0,'A date before the request date cannot submit');
    await page.locator('#request-dateNeeded').fill('');

    await context.setOffline(true);
    await page.locator('#submitServiceRequestBtn').click();
    assert.match(await page.locator('#serviceRequestFeedback').textContent(),/offline/);
    assert.equal(attempts,0);
    await context.setOffline(false);
    unavailable = true;
    await page.locator('#submitServiceRequestBtn').click();
    await page.waitForFunction(() => !document.getElementById('submitServiceRequestBtn').disabled);
    assert.match(await page.locator('#serviceRequestFeedback').textContent(),/ask the administrator/);
    assert.equal(await page.locator('#request-clientName').inputValue(),'PUBLIC SERVICE CLIENT');
    unavailable = false;
    loseResponse = true;
    await page.locator('#submitServiceRequestBtn').click();
    await page.waitForFunction(() => !document.getElementById('submitServiceRequestBtn').disabled);
    assert.match(await page.locator('#serviceRequestFeedback').textContent(),/try again/);
    assert.equal((await db.query('select count(*)::int as count from public.service_requests')).rows[0].count,1);
    const beforeRetry = attempts;
    await page.locator('#publicServiceRequestForm').evaluate(form => {
      form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    });
    await page.locator('#serviceRequestReceipt').waitFor({state:'visible'});
    assert.equal(attempts,beforeRetry + 1);
    assert.equal((await db.query('select count(*)::int as count from public.service_requests')).rows[0].count,1);
    assert.match(await page.locator('#receiptServiceNo').textContent(),/^SR-\d{4}-P\d+/);
    assert.ok(externalRequests.every(url => !/\/auth\/|\/profiles\b/.test(url)));
    await page.locator('#anotherServiceRequestBtn').click();
    assert.equal(await page.locator('#request-clientName').inputValue(),'');
    assert.equal(await page.locator('#request-technicalAssistance').inputValue(),'');
    await page.goto(`${origin}/User/login.html?next=service`);
    await page.waitForURL('**/User/service-request-form.html');
    await page.goto(`${origin}/User/login.html?next=ics`);
    await page.locator('#loginForm').waitFor({state:'visible'});
    assert.ok(page.url().includes('next=ics'),'ICS still requires sign-in');
    await page.goto(`${origin}/User/service.html`);
    await page.waitForURL(url => /\/User\/login\.html$/.test(url.pathname));
    assert.equal(await page.locator('#serviceLogsTable').count(),0,'Signed-out visitors cannot open the registry');
    await context.close();

    pendingRows = (await db.query('select * from public.service_requests')).rows;
    const publicRow = pendingRows[0], publicId = publicRow.id;
    for (const [index,status] of ['Pending Review','In Progress','Completed / Closed','Disapproved / Cancelled'].entries()) {
      pendingRows.push({ id:`office-${index}`, data:{...publicRow.data,submissionSource:'admin',submittedAt:undefined,
        createdAt:'2026-01-01T00:00:00Z',serviceNo:`SR-2026-00${index+1}`,clientName:`OFFICE CLIENT ${index+1}`,serviceStatus:status} });
    }
    const adminContext = await contextFor(true);
    const admin = await adminContext.newPage();
    await admin.clock.install();
    await admin.goto(`${origin}/admin/serviceAdmin.html`);
    await admin.waitForFunction(() => document.getElementById('serviceRegistryBody').textContent.includes('PUBLIC SERVICE CLIENT'));
    assert.match(await admin.locator('#serviceRegistryBody').textContent(),/Pending Review/);
    assert.equal(await admin.locator('#serviceTotal').textContent(),'5');
    assert.equal(await admin.locator('#servicePending').textContent(),'2');
    assert.equal(await admin.locator('#serviceActive').textContent(),'1');
    assert.equal(await admin.locator('#serviceCompleted').textContent(),'1');
    assert.match(await admin.locator('#serviceReviewNoticeText').textContent(),/including 1 from the public form/);
    for(const width of [1440,390,320]) {
      await admin.setViewportSize({width,height:1000});
      assert.ok(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Admin fits ${width}px`);
      if(process.env.PGENRO_QA_SCREENSHOTS)await admin.screenshot({path:path.join(process.env.PGENRO_QA_SCREENSHOTS,`service-admin-${width}.png`),fullPage:true});
    }
    await admin.setViewportSize({width:1440,height:1000});
    await admin.locator('#serviceSourceFilter').selectOption('public');
    assert.equal(await admin.locator('#serviceRegistryBody tr').count(),1);
    assert.match(await admin.locator('#serviceRegistryBody').textContent(),/Public form/);
    await admin.locator('#serviceStatusFilter').selectOption('completed');
    assert.match(await admin.locator('#serviceRegistryBody').textContent(),/No requests match/);
    await admin.locator('#showPendingServicesBtn').click();
    assert.equal(await admin.locator('#serviceSourceFilter').inputValue(),'');
    assert.equal(await admin.locator('#serviceRegistryBody tr').count(),2);
    await admin.locator('#serviceSourceFilter').selectOption('public');
    await admin.locator('#serviceRegistrySearch').fill(publicId);
    assert.equal(await admin.locator('#serviceRegistryBody .js-load-record').count(),1,'Submission references are searchable');
    const csvDownload=admin.waitForEvent('download');
    await admin.locator('#exportServicesBtn').click();
    const csvText=fs.readFileSync(await (await csvDownload).path(),'utf8');
    assert.match(csvText,/PUBLIC SERVICE CLIENT/);assert.doesNotMatch(csvText,/OFFICE CLIENT/);
    assert.match(csvText,/Public form/);
    await admin.locator('#serviceRegistryBody .js-load-record').first().click();
    assert.equal(await admin.locator('#clientName').inputValue(),'PUBLIC SERVICE CLIENT');
    assert.equal(await admin.locator('#technicalAssistance').inputValue(),'Tree Growing');
    assert.equal(await admin.locator('#requestDetails').inputValue(),'Requesting 25 seedlings for our school.');
    assert.equal(await admin.locator('#serviceNo').evaluate(field=>field.readOnly),true);
    assert.equal(await admin.locator('#dateRequest').evaluate(field=>field.readOnly),true);
    assert.match(await admin.locator('#serviceSubmissionContext').textContent(),new RegExp(publicId));
    await admin.locator('#btnNextTab').click();
    await admin.locator('#serviceStatus').selectOption('In Progress');
    await admin.locator('#btnNextTab').click();
    await admin.locator('#receivedBy').fill('TEST RECORDS OFFICER');
    await admin.locator('#receivedRemarks').fill('Checked client details.');
    await admin.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await admin.waitForFunction(()=>document.getElementById('serviceSyncStatus').textContent.startsWith('Updated'));
    assert.equal(await admin.locator('#receivedRemarks').inputValue(),'Checked client details.','Refresh preserves unsaved form entries');
    await admin.locator('#btnSaveAction').click();
    await admin.waitForFunction(id=>window.__db.service_requests.find(row=>row.id===id).data.serviceStatus==='In Progress',publicId);
    const saved=await admin.evaluate(id=>window.__db.service_requests.find(row=>row.id===id),publicId);
    assert.equal(saved.data.submissionSource,'public');
    assert.equal(saved.data.submittedAt,publicRow.data.submittedAt);
    assert.equal(saved.data.serviceNo,publicRow.data.serviceNo);
    assert.equal(saved.data.receivedBy,'TEST RECORDS OFFICER');
    await admin.waitForFunction(()=>document.getElementById('serviceFileStatus').dataset.state==='ready',null,{timeout:30000});
    assert.equal(await admin.locator('#serviceFilePages canvas').count(),1,'Saved requests generate a real PDF preview');
    const output=process.env.PGENRO_QA_SCREENSHOTS||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'pgenro-service-admin-'));
    const pdfDownload=admin.waitForEvent('download');
    await admin.locator('#downloadServicePdfBtn').click();
    const pdfFile=path.join(output,'service-admin-generated.pdf');await (await pdfDownload).saveAs(pdfFile);
    assert.equal(fs.readFileSync(pdfFile).subarray(0,5).toString(),'%PDF-');
    const wordDownload=admin.waitForEvent('download');
    await admin.locator('#downloadServiceWordBtn').click();
    const wordFile=path.join(output,'service-admin-generated.docx');await (await wordDownload).saveAs(wordFile);
    const JSZip=require(path.join(root,'admin/vendor/jszip.min.js'));
    const wordZip=await JSZip.loadAsync(fs.readFileSync(wordFile));
    const wordXml=await wordZip.file('word/document.xml').async('string');
    for(const text of ['PUBLIC SERVICE CLIENT','TEST RECORDS OFFICER','Checked client details.',publicRow.data.serviceNo])assert.ok(wordXml.includes(text),`Word contains ${text}`);
    await admin.evaluate(()=>{
      window.__qaPrints=[];
      new MutationObserver(()=>document.querySelectorAll('iframe[title="Service request print document"]').forEach(frame=>{
        if(frame.dataset.qaPrint)return;frame.dataset.qaPrint='ready';
        frame.contentWindow.print=()=>window.__qaPrints.push({title:frame.contentDocument.title,pages:frame.contentDocument.images.length,loaded:[...frame.contentDocument.images].every(img=>img.naturalWidth>1000)});
      })).observe(document.body,{childList:true,subtree:true});
    });
    await admin.locator('#printServiceFormBtn').click();
    await admin.waitForFunction(()=>window.__qaPrints.length===1);
    const printed=await admin.evaluate(()=>window.__qaPrints[0]);
    assert.equal(printed.pages,1);assert.equal(printed.loaded,true);assert.ok(printed.title.includes(publicRow.data.serviceNo));
    const longPreview=await admin.evaluate(async id=>{
      const row=window.__db.service_requests.find(row=>row.id===id);
      await window.PGENRO_ServiceFile.view({...row.data,id:row.id,requestDetails:'Detailed environmental service request for school rehabilitation. '.repeat(50)});
      return document.querySelectorAll('#serviceFilePages canvas').length;
    },publicId);
    assert.ok(longPreview>1,'Long requests receive continuation pages');
    await admin.locator('#printServiceFormBtn').click();
    await admin.waitForFunction(()=>window.__qaPrints.length===2);
    assert.equal(await admin.evaluate(()=>window.__qaPrints[1].pages),longPreview,'Print includes every continuation page');
    if(process.env.PGENRO_QA_SCREENSHOTS)await admin.screenshot({path:path.join(output,'service-admin-file-preview.png')});
    await admin.locator('#closeServiceFileBtn').click();
    await admin.locator('#serviceRegistrySearch').fill('');
    await admin.locator('#serviceStatusFilter').selectOption('');
    await admin.locator('#serviceSourceFilter').selectOption('');
    await admin.locator('#btnNewRecord').click();
    assert.equal(await admin.locator('#serviceNo').evaluate(field=>field.readOnly),false,'Office entries can use their own service number');
    assert.equal(await admin.locator('#serviceSubmissionContext').isVisible(),false);
    await admin.locator('#serviceFormModal [data-close]').click();
    await admin.evaluate(()=>window.__db.service_requests.unshift({id:'public-service-later',data:{clientName:'LATER PUBLIC CLIENT',organization:'Test School',serviceNo:'SR-2026-P999999',serviceStatus:'Pending Review',submissionSource:'public',submittedAt:new Date().toISOString()}}));
    await admin.clock.fastForward(30000);
    await admin.waitForFunction(()=>document.getElementById('serviceRegistryBody').textContent.includes('LATER PUBLIC CLIENT'));
    assert.equal(await admin.locator('#servicePending').textContent(),'2','Polling finds newly submitted forms without a realtime event');
    await admin.evaluate(()=>{window.__realRead=window.PGENRO_Module.read;window.PGENRO_Module.read=async()=>{throw new Error('Database unavailable');};window.dispatchEvent(new Event('focus'));});
    await admin.waitForFunction(()=>document.getElementById('serviceSyncStatus').dataset.state==='error');
    assert.match(await admin.locator('#serviceRegistryBody').textContent(),/PUBLIC SERVICE CLIENT/,'Cached requests stay visible on connection failure');
    await admin.evaluate(()=>{window.PGENRO_Module.read=window.__realRead;});
    await admin.locator('#refreshServicesBtn').click();
    await admin.waitForFunction(()=>document.getElementById('serviceSyncStatus').dataset.state==='ready');
    await adminContext.close();
    assert.deepEqual(errors,[],'No browser script errors');
    console.log('PASS: Guest submission, validation/retry handling, protected registries and ICS sign-in, admin review/status/source filters, reference search, filtered CSV, metadata preservation, real PDF/Word generation, single/continuation-page print preparation, polling, connection recovery, and 1440/390/320-pixel layouts.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await db.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

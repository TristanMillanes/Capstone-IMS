// Actual HTML/JS/CSS in Chromium; Supabase responses are simulated locally.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),checks=[];
let browser,server,base;
const sdk=fs.readFileSync(path.join(root,'verification/ui/mock-sdk.js'),'utf8')+`
(() => {
 const client=window.supabase.createClient(),profile=window.__db.profiles[0];
 profile.role=window.__testRole;profile.is_active=true;profile.status='Active';
 profile.account_type=profile.role==='Admin'?'Administrator':'Standard User';
 window.__db.profiles.push({...profile,user_id:'qa-other',full_name:'Other Personnel',username:'other',email:'other@example.test',role:'User',account_type:'Standard User'});
 const callbacks=[];window.__accessCalls=[];
 client.auth.getUser=async()=>({data:{user:window.__testLogged?{id:profile.user_id,email:profile.email,user_metadata:{full_name:profile.full_name}}:null},error:null});
 client.auth.getSession=async()=>({data:{session:window.__testLogged?{user:{id:profile.user_id,email:profile.email},access_token:'verified-token'}:null},error:null});
 client.auth.onAuthStateChange=callback=>{callbacks.push(callback);return {data:{subscription:{unsubscribe(){}}}};};
 window.__testSignOut=()=>{window.__testLogged=false;callbacks.forEach(fn=>fn('SIGNED_OUT',null));};
 client.rpc=async(name,args)=>{
   window.__accessCalls.push(name);
   if(name==='is_pgenro_admin'||name==='pgenro_is_admin')return {data:window.__testAllowed&&profile.role==='Admin',error:window.__testSetupError?{code:'PGRST202'}:null};
   if(name==='pgenro_admin_list_users')return {data:null,error:{code:'42804',message:'structure of query does not match function result type'}};
   if(name==='pgenro_admin_pending_count')return {data:1,error:null};
   return {data:null,error:null};
 };
 client.functions.invoke=async(name,{body})=>{
   const row={...body.user,user_id:'qa-created',full_name:body.user.fullName,is_active:true,account_type:body.user.role==='Admin'?'Administrator':'Standard User',status:'Active'};
   window.__db.profiles.push(row);window.__mutations.push({function:name,body});return {data:{ok:true,success:true,user:row},error:null};
 };
})();
`;
async function open(file='admin/Usermanagement.html',options={}){
 const context=await browser.newContext({viewport:options.mobile?{width:390,height:844}:{width:1440,height:980},javaScriptEnabled:options.noJS!==true,reducedMotion:'reduce'});
 await context.addInitScript(options=>{
   window.__testRole=options.role||'Admin';window.__testAllowed=options.allowed!==false;window.__testLogged=options.logged!==false;window.__testSetupError=!!options.setupError;
   localStorage.setItem('pgenro_current_user',JSON.stringify({role:'Admin',fullName:'Forged cached Admin'}));
 },options);
 await context.route('**/*',route=>{
   const url=route.request().url();
   if(url.includes('@supabase/supabase-js'))return route.fulfill({contentType:'text/javascript',body:sdk});
   if(url.includes('chart.js'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'verification/ui/chart.umd.min.js'))});
   if(url.includes('lucide@'))return route.fulfill({contentType:'text/javascript',body:''});
   if(url.startsWith(base))return route.continue();
   return route.fulfill({contentType:url.includes('fonts.')?'text/css':'text/javascript',body:''});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(base+'/'+file);return {page,context,errors};
}
function pass(scenario){checks.push({scenario,result:'PASS'});console.log('PASS',scenario);}
(async()=>{
 server=http.createServer((req,res)=>{
   const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
   res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.PGENRO_CHROMIUM_EXECUTABLE||'/tmp/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 let test=await open();
 await test.page.waitForFunction(()=>document.body.dataset.directoryState==='ready');
 assert.equal(await test.page.locator('.app-layout').isVisible(),true);
 assert.equal(await test.page.locator('#userAccessGate').count(),0);
 assert.equal(await test.page.evaluate(()=>window.__accessCalls.includes('pgenro_admin_list_users')),false);
 assert.deepEqual(await test.page.locator('#userTableBody .role-badge-pill').allTextContents(),['Admin','User']);
 assert.deepEqual(await test.page.locator('#roleFilterSelect option').evaluateAll(options=>options.map(o=>o.value)),['ALL','Admin','User']);
 await test.page.locator('#openAddUserModalBtn').click();
 assert.deepEqual(await test.page.locator('#roleSelect option').evaluateAll(options=>options.map(o=>o.value)),['User','Admin']);
 await test.page.locator('#fullNameInput').fill('Created User');await test.page.locator('#usernameInput').fill('created_user');await test.page.locator('#emailInput').fill('created@example.test');
 await test.page.locator('#passwordInput').fill('TestPassword123!');await test.page.locator('#divisionSelect').selectOption('Admin Office');
 await test.page.locator('#saveUserBtn').click();
 await test.page.waitForFunction(()=>!document.getElementById('userModal').classList.contains('open'));
 assert.match(await test.page.locator('#userTableBody').innerText(),/Created User/);
 assert.equal(await test.page.evaluate(()=>window.__mutations.find(r=>r.function)?.body.user.role),'User');
 assert.deepEqual(test.errors,[]);
 await test.page.screenshot({path:path.join(__dirname,'admin-user-desktop.png'),fullPage:true});
 pass('Admin opens User Management directly, lists profiles despite a broken legacy RPC, and creates User accounts with only Admin/User choices');
 await test.page.locator('#openAddUserModalBtn').click();
 await test.page.evaluate(()=>{window.__testAllowed=false;window.dispatchEvent(new Event('focus'));});
 await test.page.waitForFunction(()=>document.body.dataset.directoryState==='unavailable');
 assert.equal(await test.page.locator('.app-layout').isVisible(),true);assert.equal(await test.page.locator('#userModal').isVisible(),false);
 assert.equal(await test.page.locator('#exportUsersBtn').isDisabled(),true);assert.doesNotMatch(await test.page.locator('#userTableBody').innerText(),/Other Personnel/);
 assert.deepEqual(test.errors,[]);await test.context.close();
 pass('Revoked or banned access clears the account directory, closes the form and disables export');
 test=await open('admin/Usermanagement.html',{role:'User'});await test.page.waitForURL('**/User/homepage.html');
 assert.deepEqual(test.errors,[]);await test.context.close();pass('User opening an Admin URL is redirected to the User workspace despite a forged Admin browser cache');
 test=await open('admin/Usermanagement.html',{logged:false});await test.page.waitForURL('**/User/login.html');
 assert.deepEqual(test.errors,[]);await test.context.close();pass('Signed-out access returns to login');
 test=await open('admin/Usermanagement.html',{setupError:true});await test.page.waitForFunction(()=>document.body.dataset.directoryState==='unavailable');
 assert.equal(await test.page.locator('.app-layout').isVisible(),true);assert.equal(await test.page.locator('#userAccessGate').count(),0);assert.match(await test.page.locator('#userTableBody').innerText(),/ADMIN_USER_ACCESS_PATCH.sql/);assert.equal(await test.page.locator('#openAddUserModalBtn').isDisabled(),true);
 assert.deepEqual(test.errors,[]);await test.context.close();pass('A database error is shown inside the registry with disabled actions; the Admin workspace remains visible without an extra access screen');
 test=await open('admin/Usermanagement.html',{mobile:true});await test.page.waitForFunction(()=>document.body.dataset.directoryState==='ready');
 assert.equal(await test.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await test.page.locator('#openAddUserModalBtn').click();assert.equal(await test.page.locator('#roleSelect').isVisible(),true);
 await test.page.screenshot({path:path.join(__dirname,'admin-user-mobile.png'),fullPage:true});
 assert.deepEqual(test.errors,[]);await test.context.close();pass('Mobile registry and account role form remain usable without horizontal page overflow');
 test=await open('admin/Usermanagement.html',{noJS:true});assert.equal(await test.page.locator('.app-layout').isVisible(),true);assert.equal(await test.page.locator('#userAccessGate').count(),0);assert.equal(await test.page.locator('#userTableBody .role-badge-pill').count(),0);await test.context.close();pass('Without JavaScript only the static Admin shell is visible, with no personnel account data or separate access card');
 for(const role of ['Admin','User']){
   test=await open('User/login.html',{role});await test.page.waitForURL(role==='Admin'?'**/admin/admin.html':'**/User/homepage.html');
   assert.deepEqual(test.errors,[]);await test.context.close();pass(role+' login routes to its corresponding workspace using the Supabase profile');
 }
 console.log(JSON.stringify({result:'PASS',scenario_groups:checks.length,hosted_changes:false}));
 fs.writeFileSync(path.join(__dirname,'browser-results.json'),JSON.stringify({result:'PASS',method:'Actual Chromium pages; local Supabase mocks',checks,hosted_changes:false},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());});

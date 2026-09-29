const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const root=require('path').resolve(__dirname,'..')+'/';
async function bridge(page,table,rows,hook){
 const queries=[],channels=[],events={},timers=[];let loaded;
 const query=t=>{let q=new Proxy({}, {get(_,key){if(key==='then')return resolve=>resolve({data:t===table?rows:[],error:null});return()=>q;}});return q;};
 const client={from(t){queries.push(t);return query(t)},channel(n){channels.push(n);return {on(){return this},subscribe(){return this}}},removeChannel(){},auth:{}};
 const document={readyState:'loading',body:{dataset:{}},addEventListener(n,f){(events[n]||=[]).push(f)},querySelectorAll(){return []},getElementById(){return null},documentElement:{dataset:{}}};
 const window={document,supabase:{createClient:()=>client},location:{pathname:'/User/'+page,href:'http://test/User/'+page},addEventListener(){},setTimeout(f){timers.push(f)},[hook]:v=>loaded=v};
 window.window=window;const storage={getItem:()=>null,setItem(){},removeItem(){}};
 const context={window,document,console,localStorage:storage,sessionStorage:storage,crypto:require('node:crypto').webcrypto,setTimeout:window.setTimeout,clearTimeout(){},URL,queueMicrotask};
 vm.runInNewContext(fs.readFileSync(root+'shared/supabase.js','utf8'),context);
 for(const f of events.DOMContentLoaded||[])await f();
 for(const f of timers)await f();
 return {loaded,queries,channels};
}
(async()=>{
 let r=await bridge('employee.html','employees',[{id:'e1',employee_id:'EMP001',first_name:'Ana',last_name:'Cruz',duty_status:'Active',designation:'Officer'}],'loadDatabaseEmployees');
 assert.equal(r.loaded[0].firstName,'Ana');assert.equal(r.loaded[0].employeeId,'EMP001');assert.equal(r.channels.length,1);assert.equal(r.queries.length,1);
 r=await bridge('travelOR.html','travel_orders',[{id:'t1',tor_no:'TO-001',traveler_name:'Ana Cruz',departure_date:'2026-09-13',return_date:'2026-09-14'}],'loadDatabaseTravelOrders');
 assert.equal(r.loaded[0].toNumber,'TO-001');assert.equal(r.loaded[0].travelerName,'Ana Cruz');assert.equal(r.loaded[0].startDate,'2026-09-13');assert.equal(r.channels.length,1);
 r=await bridge('communication.html','communications',[{id:'canonical',data:{id:'stale',subject:'Test record'},created_at:'2026-09-12'}],'loadDatabaseRecords');
 assert.equal(r.loaded[0].id,'canonical');assert.equal(r.loaded[0].subject,'Test record');assert.equal(r.channels.length,1);
 r=await bridge('officememo.html','office_memos',[],'loadDatabaseMemos');assert.equal(r.loaded.length,0);assert.equal(r.channels.length,1);
 // Navigation: at most one current link, and a hash section takes precedence.
 const source=fs.readFileSync(root+'shared/pgenro-global.js','utf8');const start=source.indexOf('  function markActiveNavigation()');const end=source.indexOf('  function navbarScrollState()',start);const fn=source.slice(start,end)+'\nmarkActiveNavigation();';
 function nav(hash){const links=['admin.html','admin.html#audit','admin.html#backup','admin.html#settings','employee-admin.html'].map(href=>({href:'http://test/admin/'+href,active:false,attrs:{},classList:{toggle(_,v){this.owner.active=v}},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]}}));links.forEach(l=>l.classList.owner=l);vm.runInNewContext(fn,{document:{querySelectorAll:()=>links},location:{href:'http://test/admin/admin.html'+hash,pathname:'/admin/admin.html',hash},URL});return links.filter(x=>x.active)}
 assert.equal(nav('').length,1);assert.equal(nav('#audit')[0].href,'http://test/admin/admin.html#audit');assert.equal(nav('#unknown')[0].href,'http://test/admin/admin.html');
 // Malformed cache must leave an empty view instead of crashing page startup.
 const employee=fs.readFileSync(root+'user-javascript/employee.js','utf8');const expression=employee.match(/let employees = (.*);/)[1];
 for(const value of ['{broken','{}','null'])assert.equal(vm.runInNewContext(expression,{window:{},localStorage:{getItem:()=>value}}).length,0);
 console.log('PASS: 4 module data bridges, single subscriptions, employee/travel mapping, canonical row IDs, 3 active-navigation states, 3 malformed-cache cases.');
})().catch(e=>{console.error(e);process.exit(1)});

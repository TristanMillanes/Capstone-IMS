const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../admincommunication.js'),'utf8');
const report=[];
const formIds=['typeSelect','controlNoInput','docTypeSelect','dateInput','officeInput','subjectInput','actionTakenInput','remarksInput','statusSelect','ocrTextInput','memoRecipientInput','memoIssuerInput','documentFileInput','editIndex'];
const memoText=(number='2026-099')=>`Republic of the Philippines\nProvincial Government\nOFFICE MEMORANDUM NO. ${number}\n\nTO: All Personnel\nFROM: Provincial ENRO\nDATE: September 30, 2026\nSUBJECT: Monthly reporting\n\nPlease submit the reports.\n`;
function setup({wrapped=false,live=true,communications=[],memos=[],requiredTypeKey=''}={}){
 const nodes=new Map(),listeners=new Map(),db={communications:structuredClone(communications),office_memos:structuredClone(memos),audit_logs:[]},storage=new Map(),files=new Map(),messages=[],navigation=[];
 if(wrapped)for(const name of Object.keys(db))db[name]=db[name].map(r=>({id:r.id,data:r}));
 let context;
 class Element{
  constructor(id=''){this.id=id;this.value='';this.textContent='';this.style={};this.dataset={};this.disabled=false;this.required=false;this.hidden=false;this.files=[];this.listeners=new Map();this.attributes={};this.children=[];this.options=[];this.parentElement={setAttribute(){}};const classes=new Set();this.classList={add:(s)=>classes.add(s),remove:(s)=>classes.delete(s),contains:(s)=>classes.has(s),toggle:(s,on)=>{if(on??!classes.has(s))classes.add(s);else classes.delete(s);}};}
  addEventListener(type,fn){const list=this.listeners.get(type)||[];list.push(fn);this.listeners.set(type,list);}
  async fire(type,event={}){for(const fn of this.listeners.get(type)||[])await fn({preventDefault(){},target:this,...event});}
  dispatchEvent(event){return true;}
  querySelector(selector){if(!this.child)this.child=new Element();return this.child;}
  querySelectorAll(){return this.id==='communicationForm'?formIds.map(get):[];}
  setAttribute(key,value){this.attributes[key]=value;}
  removeAttribute(key){delete this.attributes[key];}
  replaceChildren(...items){this.children=items;}
  add(item){this.children.push(item);}
  append(item){this.children.push(item);item.parent=this;if(this.id==='toastContainer')messages.push(item.textContent);}
  get firstElementChild(){return this.children[0];}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(item=>item!==this);}
  closest(){return this;}
  focus(){}
  reset(){for(const id of formIds)get(id).value='';}
  reportValidity(){return formIds.every(id=>{const e=get(id);return e.disabled||!e.required||e.value.trim();});}
 }
 const get=id=>{if(!nodes.has(id))nodes.set(id,new Element(id));return nodes.get(id);};
 for(const id of ['typeSelect','controlNoInput','docTypeSelect','dateInput','officeInput','subjectInput','statusSelect'])get(id).required=true;
 const document={title:'PGENRO IMS | Communications Log Admin',readyState:'loading',activeElement:null,body:new Element('body'),head:new Element('head'),getElementById:get,createElement:()=>new Element(),createElementNS:()=>new Element(),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(type,fn){const l=listeners.get(type)||[];l.push(fn);listeners.set(type,l);}};
 const flags={fail:false,denyInsert:false,denyDelete:false,unknownInsert:false,unknownDelete:false,delay:0};
 const calls=[];
 function from(table){const q={op:'read',cols:'*',ids:null,body:null,lo:0,hi:Infinity},query={select(cols){q.cols=cols;return query;},order(){return query;},range(lo,hi){q.lo=lo;q.hi=hi;return query;},limit(n){q.hi=n-1;return query;},eq(k,v){q.ids=[String(v)];return query;},in(k,v){q.ids=v.map(String);return query;},insert(body){q.op='insert';q.body=body;return query;},update(body){q.op='update';q.body=body;return query;},delete(){q.op='delete';return query;},then(resolve,reject){return (async()=>{
  if(flags.delay)await new Promise(r=>setTimeout(r,flags.delay));
  if(flags.fail)return {data:null,error:{message:'Simulated outage',code:'503'}};
  if(q.cols==='data'&&!wrapped)return {data:null,error:{message:'Column data not found',code:'42703'}};
  const rows=db[table]||=[];let result=q.ids?rows.filter(r=>q.ids.includes(String(r.id))):rows;
  if(table==='communications'&&['insert','update'].includes(q.op)&&requiredTypeKey){
   const candidate=wrapped?q.body.data:q.body;
   if(!['Incoming','Outgoing'].includes(candidate[requiredTypeKey]))return {data:null,error:{code:'P0001',message:'Invalid communication type. Use Incoming or Outgoing.'}};
  }
  if(q.op==='insert'){
   calls.push({table,op:q.op,body:structuredClone(q.body)});
   if(flags.denyInsert&&table==='office_memos')return {data:[],error:null};
   assert(!rows.some(r=>r.id===q.body.id),'duplicate database ID');
   result=[{...structuredClone(q.body),id:q.body.id||crypto.randomUUID()}];rows.push(...result);
   if(flags.unknownInsert&&table==='office_memos'){flags.unknownInsert=false;throw new Error('Connection interrupted after insert');}
  }
  if(q.op==='delete'){
   calls.push({table,op:q.op});if(flags.denyDelete&&table==='communications')return {data:[],error:null};
   db[table]=rows.filter(r=>!q.ids.includes(String(r.id)));
   if(flags.unknownDelete&&table==='communications'){flags.unknownDelete=false;throw new Error('Connection interrupted after delete');}
  }
  if(q.op==='update')result.forEach(r=>Object.assign(r,q.body));
  return {data:structuredClone(result.slice(q.lo,q.hi+1)),count:result.length,error:null};
 })().then(resolve,reject);}};return query;}
 const indexedDB={open(){const req={};setImmediate(()=>{req.result={transaction(){const tx={objectStore(){return {put(value,id){return operation('put',id,value);},get(id){return operation('get',id);},delete(id){return operation('delete',id);}};}};function operation(action,id,value){const r={};setImmediate(()=>{if(action==='put')files.set(id,value);if(action==='delete')files.delete(id);r.result=files.get(id);r.onsuccess?.();tx.oncomplete?.();});return r;}return tx;}};req.onsuccess?.();});return req;}};
 class Reader{readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result=`data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;this.onload();},()=>this.onerror());}}
 const location={href:'http://localhost/admin/admincommunication.html',assign:url=>navigation.push(url)};
 const sandbox={document,window:null,location,history:{},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},indexedDB,FileReader:Reader,File,Blob,URL,crypto,console,Event,AbortController,DOMException,TextDecoder,performance,Option:Element,setInterval,clearInterval,setTimeout:(fn,t)=>{if(t>1000)return 0;return setTimeout(fn,t);},clearTimeout,innerWidth:1440,confirm:()=>true};
 sandbox.window=sandbox;sandbox.addEventListener=()=>{};
 if(live)sandbox.pgenroSupabase={from,channel(){return {on(){return this;},subscribe(){return this;}}},removeChannel(){}};
 context=vm.createContext(sandbox);
 vm.runInContext(source,context);
 async function init(){for(const callback of listeners.get('DOMContentLoaded')||[])await callback();}
 async function open(id){if(id){const b=new Element();b.dataset={action:'edit',id};await get('communicationTableBody').fire('click',{target:{closest:()=>b}});if(get('docTypeSelect').value==='Memorandum'&&!get('memoRecipientInput').value)get('memoRecipientInput').value='All Personnel';}else await get('openEncodingModalBtn').fire('click');}
 async function upload(text=memoText(),name='memo.txt'){const file=new File([text],name,{type:'text/plain'});get('documentFileInput').files=[file];await get('documentFileInput').fire('change');await get('runOcrBtn').fire('click');return file;}
 const rows=table=>db[table].map(r=>wrapped?r.data:r);
 return {init,open,upload,get,flags,db,rows,storage,files,messages,navigation,calls,save:()=>get('communicationForm').fire('submit')};
}
async function run(name,fn){await fn();report.push({scenario:name,result:'PASS'});console.log('PASS',name);}
(async()=>{
 const typeKeys=['communicationType','communication_type','type','direction','recordType','record_type','commType','comm_type'];
 const text='OFFICE ORDER NO. 025\nTO: ALL PERSONNEL\nDATE: January 2, 2025\nSUBJECT: WORK AUGMENTATION AND SUPPORT\n\nFor your compliance.\nMARIA L. SANTOS\nDepartment Head';
 for(const key of typeKeys)for(const type of ['Incoming','Outgoing'])await run(`JSON upload passes ${key} validation for ${type}`,async()=>{
  const s=setup({wrapped:true,requiredTypeKey:key,communications:[{id:'legacy',controlNo:'LEGACY-001',[key]:'Incoming',subject:'Existing record',status:'Pending'}]});await s.init();await s.open();await s.upload(text,'office-order.txt');s.get('typeSelect').value=type;s.get('controlNoInput').value='TEST-'+key+'-'+type;s.get('docTypeSelect').value='Office Order';s.get('officeInput').value=type==='Incoming'?'MARIA L. SANTOS':'ALL PERSONNEL';await s.save();
  assert.equal(s.rows('communications').length,2,`Upload rejected: ${s.messages.join(' | ')}`);const row=s.rows('communications').find(r=>r.id!=='legacy');for(const field of typeKeys)assert.equal(row[field],type);assert.equal(row.docType,'Office Order');assert.equal(row.fileType,'text/plain');assert(s.files.has(row.attachmentId));assert.equal(await s.files.get(row.attachmentId).text(),text);assert(s.messages.some(m=>m.includes('saved successfully')));
 });
 for(const typeKey of ['type','communication_type'])await run(`Flat-column attachment upload preserves ${typeKey} schema`,async()=>{
  const s=setup({requiredTypeKey:typeKey,communications:[{id:'legacy',controlNo:'LEGACY-FLAT-1',[typeKey]:'Incoming'}]});await s.init();await s.open();await s.upload(text,'order.txt');s.get('docTypeSelect').value='Office Order';s.get('controlNoInput').value='FLAT-'+typeKey;s.get('typeSelect').value='Outgoing';s.get('officeInput').value='ALL PERSONNEL';await s.save();assert.equal(s.rows('communications').length,2);const row=s.rows('communications').find(r=>r.id!=='legacy');assert.equal(row[typeKey],'Outgoing');if(typeKey==='communication_type')assert(!Object.hasOwn(row,'type'));assert(s.files.has(row.attachmentId));
 });
 await run('Direction change updates every legacy JSON alias while retaining other fields',async()=>{
  const s=setup({wrapped:true,requiredTypeKey:'communicationType',communications:[{id:'edit',controlNo:'EDIT-1',type:'Incoming',communicationType:'Incoming',communication_type:'Incoming',docType:'Office Order',date:'2025-01-02',office:'MARIA L. SANTOS',subject:'WORK',status:'Pending',unrelatedValue:'keep'}]});await s.init();await s.open('edit');s.get('typeSelect').value='Outgoing';s.get('officeInput').value='ALL PERSONNEL';await s.save();assert.equal(s.rows('communications').length,1);const row=s.rows('communications')[0];for(const field of typeKeys)assert.equal(row[field],'Outgoing');assert.equal(row.unrelatedValue,'keep');assert.equal(row.docType,'Office Order');
 });
 await run('A failed attachment save keeps the draft and succeeds on retry',async()=>{
  const s=setup({wrapped:true,requiredTypeKey:'communicationType'});await s.init();await s.open();await s.upload(text,'retry.txt');s.get('docTypeSelect').value='Office Order';s.get('officeInput').value='MARIA L. SANTOS';s.flags.fail=true;await s.save();assert.equal(s.rows('communications').length,0);assert.equal(s.get('officeInput').value,'MARIA L. SANTOS');assert.equal(s.get('documentFileInput').files[0].name,'retry.txt');assert.equal(s.get('saveRecordBtn').disabled,false);s.flags.fail=false;await s.save();assert.equal(s.rows('communications').length,1);assert(s.files.has(s.rows('communications')[0].attachmentId));
 });
 fs.writeFileSync(path.join(__dirname,'communication_upload.json'),JSON.stringify({method:'Production module and attachment handling with simulated strict database validators; hosted trigger definition was not available',scenarios:report},null,2));console.log(`${report.length} upload scenarios passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});

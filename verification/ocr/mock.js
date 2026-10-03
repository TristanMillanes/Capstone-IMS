const mock=()=>{
 const employees=Array.from({length:23},(_,i)=>({id:String(i+1),employee_id:`EMP-2026-${String(i+1).padStart(3,'0')}`,first_name:'Staff',last_name:`Person ${String(i+1).padStart(2,'0')}`,department:i%2?'Forest Management':'Administration',designation:'Officer',employment_type:i%3?'PERMANENT':'JOB ORDER',duty_status:i%5?'Active':'On Leave',email:'staff@example.com'}));
 const communications=Array.from({length:15},(_,i)=>({id:String(i+1),controlNo:`COMM-2026-${String(i+1).padStart(5,'0')}`,type:i%2?'Incoming':'Outgoing',docType:'Memorandum',date:'2026-09-29',office:'Office of the Governor',subject:`Document ${i+1}`,status:i%3?'Received':'Pending',remarks:''}));
 window.__db={employees,communications,audit_logs:[],profiles:[],access_requests:[],travel_orders:[],office_memos:[],ics:[],inventory:[],visitors:[],service_requests:[]};
 window.__channels=[];window.__fail=false;window.__deny=false;window.__wrapped=false;
 function from(table){const q={table,op:'read',columns:'*',ids:null,body:null,lo:0,hi:Infinity};const query={
  select(columns){q.columns=columns;return query;},order(){return query;},range(lo,hi){q.lo=lo;q.hi=hi;return query;},limit(n){q.hi=n-1;return query;},eq(key,val){q.ids=[String(val)];return query;},in(key,ids){q.ids=ids.map(String);return query;},insert(body){q.op='insert';q.body=Array.isArray(body)?body:[body];return query;},update(body){q.op='update';q.body=body;return query;},delete(){q.op='delete';return query;},upsert(body){q.op='insert';q.body=[body];return query;},
  then(resolve,reject){return Promise.resolve().then(()=>{
   if(window.__fail)return {error:{message:'Simulated outage',code:'503'},data:null};
   if(q.columns==='data'&&!window.__wrapped)return {error:{message:'column data does not exist',code:'42703'},data:null};
   const rows=window.__db[q.table] ||= [];let result=q.ids?rows.filter(r=>q.ids.includes(String(r.id))):rows;
   if(q.op!=='read'&&window.__deny)return {data:[],error:null};
   if(q.op==='insert'){result=q.body.map(b=>({...b,id:b.id||crypto.randomUUID()}));rows.push(...result);}
   if(q.op==='update'){result=rows.filter(r=>q.ids.includes(String(r.id)));result.forEach(r=>Object.assign(r,q.body));}
   if(q.op==='delete'){result=rows.filter(r=>q.ids.includes(String(r.id)));window.__db[q.table]=rows.filter(r=>!q.ids.includes(String(r.id)));}
   return {data:result.slice(q.lo,q.hi+1).map(r=>({...r})),count:result.length,error:null};
  }).then(resolve,reject);}
 };return query;}
 window.pgenroSupabase={from,auth:{signOut:async()=>({error:null}),getSession:async()=>({data:{session:{user:{email:'admin@example.com'}}}})},channel(name){const chan={name,on(event,filter,callback){chan.table=filter.table;chan.callback=callback;return chan;},subscribe(){window.__channels.push(chan);return chan;}};return chan;},removeChannel:()=>{}};
};

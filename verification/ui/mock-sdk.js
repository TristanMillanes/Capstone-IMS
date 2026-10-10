(() => {
  const admin = location.pathname.includes('/admin/');
  const profile = {user_id:'qa-user',id:'qa-profile',email:'qa@example.com',full_name:'QA Office Personnel',username:'qa',role:admin?'Administrator':'System Staff',account_type:admin?'ADMIN':'USER',status:'Active',is_active:true,preferences:{}};
  const timestamp='2026-10-02T05:00:00Z';
  const base = {created_at:timestamp,updated_at:timestamp};
  window.__db = {
    profiles:[profile],audit_logs:[],admin_logs:[],access_requests:[{id:'request-1',data:{fullName:'New Personnel',email:'new@example.com',role:'System Staff',accountType:'USER',status:'Pending',division:'Administration',createdAt:timestamp}}],
    communications:[{...base,id:'comm-1',data:{controlNo:'COMM-2026-00001',type:'Incoming',docType:'Letter',date:'2026-10-01',office:'MARIA L. SANTOS',subject:'REQUEST FOR TECHNICAL ASSISTANCE',status:'Pending',remarks:''}}],
    office_memos:[{...base,id:'memo-1',data:{controlNo:'MEMO-2026-00001',memoNo:'12',subject:'WEEKLY OFFICE COORDINATION',dateIssued:'2026-10-01',date:'2026-10-01',office:'PGENRO',issuedBy:'MARIA L. SANTOS',signatory:'MARIA L. SANTOS',addressedTo:'ALL DIVISION HEADS',status:'Active',memoType:'Memorandum',priority:'Normal'}}],
    travel_orders:[{...base,id:'travel-1',data:{controlNo:'TOR-2026-00001',torNo:'TOR-2026-00001',employeeName:'MARIA L. SANTOS',traveler:'MARIA L. SANTOS',destination:'Lucena City',dateFrom:'2026-10-03',dateTo:'2026-10-04',startDate:'2026-10-03',endDate:'2026-10-04',status:'Pending',type:'Official',purpose:'Inspection'}}],
    employees:[{...base,id:'emp-1',employee_id:'EMP-2026-00001',first_name:'MARIA',last_name:'SANTOS',department:'Administration',designation:'Officer',employment_type:'PERMANENT',duty_status:'Active',email:'maria@example.com'}],
    inventory:[{...base,id:'inv-1',control_no:'INV-2026-00001',item_name:'BOND PAPER',category:'Office Supplies',unit:'REAM',quantity:30,threshold:10,description:'A4 paper',remarks:''}],
    inventory_movements:[],
    ics_records:[{...base,id:'ics-1',data:{controlNo:'ICS-2026-00001',icsNo:'ICS-2026-00001',article:'Laptop',itemDescription:'Office equipment',quantity:1,unit:'UNIT',unitCost:30000,accountablePerson:'MARIA L. SANTOS',status:'Active',dateIssued:'2026-10-01'}}],
    service_requests:[{...base,id:'service-1',data:{serviceNo:'SR-2026-00001',controlNo:'SR-2026-00001',requesterName:'MARIA L. SANTOS',clientName:'MARIA L. SANTOS',agency:'Municipal Government',category:'Technical Assistance',status:'Pending',dateRequested:'2026-10-01',subject:'Technical consultation'}}],
    visitors:[{...base,id:'visitor-1',full_name:'JUAN DELA CRUZ',contact:'09123456789',address:'Lucena City',person_to_visit:'MARIA L. SANTOS',purpose_category:'Meeting',status:'inside',time_in:timestamp,time_out:null}],
    system_settings:[]
  };
  window.__mutations=[]; window.__fail=false; window.__deny=false; window.__channels=[];
  const wrapped = new Set(['communications','office_memos','travel_orders','ics_records','service_requests','access_requests','audit_logs','admin_logs']);
  function from(table) {
    const state = {operation:'select',columns:'*',filters:[],lo:0,hi:Infinity,payload:null,single:false};
    const query = {
      select(columns='*',options={}){state.columns=columns;state.head=options.head;return query;},
      eq(key,value){state.filters.push(r=>String(r[key])===String(value));return query;},
      neq(key,value){state.filters.push(r=>String(r[key])!==String(value));return query;},
      in(key,values){state.filters.push(r=>values.map(String).includes(String(r[key])));return query;},
      is(key,value){state.filters.push(r=>r[key]===value);return query;},
      gt(){return query;},gte(){return query;},lte(){return query;},lt(){return query;},ilike(){return query;},or(){return query;},
      order(){return query;},limit(n){state.hi=n-1;return query;},range(lo,hi){state.lo=lo;state.hi=hi;return query;},
      maybeSingle(){state.single=true;return query;},single(){state.single=true;return query;},
      insert(body){state.operation='insert';state.payload=body;return query;},
      upsert(body){state.operation='upsert';state.payload=body;return query;},
      update(body){state.operation='update';state.payload=body;return query;},
      delete(){state.operation='delete';return query;},
      then(resolve,reject) {
        return Promise.resolve().then(()=> {
          if(window.__fail) return {data:null,error:{message:'Simulated unavailable database',code:'503'}};
          if(state.columns==='data'&&!wrapped.has(table))return {data:null,error:{message:'column data does not exist',code:'42703'}};
          const rows=window.__db[table] ||= [];
          let data=rows.filter(r=>state.filters.every(f=>f(r)));
          if(state.operation!=='select') {
            window.__mutations.push({table,operation:state.operation,payload:state.payload});
            if(window.__deny)return {data:[],error:null};
            if(state.operation==='insert'||state.operation==='upsert'){data=(Array.isArray(state.payload)?state.payload:[state.payload]).map(p=>({...base,...p,id:p.id||crypto.randomUUID()}));rows.push(...data);}
            if(state.operation==='update')data.forEach(r=>Object.assign(r,state.payload));
            if(state.operation==='delete')window.__db[table]=rows.filter(r=>!data.includes(r));
          }
          const count=data.length;data=data.slice(state.lo,state.hi+1).map(r=>({...r}));
          return {data:state.head?null:state.single?(data[0]||null):data,count,error:null};
        }).then(resolve,reject);
      }
    };return query;
  }
  const user={id:'qa-user',email:profile.email,user_metadata:{full_name:profile.full_name}};
  window.__signOutFailure=false;
  window.__signOutDelay=0;
  const session=()=>sessionStorage.getItem('qa_signed_out')==='true'?null:{user,access_token:'qa-token'};
  async function signOut(){
    sessionStorage.setItem('qa_signout_count',String(Number(sessionStorage.getItem('qa_signout_count')||0)+1));
    if(window.__signOutDelay)await new Promise(resolve=>setTimeout(resolve,window.__signOutDelay));
    if(window.__signOutFailure)return {error:{message:'Simulated sign-out failure'}};
    sessionStorage.setItem('qa_signed_out','true');
    return {error:null};
  }
  const client = {
    from,
    auth:{getSession:async()=>({data:{session:session()}}),getUser:async()=>({data:{user:session()?.user||null}}),signOut,onAuthStateChange(callback){queueMicrotask(()=>callback('INITIAL_SESSION',session()));return {data:{subscription:{unsubscribe(){}}}};},updateUser:async()=>({data:{user},error:null}),resetPasswordForEmail:async()=>({data:{},error:null})},
    rpc:async(name,args)=>({data:name==='pgenro_is_admin'?admin:name==='pgenro_admin_list_users'?[profile]:name==='pgenro_admin_pending_count'?1:name==='get_system_settings'?{}:{success:true},error:null}),
    channel(name){const channel={name,on(event,filter,callback){channel.table=filter.table;channel.callback=callback;return channel;},subscribe(callback){window.__channels.push(channel);callback?.('SUBSCRIBED');return channel;},unsubscribe(){}};return channel;},
    removeChannel(){},functions:{invoke:async(name,{body})=>{window.__mutations.push({function:name,body});return {data:{success:true},error:null};}},
    storage:{from(){return {upload:async(path)=>({data:{path},error:null}),getPublicUrl:path=>({data:{publicUrl:'https://example.com/'+path}}),remove:async()=>({error:null}),createSignedUrl:async()=>({data:{signedUrl:'https://example.com/fixture.pdf'},error:null})};}}
  };
  window.supabase={createClient:()=>client};
})();

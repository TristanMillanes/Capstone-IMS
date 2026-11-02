/* Official PGENRO service request document generation. All files stay in this
 * browser; Supabase remains the source of saved request data. */
(() => {
  'use strict';
  const scriptURL = document.currentScript.src;
  const assetsURL = new URL('./assets/service-request/', scriptURL);
  const vendorURL = new URL('./vendor/', scriptURL);
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const XML = 'http://www.w3.org/XML/1998/namespace';
  const $ = id => document.getElementById(id);
  const clean = value => String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  const equal = (a,b) => clean(a).toLocaleLowerCase() === clean(b).toLocaleLowerCase();
  let assetsPromise = null;
  let pdfjsPromise = null;
  let sequence = 0;
  let current = null;
  let returnToForm = false;
  let pdfTask = null;
  let printing = false;

  async function fetchAsset(name, json = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(new URL(name, assetsURL), {signal:controller.signal, cache:'force-cache'});
      if (!response.ok) throw new Error(`Missing form asset: ${name} (${response.status}).`);
      return await (json ? response.json() : response.arrayBuffer());
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The form template took too long to load. Please retry.');
      if (location.protocol === 'file:') throw new Error('Open PGENRO through your web server or Live Server to load the form template.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  function loadAssets() {
    if (!assetsPromise) assetsPromise = Promise.all([
      fetchAsset('PGENRO_Service_Request_Template.pdf'),
      fetchAsset('PGENRO_Service_Request_Template.docx'),
      fetchAsset('DejaVuSans.ttf'),
      fetchAsset('layout.json', true)
    ]).then(([pdf,docx,font,layout]) => ({pdf,docx,font,layout})).catch(error => {assetsPromise=null;throw error;});
    return assetsPromise;
  }

  function date(value) {
    const s=clean(value), match=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
    return match ? `${match[2]}/${match[3]}/${match[1]}` : s;
  }
  function time(value) {
    const s=clean(value), match=s.match(/^(\d{2}):(\d{2})/);
    if (!match) return s;
    const hour=Number(match[1]);
    return `${hour % 12 || 12}:${match[2]} ${hour>=12?'PM':'AM'}`;
  }
  const dateTime = (d,t) => [date(d),time(t)].filter(Boolean).join('\n');

  function documentValues(record) {
    const d=record || {}, v={};
    for (const key of ['clientName','organization','contactNo','emailAddress','serviceNo','location','requestedBy','notedBy','otherServices','receivedBy','receivedRemarks','assessedBy','assessedRemarks','recommendedBy','recommendedRemarks','processedBy','processedRemarks','serviceReceivedBy','clientRemarks']) v[key]=clean(d[key]);
    v.dateRequest=date(d.dateRequest); v.dateNeeded=date(d.dateNeeded);
    const select=(field,main,choices,other,text) => {
      const value=clean(d[field]);v[main]=Boolean(value);
      for(const [key,label] of choices) v[key]=Boolean(value)&&equal(value,label);
      v[other]=Boolean(value)&&!choices.some(([,label])=>equal(value,label));
      v[text]=v[other]?value:'';
    };
    select('technicalAssistance','taMain',[
      ['taTree','Tree Growing'],['taWaste','Waste Analysis and Characterization Study'],['taPlan','Formulation/Review of 10-Year SWM Plan']
    ],'taOthers','taOtherText');
    select('iecService','iecMain',[
      ['iecSpeaker','Request for Speaker'],['iecInfo','Request for Information'],['iecInterview','Request for Interview']
    ],'iecOthers','iecOtherText');
    select('environmentalConcerns','envMain',[
      ['envWaste','Solid Waste'],['envAir','Air Quality'],['envWater','Water Quality'],['envWildlife','Wildlife'],['envResources','Natural Resources']
    ],'envOthers','envOtherText');
    select('certifications','certMain',[['certSwm','SWM Compliance']],'certOthers','certOtherText');
    v.plantingMain=Boolean(clean(d.plantingMaterials));v.otherMain=Boolean(v.otherServices);
    const attachmentFlag=typeof d.hasAttachments==='boolean'?d.hasAttachments:(Array.isArray(d.attachments)?d.attachments.length>0:null);
    v.withDocuments=attachmentFlag===true;v.withoutDocuments=attachmentFlag===false;
    v.approved=equal(d.pgdhAction,'Approved');v.disapproved=equal(d.pgdhAction,'Disapproved');
    v.pgdhInstructions=[clean(d.pgdhAction)&&!v.approved&&!v.disapproved?`Action: ${clean(d.pgdhAction)}`:'',clean(d.pgdhInstructions)].filter(Boolean).join('\n');
    v.requestDetails=[v.plantingMain?`Planting materials: ${clean(d.plantingMaterials)}`:'',clean(d.requestDetails)].filter(Boolean).join('\n');
    for(const [prefix,receivedDate,receivedTime,actedDate,actedTime] of [
      ['received','dateReceived','timeReceived','receivedDateActed','receivedTimeActed'],
      ['assessed','dateAssessed','timeAssessed','assessedDateActed','assessedTimeActed'],
      ['recommended','recommendedDate','recommendedTime','recommendedDateActed','recommendedTimeActed'],
      ['pgdh','pgdhDateReceived','pgdhTimeReceived','pgdhDateActed','pgdhTimeActed'],
      ['processed','dateProcessed','timeProcessed','processedDateActed','processedTimeActed'],
      ['client','clientDateReceived','clientTimeReceived','clientDateActed','clientTimeActed']
    ]) {v[prefix+'Receipt']=dateTime(d[receivedDate],d[receivedTime]);v[prefix+'Acted']=dateTime(d[actedDate],d[actedTime]);}
    return v;
  }

  function wrap(value, font, size, width) {
    const lines=[];
    for(const paragraph of clean(value).split('\n')) {
      if(!paragraph){lines.push('');continue;}
      let line='';
      for(const word of paragraph.split(/\s+/)) {
        const combined=line?`${line} ${word}`:word;
        if(font.widthOfTextAtSize(combined,size)<=width){line=combined;continue;}
        if(line){lines.push(line);line='';}
        if(font.widthOfTextAtSize(word,size)<=width){line=word;continue;}
        for(const char of word) {
          if(line&&font.widthOfTextAtSize(line+char,size)>width){lines.push(line);line='';}
          line+=char;
        }
      }
      if(line)lines.push(line);
    }
    return lines;
  }

  function fit(value, box, font) {
    if(!clean(value))return {text:'',size:box.size,lines:[],overflow:false};
    for(let size=box.size;size>=box.minSize;size-=0.5) {
      const lines=wrap(value,font,size,box.width);
      if(lines.length*box.lineHeight*(size/box.size)<=box.height+0.1)
        return {text:lines.join('\n'),size,lines,overflow:false};
    }
    const size=Math.max(6.5,box.minSize);
    return {text:'See continuation',lines:['See continuation'],size,overflow:true};
  }

  async function generate(record) {
    if(!window.PDFLib||!window.fontkit||!window.JSZip) throw new Error('The document tools could not load. Copy the vendor folder beside serviceAdmin.html, then refresh.');
    const assets=await loadAssets();
    const pdf=await PDFLib.PDFDocument.load(assets.pdf.slice(0));
    pdf.registerFontkit(window.fontkit);
    const font=await pdf.embedFont(assets.font.slice(0),{subset:true});
    const values=documentValues(record),display={},overflow=[];
    const page=pdf.getPage(0),height=page.getHeight();
    for(const box of assets.layout.fields) {
      const value=values[box.tag] || '';
      const fitted=fit(value,box,font);display[box.tag]=fitted;
      if(fitted.overflow)overflow.push({label:box.label,value:clean(value)});
      const step=box.lineHeight*(fitted.size/box.size);
      fitted.lines.forEach((line,index) => page.drawText(line,{x:box.x,y:height-box.y-fitted.size-index*step,size:fitted.size,font,color:PDFLib.rgb(0,0,0)}));
    }
    for(const box of assets.layout.checkboxes) {
      if(!values[box.tag])continue;
      const opts={color:PDFLib.rgb(0,0,0),thickness:0.9};
      page.drawLine({start:{x:box.x+0.7,y:height-box.y-0.7},end:{x:box.x+box.size-0.7,y:height-box.y-box.size+0.7},...opts});
      page.drawLine({start:{x:box.x+0.7,y:height-box.y-box.size+0.7},end:{x:box.x+box.size-0.7,y:height-box.y-0.7},...opts});
    }
    if(overflow.length) {
      let extra,y=0,number=0;
      const newPage=()=>{
        extra=pdf.addPage([612,936]);number++;
        extra.drawText('SERVICE REQUEST CONTINUATION',{x:54,y:879,font,size:14});
        extra.drawText(`${clean(record.serviceNo)||'Service request'}  |  Continuation ${number}`,{x:54,y:858,font,size:9});
        y=827;
      };
      newPage();
      for(const item of overflow) {
        if(y<125)newPage();
        for(const labelLine of wrap(item.label,font,10,504)) {
          extra.drawText(labelLine,{x:54,y,font,size:10});y-=14;
        }
        for(const line of wrap(item.value,font,10,504)) {
          if(y<72)newPage();
          extra.drawText(line,{x:54,y,font,size:10});y-=14;
        }
        y-=14;
      }
    }
    pdf.setTitle(`PGENRO Service Request ${clean(record.serviceNo)}`);
    pdf.setSubject('Environment and Natural Resources Services Request Form');
    pdf.setProducer('PGENRO IMS');
    return {pdf:new Blob([await pdf.save()],{type:'application/pdf'}),record:{...record},values,display,overflow,assets};
  }

  function element(doc,name,attrs={}) {
    const el=doc.createElementNS(W,`w:${name}`);
    for(const [key,value] of Object.entries(attrs))el.setAttributeNS(W,`w:${key}`,String(value));
    return el;
  }
  function wordRun(doc,text,size=9) {
    const r=element(doc,'r'),rp=element(doc,'rPr');
    rp.append(element(doc,'rFonts',{ascii:'DejaVu Sans',hAnsi:'DejaVu Sans'}),element(doc,'sz',{val:Math.round(size*2)}));r.append(rp);
    clean(text).split('\n').forEach((line,index)=>{
      if(index)r.append(element(doc,'br'));
      const t=element(doc,'t');t.setAttributeNS(XML,'xml:space','preserve');t.textContent=line;r.append(t);
    });
    return r;
  }

  async function wordDocument(result) {
    const zip=await JSZip.loadAsync(result.assets.docx.slice(0));
    const entry=zip.file('word/document.xml');
    if(!entry)throw new Error('The Word template is invalid.');
    const doc=new DOMParser().parseFromString(await entry.async('string'),'application/xml');
    if(doc.getElementsByTagName('parsererror').length)throw new Error('The Word template could not be read.');
    for(const sdt of doc.getElementsByTagNameNS(W,'sdt')) {
      const tag=sdt.getElementsByTagNameNS(W,'tag')[0]?.getAttributeNS(W,'val');
      if(!tag)continue;
      const content=sdt.getElementsByTagNameNS(W,'sdtContent')[0];
      if(!content)continue;
      const value=result.values[tag],fitted=result.display[tag];
      const text=typeof value==='boolean'?(value?'\u2612':'\u2610'):(fitted?.text??clean(value));
      content.replaceChildren(wordRun(doc,text,fitted?.size||(typeof value==='boolean'?9:8.5)));
    }
    if(result.overflow.length) {
      const body=doc.getElementsByTagNameNS(W,'body')[0];
      const sect=Array.from(body.children).find(e=>e.localName==='sectPr');
      const insertP=(text,size=10,extra={})=>{
        const p=element(doc,'p'),pp=element(doc,'pPr');
        pp.append(element(doc,'spacing',{after:extra.after??120,line:Math.round((size+3)*20),lineRule:'exact'}));
        if(extra.keepNext)pp.append(element(doc,'keepNext'));
        p.append(pp,wordRun(doc,text,size));body.insertBefore(p,sect);return p;
      };
      // Start a normal continuation section. Keep the original first-page setup.
      const boundary=element(doc,'p'),props=element(doc,'pPr'),firstSect=sect.cloneNode(true);
      let type=firstSect.getElementsByTagNameNS(W,'type')[0];
      if(!type){type=element(doc,'type');firstSect.append(type);}type.setAttributeNS(W,'w:val','nextPage');
      props.append(firstSect);boundary.append(props);body.insertBefore(boundary,sect);
      const margins=sect.getElementsByTagNameNS(W,'pgMar')[0];
      margins?.setAttributeNS(W,'w:top','1080');margins?.setAttributeNS(W,'w:bottom','1440');
      insertP('SERVICE REQUEST CONTINUATION',14,{keepNext:true});
      insertP(clean(result.record.serviceNo),9,{after:240,keepNext:true});
      for(const item of result.overflow) {
        insertP(item.label,10,{keepNext:true});
        insertP(item.value,10,{after:240});
      }
    }
    zip.file('word/document.xml',new XMLSerializer().serializeToString(doc));
    return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',compression:'DEFLATE',compressionOptions:{level:3}});
  }

  function filename(record,ext) {
    return `PGENRO_Service_Request_${clean(record.serviceNo).replace(/[^a-zA-Z0-9_.-]/g,'_')||'Form'}.${ext}`;
  }
  function download(blob,name) {
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function enabled(ready) {
    for(const id of ['downloadServicePdfBtn','downloadServiceWordBtn','openServicePdfBtn'])$(id).disabled=!ready;
    $('printServiceFormBtn').disabled=!ready||printing;
  }
  async function destroyPreview() {
    const task=pdfTask;pdfTask=null;
    if(task)try{await task.destroy();}catch{}
  }

  function loadPdfLibrary() {
    if(!pdfjsPromise)pdfjsPromise=import(new URL('pdf.mjs',vendorURL).href).then(lib=>{
      lib.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.mjs',vendorURL).href;return lib;
    }).catch(error=>{pdfjsPromise=null;throw error;});
    return pdfjsPromise;
  }

  async function renderPreview(result,token) {
    const pdfjs=await loadPdfLibrary();
    if(token!==sequence)return;
    const data=new Uint8Array(await result.pdf.arrayBuffer());
    const task=pdfjs.getDocument({data,isEvalSupported:false});pdfTask=task;
    const pdf=await task.promise;
    if(token!==sequence){await task.destroy();return;}
    $('serviceFilePages').replaceChildren();
    for(let i=1;i<=pdf.numPages;i++) {
      if(token!==sequence)return;
      const p=await pdf.getPage(i),view=p.getViewport({scale:1});
      const width=Math.max(240,Math.min(1000,$('serviceFilePages').clientWidth-32));
      const scale=(width/view.width)*Math.min(devicePixelRatio||1,2);
      const vp=p.getViewport({scale});
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
      canvas.style.width=`${width}px`;canvas.style.maxWidth='100%';canvas.style.height='auto';
      canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`Completed service request, page ${i} of ${pdf.numPages}`);
      $('serviceFilePages').append(canvas);
      await p.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
    }
    if(token===sequence){$('serviceFileStatus').textContent=`${pdf.numPages} page${pdf.numPages===1?'':'s'} ready. Use Open PDF for selectable text.`;$('serviceFileStatus').dataset.state='ready';}
  }

  async function printForm() {
    if(!current||printing)return;
    const result=current,button=$('printServiceFormBtn');
    let task=null,frame=null;
    printing=true;button.disabled=true;button.textContent='Preparing print…';
    try {
      const pdfjs=await loadPdfLibrary();
      task=pdfjs.getDocument({data:new Uint8Array(await result.pdf.arrayBuffer()),isEvalSupported:false});
      const pdf=await task.promise,images=[];
      let pageSize=null;
      for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++) {
        const page=await pdf.getPage(pageNumber),size=page.getViewport({scale:1}),view=page.getViewport({scale:2});
        pageSize ||= size;
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
        await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;
        images.push(canvas.toDataURL('image/png'));
        canvas.width=canvas.height=0;
      }
      if(current!==result)return;
      frame=document.createElement('iframe');
      frame.title='Service request print document';frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;
      frame.style.cssText='position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0';
      document.body.append(frame);
      const doc=frame.contentDocument;
      doc.open();doc.write('<!doctype html><html><head><title>Service Request</title></head><body></body></html>');doc.close();
      doc.title=`PGENRO Service Request ${clean(result.record.serviceNo)}`;
      const style=doc.createElement('style');
      style.textContent=`@page{size:${pageSize.width}pt ${pageSize.height}pt;margin:0}html,body{margin:0;padding:0}img{display:block;width:100%;height:auto;break-after:page;page-break-after:always}img:last-child{break-after:auto;page-break-after:auto}`;
      doc.head.append(style);
      for(const source of images){const img=doc.createElement('img');img.alt='Completed service request page';img.src=source;doc.body.append(img);}
      await Promise.all([...doc.images].map(img=>img.decode()));
      if(current!==result){frame.remove();return;}
      const printFrame=frame;
      printFrame.contentWindow.addEventListener('afterprint',()=>printFrame.remove(),{once:true});
      setTimeout(()=>printFrame.remove(),120000);
      printFrame.contentWindow.focus();printFrame.contentWindow.print();
      void window.PGENRO_Module.audit('Print Service Request Form',{recordId:result.record.id,serviceNo:result.record.serviceNo});
    }catch(error){frame?.remove();window.PGENRO_Module.toast(`The print form could not be prepared: ${error.message}. You can download the PDF and print it.`,'error');}
    finally{if(task)try{await task.destroy();}catch{}printing=false;button.disabled=!current;button.textContent='Print Form';}
  }

  async function view(record,{fromForm=false,saved=false}={}) {
    const M=window.PGENRO_Module;
    if(!M?.canStartAction())return;
    const token=++sequence;
    await destroyPreview();current=null;returnToForm=fromForm;
    $('serviceFilePages').replaceChildren();enabled(false);
    $('serviceFileRetryBtn').hidden=true;
    $('serviceFileStatus').textContent='Filling the official service request form…';$('serviceFileStatus').dataset.state='loading';
    $('serviceFileTitle').textContent=`${clean(record.serviceNo)||'Service Request'} — View File`;
    $('serviceFileNote').textContent=fromForm?'Preview of your current entries. Save the form to update the record.':(saved?'Record saved. The completed form is ready.':'Completed form from the saved request.');
    $('closeServiceFileBtn').textContent=fromForm?'Back to Form':'Close';
    if(M.openModal('serviceFileModal')===false)return;
    const snapshot=JSON.parse(JSON.stringify(record));
    $('serviceFileRetryBtn').onclick=()=>view(snapshot,{fromForm,saved});
    try {
      const result=await generate(snapshot);
      if(token!==sequence)return;
      current=result;enabled(true);
      await renderPreview(result,token);
      if(!fromForm)void M.audit('View Service Request File',{recordId:record.id,serviceNo:record.serviceNo});
    } catch(error) {
      if(token!==sequence)return;
      $('serviceFileStatus').textContent=current?`The preview could not display. Download or open the completed PDF below. ${error.message}`:`Unable to generate the file. ${error.message}`;
      $('serviceFileStatus').dataset.state='error';$('serviceFileRetryBtn').hidden=false;
    }
  }

  document.addEventListener('DOMContentLoaded',()=>{
    $('printServiceFormBtn').addEventListener('click',printForm);
    $('downloadServicePdfBtn').addEventListener('click',()=>{
      if(!current)return;download(current.pdf,filename(current.record,'pdf'));
      void window.PGENRO_Module.audit('Download Service Request PDF',{recordId:current.record.id,serviceNo:current.record.serviceNo});
    });
    $('downloadServiceWordBtn').addEventListener('click',async()=>{
      if(!current)return;
      const button=$('downloadServiceWordBtn'),result=current;button.disabled=true;button.textContent='Creating Word file…';
      try {
        download(await wordDocument(result),filename(result.record,'docx'));
        void window.PGENRO_Module.audit('Download Service Request Word',{recordId:result.record.id,serviceNo:result.record.serviceNo});
      }catch(error){window.PGENRO_Module.toast(`Word file could not be created: ${error.message}`,'error');}
      finally{button.disabled=!current;button.textContent='Download Word';}
    });
    $('openServicePdfBtn').addEventListener('click',()=>{
      if(!current)return;
      const result=current,url=URL.createObjectURL(result.pdf);
      const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),120000);
    });
    $('closeServiceFileBtn').addEventListener('click',()=>window.PGENRO_Module.closeModal('serviceFileModal'));
    $('serviceFileModal').addEventListener('pgenro:modal-close',()=>{
      sequence++;current=null;void destroyPreview();$('serviceFilePages').replaceChildren();enabled(false);
      const back=returnToForm;returnToForm=false;
      if(back)queueMicrotask(()=>{
        if(!document.querySelector('.modal-overlay.open,.modal-backdrop.open,.admin-modal.open'))window.PGENRO_Module.openModal('serviceFormModal');
      });
    });
  },{once:true});
  window.PGENRO_ServiceFile={view,generate,wordDocument,documentValues};
})();

/* Direct preview for attachments and generated documents in the User workspace. */
(() => {
  'use strict';
  const base=new URL('vendor/pdfjs/',document.currentScript.src);
  const maxBytes=50*1024*1024;
  let reader=null, library=null;
  const element=(tag,cls='',text)=>{const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const control=(label,action)=>{const node=element('button','viewer-button',label);node.type='button';node.addEventListener('click',action);return node;};
  function safeURL(value){
    const url=new URL(String(value),location.href);
    if(['https:','http:'].includes(url.protocol))return url.href;
    if(url.protocol==='blob:'&&url.origin===location.origin)return url.href;
    if(/^data:(?:application\/(?:pdf|octet-stream|msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.(?:wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))|image\/(?:png|jpeg|gif|webp|bmp|tiff)|text\/(?:plain|csv))(?:;[^,]*)?,/i.test(String(value)))return String(value);
    throw new Error('This file link cannot be opened. Ask the administrator to check the attachment.');
  }
  function message(state,title,body){state.message.replaceChildren(element('h3','',title),element('p','',body));state.message.hidden=false;}
  function release(state){
    state.version++;state.abort?.abort();state.renderTask?.cancel();
    if(state.pdfTask)Promise.resolve(state.pdfTask.destroy()).catch(()=>{});
    if(state.objectURL)URL.revokeObjectURL(state.objectURL);
    if(state.printURL)URL.revokeObjectURL(state.printURL);
    state.printFrame?.remove();state.canvas.width=state.canvas.height=0;
  }
  async function pdfLibrary(){
    if(!library)library=import(new URL('pdf.min.mjs',base)).then(pdf=>{pdf.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.min.mjs',base).href;return pdf;}).catch(error=>{library=null;throw error;});
    return library;
  }
  async function renderPage(state){
    if(!state.pdf||reader!==state)return;
    const version=++state.renderVersion;state.renderTask?.cancel();
    state.chain=state.chain.catch(()=>{}).then(async()=>{
      if(reader!==state||version!==state.renderVersion)return;
      state.stage.setAttribute('aria-busy','true');
      const page=await state.pdf.getPage(state.page);
      if(reader!==state||version!==state.renderVersion)return;
      const original=page.getViewport({scale:1,rotation:state.rotation});
      const fit=Math.max(180,state.stage.clientWidth-48)/original.width;
      const scale=state.zoom.value==='fit'?fit:Number(state.zoom.value);
      const viewport=page.getViewport({scale,rotation:state.rotation});
      const ratio=Math.min(devicePixelRatio||1,2,Math.sqrt(12000000/(viewport.width*viewport.height)));
      state.canvas.width=Math.ceil(viewport.width*ratio);state.canvas.height=Math.ceil(viewport.height*ratio);
      state.canvas.style.width=`${viewport.width}px`;state.canvas.style.height=`${viewport.height}px`;
      state.canvas.setAttribute('aria-label',`Page ${state.page} of ${state.pdf.numPages}`);
      const task=page.render({canvasContext:state.canvas.getContext('2d'),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]});state.renderTask=task;
      await task.promise;
      if(reader!==state||version!==state.renderVersion)return;
      const content=await page.getTextContent();
      if(reader!==state||version!==state.renderVersion)return;
      state.pageText.textContent=content.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('');
      state.canvas.hidden=false;state.pageInput.value=String(state.page);state.pageTotal.textContent=`of ${state.pdf.numPages}`;
      state.previous.disabled=state.page<=1;state.next.disabled=state.page>=state.pdf.numPages;
      state.status.textContent=`Page ${state.page} of ${state.pdf.numPages}`;state.stage.setAttribute('aria-busy','false');page.cleanup();
    }).catch(error=>{if(reader===state&&error.name!=='RenderingCancelledException'){console.warn('Attachment page preview failed:',error);message(state,'Page preview unavailable','Use Open in tab or Download to read this file.');state.status.textContent='Preview unavailable';state.stage.setAttribute('aria-busy','false');}});
    return state.chain;
  }
  function updateImage(state){
    if(state.kind!=='image')return;
    const scale=state.zoom.value==='fit'?1:Number(state.zoom.value);
    state.image.style.width=state.zoom.value==='fit'?'':`${state.image.naturalWidth*scale}px`;
    state.image.style.maxWidth=state.zoom.value==='fit'?'100%':'none';state.image.style.transform=`rotate(${state.rotation}deg)`;
  }
  function create(file){
    const last=document.activeElement;
    const dialog=element('dialog','viewer-document-dialog');dialog.setAttribute('aria-labelledby','viewerDocumentTitle');
    const state={dialog,version:0,renderVersion:0,page:1,rotation:0,pdf:null,pdfTask:null,chain:Promise.resolve(),objectURL:'',abort:new AbortController(),kind:''};
    const header=element('header','viewer-dialog-header'),heading=element('div','viewer-document-heading');
    heading.append(element('span','viewer-kicker',file.reference||'Attachment'));
    const title=element('h2','',file.name||file.title||'Document');title.id='viewerDocumentTitle';heading.append(title);
    const close=control('Close',()=>dialog.close());close.setAttribute('aria-label','Close file viewer');header.append(heading,close);
    const tools=element('div','viewer-document-tools');tools.setAttribute('aria-label','Document controls');
    const previous=control('Previous',()=>{if(state.page>1){state.page--;renderPage(state);}}),next=control('Next',()=>{if(state.pdf&&state.page<state.pdf.numPages){state.page++;renderPage(state);}});
    const pageLabel=element('label','viewer-page-label','Page '),pageInput=element('input');pageInput.type='number';pageInput.min='1';pageInput.value='1';pageInput.setAttribute('aria-label','Go to PDF page');
    const pageTotal=element('span','','of 1');pageLabel.append(pageInput,pageTotal);
    pageInput.addEventListener('change',()=>{if(!state.pdf)return;state.page=Math.max(1,Math.min(state.pdf.numPages,Math.floor(Number(pageInput.value))||1));renderPage(state);});
    const zoom=element('select');zoom.setAttribute('aria-label','Document zoom');[['fit','Fit width'],['0.75','75%'],['1','100%'],['1.5','150%'],['2','200%']].forEach(([value,label])=>zoom.add(new Option(label,value)));
    zoom.addEventListener('change',()=>{if(state.pdf)renderPage(state);else updateImage(state);});
    const rotate=control('Rotate',()=>{state.rotation=(state.rotation+90)%360;if(state.pdf)renderPage(state);else updateImage(state);});
    const expand=control('Expand',()=>{dialog.classList.toggle('viewer-expanded');expand.textContent=dialog.classList.contains('viewer-expanded')?'Restore':'Expand';expand.setAttribute('aria-pressed',String(dialog.classList.contains('viewer-expanded')));if(state.pdf)requestAnimationFrame(()=>renderPage(state));});expand.setAttribute('aria-pressed','false');
    const open=element('a','viewer-button','Open in tab');open.target='_blank';open.rel='noopener noreferrer';open.hidden=true;
    const download=element('a','viewer-button viewer-file-button','Download');download.download=file.name||'document';download.hidden=true;
    const print=control('Print',()=>printFile(state));print.disabled=true;
    tools.append(previous,pageLabel,next,zoom,rotate,expand,open,download,print);
    [previous,pageLabel,next,zoom,rotate].forEach(node=>node.hidden=true);
    const stage=element('div','viewer-document-stage');stage.setAttribute('tabindex','0');stage.setAttribute('aria-label','File preview');
    const canvas=element('canvas'),image=element('img'),plain=element('pre','viewer-file-text'),info=element('div','viewer-document-message');
    image.alt=file.name||'Attachment';[canvas,image,plain].forEach(node=>node.hidden=true);stage.append(info,canvas,image,plain);
    const textDetails=element('details','viewer-page-text');textDetails.hidden=true;const pageText=element('pre');textDetails.append(element('summary','','Read or copy page text'),pageText);
    const status=element('p','viewer-document-status');status.setAttribute('role','status');status.textContent='Preparing file…';
    dialog.append(header,tools,stage,textDetails,status);
    Object.assign(state,{stage,canvas,image,plain,message:info,pageInput,pageTotal,previous,next,zoom,rotate,open,download,print,status,textDetails,pageText});
    dialog.addEventListener('keydown',event=>{
      event.stopPropagation();if(event.target.closest('input,select,textarea'))return;
      if(event.key==='ArrowRight'&&state.pdf){event.preventDefault();next.click();}if(event.key==='ArrowLeft'&&state.pdf){event.preventDefault();previous.click();}
    });
    dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
    dialog.addEventListener('close',()=>{release(state);dialog.remove();if(reader===state)reader=null;last?.focus?.({preventScroll:true});},{once:true});
    document.body.append(dialog);dialog.showModal();return state;
  }
  async function printFile(state){
    if(!state.objectURL)return;
    state.print.disabled=true;
    const frame=element('iframe','viewer-print-frame');frame.title='Print attachment';state.printFrame?.remove();state.printFrame=frame;
    let contentURL=state.objectURL;
    if(state.kind!=='pdf'){
      const doc=document.implementation.createHTMLDocument('Print attachment');
      const style=doc.createElement('style');style.textContent='img{max-width:100%;height:auto}pre{white-space:pre-wrap;font:12pt sans-serif}';doc.head.append(style);
      if(state.kind==='image'){const img=doc.createElement('img');img.src=state.objectURL;doc.body.append(img);}else{const pre=doc.createElement('pre');pre.textContent=state.plain.textContent;doc.body.append(pre);}
      if(state.printURL)URL.revokeObjectURL(state.printURL);state.printURL=URL.createObjectURL(new Blob(['<!doctype html>'+doc.documentElement.outerHTML],{type:'text/html'}));contentURL=state.printURL;
    }
    frame.onload=()=>{if(reader!==state)return;try{frame.contentWindow.focus();frame.contentWindow.print();}catch{window.PGENRO_ViewerUI.notify('Use Open in tab, then choose Print in your browser.');}state.print.disabled=false;};
    frame.src=contentURL;document.body.append(frame);
    setTimeout(()=>{if(reader===state)state.print.disabled=false;},3000);
  }
  async function open(file){
    reader?.dialog.close();const state=create(file);reader=state;const version=state.version;
    const isCurrent=()=>reader===state&&version===state.version&&state.dialog.open;
    const generated=typeof file.loadBlob==='function';
    message(state,generated?'Generating request form…':'Opening file…',
      generated?'Filling the official form from the saved request.':'Preparing your attachment.');
    const timeout=generated?null:setTimeout(()=>state.abort.abort(),25000);
    try{
      let blob;
      if(generated){
        blob=await file.loadBlob();
      }else{
        const api=window.PGENRO_API?.getDocumentUrl;
        const resolved=api?await Promise.race([api.call(window.PGENRO_API,file.url),new Promise((_,reject)=>state.abort.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))]):file.url;
        if(!isCurrent())return;
        const url=safeURL(resolved);state.open.href=url;state.open.hidden=false;
        const response=await fetch(url,{signal:state.abort.signal});
        if(!response.ok)throw new Error('The attachment could not be retrieved. It may have moved or your account may not have access.');
        if(Number(response.headers.get('Content-Length'))>maxBytes)throw new Error('This file is larger than 50 MB. Use Open in tab to view it.');
        blob=await response.blob();
        if(blob.size>maxBytes)throw new Error('This file is larger than 50 MB. Use Open in tab to view it.');
      }
      if(!isCurrent())return;
      if(!(blob instanceof Blob))throw new Error('The request form could not be generated. Please try again.');
      const bytes=new Uint8Array(await blob.arrayBuffer());if(!isCurrent())return;
      state.objectURL=URL.createObjectURL(blob);state.open.href=state.objectURL;state.open.hidden=false;
      state.download.href=state.objectURL;state.download.hidden=false;
      const signature=new TextDecoder('ascii').decode(bytes.subarray(0,1024));const mime=blob.type.split(';')[0].toLowerCase();
      if(signature.includes('%PDF-')||mime==='application/pdf'){
        state.kind='pdf';state.status.textContent='Loading PDF…';
        const pdf=await pdfLibrary();if(!isCurrent())return;
        state.pdfTask=pdf.getDocument({data:bytes,isEvalSupported:false,cMapUrl:new URL('cmaps/',base).href,cMapPacked:true,standardFontDataUrl:new URL('standard_fonts/',base).href,wasmUrl:new URL('wasm/',base).href});
        state.pdf=await state.pdfTask.promise;if(!isCurrent())return;
        state.message.hidden=true;state.textDetails.hidden=false;state.pageInput.max=String(state.pdf.numPages);
        [state.previous,state.pageInput.parentElement,state.next,state.zoom,state.rotate].forEach(node=>node.hidden=false);state.print.disabled=false;await renderPage(state);
      }else if(/^image\/(?:png|jpeg|gif|webp|bmp)$/.test(mime)||/\.(?:png|jpe?g|gif|webp|bmp)$/i.test(file.name)){
        state.kind='image';state.image.onload=()=>{if(reader===state){state.message.hidden=true;state.image.hidden=false;state.status.textContent=`${state.image.naturalWidth} × ${state.image.naturalHeight} pixels`;updateImage(state);}};
        state.image.onerror=()=>message(state,'Image preview unavailable','Use Download to open this attachment.');state.image.src=state.objectURL;state.zoom.hidden=state.rotate.hidden=false;state.print.disabled=false;
      }else if(/^text\/(?:plain|csv|tab-separated-values)$/.test(mime)||/\.(?:txt|csv|log)$/i.test(file.name)){
        state.kind='text';const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
        state.plain.textContent=new TextDecoder(encoding).decode(bytes);state.plain.hidden=false;state.message.hidden=true;state.status.textContent='Text document';state.print.disabled=false;
      }else{
        // Unknown attachments are downloaded as bytes; never execute an uploaded HTML/SVG document in the application origin.
        URL.revokeObjectURL(state.objectURL);state.objectURL=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
        state.download.href=state.objectURL;state.open.removeAttribute('href');state.open.hidden=true;
        message(state,'File ready to download','Download this attachment and open it in its usual application.');state.status.textContent='Preview is unavailable for this file type.';
      }
    }catch(error){
      if(isCurrent()){
        const generationFailed=generated&&!state.objectURL;
        message(state,generationFailed?'Unable to generate the request form':'Unable to preview file',
          error.name==='AbortError'?'The file took too long to load. Close the viewer and try again.':error.message);
        state.status.textContent=generationFailed?'Form unavailable':'Preview unavailable';
      }
    }
    finally{clearTimeout(timeout);}
  }
  let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(reader?.pdf&&reader.zoom.value==='fit')renderPage(reader);},160);});
  document.addEventListener('click',event=>{
    const trigger=event.target.closest('[data-viewer-file]');if(!trigger)return;
    event.preventDefault();open({url:trigger.dataset.viewerFile,name:trigger.dataset.viewerName||'Attachment',reference:trigger.dataset.viewerReference||''});
  });
  window.addEventListener('pagehide',()=>{if(reader)release(reader);});
  window.PGENRO_Documents=Object.freeze({open});
})();

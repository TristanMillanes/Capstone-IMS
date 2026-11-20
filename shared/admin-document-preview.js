(() => {
  'use strict';

  const pdfAssets = new URL('../vendor/pdfjs/', document.currentScript?.src || location.href);
  let pdfLibrary;

  function loadPdfLibrary() {
    pdfLibrary ??= import(new URL('pdf.min.mjs', pdfAssets).href).then(library => {
      library.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', pdfAssets).href;
      return library;
    }).catch(error => {
      pdfLibrary = null;
      throw error;
    });
    return pdfLibrary;
  }

  function pdfOptions() {
    return {
      isEvalSupported: false,
      cMapUrl: new URL('cmaps/', pdfAssets).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('standard_fonts/', pdfAssets).href,
    };
  }

  async function decodeText(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' :
      bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
    return new TextDecoder(encoding).decode(bytes);
  }

  async function appendPrintImage(doc, parent, url, label) {
    const image = doc.createElement('img');
    image.alt = label;
    image.src = url;
    parent.append(image);
    await image.decode();
  }

  async function appendPdfPages(doc, pdf, contentUrl, signal) {
    const canvas = doc.createElement('canvas');
    const sizes = doc.createElement('style');
    const pageRules = [];
    doc.head.append(sizes);
    try {
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        signal.throwIfAborted();
        const size = page.getViewport({scale: 1});
        const scale = Math.min(2, Math.sqrt(8000000 / (size.width * size.height)));
        const viewport = page.getViewport({scale});
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const render = page.render({canvasContext: canvas.getContext('2d'), viewport, intent: 'print'});
        const cancelRender = () => render.cancel();
        signal.addEventListener('abort', cancelRender, {once: true});
        try {
          await render.promise;
        } finally {
          signal.removeEventListener('abort', cancelRender);
        }
        signal.throwIfAborted();
        const blob = await new Promise(resolve => canvas.toBlob(resolve));
        signal.throwIfAborted();
        if (!blob) throw new Error('A PDF page could not be prepared for printing.');
        const name = `sheet-${number}`;
        pageRules.push(`@page ${name} { size: ${size.width}pt ${size.height}pt; margin: 0; }`);
        const sheet = doc.createElement('section');
        sheet.className = 'document-print-sheet';
        sheet.style.page = name;
        doc.body.append(sheet);
        await appendPrintImage(doc, sheet, contentUrl(blob), `Page ${number}`);
        signal.throwIfAborted();
      }
      sizes.textContent = pageRules.join('\n');
    } finally {
      canvas.width = canvas.height = 0;
    }
  }

  function bindPrintButton(button, notify) {
    if (!button) return;
    const label = button.textContent.trim();
    let source;
    let finish;

    function reset() {
      source = null;
      finish?.();
      button.hidden = true;
      button.disabled = true;
    }

    button.addEventListener('click', async () => {
      if (!source || finish || button.disabled) return;
      const {pdf, imageUrl, textBlob, title} = source;
      const controller = new AbortController();
      const {signal} = controller;
      const urls = [];
      const contentUrl = blob => {
        const url = URL.createObjectURL(blob);
        urls.push(url);
        return url;
      };
      let frame;
      let timer;
      const cleanup = () => {
        if (finish !== cleanup) return;
        finish = null;
        controller.abort();
        clearTimeout(timer);
        frame?.remove();
        urls.forEach(url => URL.revokeObjectURL(url));
        button.textContent = label;
        button.disabled = !source;
      };
      finish = cleanup;
      button.disabled = true;
      button.textContent = 'Preparing print…';
      try {
        frame = document.createElement('iframe');
        frame.title = 'Printable document';
        frame.setAttribute('aria-hidden', 'true');
        frame.tabIndex = -1;
        frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;pointer-events:none';
        document.body.append(frame);
        const doc = frame.contentDocument;
        const printWindow = frame.contentWindow;
        doc.title = title || 'Document';
        const style = doc.createElement('style');
        style.textContent = `
          @page { margin: 12mm; }
          html, body { margin: 0; padding: 0; color: #111; background: white; }
          img { display: block; max-width: 100%; max-height: 100vh; object-fit: contain; margin: auto; }
          pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 12pt monospace; }
          .document-print-sheet { break-inside: avoid; break-after: page; }
          .document-print-sheet:last-child { break-after: auto; }
          .document-print-sheet img { width: 100%; height: auto; max-height: none; }`;
        doc.head.append(style);

        if (pdf) {
          await appendPdfPages(doc, pdf, contentUrl, signal);
        } else if (imageUrl) {
          await appendPrintImage(doc, doc.body, imageUrl, title || 'Attachment');
        } else {
          const text = await decodeText(textBlob);
          signal.throwIfAborted();
          const pre = doc.createElement('pre');
          pre.textContent = text;
          doc.body.append(pre);
        }
        signal.throwIfAborted();
        button.textContent = label;
        printWindow.addEventListener('afterprint', cleanup, {once: true});
        timer = setTimeout(cleanup, 120000);
        printWindow.focus();
        printWindow.print();
      } catch (error) {
        const canceled = signal.aborted;
        cleanup();
        if (!canceled) notify('Could not print the attachment. Try downloading it and printing the saved file.');
      }
    });

    return {
      reset,
      setSource(value) {
        source = value;
        button.hidden = false;
        button.disabled = Boolean(finish);
      },
    };
  }

  window.PGENRO_DocumentPreview = {loadPdfLibrary, pdfOptions, decodeText, bindPrintButton};
})();

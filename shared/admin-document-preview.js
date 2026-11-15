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

  function create(container) {
    const body = container.querySelector('[data-preview-body]');
    const download = container.querySelector('[data-preview-download]');
    let active = null;

    function clear() {
      const previous = active;
      active = null;
      if (previous) {
        previous.controller.abort();
        previous.render?.cancel();
        if (previous.pdfTask) previous.pdfTask.destroy().catch(() => {});
        if (previous.url) URL.revokeObjectURL(previous.url);
      }
      container.hidden = true;
      body.replaceChildren();
      download.hidden = true;
      download.removeAttribute('href');
    }

    function message(text) {
      const status = document.createElement('p');
      status.className = 'attachment-preview-message';
      status.setAttribute('role', 'status');
      status.textContent = text;
      body.replaceChildren(status);
    }

    function showText(state) {
      if (active !== state || !state.useText) return;
      if (state.text.trim()) {
        const preview = document.createElement('pre');
        preview.className = 'attachment-preview-text';
        preview.tabIndex = 0;
        preview.setAttribute('aria-label', 'Document text preview');
        preview.textContent = state.text.slice(0, 12000);
        const caption = document.createElement('p');
        caption.className = 'attachment-preview-message';
        caption.textContent = state.text.length > 12000 ?
          'Showing the start of the document. Review the full extracted text below.' : 'Document text preview';
        body.replaceChildren(caption, preview);
      } else {
        message(state.pending ? 'Preparing the text preview…' :
          state.error || state.fallback || 'No readable text is available for this attachment.');
      }
    }

    function setReadState({text, pending = false, error = ''}) {
      if (!active) return;
      if (typeof text === 'string') active.text = text;
      active.pending = pending;
      active.error = error;
      showText(active);
    }

    async function showPdf(state, blob) {
      const library = await loadPdfLibrary();
      const data = new Uint8Array(await blob.arrayBuffer());
      if (active !== state) return;
      state.pdfTask = library.getDocument({data, ...pdfOptions()});
      const pdf = await state.pdfTask.promise;
      if (active !== state) return;

      const controls = document.createElement('div');
      controls.className = 'attachment-preview-pages';
      const label = document.createElement('span');
      label.setAttribute('aria-live', 'polite');
      const previous = document.createElement('button');
      previous.type = 'button';
      previous.className = 'btn btn-secondary';
      previous.textContent = 'Previous';
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'btn btn-secondary';
      next.textContent = 'Next';
      controls.append(previous, label, next);
      controls.hidden = pdf.numPages === 1;

      const viewport = document.createElement('div');
      viewport.className = 'attachment-preview-page';
      let pageNumber = 1;
      async function draw(number) {
        previous.disabled = next.disabled = true;
        label.textContent = `Page ${number} of ${pdf.numPages}`;
        try {
          const page = await pdf.getPage(number);
          if (active !== state) return;
          const base = page.getViewport({scale: 1});
          // Keep the backing bitmap legible on tablets without allocating it at scan resolution.
          const width = Math.max(body.clientWidth, 540) * Math.min(window.devicePixelRatio || 1, 2);
          const size = page.getViewport({scale: Math.min(width / base.width, 2048 / Math.max(base.width, base.height))});
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(size.width);
          canvas.height = Math.ceil(size.height);
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', `${state.name}, page ${number} of ${pdf.numPages}`);
          state.render = page.render({canvasContext: canvas.getContext('2d'), viewport: size, background: '#fff'});
          await state.render.promise;
          if (active !== state) return;
          viewport.replaceChildren(canvas);
          viewport.scrollTop = 0;
          page.cleanup();
        } catch (error) {
          if (active === state) throw error;
        } finally {
          state.render = null;
          pageNumber = number;
          previous.disabled = number <= 1;
          next.disabled = number >= pdf.numPages;
        }
      }
      const move = number => draw(number).catch(() => showPreviewFallback(state));
      previous.addEventListener('click', () => move(pageNumber - 1));
      next.addEventListener('click', () => move(pageNumber + 1));
      body.replaceChildren(controls, viewport);
      await draw(1);
    }

    function showPreviewFallback(state) {
      if (active !== state) return;
      if (state.pdfTask) {
        state.pdfTask.destroy().catch(() => {});
        state.pdfTask = null;
      }
      state.useText = true;
      state.fallback = 'The file could not be displayed here. You can download the original above.';
      showText(state);
    }

    async function show({name, file, loadFile, text = '', pending = false}) {
      clear();
      const state = {name, controller: new AbortController(), text: String(text || ''), pending, useText: false};
      active = state;
      container.hidden = false;
      message('Loading document preview…');
      try {
        const blob = file || await loadFile(state.controller.signal);
        if (active !== state) return;
        if (!blob?.size) throw new Error('The attachment is empty or unavailable.');
        state.url = URL.createObjectURL(blob);
        download.href = state.url;
        download.download = name;
        download.hidden = false;

        if (/\.pdf$/i.test(name) || blob.type === 'application/pdf') {
          await showPdf(state, blob);
        } else if (/\.(?:png|jpe?g|webp|bmp|tiff?)$/i.test(name) || /^image\/(?:png|jpeg|webp|bmp|tiff)$/.test(blob.type)) {
          const image = document.createElement('img');
          image.alt = `Preview of ${name}`;
          const loaded = new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = reject;
          });
          image.src = state.url;
          await loaded;
          if (active === state) {
            const viewport = document.createElement('div');
            viewport.className = 'attachment-preview-page';
            viewport.append(image);
            body.replaceChildren(viewport);
          }
        } else {
          if (/\.(txt|csv)$/i.test(name) || /^text\/(plain|csv)\b/.test(blob.type)) {
            state.text = await decodeText(blob.slice(0, 48004));
            state.pending = false;
          }
          state.useText = true;
          showText(state);
        }
      } catch (error) {
        if (active !== state) return;
        if (state.url) showPreviewFallback(state);
        else message(error.message || 'The attachment could not be retrieved.');
      }
    }

    return {clear, show, setReadState};
  }

  window.PGENRO_DocumentPreview = {create, loadPdfLibrary, pdfOptions, decodeText};
})();

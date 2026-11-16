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

  window.PGENRO_DocumentPreview = {loadPdfLibrary, pdfOptions, decodeText};
})();

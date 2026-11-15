(() => {
  'use strict';

  function serviceRoute(endpoint, path) {
    const url = new URL(endpoint);
    url.pathname = url.pathname.replace(/\/ocr\/?$/, path);
    return url;
  }

  function cancel(operation) {
    if (!operation?.requestId || operation.notifiedRequest === operation.requestId) return;
    operation.notifiedRequest = operation.requestId;
    fetch(serviceRoute(operation.endpoint, '/cancel'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({requestId: operation.requestId}),
      keepalive: true,
    }).catch(() => {});
  }

  async function read(file, {operation, assertActive, progress, direction, uuid, warnings}) {
    const configured = document.querySelector('meta[name="pgenro-ocr-endpoint"]')?.content?.trim();
    const addresses = [];
    if (configured && location.protocol !== 'file:') addresses.push(configured);
    if ((['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.protocol === 'file:') && location.port !== '5000') {
      addresses.push('http://127.0.0.1:5000/ocr');
    }
    const endpoints = new Set(addresses.map(address => new URL(address, location.href).href));

    for (const endpoint of endpoints) {
      const sameOrigin = new URL(endpoint).origin === location.origin;
      let timeoutSeconds = 180;
      if (!sameOrigin) {
        // Probe optional cross-origin services before sending the file.
        const probe = new AbortController();
        operation.controller = probe;
        const timer = setTimeout(() => probe.abort(), 3500);
        let health;
        try {
          progress('Connecting to the document reader…', 3);
          const response = await fetch(serviceRoute(endpoint, '/health'), {signal: probe.signal, cache: 'no-store'});
          if (response.ok) health = await response.json();
        } catch {} finally {
          clearTimeout(timer);
        }
        assertActive();
        if (!health?.ok && !health?.success) continue;
        timeoutSeconds = Number(health.documentTimeoutSeconds) || timeoutSeconds;
      }

      assertActive();
      const controller = new AbortController();
      operation.controller = controller;
      operation.endpoint = endpoint;
      operation.requestId = uuid();
      controller.signal.addEventListener('abort', () => cancel(operation), {once: true});
      const timer = setTimeout(() => controller.abort(), Math.max(45000, Math.min(900000, timeoutSeconds * 1000 + 15000)));
      let polling = true;
      let progressRequest;
      let pollTimer;

      async function poll() {
        if (!polling || operation.cancelled) return;
        progressRequest = new AbortController();
        const timeout = setTimeout(() => progressRequest.abort(), 2500);
        try {
          const url = serviceRoute(endpoint, '/ocr/status/' + operation.requestId);
          const response = await fetch(url, {signal: progressRequest.signal, cache: 'no-store'});
          if (!response.ok) return;
          const status = await response.json();
          if (!polling || operation.cancelled || !status.success) return;
          const total = Number(status.pages) || 0;
          const done = Number(status.completedPages) || 0;
          const stage = status.stage || 'Reading the document…';
          progress(total ? `${stage} · ${done} of ${total} pages` : stage, total ? Math.min(96, 8 + 88 * done / total) : 8);
        } catch {} finally {
          clearTimeout(timeout);
          if (polling && !operation.cancelled) pollTimer = setTimeout(poll, 1000);
        }
      }

      try {
        progress('Reading all pages and printed details…', 8);
        const body = new FormData();
        body.append('file', file);
        if (direction) body.append('communicationType', direction);
        pollTimer = setTimeout(poll, 700);
        const response = await fetch(endpoint, {
          method: 'POST', body, signal: controller.signal,
          headers: {'X-OCR-Request-ID': operation.requestId},
        });
        // Static hosts and temporarily unavailable workers use the browser reader.
        if ([404, 405].includes(response.status) || response.status >= 500) continue;
        if (response.ok && response.headers.get('Content-Type')?.includes('text/html')) continue;
        const result = await response.json().catch(() => null);
        if (!result) throw new Error('The document reader returned an invalid response. Retry the read.');
        if (!response.ok || result.success === false) throw new Error(result.error || 'The document reader could not read this file.');
        if (typeof result.text !== 'string') throw new Error('The document reader returned no document text.');
        assertActive();
        if (result.requestId && result.requestId !== operation.requestId) throw new Error('The reader response does not match this document. Retry the read.');
        return {...result, metadata: result.metadata || {}, warnings: result.warnings || []};
      } catch (error) {
        assertActive();
        if (error.name === 'AbortError') throw new Error('The document reached the reading time limit. Choose a smaller file and retry.');
        if (!(error instanceof TypeError)) throw error;
        if (sameOrigin) throw new Error('The reader connection was interrupted. Your draft is kept.');
      } finally {
        polling = false;
        clearTimeout(timer);
        clearTimeout(pollTimer);
        progressRequest?.abort();
      }
    }

    if (endpoints.size) warnings.push('The document service is unavailable. The browser reader was used.');
    return null;
  }

  window.PGENRO_AdminOcrService = {read, cancel};
})();

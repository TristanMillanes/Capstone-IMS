/* Decorative motion only; no session, record, or submission behavior. */
(() => {
  'use strict';
  // Keep the essential navigation legible when the existing icon CDN is offline.
  if (!window.lucide?.createIcons) {
    const paths = {
      'layout-dashboard':'<rect x="3" y="3" width="7" height="8" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="3" y="15" width="7" height="6" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/>',
      mail:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/>',
      navigation:'<path d="m21 3-7 18-3-8-8-3Z"/>',
      'file-text':'<path d="M14 3H6v18h12V7Z"/><path d="M14 3v5h4M9 12h6m-6 4h6"/>',
      'users-round':'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-17a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5v2"/>',
      package:'<path d="m12 3 9 5v9l-9 5-9-5V8Zm0 10 9-5M3 8l9 5v9M7 5.8l9 5"/>',
      'clipboard-signature':'<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 2h6v4H9Zm-2 9h10m-10 5h5m1 1 4-4"/>',
      wrench:'<path d="M14 6a5 5 0 0 0-6 6l-5 5a2 2 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-4-4Z"/>',
      layers:'<path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
      user:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
      'chevron-up':'<path d="m6 15 6-6 6 6"/>',
      'chevron-down':'<path d="m6 9 6 6 6-6"/>',
      'log-out':'<path d="M9 3H4v18h5m5-15 6 6-6 6M8 12h12"/>',
      search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
      'refresh-cw':'<path d="M20 8a8 8 0 1 0 0 8m1-14v6h-6"/>',
      'calendar-days':'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18M7 15h2m4 0h2"/>',
      'clock-3':'<circle cx="12" cy="12" r="9"/><path d="M12 7v5h5"/>',
      'circle-check-big':'<path d="M21 11a9 9 0 1 1-6-8M8 11l4 4L22 5"/>',
      'circle-check':'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 6-6"/>',
      'badge-check':'<path d="m12 2 3 2 4 1 1 4 2 3-2 3-1 4-4 1-3 2-3-2-4-1-1-4-2-3 2-3 1-4 4-1Z"/><path d="m8 12 3 3 5-6"/>',
      leaf:'<path d="M20 3C10 3 4 8 4 14a6 6 0 0 0 6 6c7 0 10-8 10-17ZM3 21 14 10"/>',
      plus:'<path d="M12 4v16M4 12h16"/>',
      x:'<path d="m6 6 12 12M6 18 18 6"/>',
      activity:'<path d="M2 12h5l3-8 4 16 3-8h5"/>',
      'arrow-up-right':'<path d="M6 18 18 6M6 6h12v12"/>',
      'arrow-right':'<path d="M4 12h16m-6-6 6 6-6 6"/>',
      'file-search':'<path d="M14 3H5v18h8M14 3v5h5V7Z"/><circle cx="16" cy="15" r="4"/><path d="m19 18 3 3"/>'
    };
    window.lucide = {createIcons() {
      document.querySelectorAll('i[data-lucide]').forEach(icon=>{
        const name=icon.getAttribute('data-lucide');if(!paths[name])return;
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
        for(const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'24',height:'24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false',class:`lucide lucide-${name} ${icon.className||''}`}))svg.setAttribute(key,value);
        svg.innerHTML=paths[name];icon.replaceWith(svg);
      });
    }};
  }
  function init() {
    if (!document.body.classList.contains('user-refresh')) return;
    window.lucide?.createIcons?.();
    // The supplied folder relies on seals in its parent project. Keep a generic
    // leaf mark if a seal is unavailable, while retaining the original image URL.
    document.querySelectorAll('.public-seal img,.sidebar-logo img,.brand-logo-wrap img[data-seal]').forEach(img=>{
      const fallback=()=>{
        if (img.parentElement.querySelector('.logo-fallback-mark')) {
          img.parentElement.classList.add('logo-fallback');
          return;
        }
        if(img.parentElement.querySelector('.brand-image-fallback'))return;
        img.hidden=true;
        const mark=document.createElement('span');mark.className='brand-image-fallback';mark.setAttribute('role','img');mark.setAttribute('aria-label','PGENRO IMS');
        mark.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 3C10 3 4 8 4 14a6 6 0 0 0 6 6c7 0 10-8 10-17ZM3 21 14 10"/></svg>';
        img.parentElement.append(mark);
      };
      img.addEventListener('error',fallback,{once:true});if(img.complete&&!img.naturalWidth)fallback();
    });
    const scenes = [...document.querySelectorAll('.eco-scene')];
    if (!scenes.length) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    let paused = false;
    try { paused = localStorage.getItem('pgenro_eco_motion') === 'paused'; } catch {}
    const buttons = [...document.querySelectorAll('.eco-motion-toggle')];
    const sync = () => {
      document.body.dataset.ecoMotion = paused || document.hidden || reduce.matches ? 'paused' : 'running';
      buttons.forEach(button => {
        button.setAttribute('aria-pressed', String(paused));
        const label = paused ? 'Play decorative animation' : 'Pause decorative animation';
        button.setAttribute('aria-label',label);button.title=label;
        const text=button.querySelector('span');if(text)text.textContent=label;
      });
    };
    buttons.forEach(button => button.addEventListener('click', () => {
      paused = !paused;
      try { localStorage.setItem('pgenro_eco_motion',paused?'paused':'running'); } catch {}
      sync();
    }));
    document.addEventListener('visibilitychange',sync);
    reduce.addEventListener?.('change',sync);
    window.addEventListener('storage', event => {
      if (event.key === 'pgenro_eco_motion') { paused = event.newValue === 'paused'; sync(); }
    });
    let observer;
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => entries.forEach(entry => entry.target.classList.toggle('eco-offscreen',!entry.isIntersecting)),{rootMargin:'40px'});
      scenes.forEach(scene => observer.observe(scene));
    }
    const fine = matchMedia('(hover:hover) and (pointer:fine)');
    let frame;
    scenes.forEach(scene => {
      const host=scene.closest('.public-intro,.depth-hero,.portal-story,.hero-panel')||scene.parentElement;
      host.addEventListener('pointermove',event=>{
        if(paused||reduce.matches||!fine.matches)return;
        const box=host.getBoundingClientRect();
        const x=Math.max(-1,Math.min(1,(event.clientX-box.left)/box.width*2-1));
        const y=Math.max(-1,Math.min(1,(event.clientY-box.top)/box.height*2-1));
        cancelAnimationFrame(frame);
        frame=requestAnimationFrame(()=>{scene.style.setProperty('--eco-rx',`${-y*4}deg`);scene.style.setProperty('--eco-ry',`${x*6}deg`);});
      },{passive:true});
      host.addEventListener('pointerleave',()=>{
        cancelAnimationFrame(frame);scene.style.setProperty('--eco-rx','0deg');scene.style.setProperty('--eco-ry','0deg');
      });
    });
    window.addEventListener('pagehide',event=>{cancelAnimationFrame(frame);if(!event.persisted)observer?.disconnect();});
    window.addEventListener('pageshow',sync);
    sync();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

// Invoice Audit — offline support.
// Keeps the app's own files and its PDF/Excel readers and fonts in a cache, so the installed app
// opens and works without internet. Google Sheet sync calls are never cached.
// Bump CACHE with every release: the new files are fetched in the background and the app offers
// "Reload now".
const CACHE = 'invoice-audit-v7.0';
const APP_FILES = [
  './', './index.html', './app.js', './branch-ekm.js', './branch-clt.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'
];
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap'
];
const RUNTIME_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_FILES.map(u => new Request(u, { cache: 'reload' })));
    // Readers and fonts: best effort — one failing must not stop the install.
    await Promise.all(LIBS.map(async u => {
      try{ const r = await fetch(u, { mode: 'cors' }); if(r.ok) await cache.put(u, r); }catch(e){}
    }));
    // First install: take over straight away. Updates wait for the "Reload now" click.
    if(!self.registration.active) self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('invoice-audit-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => { if(event.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if(!sameOrigin && !RUNTIME_HOSTS.includes(url.hostname)) return;   // e.g. the Google Sheet script

  // Opening the app (any ?branch=… link included): the cached page. Other pages on the site
  // (e.g. the old /ernakulam/ and /calicut/ links) go to the network as normal.
  const scopePath = new URL(self.registration.scope).pathname;
  const isAppPage = sameOrigin && (url.pathname === scopePath || url.pathname === scopePath + 'index.html');
  if(req.mode === 'navigate' && !isAppPage) return;
  if(req.mode === 'navigate'){
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match('./index.html');
      if(cached) return cached;             // new page versions arrive with a new CACHE, all files together
      const fresh = await fetch(req).catch(() => null);
      return fresh || new Response('Invoice Audit is offline and not cached yet — open it once with internet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    })());
    return;
  }

  // Everything else: cache first, network as fallback (and kept for next time).
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: sameOrigin });
    if(cached) return cached;
    try{
      const r = await fetch(req);
      if(r.ok || r.type === 'opaque') cache.put(req, r.clone());
      return r;
    }catch(e){
      return new Response('', { status: 504 });
    }
  })());
});

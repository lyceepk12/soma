/* ═══════════════════════════════════════════════
   SOMA — sw.js (Service Worker)
   Compatible GitHub Pages (/soma/) et local (./)
   Auteur : NGG
   ═══════════════════════════════════════════════ */

const CACHE_STATIC  = 'soma-static-v1.0.0';
const CACHE_DYNAMIC = 'soma-dynamic-v1.0.0';

/* Détection automatique du base path */
const BASE = self.location.pathname.replace('/sw.js', '');

const STATIC_ASSETS = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/style.css',
  BASE + '/app.js',
  BASE + '/manifest.json',
  BASE + '/logo.png',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700&family=DM+Sans:wght@300;400;500&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js'
];

const API_DOMAINS = [
  'api.groq.com',
  'generativelanguage.googleapis.com',
  'api.mistral.ai',
  'cloudfunctions.net',
  'firebaseapp.com'
];

/* ── INSTALL ── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache =>
      Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(err =>
            console.warn('[SOMA SW] Cache miss:', url, err.message)
          )
        )
      )
    ).then(() => self.skipWaiting())
  );
});

/* ── ACTIVATE ── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_DYNAMIC)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH ── */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  if (isApiRequest(url)) {
    event.respondWith(networkOnly(request));
    return;
  }

  if (url.hostname.includes('fonts.g')) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  event.respondWith(networkFirst(request));
});

/* ── Stratégies ── */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) (await caches.open(cacheName)).put(request, res.clone());
    return res;
  } catch { return offlineFallback(request); }
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) (await caches.open(CACHE_DYNAMIC)).put(request, res.clone());
    return res;
  } catch {
    return (await caches.match(request)) || offlineFallback(request);
  }
}

async function networkOnly(request) {
  try { return await fetch(request); }
  catch {
    return new Response(
      JSON.stringify({ error: 'Pas de connexion internet.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function offlineFallback(request) {
  if (request.headers.get('accept')?.includes('text/html')) {
    return new Response(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>SOMA — Hors ligne</title>
<style>
  body{font-family:sans-serif;background:#0B1222;color:#F0F6FF;
  display:flex;align-items:center;justify-content:center;
  height:100vh;margin:0;flex-direction:column;gap:16px;text-align:center;padding:24px}
  .logo{font-size:48px;font-weight:700;background:linear-gradient(135deg,#1E3A8A,#10B981);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent}
  p{color:#94A3B8;max-width:320px;line-height:1.6}
  button{padding:12px 24px;background:linear-gradient(135deg,#1E3A8A,#2D55C8);
  color:white;border:none;border-radius:10px;font-size:15px;cursor:pointer}
</style></head>
<body>
  <div class="logo">SOMA</div>
  <p>Vous êtes hors ligne. Reconnectez-vous pour utiliser SOMA.</p>
  <button onclick="location.reload()">Réessayer</button>
</body></html>`,
      { headers: { 'Content-Type': 'text/html;charset=utf-8' } }
    );
  }
  return new Response('Hors ligne', { status: 503 });
}

function isApiRequest(url) {
  return API_DOMAINS.some(d => url.hostname.includes(d));
}

function isStaticAsset(url) {
  return /\.(html|css|js|png|jpg|jpeg|svg|ico|json|woff2|webp)$/.test(url.pathname);
}

/* ── Messages depuis l'app ── */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => event.ports[0]?.postMessage({ cleared: true }));
  }
});

/* 只缓存应用外壳，绝不缓存视频流 */
const CACHE = 'live-player-shell-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './hls.min.js',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 跨域资源、视频流、m3u8/ts 分片一律走网络
  if (url.origin !== location.origin) return;
  if (/\.(m3u8|ts|mp4|webm|mkv|flv)(\?|$)/i.test(url.pathname)) return;

  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});

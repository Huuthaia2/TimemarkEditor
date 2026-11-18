// Đổi số này mỗi lần sửa code để điện thoại lấy bản mới
const CACHE = 'timemark-v2';
const FILES = [
  '.', 'index.html', 'style.css', 'inpaint.js', 'timemark.js', 'app.js',
  'icon.svg', 'manifest.webmanifest',
  'fonts/resolve-sans-w05-medium-cn.otf', 'fonts/Franco-C4SA.ttf',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// Ưu tiên mạng để luôn có bản mới, mất mạng thì lấy bản đã lưu
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});

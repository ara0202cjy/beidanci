/* 离线缓存：加到主屏幕后，断网也能背（词库约 4MB，首次用后即缓存） */
/* 采用「网络优先 + 缓存兜底」：每次都先拉最新代码，断网才回退缓存，避免部署后一直跑旧版 */
const C = 'wb-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;           // GitHub API 等外部请求不拦
  e.respondWith(
    caches.open(C).then(c => {
      const net = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') c.put(req, res.clone());
        return res;
      }).catch(() => c.match(req));                     // 断网时回退到缓存
      return net;                                        // 网络优先，确保拿到最新代码
    })
  );
});

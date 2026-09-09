/* 离线缓存：加到主屏幕后，断网也能背（词库约 4MB，首次用后即缓存） */
/* 采用「网络优先 + 缓存兜底」：每次都先拉最新代码，断网才回退缓存，避免部署后一直跑旧版 */
/* 核心脚本每次强制从网络取最新（cache:'reload'），词库 JSON 首次后常驻缓存，避免每次更新都重拉 4MB */
const C = 'wb-v3';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
const CORE = ['app.js', 'styles.css', 'sync.js', 'index.html', 'sw.js'];
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;           // GitHub API 等外部请求不拦
  const name = u.pathname.split('/').pop();
  const core = CORE.includes(name);
  e.respondWith(
    caches.open(C).then(c => {
      const net = fetch(req, core ? { cache: 'reload' } : {})  // 核心文件绕过 HTTP 缓存，永远拿最新
        .then(res => {
          if (res && res.status === 200 && res.type === 'basic') c.put(req, res.clone());
          return res;
        })
        .catch(() => c.match(req));                     // 断网时回退到缓存
      return net;                                        // 网络优先，确保拿到最新代码
    })
  );
});

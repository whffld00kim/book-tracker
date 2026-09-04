// v4: Firebase 로그인/동기화 추가 — 기존 캐시를 반드시 갈아엎어야 새 index.html이 뜬다
const CACHE = 'book-tracker-v6';  // v6: 시작일(startDate) 칸 추가
const ASSETS = [
  '/book-tracker/',
  '/book-tracker/index.html',
  '/book-tracker/manifest.json',
  '/book-tracker/icon.svg',
  '/book-tracker/icon-maskable.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // 이 앱 자신의 파일만 캐시한다.
  // Firebase(RTDB 롱폴링·gstatic SDK) 같은 외부 요청까지 가로채면,
  // 캐시 우선 전략이라 동기화 응답이 캐시에 무한히 쌓이고
  // 옛 응답이 재생될 수도 있다. 그런 요청은 브라우저에 그대로 맡긴다.
  let url;
  try { url = new URL(e.request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/book-tracker/')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request)
        .then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match('/book-tracker/'));
    })
  );
});

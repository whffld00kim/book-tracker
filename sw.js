// book-tracker — 저장된 사본으로 먼저 열고, 뒤에서 새 파일을 받아 캐시를 바꿔 둔다 (2026-09-29, 투자 트래커와 같은 방식).
// 그전엔 네트워크 우선이라 열 때마다 앱 파일·라이브러리 응답을 기다렸다.
// ⚠ index.html을 고치면 CACHE 버전을 올린다. 고친 뒤 첫 실행은 옛 화면, 두 번째 실행부터 새 화면이다.
// ⚠ index.html이 부르는 파일을 바꾸면 OWN·CDN 목록도 같이 고친다 (한 글자라도 다르면 미리 받아 둔 의미가 없다).
const CACHE = 'book-tracker-v11';

// 이 앱의 파일
const OWN = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg",
  "./icon-maskable.svg"
];

// 외부 라이브러리 (버전이 주소에 박혀 있어 내용이 안 바뀐다)
const CDN = [
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-database-compat.js"
];

// 캐시해도 되는 곳. 여기 없는 호스트는 손대지 않는다.
// ⚠ 이 목록을 넓히지 말 것 — 로그인(identitytoolkit)·DB(firebaseio)·Storage 응답까지 캐시되면
//    지난 응답이 되살아나 로그인이 이상하게 풀리거나 옛 데이터가 보인다.
const CDN_HOSTS = ["www.gstatic.com"];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(cache => Promise.all([
    // 브라우저 HTTP 캐시(GitHub Pages max-age=600)를 거치지 않고 새로 받는다
    ...OWN.map(u => cache.add(new Request(u, { cache: 'reload' }))),
    ...CDN.map(u => cache.add(u)
      .catch(() => fetch(u, { mode: 'no-cors' }).then(r => cache.put(u, r)))
      .catch(() => {})),
  ])));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      // 이 앱의 옛 캐시만 지운다. 웹앱들이 같은 주소(github.io)를 나눠 써서 캐시 저장소도 하나다 —
      // 접두사를 안 가리면 다른 앱의 캐시까지 지운다
      .then(keys => Promise.all(keys.filter(k => k.startsWith('book-tracker-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  const own = url.origin === self.location.origin && req.url.startsWith(self.registration.scope);
  if (!own && !CDN_HOSTS.includes(url.hostname)) return;

  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req);
    const fresh = (own ? fetch(req.url, { cache: 'no-cache' }) : fetch(req)).then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    });
    if (cached) { e.waitUntil(fresh.catch(() => {})); return cached; }
    return fresh.catch(() => req.destination === 'document' ? cache.match('./index.html') : Response.error());
  }));
});

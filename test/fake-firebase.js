// test/fake-firebase.js — 시험용 가짜 Firebase compat SDK (app·auth·database 세 스크립트 자리에 들어간다)
//
// test/helpers.js 가 www.gstatic.com/firebasejs/… 요청을 이 파일로 바꿔치기한다. 실제 SDK 는 시험 중 전혀 쓰지 않는다
// (실제 Firebase 프로젝트에는 아무 요청도 가지 않는다).
//
// 흉내 내는 것 (앱이 쓰는 것만):
//  - firebase.initializeApp / firebase.auth(): setPersistence, onAuthStateChanged, signInWithEmailAndPassword, signOut
//  - firebase.database().ref(path): on('value', cb, cancel), off(), set(v), transaction(fn), once('value')
//  - 서버는 Node(test/helpers.js) 쪽에 하나 있고 window.__srv 바인딩으로 주고받는다 → 기기(페이지) 여러 대가 같은 서버를 본다
//  - 오프라인(window.__fake.setOnline(false)): 실제 SDK 처럼 쓰기는 큐에 쌓이고 화면(로컬 value 이벤트)은 먼저 바뀐다.
//    다시 연결되면 큐를 순서대로 서버에 보낸 뒤 구독 값을 새로 받는다
//  - set: 무조건 덮어쓴다 (마지막 쓰기가 이긴다)
//  - transaction: 로컬 캐시 값으로 함수를 돌려 먼저 로컬 이벤트를 내고(applyLocally), 서버 값이 그 사이 달라졌으면
//    서버가 돌려준 값으로 다시 돌린다 (실제 SDK 의 datastale 재시도, 최대 25번)
//  - 값 안에 undefined 가 있으면 실제 SDK 처럼 예외. 빈 배열/객체는 null 로 저장된다 (실제 RTDB 와 같다)
//  - value 이벤트는 값이 실제로 달라졌을 때만 낸다 (실제 SDK 와 같다)
//
// 시험에서 쓰는 손잡이: window.__fake = { setOnline, isOnline, recv, cancel, log, user, state }
(function (root) {
  'use strict';

  // ── 값 정규화: 실제 RTDB 가 저장하고 돌려주는 모양으로 (키 정렬, null 제거, 빈 것은 null) ──
  function canon(v) {
    if (v === undefined || v === null) return null;
    if (Array.isArray(v)) {
      const arr = v.map(canon);
      return arr.every(x => x === null) ? null : arr;
    }
    if (typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v).sort()) { const c = canon(v[k]); if (c !== null) o[k] = c; }
      return Object.keys(o).length ? o : null;
    }
    return v;
  }
  function assertNoUndefined(v, where, at) {
    if (v === undefined) throw new Error(where + ' failed: first argument contains undefined in property \'' + at + '\'');
    if (v && typeof v === 'object') for (const k of Object.keys(v)) assertNoUndefined(v[k], where, at + '.' + k);
  }
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  // Node 에서 require 하면 canon 만 내준다 (서버 쪽도 같은 정규화를 써야 CAS 비교가 맞는다)
  if (typeof module !== 'undefined' && module.exports) { module.exports = { canon }; return; }
  if (root.firebase) return;

  const cfg = root.__fakeConfig || {};   // { uid, email, signedIn, online, authDelay, loginError }
  // Node 쪽 가짜 서버 (test/helpers.js, context.exposeBinding). 보안 규칙 흉내를 위해 지금 로그인한 uid 를 함께 보낸다
  const srv = msg => root.__srv({ ...msg, auth: user ? user.uid : null });

  const state = {
    online: cfg.online !== false,
    cache: new Map(),       // path → canon 값
    lastFired: new Map(),   // path → 마지막으로 value 이벤트를 낸 값(JSON)
    listeners: new Map(),   // path → [{cb, cancel}]
    queue: [],              // 오프라인 동안 쌓인 쓰기를 깨우는 함수들 (서버 왕복이 끝날 때까지의 약속을 돌려준다)
    log: [],                // 서버에 보낸 것 기록 (시험 확인용)
  };

  function snap(path, value) {
    return { key: path.split('/').pop(), val: () => clone(value), exists: () => value !== null };
  }
  function fire(path) {
    const value = state.cache.has(path) ? state.cache.get(path) : null;
    const json = JSON.stringify(value);
    if (state.lastFired.get(path) === json) return;
    state.lastFired.set(path, json);
    for (const l of (state.listeners.get(path) || []).slice()) l.cb(snap(path, value));
  }
  function setCache(path, value) { state.cache.set(path, value); fire(path); }

  // 오프라인이면 큐에 들어가 기다린다. 돌려주는 함수(settle)는 "이 쓰기의 서버 왕복이 끝났다"를 알리는 데 쓴다
  async function whenOnline() {
    let settle = () => {};
    if (!state.online) {
      const settled = new Promise(r => { settle = r; });
      await new Promise(resume => state.queue.push(() => { resume(); return settled; }));
    }
    return settle;
  }

  async function listen(path) {
    let res;
    try { res = await srv({ op: 'listen', path }); }
    catch (e) { cancelListen(path, 'PERMISSION_DENIED'); return; }   // 실제 SDK: 읽기 권한이 없으면 cancel 콜백
    state.log.push({ op: 'listen', path });
    if (!state.listeners.has(path)) return;   // 기다리는 동안 off() 됐다
    setCache(path, canon(res.value));
  }
  function cancelListen(path, code) {
    const ls = state.listeners.get(path) || [];
    state.listeners.delete(path); state.cache.delete(path); state.lastFired.delete(path);
    ls.forEach(l => l.cancel && l.cancel({ code: code || 'PERMISSION_DENIED', message: 'permission_denied' }));
  }

  function ref(path) {
    path = String(path).replace(/^\/+|\/+$/g, '');
    return {
      key: path.split('/').pop(),
      toString: () => path,
      on(evt, cb, cancel) {
        if (evt !== 'value') throw new Error('fake firebase: value 이벤트만 흉내 낸다');
        if (!state.listeners.has(path)) state.listeners.set(path, []);
        state.listeners.get(path).push({ cb, cancel });
        if (state.cache.has(path)) {
          const v = state.cache.get(path);
          setTimeout(() => { if ((state.listeners.get(path) || []).some(l => l.cb === cb)) cb(snap(path, v)); }, 0);
        } else if (state.online) {
          listen(path);
        }
        // 오프라인이면 setOnline(true) 때 listen 한다
        return cb;
      },
      off() {
        state.listeners.delete(path);
        state.cache.delete(path);          // 실제 SDK 도 구독이 없어지면 그 위치의 캐시를 버린다
        state.lastFired.delete(path);
        if (state.online) srv({ op: 'unlisten', path }).catch(() => {});
      },
      set(v) {
        assertNoUndefined(v, 'Reference.set', 'value');
        const c = canon(v);
        setCache(path, c);
        return (async () => {
          const settle = await whenOnline();
          try {
            state.log.push({ op: 'set', path, value: clone(c) });
            const res = await srv({ op: 'put', path, value: c });
            setCache(path, canon(res.value));
          } finally { settle(); }
        })();
      },
      transaction(fn, onComplete, applyLocally) {
        return (async () => {
          for (let attempt = 0; attempt < 25; attempt++) {
            const base = state.cache.has(path) ? state.cache.get(path) : null;
            const result = fn(clone(base));
            if (result === undefined) {
              const s = snap(path, base);
              if (onComplete) onComplete(null, false, s);
              return { committed: false, snapshot: s };
            }
            assertNoUndefined(result, 'Reference.transaction', 'value');
            const c = canon(result);
            if (applyLocally !== false) setCache(path, c);
            const settle = await whenOnline();
            let res;
            try {
              state.log.push({ op: 'cas', path, base: clone(base), value: clone(c) });
              res = await srv({ op: 'cas', path, base: JSON.stringify(base), value: c });
            } finally { settle(); }
            setCache(path, canon(res.value));
            if (res.ok) {
              const s = snap(path, state.cache.get(path));
              if (onComplete) onComplete(null, true, s);
              return { committed: true, snapshot: s };
            }
            // 서버 값이 달라졌다 → 서버가 돌려준 값으로 다시 돈다 (실제 SDK 의 datastale)
          }
          const err = new Error('maxretry');
          if (onComplete) onComplete(err, false, null);
          throw err;
        })();
      },
      once(evt) {
        if (evt !== 'value') throw new Error('fake firebase: value 이벤트만 흉내 낸다');
        return srv({ op: 'get', path }).then(res => snap(path, canon(res.value)));
      },
    };
  }

  // ── auth ──
  let user = (cfg.signedIn === false || !cfg.uid) ? null : { uid: cfg.uid, email: cfg.email || 'test@example.com' };
  const authCbs = [];
  const notifyAuth = () => authCbs.slice().forEach(cb => cb(user));
  const auth = {
    setPersistence: () => Promise.resolve(),
    onAuthStateChanged(cb) {
      authCbs.push(cb);
      // 실제 SDK 도 저장된 로그인 정보를 읽은 뒤 비동기로 알려 준다
      setTimeout(() => { if (authCbs.includes(cb)) cb(user); }, cfg.authDelay == null ? 30 : cfg.authDelay);
      return () => { const i = authCbs.indexOf(cb); if (i >= 0) authCbs.splice(i, 1); };
    },
    signInWithEmailAndPassword(email) {
      state.log.push({ op: 'signIn', email });
      if (cfg.loginError) return Promise.reject({ code: cfg.loginError });
      user = { uid: cfg.uid || 'u_test1', email };
      notifyAuth();
      return Promise.resolve({ user });
    },
    signOut() { state.log.push({ op: 'signOut' }); user = null; notifyAuth(); return Promise.resolve(); },
    get currentUser() { return user; },
  };
  const authFn = () => auth;
  authFn.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };

  root.firebase = {
    initializeApp(c) { state.log.push({ op: 'init', projectId: c && c.projectId }); return {}; },
    auth: authFn,
    database: () => ({ ref }),
    SDK_VERSION: 'fake',
  };

  // ── 시험용 손잡이 ──
  async function setOnline(on) {
    on = !!on;
    if (on === state.online) return;
    state.online = on;
    state.log.push({ op: on ? 'online' : 'offline' });
    if (!on) return;
    // 큐에 쌓인 쓰기를 순서대로 서버에 보낸다 (하나의 서버 왕복이 끝나야 다음을 보낸다 — 실제 SDK 의 outstanding puts 처럼)
    while (state.queue.length) { const wake = state.queue.shift(); await wake(); }
    // 그다음 구독 값을 새로 받는다
    for (const p of Array.from(state.listeners.keys())) await listen(p);
  }
  root.__fake = {
    setOnline,
    isOnline: () => state.online,
    recv(path, value) {   // 서버가 미는 값 (다른 기기의 쓰기). 오프라인이면 닿지 않는다
      if (!state.online || !state.listeners.has(path)) return;
      setCache(path, canon(value));
    },
    cancel: cancelListen,   // 구독 취소(권한 오류 등) 흉내
    log: state.log,
    user: () => user,
    state,
  };
})(typeof window !== 'undefined' ? window : globalThis);

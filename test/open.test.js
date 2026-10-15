// 열기 시험 (2026-10-15) — 동기화한 적 있는 기기는 로그인 확인을 기다리지 않고 바로 목록을 보인다 · 구글 로그인 버튼
// 가짜 Firebase(test/fake-firebase.js)로 돈다. 실제 서버엔 아무것도 보내지 않는다.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');

let env;
test.before(async () => { env = await H.setup(); });
test.after(() => H.teardown(env));
test.beforeEach(() => env.server.reset());

const loginShown = page => page.evaluate(() => getComputedStyle(document.getElementById('loginScreen')).display !== 'none');

test('동기화한 적 있는 기기: 로그인 확인이 늦어도 덮개 없이 저장된 목록을 바로 보이고, 확인이 끝나면 「동기화됨」', async () => {
  env.server.set([H.book('a1', '연습용 책 A')]);
  let A = await H.newDevice(env, { name: 'A' });
  await A.waitForCard('a1');
  const state = await A.close();

  A = await H.newDevice(env, { name: 'A 다시', storageState: state, authDelay: 3000 });   // 로그인 확인이 3초 걸리는 상황
  await A.waitForCard('a1', 1500);
  assert.equal(await loginShown(A.page), false, '덮개가 걷혀 있어야 한다');
  assert.equal(await H.syncBadge(A.page), '최신 확인 중');
  await H.waitFor(async () => (await H.syncBadge(A.page)) === '동기화됨', { message: '로그인 확인 뒤 동기화됨' });
  assert.deepEqual(A.errors, []);
  await A.close();
});

test('처음 쓰는 기기(사본 없음)는 지금처럼 로그인 확인을 기다린다 · 로그인 화면에 구글 버튼이 있다', async () => {
  const A = await H.newDevice(env, { name: 'A', signedIn: false });
  await H.waitFor(async () => A.page.isVisible('#loginForm'));
  assert.equal(await loginShown(A.page), true);
  assert.equal(await A.page.isVisible('#googleBtn'), true);
  assert.match(await A.page.textContent('#googleBtn'), /구글/);
  await A.close();
});

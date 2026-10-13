// 기록 유실 시험 — 같은 계정으로 기기 둘(폰·태블릿)을 연 채 한쪽이 옛 화면·오프라인일 때, 앱을 닫았다 열 때.
// 가짜 Firebase(test/fake-firebase.js)로 돈다. 실제 서버엔 아무것도 보내지 않는다.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');

// (describe 로 묶지 않는다 — 묶으면 --test-timeout 이 묶음 전체에 걸린다)
let env;
test.before(async () => { env = await H.setup(); });
test.after(() => H.teardown(env));
test.beforeEach(() => env.server.reset());

const seed = () => env.server.set([H.book('a1', '연습용 책 A'), H.book('b2', '연습용 책 B')]);
const onServer = id => env.server.books().find(b => b.id === id);

test('옛 화면(연결 끊긴) 기기에서 저장해도 다른 기기가 그 사이 고친 것이 지워지지 않는다', async () => {
  seed();
  const A = await H.newDevice(env, { name: 'A(태블릿)' });
  const B = await H.newDevice(env, { name: 'B(폰)' });
  await A.waitForCard('a1'); await B.waitForCard('a1');

  await A.setOnline(false);                                   // 태블릿: 연결이 끊긴 채 옛 화면
  await H.editReview(B.page, 'b2', 'B에서 쓴 감상평');          // 폰: 책 B 를 고친다
  await H.waitFor(() => onServer('b2')?.review === 'B에서 쓴 감상평');
  await H.editRating(A.page, 'a1', 4);                         // 태블릿: 다른 책 A 를 고친다 (B 의 편집을 모른다)
  await A.setOnline(true);

  await H.waitFor(() => onServer('a1')?.rating === 4 && onServer('b2')?.review === 'B에서 쓴 감상평',
    { message: '서버에 두 기기의 편집이 모두 남아야 한다. 지금: ' + JSON.stringify(env.server.books()) });
  await H.waitFor(async () => (await B.books()).find(b => b.id === 'a1')?.rating === 4, { message: 'B 화면에 A 의 별점이 와야 한다' });
  await H.waitFor(async () => (await A.books()).find(b => b.id === 'b2')?.review === 'B에서 쓴 감상평', { message: 'A 화면에 B 의 감상평이 와야 한다' });
  assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []);
  await A.close(); await B.close();
});

test('오프라인에서 고치고 앱을 닫았다 다시 열어도 그 편집이 올라간다', async () => {
  seed();
  let A = await H.newDevice(env, { name: 'A' });
  await A.waitForCard('a1');
  await A.setOnline(false);
  await H.editReview(A.page, 'a1', '오프라인에서 쓴 감상평');
  const state = await A.close();                               // 앱 종료 — 메모리에만 있던 것은 사라진다

  A = await H.newDevice(env, { name: 'A(재시작)', storageState: state });
  await H.waitFor(() => onServer('a1')?.review === '오프라인에서 쓴 감상평',
    { message: '다시 연 뒤 오프라인 편집이 서버에 올라가야 한다. 지금: ' + JSON.stringify(env.server.books()) });
  await H.waitFor(async () => (await A.books()).find(b => b.id === 'a1')?.review === '오프라인에서 쓴 감상평');
  assert.deepEqual(A.errors, []);
  await A.close();
});

test('한 기기에서 지운 책이 다른 기기의 옛 배열로 되살아나지 않는다', async () => {
  seed();
  const A = await H.newDevice(env, { name: 'A' });
  const B = await H.newDevice(env, { name: 'B' });
  await A.waitForCard('b2'); await B.waitForCard('b2');

  await A.setOnline(false);
  await H.deleteBook(B.page, 'b2');
  await H.waitFor(() => !onServer('b2'));
  await H.editReview(A.page, 'a1', 'A 감상평');                // A 는 아직 b2 를 들고 있다
  await A.setOnline(true);

  await H.waitFor(() => onServer('a1')?.review === 'A 감상평');
  await H.sleep(300);
  assert.ok(!onServer('b2'), '지운 책 b2 가 되살아났다: ' + JSON.stringify(env.server.books()));
  await A.waitForNoCard('b2');
  await A.close(); await B.close();
});

test('전체 삭제 뒤, 닫혀 있던 기기를 열어도 그 기기의 옛 목록이 계정에 다시 올라가지 않는다', async () => {
  seed();
  const A = await H.newDevice(env, { name: 'A' });
  let B = await H.newDevice(env, { name: 'B' });
  await A.waitForCard('a1'); await B.waitForCard('a1');
  const stateB = await B.close();                              // B 는 닫혀 있다 (캐시엔 책 둘)

  await H.clearAll(A.page);
  await H.waitFor(() => env.server.books().length === 0);

  B = await H.newDevice(env, { name: 'B(재시작)', storageState: stateB });
  await B.waitForServerListen();
  await H.sleep(600);
  assert.equal(env.server.books().length, 0, '닫혀 있던 기기의 캐시가 계정에 다시 올라갔다: ' + JSON.stringify(env.server.books()));
  await H.waitFor(async () => (await B.books()).length === 0, { message: 'B 화면도 비어야 한다' });
  await A.close(); await B.close();
});

test('연결 전에 고친 것은 올라가고, 그 사이 다른 기기가 고친 것은 지워지지 않는다', async () => {
  seed();
  let A = await H.newDevice(env, { name: 'A' });
  await A.waitForCard('a1');
  const state = await A.close();
  // A 가 꺼져 있는 동안 다른 기기가 b2 를 고쳤다
  env.server.set([H.book('a1', '연습용 책 A'), H.book('b2', '연습용 책 B', { review: 'B 감상평', updatedAt: '2026-10-02T00:00:00.000Z' })]);

  A = await H.newDevice(env, { name: 'A(오프라인 시작)', storageState: state, online: false });   // 첫 응답 전
  await A.waitForCard('a1');
  await H.editRating(A.page, 'a1', 5);
  await A.setOnline(true);

  await H.waitFor(() => onServer('a1')?.rating === 5 && onServer('b2')?.review === 'B 감상평',
    { message: '연결 전 편집은 올라가고 B 의 편집은 남아야 한다. 지금: ' + JSON.stringify(env.server.books()) });
  await H.waitFor(async () => (await A.books()).find(b => b.id === 'b2')?.review === 'B 감상평');
  await A.close();
});

test('같은 책을 빠르게 연달아 고쳐도 마지막 내용이 남고 책이 늘거나 줄지 않는다', async () => {
  seed();
  const A = await H.newDevice(env, { name: 'A' });
  const B = await H.newDevice(env, { name: 'B' });
  await A.waitForCard('a1'); await B.waitForCard('a1');
  for (let i = 1; i <= 3; i++) await H.editReview(A.page, 'a1', '감상평 ' + i);
  await H.waitFor(() => onServer('a1')?.review === '감상평 3');
  await H.waitFor(async () => (await B.books()).find(b => b.id === 'a1')?.review === '감상평 3');
  assert.equal(env.server.books().length, 2);
  assert.equal((await A.books()).length, 2);
  await A.close(); await B.close();
});

test('양쪽에서 같은 책을 고쳤으면 더 나중에 고친 쪽이 남는다', async () => {
  seed();
  const A = await H.newDevice(env, { name: 'A' });
  const B = await H.newDevice(env, { name: 'B' });
  await A.waitForCard('a1'); await B.waitForCard('a1');
  await A.setOnline(false);
  await H.editReview(A.page, 'a1', 'A 가 먼저 쓴 것');            // 오프라인, 먼저
  await H.sleep(50);
  await H.editReview(B.page, 'a1', 'B 가 나중에 쓴 것');          // 온라인, 나중
  await H.waitFor(() => onServer('a1')?.review === 'B 가 나중에 쓴 것');
  await A.setOnline(true);
  await H.sleep(500);
  assert.equal(onServer('a1')?.review, 'B 가 나중에 쓴 것', '먼저 쓴 A 의 옛 편집이 나중 편집을 덮어썼다');
  await H.waitFor(async () => (await A.books()).find(b => b.id === 'a1')?.review === 'B 가 나중에 쓴 것', { message: 'A 화면도 나중 편집으로 맞춰져야 한다' });
  await A.close(); await B.close();
});

test('아직 올리지 못한 편집은 로그아웃해도 남아, 같은 계정으로 다시 로그인하면 올라간다', async () => {
  seed();
  let A = await H.newDevice(env, { name: 'A' });
  await A.waitForCard('a1');
  await A.setOnline(false);
  await H.editReview(A.page, 'a1', '로그아웃 전에 쓴 감상평');
  await H.goTab(A.page, 'settings');
  await A.page.click('#btnLogout');                            // 오프라인에서 로그아웃 (책 목록 캐시는 지워진다)
  await A.page.waitForSelector('#loginForm', { state: 'visible' });
  const state = await A.close();                               // 앱 종료

  A = await H.newDevice(env, { name: 'A(재시작·로그아웃 상태)', storageState: state, signedIn: false });
  await A.page.waitForSelector('#loginForm', { state: 'visible' });
  await A.page.fill('#loginEmail', 'test@example.com');
  await A.page.fill('#loginPassword', 'password');
  await A.page.click('#loginBtn');
  await H.waitFor(() => onServer('a1')?.review === '로그아웃 전에 쓴 감상평',
    { message: '다시 로그인한 뒤 미반영 편집이 올라가야 한다. 지금: ' + JSON.stringify(env.server.books()) });
  await H.waitFor(async () => (await A.books()).find(b => b.id === 'a1')?.review === '로그아웃 전에 쓴 감상평');
  await A.close();
});

test('SDK 를 못 불러온 채(오프라인 첫 실행) 고친 것도 다음에 올라간다', async () => {
  seed();
  let A = await H.newDevice(env, { name: 'A' });
  await A.waitForCard('a1');
  let state = await A.close();

  A = await H.newDevice(env, { name: 'A(SDK 없음)', storageState: state, sdk: 'none' });   // 저장된 목록만 보인다
  await A.waitForCard('a1');
  await A.page.waitForSelector('#loginScreen', { state: 'hidden' });
  await H.editReview(A.page, 'a1', 'SDK 없이 쓴 감상평');
  state = await A.close();

  A = await H.newDevice(env, { name: 'A(다시 온라인)', storageState: state });
  await H.waitFor(() => onServer('a1')?.review === 'SDK 없이 쓴 감상평',
    { message: 'SDK 없이 고친 것이 다음 실행에서 올라가야 한다. 지금: ' + JSON.stringify(env.server.books()) });
  await A.close();
});

test('다른 기기가 책을 추가·삭제하면 열려 있는 기기 화면에 바로 반영된다 (기본 동기화)', async () => {
  seed();
  const A = await H.newDevice(env, { name: 'A' });
  const B = await H.newDevice(env, { name: 'B' });
  await A.waitForCard('a1'); await B.waitForCard('a1');
  await H.addBook(B.page, { title: '연습용 책 C', review: '새 책' });
  await H.waitFor(() => env.server.books().some(b => b.title === '연습용 책 C'));
  const c = env.server.books().find(b => b.title === '연습용 책 C');
  await A.waitForCard(c.id);
  await H.deleteBook(B.page, 'a1');
  await A.waitForNoCard('a1');
  assert.equal(env.server.books().length, 2);
  assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []);
  await A.close(); await B.close();
});

test('서버가 구멍 난 객체 모양으로 돌려줘도 읽고 쓸 수 있다', async () => {
  env.server.set({ 0: H.book('a1', '연습용 책 A'), 2: H.book('c3', '연습용 책 C') });   // 가운데가 빈 객체 형태
  const A = await H.newDevice(env, { name: 'A' });
  await A.waitForCard('a1'); await A.waitForCard('c3');
  await H.editReview(A.page, 'c3', '객체 모양에서 고침');
  await H.waitFor(() => onServer('c3')?.review === '객체 모양에서 고침');
  assert.equal(env.server.books().length, 2);
  assert.deepEqual(A.errors, []);
  await A.close();
});

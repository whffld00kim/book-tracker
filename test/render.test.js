// 화면·입력 시험 — XSS(innerHTML 에 들어가는 사용자 글), 불러온 책의 id, 수정 중 지워진 책 저장
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');

let env;
test.before(async () => { env = await H.setup(); });
test.after(() => H.teardown(env));
test.beforeEach(() => env.server.reset());
const onServer = id => env.server.books().find(b => b.id === id);

test('제목·저자·카테고리·감상평·상태에 HTML 을 넣어도 글자로만 보인다 (XSS)', async () => {
  const tag = '<img src=x onerror="window.__xss=1">';
  env.server.set([H.book('x1', '제목' + tag, { author: '저자' + tag, publisher: '<b>굵게</b>', category: '소설' + tag, status: '완독' + tag, review: '감상' + tag })]);
  const A = await H.newDevice(env);
  await A.page.waitForSelector('.book-card');
  await H.sleep(100);
  assert.equal(await A.page.evaluate(() => document.querySelectorAll('#bookGrid img, #bookGrid b').length), 0, 'HTML 이 요소로 만들어졌다');
  assert.equal(await A.page.evaluate(() => window.__xss), undefined);
  assert.ok((await A.page.textContent('.card-title')).includes(tag));
  await A.close();
});

test('책 id 에 HTML 이 들어 있어도 카드에서 실행되지 않는다 (XSS)', async () => {
  const evil = '"><img src=x onerror="window.__xss=1">';
  env.server.set([H.book(evil, '연습용 책 X')]);
  const A = await H.newDevice(env);
  await A.page.waitForSelector('.book-card');
  await H.sleep(100);
  assert.equal(await A.page.evaluate(() => document.querySelectorAll('#bookGrid img').length), 0, 'id 로 img 요소가 만들어졌다');
  assert.equal(await A.page.evaluate(() => window.__xss), undefined);
  assert.equal(await A.page.getAttribute('.book-card', 'data-id'), evil);
  await A.close();
});

test('불러온 JSON 에 id 가 없는 책도 열어서 고치고 지울 수 있다', async () => {
  env.server.set([H.book('a1', '연습용 책 A')]);
  const A = await H.newDevice(env);
  await A.waitForCard('a1');
  await H.importJSON(A.page, [{ title: '연습용 책 I', author: '연습 저자' }]);   // id 없는 책
  await H.waitFor(() => env.server.books().some(b => b.title === '연습용 책 I'));
  const imported = env.server.books().find(b => b.title === '연습용 책 I');
  assert.ok(typeof imported.id === 'string' && imported.id && imported.id !== 'undefined', 'id 가 부여돼야 한다: ' + JSON.stringify(imported));

  await H.goTab(A.page, 'list');
  await H.editReview(A.page, imported.id, '불러온 책 감상평');
  await H.waitFor(() => onServer(imported.id)?.review === '불러온 책 감상평', { message: '불러온 책을 고칠 수 있어야 한다' });
  await H.deleteBook(A.page, imported.id);
  await H.waitFor(() => !env.server.books().some(b => b.title === '연습용 책 I'), { message: '불러온 책을 지울 수 있어야 한다' });
  assert.deepEqual(A.errors, []);
  await A.close();
});

test('수정창을 열어 둔 사이 다른 기기가 그 책을 지워도, 저장한 내용이 사라지지 않는다', async () => {
  env.server.set([H.book('a1', '연습용 책 A', { createdAt: '2026-09-01T00:00:00.000Z' }), H.book('b2', '연습용 책 B')]);
  const A = await H.newDevice(env, { name: 'A' });
  const B = await H.newDevice(env, { name: 'B' });
  await A.waitForCard('a1'); await B.waitForCard('a1');

  await H.openEdit(A.page, 'a1');
  await A.page.fill('#fReview', '지워지는 사이 쓴 감상평');
  await H.deleteBook(B.page, 'a1');            // 다른 기기가 그 책을 지운다
  await A.waitForNoCard('a1');
  await H.saveModal(A.page);                   // A 가 저장

  await H.waitFor(() => env.server.books().some(b => b.title === '연습용 책 A' && b.review === '지워지는 사이 쓴 감상평'),
    { message: '저장한 수정 내용이 서버에 남아야 한다. 지금: ' + JSON.stringify(env.server.books()) });
  const saved = env.server.books().find(b => b.title === '연습용 책 A');
  assert.equal(saved.id, 'a1', '같은 책(id)으로 돌아와야 한다');
  assert.equal(saved.createdAt, '2026-09-01T00:00:00.000Z', '등록일이 유지돼야 한다');
  await H.waitFor(async () => (await B.books()).some(b => b.id === 'a1'), { message: 'B 화면에도 다시 보여야 한다' });
  await A.close(); await B.close();
});

test('구매희망 배지를 눌러 구매완료로 바꾸면 다른 기기에도 반영된다', async () => {
  env.server.set([H.book('w1', '연습용 책 W', { wantToBuy: true })]);
  const A = await H.newDevice(env, { name: 'A' });
  const B = await H.newDevice(env, { name: 'B' });
  await A.waitForCard('w1'); await B.waitForCard('w1');
  await A.page.click('[data-buy="w1"]');
  await H.waitFor(() => onServer('w1')?.purchased === true);
  await B.page.waitForSelector('[data-buy="w1"].bought');
  await A.close(); await B.close();
});

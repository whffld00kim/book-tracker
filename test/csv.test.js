// CSV 내보내기 시험 — 따옴표·쉼표·줄바꿈이 든 글이 칸을 깨뜨리지 않는지
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');

let env;
test.before(async () => { env = await H.setup(); });
test.after(() => H.teardown(env));
test.beforeEach(() => env.server.reset());

const HEADER = ['제목', '저자', '출판사', '카테고리', '상태', '시작일', '완독일', '별점', '구매희망', '구매완료', '감상평', '등록일'];

test('CSV 내보내기: 제목·저자·감상평에 큰따옴표·쉼표·줄바꿈이 있어도 칸이 깨지지 않는다', async () => {
  env.server.set([
    H.book('q1', '"연습" 책, 쉼표 포함', {
      author: '저자 "별명"', publisher: '출판사, 주식회사', status: '완독', finishDate: '2026-10-05', rating: 4,
      wantToBuy: true, purchased: true, review: '첫 줄\n둘째 줄에 "인용"과, 쉼표', createdAt: '2026-10-03T03:00:00.000Z',
    }),
    H.book('q2', '보통 책', { rating: 0 }),
  ]);
  const A = await H.newDevice(env);
  await A.waitForCard('q1');

  const csv = await H.exportCSV(A.page);
  assert.equal(csv.charCodeAt(0), 0xFEFF, '엑셀용 BOM 이 있어야 한다');
  const rows = H.parseCSV(csv);
  assert.equal(rows.length, 3, '머리글 + 책 2권. 실제: ' + JSON.stringify(rows));
  assert.deepEqual(rows[0], HEADER);
  rows.forEach((r, i) => assert.equal(r.length, HEADER.length, `${i}번째 행의 칸 수가 다르다: ` + JSON.stringify(r)));

  const r = rows.find(r => r[0] === '"연습" 책, 쉼표 포함');
  assert.ok(r, '큰따옴표가 든 제목이 온전해야 한다. 실제 행들: ' + JSON.stringify(rows.slice(1)));
  assert.equal(r[1], '저자 "별명"');
  assert.equal(r[2], '출판사, 주식회사');
  assert.equal(r[4], '완독');
  assert.equal(r[5], '2026-10-01');
  assert.equal(r[6], '2026-10-05');
  assert.equal(r[7], '4');
  assert.equal(r[8], 'O'); assert.equal(r[9], 'O');
  assert.equal(r[10], '첫 줄\n둘째 줄에 "인용"과, 쉼표');

  const r2 = rows.find(r => r[0] === '보통 책');
  assert.equal(r2[7], '', '별점 0 은 빈칸');
  assert.equal(r2[8], 'X'); assert.equal(r2[9], 'X');
  assert.deepEqual(A.errors, []);
  await A.close();
});

test('JSON 내보내기 → 불러오기: 같은 책은 중복으로 들어가지 않는다', async () => {
  env.server.set([H.book('a1', '연습용 책 A'), H.book('b2', '연습용 책 B')]);
  const A = await H.newDevice(env);
  await A.waitForCard('a1');
  const backup = { version: '1.0', exportedAt: '2026-10-10T00:00:00.000Z', books: [H.book('a1', '연습용 책 A'), H.book('c3', '연습용 책 C')] };
  await H.importJSON(A.page, backup);
  await H.waitFor(() => env.server.books().some(b => b.id === 'c3'));
  const ids = env.server.books().map(b => b.id).sort();
  assert.deepEqual(ids, ['a1', 'b2', 'c3']);
  assert.deepEqual(A.errors, []);
  await A.close();
});

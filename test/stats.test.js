// 통계·정렬 시험 — 평균 별점, 월별 완독(날짜가 시간대 때문에 밀리지 않는지), 카테고리, 정렬, 다른 기기 변경의 즉시 반영
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');

let env;
test.before(async () => { env = await H.setup(); });
test.after(() => H.teardown(env));
test.beforeEach(() => env.server.reset());

// 시간대 tz 에서의 '이번 달' (YYYY, MM)
function thisMonth(tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  return { y: +get('year'), m: +get('month') };
}
const lbl = (y, m) => `${String(y).slice(2)}.${String(m).padStart(2, '0')}`;
const monthRows = page => page.$$eval('#monthlyChart .chart-row', rs => Object.fromEntries(rs.map(r => [r.querySelector('.chart-lbl').textContent, r.querySelector('.chart-num').textContent])));

test('월별 완독: 완독일이 달의 첫날이어도 서쪽 시간대(미국)에서 전달로 밀리지 않는다', async () => {
  const tz = 'America/Los_Angeles';
  const { y, m } = thisMonth(tz);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  env.server.set([H.book('m1', '연습용 책 M', { status: '완독', finishDate: first, rating: 5 })]);

  const A = await H.newDevice(env, { timezoneId: tz });
  await A.waitForCard('m1');
  await H.goTab(A.page, 'stats');
  const rows = await monthRows(A.page);
  assert.equal(rows[lbl(y, m)], '1', `이번 달(${lbl(y, m)})에 1권이어야 한다: ` + JSON.stringify(rows));
  assert.equal(rows[lbl(prev.y, prev.m)], '0', `전달(${lbl(prev.y, prev.m)})로 밀리면 안 된다: ` + JSON.stringify(rows));
  await A.close();
});

test('월별 완독: 한국 시간대에서도 같은 달에 집계된다', async () => {
  const tz = 'Asia/Seoul';
  const { y, m } = thisMonth(tz);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  env.server.set([H.book('m1', '연습용 책 M', { status: '완독', finishDate: first }), H.book('m2', '읽는 중인 책', { finishDate: first })]);
  const A = await H.newDevice(env, { timezoneId: tz });
  await A.waitForCard('m1');
  await H.goTab(A.page, 'stats');
  const rows = await monthRows(A.page);
  assert.equal(rows[lbl(y, m)], '1', '완독 상태인 책만 센다');
  assert.equal(Object.keys(rows).length, 12);
  await A.close();
});

test('평균 별점은 별점을 준 책만으로 계산하고, 카테고리 분포·정렬이 맞다', async () => {
  env.server.set([
    H.book('r0', '다 책', { rating: 0, category: '소설', createdAt: '2026-10-03T00:00:00.000Z' }),
    H.book('r3', '가 책', { rating: 3, category: '과학', status: '완독', createdAt: '2026-10-01T00:00:00.000Z' }),
    H.book('r5', '나 책', { rating: 5, category: '소설', status: '완독', createdAt: '2026-10-02T00:00:00.000Z' }),
  ]);
  const A = await H.newDevice(env);
  await A.waitForCard('r0');
  await H.goTab(A.page, 'stats');
  assert.equal(await A.page.textContent('#statTotal'), '3');
  assert.equal(await A.page.textContent('#statReading'), '1');
  assert.equal(await A.page.textContent('#statDone'), '2');
  assert.equal(await A.page.textContent('#statAvg'), '4.0');
  const cats = await A.page.$$eval('#categoryChart .chart-row', rs => rs.map(r => [r.querySelector('.chart-lbl').textContent, r.querySelector('.chart-num').textContent]));
  assert.deepEqual(cats, [['소설', '2'], ['과학', '1']]);

  await H.goTab(A.page, 'list');
  const order = () => A.page.$$eval('.book-card', cs => cs.map(c => c.dataset.id));
  assert.deepEqual(await order(), ['r0', 'r5', 'r3'], '최신순(등록일)');
  await A.page.selectOption('#sortBy', 'rating');
  assert.deepEqual(await order(), ['r5', 'r3', 'r0'], '별점순');
  await A.page.selectOption('#sortBy', 'title');
  assert.deepEqual(await order(), ['r3', 'r5', 'r0'], '제목순(가나다)');
  assert.deepEqual(A.errors, []);
  await A.close();
});

test('통계 탭을 보고 있을 때 다른 기기가 책을 추가하면 숫자가 바로 바뀐다', async () => {
  env.server.set([H.book('s1', '연습용 책 S', { status: '완독', rating: 4 })]);
  const A = await H.newDevice(env);
  await A.waitForCard('s1');
  await H.goTab(A.page, 'stats');
  assert.equal(await A.page.textContent('#statTotal'), '1');
  // 다른 기기의 쓰기
  env.server.set([H.book('s1', '연습용 책 S', { status: '완독', rating: 4 }), H.book('s2', '연습용 책 S2', { status: '완독', rating: 2 })]);
  await H.waitFor(async () => (await A.page.textContent('#statTotal')) === '2', { message: '통계 탭의 숫자가 갱신되지 않았다' });
  assert.equal(await A.page.textContent('#statDone'), '2');
  assert.equal(await A.page.textContent('#statAvg'), '3.0');
  await A.close();
});

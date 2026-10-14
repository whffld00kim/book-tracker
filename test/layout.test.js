// 세 화면 폭 레이아웃 시험 — 폴드7 접은 화면(360), 펼친 화면(750), 태블릿 가로(1280). 스크린샷은 test/.out/ 에 남긴다
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./helpers.js');

let env;
test.before(async () => { env = await H.setup(); fs.mkdirSync(path.join(__dirname, '.out'), { recursive: true }); });
test.after(() => H.teardown(env));
test.beforeEach(() => env.server.reset());

const seed = () => env.server.set([
  H.book('a1', '연습용 책 A — 제목이 꽤 길어서 두 줄로 넘어가는 경우를 봅니다', { review: '감상평 '.repeat(30), rating: 4, status: '완독', finishDate: '2026-10-05', wantToBuy: true }),
  H.book('b2', '연습용 책 B', { rating: 2 }),
  H.book('c3', '연습용 책 C', { status: '중단', wantToBuy: true, purchased: true }),
]);
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const box = (page, sel) => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; });
const shot = (page, name) => page.screenshot({ path: path.join(__dirname, '.out', name + '.png'), fullPage: false });

for (const [name, viewport] of [['360-접은화면', { width: 360, height: 780 }], ['750-펼친화면', { width: 750, height: 900 }], ['1280-태블릿가로', { width: 1280, height: 800 }]]) {
  test(`${name}: 목록·통계·설정·수정창이 가로로 넘치지 않는다`, async () => {
    seed();
    const A = await H.newDevice(env, { viewport });
    await A.waitForCard('a1');
    assert.ok(await noOverflow(A.page), '목록이 가로로 넘친다');
    await shot(A.page, `${name}-목록`);
    await H.goTab(A.page, 'stats'); assert.ok(await noOverflow(A.page), '통계가 가로로 넘친다'); await shot(A.page, `${name}-통계`);
    await H.goTab(A.page, 'settings'); assert.ok(await noOverflow(A.page), '설정이 가로로 넘친다'); await shot(A.page, `${name}-설정`);
    await H.goTab(A.page, 'list');
    await H.openEdit(A.page, 'a1');
    await A.page.waitForTimeout(150);
    assert.ok(await noOverflow(A.page), '수정창이 가로로 넘친다');
    await shot(A.page, `${name}-수정창`);

    const title = await box(A.page, '#fTitle'); const review = await box(A.page, '.fg-review'); const modal = await box(A.page, '.modal-box');
    if (viewport.width >= 700) {
      assert.ok(review.x >= title.right - 1, '넓은 화면에서는 책 정보 | 감상평 2단이어야 한다');
    } else {
      assert.ok(review.y >= title.bottom, '좁은 화면에서는 한 단이어야 한다');
    }
    assert.ok(modal.right <= viewport.width + 1 && modal.x >= -1, '수정창이 화면 밖으로 나간다');
    if (viewport.width >= 900) {
      const nav = await A.page.$eval('.bottom-nav', el => ({ dir: getComputedStyle(el).flexDirection, w: el.getBoundingClientRect().width }));
      assert.equal(nav.dir, 'column', '태블릿 가로에서는 왼쪽 레일');
      assert.ok(nav.w < 120);
    }
    assert.deepEqual(A.errors, []);
    await A.close();
  });
}

// test/helpers.js — Playwright 시험 공통 도구
//  - 정적 서버: 저장소(또는 환경변수 APP_DIR 의 디렉터리)를 GitHub Pages 와 같은 /book-tracker/ 경로로 서비스한다.
//    APP_DIR 로 고치기 전 index.html 을 가리키면 "고치기 전엔 실패, 고친 뒤엔 통과"를 비교할 수 있다.
//  - FakeServer: books/{uid} 값을 한 곳에 두고 기기(페이지)들의 listen/put/cas 를 받는다 (RTDB 서버 흉내)
//  - newDevice(): 기기 하나 = 브라우저 컨텍스트 하나. www.gstatic.com 의 Firebase 스크립트를 test/fake-firebase.js 로
//    바꿔치기하고, 서비스워커는 막는다(라우팅이 통하게). 실제 Firebase 에는 아무 요청도 가지 않는다.
//  - 시험 데이터는 모두 가짜다 (uid u_test1, test@example.com, "연습용 책 …")
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { canon } = require('./fake-firebase.js');

const APP_DIR = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
const FAKE_SDK = fs.readFileSync(path.join(__dirname, 'fake-firebase.js'), 'utf8');
const UID = 'u_test1';
const BOOKS_PATH = 'books/' + UID;
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// ── 정적 서버 ──
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.md': 'text/markdown' };
function startStaticServer(dir) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!p.startsWith('/book-tracker/')) { res.writeHead(404); return res.end(); }
    p = p.slice('/book-tracker/'.length) || 'index.html';
    const file = path.join(dir, p);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}/book-tracker/`, close: () => new Promise(r => server.close(r)) });
  }));
}

// ── 가짜 RTDB 서버 ──
class FakeServer {
  constructor() { this.data = new Map(); this.devices = new Set(); this.writes = []; }
  reset() { this.data.clear(); this.writes.length = 0; }
  get(p = BOOKS_PATH) { return this.data.has(p) ? clone(this.data.get(p)) : null; }
  books(p = BOOKS_PATH) {   // 배열 또는 구멍 난 객체 → 배열
    const v = this.get(p);
    if (Array.isArray(v)) return v.filter(Boolean);
    if (v && typeof v === 'object') return Object.values(v).filter(Boolean);
    return [];
  }
  // 시험에서 "다른 곳의 쓰기"(모델링하지 않은 기기, 콘솔 등)를 흉내 낸다
  set(value, p = BOOKS_PATH) { this.data.set(p, canon(value)); this.broadcast(p); }
  // 보안 규칙 흉내: books/$uid 는 본인 uid 만 읽고 쓴다 (로그아웃 뒤 큐에 남은 쓰기는 실제처럼 거부된다)
  allowed(msg) { const m = /^books\/([^/]+)/.exec(msg.path); return !!m && msg.auth === m[1]; }
  handle(device, msg) {
    const p = msg.path;
    if (['listen', 'get', 'put', 'cas'].includes(msg.op) && !this.allowed(msg)) {
      this.writes.push({ device: device.name, op: msg.op + '-denied', path: p });
      throw new Error('PERMISSION_DENIED: ' + p);
    }
    switch (msg.op) {
      case 'listen': device.listening.add(p); return { value: this.get(p) };
      case 'unlisten': device.listening.delete(p); return {};
      case 'get': return { value: this.get(p) };
      case 'put':
        this.data.set(p, canon(msg.value));
        this.writes.push({ device: device.name, op: 'put', path: p, value: this.get(p) });
        this.broadcast(p);
        return { value: this.get(p) };
      case 'cas': {
        const cur = this.get(p);
        if (JSON.stringify(cur) !== msg.base) {
          this.writes.push({ device: device.name, op: 'cas-stale', path: p });
          return { ok: false, value: cur };
        }
        this.data.set(p, canon(msg.value));
        this.writes.push({ device: device.name, op: 'cas', path: p, value: this.get(p) });
        this.broadcast(p);
        return { ok: true, value: this.get(p) };
      }
      default: throw new Error('fake server: unknown op ' + msg.op);
    }
  }
  broadcast(p) {
    const value = this.get(p);
    for (const d of this.devices) {
      if (d.closed || !d.online || !d.listening.has(p)) continue;
      d.page.evaluate(([pp, v]) => window.__fake && window.__fake.recv(pp, v), [p, value]).catch(() => {});
    }
  }
}

// ── 환경 ──
async function setup() {
  const browser = await chromium.launch();
  const stat = await startStaticServer(APP_DIR);
  return { browser, stat, url: stat.url, server: new FakeServer(), appDir: APP_DIR };
}
async function teardown(env) {
  if (!env) return;
  for (const d of Array.from(env.server.devices)) { try { await d.context.close(); } catch {} }
  await env.browser.close();
  await env.stat.close();
}

// 기기 하나를 연다. opts: { name, uid, email, signedIn, online, viewport, timezoneId, storageState, sdk:'fake'|'none', dialog:'accept'|'dismiss', goto }
async function newDevice(env, opts = {}) {
  const uid = opts.uid || UID;
  const online = opts.online !== false;
  const context = await env.browser.newContext({
    serviceWorkers: 'block',
    viewport: opts.viewport || { width: 360, height: 780 },
    deviceScaleFactor: 1,
    timezoneId: opts.timezoneId || 'Asia/Seoul',
    locale: 'ko-KR',
    storageState: opts.storageState,
    acceptDownloads: true,
  });
  const device = { context, uid, online, listening: new Set(), errors: [], closed: false, name: opts.name || uid };
  env.server.devices.add(device);
  await context.addInitScript(cfg => { window.__fakeConfig = cfg; }, {
    uid, email: opts.email || 'test@example.com', signedIn: opts.signedIn !== false, online,
    authDelay: opts.authDelay, loginError: opts.loginError,
  });
  await context.exposeBinding('__srv', (source, msg) => env.server.handle(device, msg));
  await context.route('https://www.gstatic.com/firebasejs/**', route => {
    if (opts.sdk === 'none') return route.abort('failed');   // SDK 를 못 불러오는 상황(오프라인 첫 실행 등)
    const isApp = route.request().url().includes('firebase-app-compat');
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: isApp ? FAKE_SDK : '/* fake: auth/database 는 app 스크립트에 함께 들어 있다 */' });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);   // 기다림이 길어지면 그 자체가 실패 (고치기 전 코드로 돌릴 때 빨리 끝나게)
  device.page = page;
  page.on('pageerror', err => device.errors.push(err));
  page.on('dialog', d => (opts.dialog === 'dismiss' ? d.dismiss() : d.accept()));
  if (opts.goto !== false) await page.goto(env.url, { waitUntil: 'load' });

  device.setOnline = async on => { device.online = !!on; await page.evaluate(v => window.__fake.setOnline(v), !!on); };
  device.books = () => page.evaluate(() => books);
  device.waitForCard = (id, timeout = 8000) => page.waitForSelector(`.book-card[data-id="${CSS_ESCAPE(id)}"]`, { timeout });
  device.waitForNoCard = (id, timeout = 8000) => page.waitForSelector(`.book-card[data-id="${CSS_ESCAPE(id)}"]`, { state: 'detached', timeout });
  device.waitForServerListen = () => waitFor(() => device.listening.has(BOOKS_PATH), { message: device.name + ': 구독이 시작되지 않았다' });
  device.close = async () => {   // 앱을 완전히 닫는 것. 돌려주는 storageState 로 다시 열면 localStorage 가 이어진다
    const storageState = await context.storageState();
    device.closed = true;
    env.server.devices.delete(device);
    await context.close();
    return storageState;
  };
  return device;
}
const CSS_ESCAPE = s => String(s).replace(/["\\]/g, '\\$&');

// 조건이 참이 될 때까지 기다린다 (동기/비동기 함수 모두)
async function waitFor(fn, { timeout = 8000, interval = 40, message = '조건이 시간 안에 충족되지 않았다' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(message + (last instanceof Error ? ` (마지막 오류: ${last.message})` : ''));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 시험용 책 (모두 가짜) ──
function book(id, title, extra = {}) {
  return {
    id, title, author: '연습 저자', publisher: '연습 출판사', category: '소설', status: '읽는중',
    startDate: '2026-10-01', finishDate: '', rating: 0, wantToBuy: false, purchased: false, review: '',
    createdAt: '2026-10-01T00:00:00.000Z', ...extra,
  };
}

// ── 화면 조작 (사용자가 하는 그대로) ──
async function openEdit(page, id) {
  await page.click(`.book-card[data-id="${CSS_ESCAPE(id)}"] .card-title`);
  await page.waitForSelector('#modal:not(.hidden)');
}
async function saveModal(page) {
  await page.click('#submitBtn');
  await page.waitForSelector('#modal', { state: 'hidden' });
}
async function editReview(page, id, text) { await openEdit(page, id); await page.fill('#fReview', text); await saveModal(page); }
async function editRating(page, id, n) { await openEdit(page, id); await page.click(`#starRating .star[data-v="${n}"]`); await saveModal(page); }
async function addBook(page, { title, review = '', rating = 0, status, finishDate }) {
  await page.click('#addBookBtn');
  await page.waitForSelector('#modal:not(.hidden)');
  await page.fill('#fTitle', title);
  if (status) await page.selectOption('#fStatus', status);
  if (finishDate) await page.fill('#fFinishDate', finishDate);
  if (review) await page.fill('#fReview', review);
  if (rating) await page.click(`#starRating .star[data-v="${rating}"]`);
  await saveModal(page);
}
async function deleteBook(page, id) {
  await page.click(`[data-del="${CSS_ESCAPE(id)}"]`);
  await page.waitForSelector('#deleteModal:not(.hidden)');
  await page.click('#confirmDeleteBtn');
  await page.waitForSelector('#deleteModal', { state: 'hidden' });
}
async function goTab(page, tab) { await page.click(`#nav-${tab}`); await page.waitForSelector(`#tab-${tab}.active`); }
async function clearAll(page) { await goTab(page, 'settings'); await page.click('#btnClearData'); }   // confirm 은 자동 승인
async function importJSON(page, data) {
  await goTab(page, 'settings');
  await page.setInputFiles('#importFile', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
}
async function exportCSV(page) {
  await goTab(page, 'settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnExportCSV')]);
  return fs.readFileSync(await dl.path(), 'utf8');
}
const toast = page => page.textContent('#toast');
const syncBadge = page => page.textContent('#syncBadge');

// RFC 4180 식 CSV 파서 (내보낸 파일 검증용)
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [[]]; let cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { rows[rows.length - 1].push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      rows[rows.length - 1].push(cell); cell = ''; rows.push([]);
    } else cell += c;
  }
  rows[rows.length - 1].push(cell);
  if (rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  return rows;
}

module.exports = {
  APP_DIR, UID, BOOKS_PATH, FakeServer, setup, teardown, newDevice, waitFor, sleep, book, clone,
  openEdit, saveModal, editReview, editRating, addBook, deleteBook, goTab, clearAll, importJSON, exportCSV, toast, syncBadge, parseCSV,
};

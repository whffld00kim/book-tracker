// 서비스워커 정합성 시험 — sw.js 의 OWN·CDN 목록이 index.html·manifest.json 과 맞는지, 캐시 버전이 올라갔는지 (정적 검사)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./helpers.js');

const read = f => fs.readFileSync(path.join(H.APP_DIR, f), 'utf8');

test('sw.js: 캐시 버전은 book-tracker-v12 이고 이 앱 접두사만 지운다', () => {
  const sw = read('sw.js');
  assert.equal(/const CACHE = '([^']+)'/.exec(sw)[1], 'book-tracker-v12');
  assert.ok(sw.includes("k.startsWith('book-tracker-') && k !== CACHE"), '다른 앱의 캐시를 지우지 않아야 한다');
  assert.ok(sw.includes('const CDN_HOSTS = ["www.gstatic.com"]'), '캐시 허용 호스트는 gstatic 만');
});

test('sw.js 의 CDN 목록 = index.html 이 부르는 외부 스크립트', () => {
  const sw = read('sw.js'); const html = read('index.html');
  const CDN = JSON.parse(/const CDN = (\[[\s\S]*?\]);/.exec(sw)[1]);
  const scripts = [...html.matchAll(/<script src="(https:[^"]+)"/g)].map(m => m[1]);
  assert.deepEqual([...CDN].sort(), [...scripts].sort());
  for (const u of CDN) assert.ok(u.startsWith('https://www.gstatic.com/'), u + ' 은 CDN_HOSTS 밖이다');
});

test('sw.js 의 OWN 목록 = 이 앱의 파일 (index.html·manifest 가 가리키는 것 모두, 실제로 있는 것만)', () => {
  const sw = read('sw.js'); const html = read('index.html');
  const OWN = JSON.parse(/const OWN = (\[[\s\S]*?\]);/.exec(sw)[1]);
  assert.ok(OWN.includes('./') && OWN.includes('./index.html'), '시작 주소와 index.html 둘 다');
  const ownFiles = OWN.map(u => u.replace(/^\.\//, '')).filter(Boolean);
  const manifest = JSON.parse(read('manifest.json'));
  const referenced = [
    ...[...html.matchAll(/href="\/book-tracker\/([^"]+)"/g)].map(m => m[1]),   // manifest, apple-touch-icon
    ...manifest.icons.map(i => i.src.replace('/book-tracker/', '')),
  ];
  for (const f of referenced) assert.ok(ownFiles.includes(f), `${f} 가 sw.js OWN 에 없다 (미리 받아 두지 않으면 오프라인에서 빠진다)`);
  for (const f of ownFiles) assert.ok(fs.existsSync(path.join(H.APP_DIR, f)), `OWN 의 ${f} 파일이 저장소에 없다 (install 이 실패한다)`);
  assert.equal(manifest.start_url, '/book-tracker/');
  assert.equal(manifest.scope, '/book-tracker/');
  assert.ok(html.includes("navigator.serviceWorker.register('/book-tracker/sw.js')"));
});

# test/ — Book Tracker 시험

앱(index.html)을 실제 브라우저(Playwright Chromium)에서 열고, www.gstatic.com 의 Firebase 스크립트 셋(app·auth·database)을
`fake-firebase.js` 로 바꿔치기해 돈다. **실제 Firebase 프로젝트에는 아무 요청도 가지 않는다.** 시험 데이터는 모두 가짜다
(uid `u_test1`, `test@example.com`, "연습용 책 …"). GitHub Pages 배포에는 영향이 없다 (앱은 이 폴더를 참조하지 않는다).

## 돌리기

```
npm install                 # playwright 1.56.1 (처음 한 번)
npx playwright install chromium   # 브라우저 (처음 한 번)
npm test
```

고치기 전 코드와 비교하려면 옛 파일들이 있는 폴더를 `APP_DIR` 로 가리킨다:

```
APP_DIR=/path/to/old-copy npm test
```

## 파일

| 파일 | 내용 |
|---|---|
| `fake-firebase.js` | 가짜 compat SDK. 오프라인(큐에 쌓인 쓰기 → 재연결 시 전송), `set`(덮어쓰기), `transaction`(서버 값이 달라졌으면 다시 돈다), 로컬 value 이벤트, `undefined` 거부, 보안 규칙(books/$uid 본인만) 흉내 |
| `helpers.js` | 정적 서버(/book-tracker/ 경로), 가짜 RTDB 서버(기기 여러 대가 공유), 기기 열기/닫기(닫으면 localStorage 만 남는다), 화면 조작 도우미, CSV 파서 |
| `sync.test.js` | 기록 유실: 옛 화면 기기 저장, 오프라인 편집 후 재시작, 삭제 되살아남, 전체 삭제 뒤 재시작, 연결 전 편집, 연달아 고치기, 같은 책 충돌, 로그아웃, SDK 없이 편집, 구멍 난 객체 |
| `render.test.js` | XSS(제목·저자·카테고리·상태·감상평·id), id 없는 책 불러오기, 수정 중 지워진 책 저장, 구매 배지 |
| `csv.test.js` | CSV 따옴표·쉼표·줄바꿈, JSON 내보내기→불러오기 중복 |
| `stats.test.js` | 월별 완독(시간대), 평균 별점, 카테고리, 정렬, 통계 탭 즉시 갱신 |
| `sw.test.js` | sw.js 캐시 버전, OWN·CDN 목록이 index.html·manifest 와 맞는지 (정적 검사) |
| `layout.test.js` | 360(폴드 접음)·750(펼침)·1280(태블릿 가로)에서 가로 넘침 없음, 수정창 2단/1단, 왼쪽 레일. 스크린샷은 `test/.out/` |

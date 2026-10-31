# KNU Campus Navigator

배포 주소: https://knu-campus-navigator.netlify.app

경북대학교 대구캠퍼스 도보 길찾기 웹앱입니다. 네이버 지도 위에 팀이 직접 만든 보행 네트워크를 올리고 다익스트라 알고리즘으로 최단 경로를 계산합니다.

## 실행

이 폴더에서 아래 명령을 실행하고 브라우저로 http://localhost:8000 을 엽니다. 맥은 python3 입니다.

    python -m http.server 8000

포트는 꼭 8000 이어야 합니다. 네이버 클라우드에 http://localhost:8000 이 등록되어 있기 때문입니다. 파일을 더블클릭해서 열면 길 데이터를 읽지 못합니다.

## 폴더와 담당

| 파일 | 내용 | 담당 |
| --- | --- | --- |
| index.html | 화면 뼈대 | 민지 |
| src/app.js | 화면 동작, 네이버 지도 연결 | 민지 |
| src/style.css | 디자인 | 민지 |
| src/core.js | 길찾기 알고리즘, 편의시설 표, 검색 별칭 | 가은 |
| knu-graph.json | 길 데이터 | 소민 |
| tools/knu-map-editor.html | 길 데이터 편집기 | 소민 |

## 길 데이터 고치기

1. http://localhost:8000/tools/knu-map-editor.html 을 엽니다. 저장소의 knu-graph.json 을 자동으로 불러옵니다.
2. 길, 계단, 샛길, 건물 위치를 고칩니다. 작업은 브라우저에 자동 저장됩니다.
3. 저장 버튼을 누르면 knu-graph.json 이 내려받아집니다. 이 파일로 저장소의 같은 파일을 덮어쓰고 Push 합니다.

편집기 규칙

1. 출입구가 여러 개인 건물은 점을 여러 개 찍고 이름 뒤에 동번호를 붙입니다. 예: 중앙도서관 신관(앞) (111)
2. 건물 점은 통로로 쓰이지 않습니다. 건물을 지나가는 지름길은 중간점끼리 잇는 길로 그립니다.
3. 번호 없는 장소(센트럴파크, 테니스장 등)는 종류를 건물로 하고 이름만 씁니다.

앱은 열릴 때마다 캠퍼스 밖 길 정리, 출입구 묶기, 떨어진 건물 연결을 자동으로 합니다.

## 편의시설과 별칭

src/core.js 위쪽의 FAC 표(편의시설)와 ALIAS 표(검색 별칭)에서 고칩니다. 키는 동번호이고, 번호 없는 장소는 'l:이름' 입니다.

## 네이버 지도

Client ID 는 src/app.js 맨 위 NAVER_KEY 에 있습니다. 새 주소에서 열려면 네이버 클라우드 콘솔의 Maps Application 에서 Web 서비스 URL 에 그 주소를 추가하고 저장합니다. 등록되지 않은 주소에서는 앱이 OpenStreetMap 으로 자동 전환하고 화면 위에 안내를 띄웁니다.

## 데이터 출처

보행로 데이터 일부는 OpenStreetMap 에서 가져왔습니다. © OpenStreetMap contributors, ODbL. 건물 번호와 편의시설 정보는 경북대학교 캠퍼스 지도와 학생들이 공유한 지도를 참고했습니다.

## 연강 이동 확인

검색창 아래 **연강 이동 확인**을 누르고 기존 출발·도착 검색창에서 번호가 있는 건물을 선택합니다. 쉬는 시간은 10/15/20분 또는 직접 입력할 수 있습니다. 일반 길찾기와 같은 경로·반올림 도보시간을 사용하며, 시간을 바꿀 때 경로를 다시 탐색하지 않습니다. 계단 회피 선택은 두 화면에서 공유하고, 교환·재검색 후에도 유지합니다. 회피는 기존 알고리즘상 계단과 경사 모두에 적용되며 완전 회피를 보장하지 않습니다.

남은 시간이 5분 이상이면 여유, 0분 이상이면 빠듯, 음수이면 어려움입니다. 잠정 여유 기준은 `src/core.js`의 `TRANSFER_DEFAULTS.comfortableMarginMinutes`에서 변경합니다. 야외 도보 기준이며 강의실·층간 이동 및 대기는 제외합니다. 같은 건물, 번호 없는 장소, 경로 없음, 잘못된 쉬는 시간은 판정 불가 사유를 표시합니다.

## Netlify 제출 전 진단 (2026-10-30)

Git 루트는 이 README의 상위 폴더이고, 실제 앱은 저장소 기준 `knu-campus-navigator/`입니다. `index.html`의 `src/style.css`, `src/core.js`, `src/app.js`와 앱의 `fetch('knu-graph.json')`는 모두 앱 폴더를 기준으로 올바르게 연결됩니다. 앱 폴더 전체를 함께 게시해야 합니다.

관리자에게 제안하는 설정은 아래와 같습니다. 실제 Netlify UI 설정은 접근하지 못했으며 이 작업에서 배포 설정을 변경하지 않았습니다.

| 항목 | 권장값 |
| --- | --- |
| Base directory | 비움 (Git 루트) |
| Package directory | 비움 |
| Publish directory | `knu-campus-navigator` |
| Build command | 비움 (HTML/CSS/JS 정적 사이트) |

대안은 Base directory를 `knu-campus-navigator`, Publish directory를 `.`으로 지정하는 것입니다. 두 설정을 섞어 앱 폴더를 두 번 붙이지 마세요. `package.json`과 빌드 산출물 폴더가 없으므로 `npm run build`, `dist`, `build`를 지정하면 이 프로젝트 구조와 맞지 않습니다. [Netlify 빌드 설정 설명](https://docs.netlify.com/build/configure-builds/overview/)

확인 결과 `netlify.toml`, `_redirects`, `_headers`는 없습니다. 현재 앱은 별도 URL 경로 라우터 없이 쿼리 문자열을 쓰므로 SPA 리다이렉트는 필요하지 않습니다. 이 파일들이 없다는 사실만으로 Header rules 또는 Redirect rules 실패 원인을 확정할 수 없습니다. 필요할 경우의 최소 파일 설정은 **저장소 루트**의 `netlify.toml`에 다음을 두는 것입니다. 현재는 적용하지 않았으며 UI 설정을 먼저 확인해야 합니다.

```toml
[build]
  publish = "knu-campus-navigator"
```

실패 배포 `6ae37ffc7888a5a223820fcb`의 로그와 실제 빌드 설정은 접근할 수 없었습니다. 따라서 약 0초 실패와 Header rules / Pages changed / Redirect rules / Deploy Preview 네 검사 실패는 사용자가 제공한 증상이며, 각각 독립적인 코드 오류라고 판단할 근거는 없습니다. 최근 PR 변경은 core 로직과 테스트·검사 도구 추가이며, Netlify 설정이나 앱 폴더 이동은 없습니다. 로컬 테스트에서는 배포를 중단시킬 구문 오류를 발견하지 못했지만 실제 실패 원인은 로그 없이 확정할 수 없습니다.

Netlify 관리자는 다음을 직접 확인해야 합니다.

1. 해당 배포의 최초 오류와 상태(Pending approval, rejected, build failure 등), 빌드가 시작됐는지, 프로젝트·Deploy Preview별 설정, 빌드 중지/무시 여부.
2. 위 Base/Publish/Build 설정과 실제 배포 커밋. 올바른 Publish 폴더 안에 `index.html`, `src/`, `knu-graph.json`이 있는지.
3. 비공개 저장소라면 작성자의 Git 계정과 Netlify 팀 계정 연결 및 Deploy Request 승인 상태. 승인 대기 가능성은 추정이며 이 배포에서 확인된 사실은 아닙니다. [Netlify Deploy Request 정책](https://docs.netlify.com/deploy/deploy-overview/)
4. Netlify GitHub App에 이 저장소 읽기 권한이 있는지, 저장소 연결이 유효한지. 이번 진단의 GitHub 커넥터 404는 진단 도구의 접근 한계이며 Netlify 권한 실패의 증거가 아닙니다.
5. 공개 저장소의 외부 기여 PR이라면 민감 환경변수 정책의 승인 필요 여부. 비공개 저장소 작성자 정책과 구분합니다. [환경변수 정책](https://docs.netlify.com/build/environment-variables/get-started/)
6. 배포가 성공한 뒤 실제 서비스·Preview 도메인의 네이버 Maps Web 서비스 URL 등록과 지도 표시. 미등록 시 OSM 전환은 런타임 문제로, 빌드 시작 전 실패와 별개입니다.

## 회귀 검사와 남은 수동 확인

앱 폴더에서 PowerShell로 실행합니다. Node 20은 Windows에서 와일드카드를 자동 확장하지 않으므로 파일 목록을 전달합니다.

```powershell
$testFiles = @(Get-ChildItem tests/*.test.js | ForEach-Object FullName)
node --test $testFiles
node tools/knu-route-audit.js --out "$env:TEMP\knu-final-route-audit.json"
```

검사에는 기존 core·데이터·전체 경로·측정 도구·팀 재현 테스트와 앱 핸들러 회귀 테스트가 포함됩니다. 기존 `tests/team-review.test.js` 중 해결한 두 증상은 정상 동작 회귀 테스트로 갱신했으며, 편집기의 별도 알고리즘 차이 재현은 유지했습니다. 편집기는 앱과 가중치·속도·건물 통과 정책이 다르므로 제출 시 앱 길찾기 결과를 기준으로 사용합니다. 편집기나 지도 데이터는 이번 작업에서 변경하지 않았습니다.

전체 경로 도구 결과: 건물 85개, 무방향 쌍 3,570개, 양방향·추천/회피 총 14,280개 경로, 오류 0건. 우회 검토 후보는 추천 43쌍·회피 92쌍이며 데이터 오류 확정값이 아닙니다.

이 환경에서는 로컬 HTTP 요청이 `EACCES`로 차단되었고, 실제 브라우저 제어도 현재 URL을 검증할 수 없어 도구가 중단했습니다. 서버 실행 시도만으로 정상 화면 표시를 확인했다고 판단하지 않았습니다. 앱 핸들러 테스트는 DOM/지도 스텁을 사용하므로 실제 레이아웃·지도 인증은 다음 절차로 확인해야 합니다.

1. 앱 폴더에서 `python -m http.server 8000` 실행 후 `http://localhost:8000` 접속. 개발자 도구 Network에서 HTML·CSS·두 JS·JSON의 200 응답과 Console 오류 없음 확인.
2. 중도→111, 글플→103, 공12→408, 4합→304 및 건물 번호 검색 후 출발·도착 선택. 지도 클릭 선택과 위치 권한 허용/거부 흐름도 확인.
3. 100→213에서 계단 회피 선택 후 교환·재검색. 선택 유지와 경사 설명 확인. 413→414에서 추천/회피 경로 및 도보시간 비교.
4. 프린터 등 편의시설을 검색하고 목록의 분 표시·상세 설명·선택한 실제 경로 시간이 같은지 두 모드에서 확인.
5. 연강 화면에서 10/15/20분 및 직접 입력. 표시된 도보시간+5분은 여유, 도보시간과 같으면 빠듯, 그보다 짧으면 어려움 확인. 직접 입력 빈 값·음수, 같은 건물, 정문 등 번호 없는 장소의 판정 불가 사유 확인. 실제 데이터에는 경로 없음 사례가 없어 해당 예외는 합성 테스트로 검사합니다.
6. 브라우저 기기 모드 360×640, 390×844, 768×1024와 데스크톱에서 검색 목록·쉬는 시간 입력·시트 스크롤·지도·하단 버튼의 잘림과 겹침 확인. 모바일 키보드가 열린 상태와 화면 회전도 확인.

병합 전 최신 main 재조회와 팀원 변경 비교, 기존 미추적 파일의 포함 범위 검토, 테스트 재실행이 필요합니다. 제출 전에는 관리자의 배포 실패 원인 확인, 승인/설정 조치 후 Deploy Preview 네 검사 재확인, 실제 PC·모바일 화면 검증, 실측되지 않은 도보시간의 한계 안내 확인이 남아 있습니다. 이 작업에서는 Commit·Push·Merge·실제 배포를 수행하지 않았습니다.

# 응CK연구소

배포된 웹 서버와 방장 PC의 Windows 업로더를 연결하는 롤 내전 밸런서입니다. 웹 서버에는 롤 클라이언트를 설치할 필요가 없습니다.

## 서버 실행

서버 환경변수에 아래 값을 설정합니다. 실제 비밀값은 파일이나 Git에 넣지 마세요.

```powershell
$env:RIOT_API_KEY="발급받은 Riot API 키"
$env:UPLOADER_TOKEN="길고 추측하기 어려운 업로드 전용 인증키"
$env:PORT="4173"
node server.mjs
```

서버는 기본적으로 `0.0.0.0`에서 요청을 받습니다. 운영 환경에서는 HTTPS 리버스 프록시 뒤에서 실행하세요. 내전 기록은 `data/internal-matches.json`에 누적됩니다. 운영 서버에서는 `DATA_FILE`로 영구 볼륨 경로를 지정할 수 있습니다.

## 경기 데이터베이스

운영 환경은 Neon 등 PostgreSQL의 풀링 연결 문자열을 `DATABASE_URL`에 설정할 수 있습니다. 안전한 전환 순서는 다음과 같습니다.

1. `MATCH_STORE_MODE=blob` 상태에서 새 코드를 먼저 배포합니다.
2. `DATABASE_URL`을 설정하고 `npm run db:migrate-matches -- --source=https://lol-ck.vercel.app/api/internal-matches`를 실행합니다.
3. 마이그레이션의 경기 수·타임라인·해시 검증이 통과하면 `MATCH_STORE_MODE=shadow`로 이중 기록을 확인합니다.
4. 마지막으로 `MATCH_STORE_MODE=postgres`로 전환합니다.

`blob`이 기본값이므로 DB가 준비되기 전에는 기존 저장 동작이 유지됩니다. 기존 Blob은 롤백용으로 보존하세요. 공개 경기 목록은 용량을 줄이기 위해 타임라인을 제외하며, 개별 경기 API는 전체 데이터를 반환합니다.

## 방장 PC 업로더

1. `uploader` 폴더 전체를 방장 PC에 전달합니다.
2. `응CK업로더 실행.cmd`를 더블 클릭합니다.
3. 웹 서버 주소와 서버의 `UPLOADER_TOKEN` 값을 입력합니다.
4. 발급받은 Riot API 키를 입력하고 `API 키 서버에 저장`을 누릅니다.
5. 롤 클라이언트를 실행한 상태에서 완료된 게임 ID를 입력하고 전송합니다. 경기 상세와 함께 분 단위 골드·경험치·CS 프레임, 킬·포탑·에픽 몬스터 이벤트가 자동으로 수집됩니다.
6. 웹사이트를 새로고침하면 서버에 저장된 경기가 모든 이용자에게 표시됩니다.

업로더 설정은 해당 PC의 `uploader/config.json`에 저장되므로 이 파일은 외부에 공유하지 마세요. Riot API 키는 HTTPS와 업로드 인증을 통해 서버의 비공개 `data/runtime-config.json`에 저장됩니다. 서버 환경변수 `RIOT_API_KEY`가 설정되어 있으면 환경변수 값이 우선합니다. 업로더는 롤 클라이언트 인증 토큰과 전체 원본 응답을 서버로 전송하지 않고, 허용된 경기 지표와 핵심 타임라인 이벤트만 전송합니다.

## API

- `GET /api/health`: 서버 상태
- `GET /api/internal-matches`: 누적 경기 목록
- `GET /api/internal-match?id=게임ID`: 저장된 경기 한 건
- `POST /api/internal-matches/upload`: 업로더 전용 저장 API (`Authorization: Bearer ...`)
- `POST /api/uploader/riot-key`: 업로더에서 Riot API 키 설정

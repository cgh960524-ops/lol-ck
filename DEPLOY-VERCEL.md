# 응CK연구소 Vercel 재배포

이 배포본은 플레이어, 연결 계정, 시리즈/POG, 내전 경기 데이터를 브라우저가 아닌 Vercel Blob에 누적 저장합니다.

1. Vercel 프로젝트에서 Storage → Blob 저장소를 연결합니다.
2. 환경 변수 `BLOB_READ_WRITE_TOKEN`이 생성되었는지 확인합니다.
3. 기존과 같은 `UPLOADER_TOKEN`과 `RIOT_API_KEY`를 설정합니다.
4. 시리즈 자동 총평을 사용하려면 서버 환경 변수 `OPENAI_API_KEY`를 추가합니다. 모델을 바꾸려면 `OPENAI_MODEL`을 설정하며, 기본값은 `gpt-5.6-luna`입니다. API 키는 브라우저 코드나 업로더 설정에 넣지 않습니다. 자동 생성은 기본 하루 8회로 제한되며 필요하면 `SERIES_COMMENTARY_DAILY_LIMIT`(1~30)으로 조정합니다.
5. 이 ZIP의 루트 전체를 배포합니다. Framework Preset은 `Other`, Build Command는 비워 둡니다.
6. 배포 후 `/api/health`의 `openAIConfigured`가 `true`인지 확인하고, `/api/app-state`와 `/api/internal-matches`에서 기존 데이터가 유지됐는지 확인합니다.

Discord 시리즈 관리 로그인을 켜려면 Discord Developer Portal의 기존 응CK 애플리케이션 OAuth2 Redirect URI에 `https://lol-ck.vercel.app/api/auth/discord/callback`을 등록합니다. Vercel 서버 환경 변수에는 `DISCORD_OAUTH_CLIENT_ID`(또는 기존 `DISCORD_APPLICATION_ID`), `DISCORD_OAUTH_CLIENT_SECRET`, 32자 이상의 무작위 `DISCORD_SESSION_SECRET`, `DISCORD_OAUTH_REDIRECT_URI`, `PUBLIC_APP_URL`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`를 설정합니다. OAuth 권한은 `identify`만 사용합니다. 시리즈 편집·삭제·변경 로그는 로그인한 계정이 응CK Discord 서버 구성원인지 Bot API로 매 요청 확인하며, 서버 조회 기능은 누구나 이용할 수 있습니다. 구성원이 아니거나 Discord 확인이 실패하면 관리는 차단됩니다. 구성원의 변경은 서버의 `seriesAuditLog`에 저장됩니다. 인증 환경 변수가 없으면 기존 조회·경기 업로드 기능은 유지되고 관리 기능만 비활성화됩니다.

첫 배포 시 ZIP에 포함된 `data/app-state.json`과 `data/internal-matches.json`을 초기값으로 읽습니다. 이후 웹에서 수정한 값은 Blob에 저장되어 재배포해도 유지됩니다.

주의: Blob 저장소를 연결하지 않으면 Vercel의 임시 파일 시스템만 사용하게 되어 장기 보존이 보장되지 않습니다.

# 응CK연구소 Vercel 재배포

이 배포본은 플레이어, 연결 계정, 시리즈/POG, 내전 경기 데이터를 브라우저가 아닌 Vercel Blob에 누적 저장합니다.

1. Vercel 프로젝트에서 Storage → Blob 저장소를 연결합니다.
2. 환경 변수 `BLOB_READ_WRITE_TOKEN`이 생성되었는지 확인합니다.
3. 기존과 같은 `UPLOADER_TOKEN`과 `RIOT_API_KEY`를 설정합니다.
4. 시리즈 자동 총평을 사용하려면 서버 환경 변수 `OPENAI_API_KEY`를 추가합니다. 모델을 바꾸려면 `OPENAI_MODEL`을 설정하며, 기본값은 `gpt-5.6-luna`입니다. API 키는 브라우저 코드나 업로더 설정에 넣지 않습니다. 자동 생성은 기본 하루 8회로 제한되며 필요하면 `SERIES_COMMENTARY_DAILY_LIMIT`(1~30)으로 조정합니다.
5. 이 ZIP의 루트 전체를 배포합니다. Framework Preset은 `Other`, Build Command는 비워 둡니다.
6. 배포 후 `/api/health`의 `openAIConfigured`가 `true`인지 확인하고, `/api/app-state`와 `/api/internal-matches`에서 기존 데이터가 유지됐는지 확인합니다.

첫 배포 시 ZIP에 포함된 `data/app-state.json`과 `data/internal-matches.json`을 초기값으로 읽습니다. 이후 웹에서 수정한 값은 Blob에 저장되어 재배포해도 유지됩니다.

주의: Blob 저장소를 연결하지 않으면 Vercel의 임시 파일 시스템만 사용하게 되어 장기 보존이 보장되지 않습니다.

# KNUE Policy Parser - Cloudflare Workers

KNUE 규정 페이지에서 정책 문서 링크를 수집하여 Cloudflare R2에 저장하는 Worker 애플리케이션입니다.

## 기능

- 매주 일요일 오전 11시(Asia/Seoul)에 자동 실행 (UTC 2AM)
- KNUE 규정 페이지에서 모든 정책 문서 링크 수집
- 각 문서의 미리보기/다운로드 URL 추출
- 문서 제목 정보 포함
- Cloudflare R2에 JSON 형식으로 저장 (`policy/{page_key}/{yyyy}_{mm}_{dd}_links.json`)
- 중복 저장 방지 (동일 날짜 재실행 시 스킵)

## 수집 데이터

### 링크 구조

각 정책 문서에 대해 다음 정보를 수집합니다:

```json
{
  "fileNo": "868",
  "previewUrl": "https://www.knue.ac.kr/www/previewMenuCntFile.do?key=392&fileNo=868",
  "downloadUrl": "https://www.knue.ac.kr/downloadContentsFile.do?key=392&fileNo=868",
  "title": "한국교원대학교 설치령"
}
```

### 저장 형식

R2에 저장되는 JSON 파일 구조:

```json
{
  "timestamp": "2025-10-19T02:00:00.000Z",
  "pageKey": "392",
  "count": 96,
  "links": [
    {
      "fileNo": "868",
      "previewUrl": "...",
      "downloadUrl": "...",
      "title": "한국교원대학교 설치령"
    }
  ]
}
```

## 아키텍처

```
Policy Page (https://www.knue.ac.kr/www/contents.do?key=392)
    ↓
  Fetcher → HTML Parser → Link Extractor → Title Enricher → R2
                                                              ↓
                              policy/392/{yyyy}_{mm}_{dd}_links.json
```

## 프로젝트 구조

```
src/
├── index.ts              # Worker 엔트리 포인트 (scheduled handler)
├── page/
│   ├── fetcher.ts        # 정책 페이지 HTML 가져오기
│   └── parser.ts         # 링크 추출 및 제목 enrichment
├── storage/
│   └── r2-writer.ts      # R2 쓰기 작업
└── utils/
    └── datetime.ts       # 날짜/시간 유틸리티

test/                     # 유닛 및 통합 테스트
fixtures/                 # 테스트 픽스처
```

## 설정

### 사전 요구사항

- Node.js >= 18.x
- Cloudflare 계정
- Wrangler CLI

### 설치

```bash
npm install
```

### R2 버킷

기존 `knue-vectorstore` 버킷을 사용합니다. 버킷이 없다면:

```bash
npx wrangler r2 bucket create knue-vectorstore
```

### 환경 변수

**프로덕션 설정** (`wrangler.jsonc`에서 설정):
- `POLICY_PAGE_URL`: KNUE 규정 페이지 URL (`https://www.knue.ac.kr/www/contents.do?key=392`)
- `POLICY_PAGE_KEY`: 페이지 키 (`392`)
- `POLICY_STORAGE`: R2 버킷 바인딩 (`knue-vectorstore`)

**로컬 개발 환경**:
1. `.env.example`를 `.env.local`로 복사:
   ```bash
   cp .env.example .env.local
   ```
2. 필요시 값 수정
3. 로컬 테스트 시 자동으로 로드됨

## 개발

### 로컬 테스트

```bash
# 유닛 테스트 실행
npm test

# 테스트 커버리지 확인
npm run test:coverage

# Cron 트리거 시뮬레이션
npm run dev
curl "http://localhost:8787/__scheduled?cron=0+2+*+*+0"
```

### 배포

```bash
npm run deploy
```

### 신뢰성 & Observability

**Retry Logic**
- 페이지 fetch 시 transient 오류에 대한 자동 재시도
- Exponential backoff: 1s → 2s → 4s (최대 10s)
- 최대 3회 재시도 (기본값)
- 처리 상황: HTTP 429, 503, timeout, network errors

**Structured Logging**
- 각 단계별 진행 상황 로그 (fetch, parse, enrich, save)
- 성공/실패 통계 및 요약
- 에러 발생 시 상세 정보 (error message, stack trace)
- 재시도 시도 여부 및 결과 기록

**로그 예시:**
```
[2025-10-19T02:00:00.000Z] Starting policy link collection job...
🔄 Fetching policy page: https://www.knue.ac.kr/www/contents.do?key=392
✓ Policy page fetched (239939 bytes)
✓ Parsed 96 policy links
✓ Enriched links with titles
✓ [R2] Saved 96 links to policy/392/2025_10_19_links.json

✅ Policy link collection completed in 450ms
📊 Saved 96 links to policy/392/2025_10_19_links.json
```

## 테스트 커버리지

- Page Parser: 9 tests
- R2 Writer: 6 tests
- Integration: 5 tests

**Total: 20 tests passing**

### Integration Tests
- ✅ HTTP 요청 거부 (cron만 허용)
- ✅ 정책 링크 수집 및 저장
- ✅ 동일 날짜 중복 실행 스킵
- ✅ Fetch 오류 처리
- ✅ 제목 enrichment

## 저장 경로 구조

- 2025-10-19 수집: `policy/392/2025_10_19_links.json`
- 2025-10-26 수집: `policy/392/2025_10_26_links.json`

## Cron 스케줄

- `0 2 * * 0` - 매주 일요일 11:00 AM Asia/Seoul (UTC 2AM)
- 약 96개의 정책 문서 링크 수집
- 주 1회 실행 (규정은 자주 변경되지 않음)

## 다른 프로젝트와의 연계

이 프로젝트는 다음 프로젝트들과 함께 사용될 수 있습니다:

- **knue-www-rss-parser-cf**: RSS 피드 파싱 (게시판 콘텐츠)
- **knue-www-preview-parser-cf**: 첨부파일 미리보기 파싱
- **knue-policy-vectorizer**: 정책 문서 벡터화 (R2에서 링크 읽어서 벡터DB 저장)

## 라이선스

ISC

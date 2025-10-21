# KNUE Policy Parser - Cloudflare Workers

GitHub 저장소(`kadragon/knue-policy-hub`)에 있는 정책 마크다운을 기반으로 매일 동기화하고, Cloudflare KV/R2에 최신 정책을 반영하는 스케줄드 워커입니다. HTML 크롤링과 Preview API 호출을 제거해 동기화 속도를 높이고 변경 이력을 Git 커밋으로 추적합니다.

## 핵심 기능
- `0 16 * * *`(UTC) 크론 스케줄에서 자동 실행되어 매일 새 커밋을 확인합니다.
- GitHub 커밋 SHA를 비교해 추가/수정/삭제된 정책 마크다운만 처리합니다.
- `policyName`(파일명) 기반으로 KV를 동기화하고 Git `sha`를 버전 관리에 사용합니다.
- 각 정책을 `policies/{policyName}/policy.md`로 R2에 저장하며 YAML front matter에 메타데이터를 포함합니다.
- 구조화된 로그로 GitHub 호출, 변경된 정책 수, KV/R2 결과를 추적합니다.

## 동작 흐름
1. 스케줄러가 최신 커밋 SHA를 조회하고, KV에 저장된 직전 SHA와 비교합니다.
2. 커밋이 변경되면 GitHub Compare API로 변경된 `.md` 파일 목록을 가져옵니다.
3. 변경된 파일은 blob API로 콘텐츠를 읽고, 파서가 `policyName`/`title`/`content`를 추출합니다.
4. KV 동기화기가 `policyName` 단위로 추가/수정/삭제 집합을 계산해 `policy-registry`에 반영합니다.
5. R2 라이터가 정책별 markdown을 최신 콘텐츠로 갱신하고, 실행 메타데이터를 로그 및 KV에 기록합니다.

```
GitHub Repo (kadragon/knue-policy-hub)
        ↓ commits / blobs
Change Tracker ──→ Markdown Parser ──→ KV Synchronizer ──→ R2 Writer
        ↑                    │                    │             ↓
  Last Commit (KV) ──────────┘        Stats & Metadata ──> Cloudflare R2
```

## 프로젝트 구조
```
src/
├── index.ts              # 스케줄드 핸들러: GitHub 동기화 전체 오케스트레이션
├── github/               # GitHub REST API 클라이언트, diff/트리/마크다운 파서
├── kv/                   # policyName 기반 KV 타입, 매니저, 동기화 로직
├── storage/r2-writer.ts  # 정책 Markdown v2.0.0 작성 및 저장
└── utils/                # 날짜/로그 헬퍼 등 공용 유틸리티

test/
├── github.*.test.ts      # GitHub 모듈 단위 테스트
├── kv-*.test.ts          # KV 매니저/동기화 테스트
├── storage/*.test.ts     # R2 writer 테스트
└── integration/          # 크론 워크플로우 및 엔드 투 엔드 시나리오

fixtures/                 # GitHub 응답 / 정책 마크다운 테스트 픽스처
```

## 요구 사항
- Node.js 18 이상 (Cloudflare Workers 런타임과 동일)
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare 계정: KV(`policy-registry`), R2(`knue-vectorstore`) 바인딩 필요

## 설치 및 환경 구성
```bash
npm install
```

### 환경 변수
| 이름 | 설명 | 예시 | 비고 |
|------|------|------|------|
| `GITHUB_REPO` | GitHub 저장소 (`owner/repo`) | `kadragon/knue-policy-hub` | 필수 |
| `GITHUB_BRANCH` | 추적할 브랜치 | `main` | 필수 |
| `GITHUB_TOKEN` | (선택) 인증 토큰 | `ghp_***` | 레이트 리밋 확장 |
| `POLICY_STORAGE` | Cloudflare R2 버킷 바인딩 | `policy-storage` | wrangler.jsonc에 설정 |
| `POLICY_REGISTRY` | Cloudflare KV 바인딩 | `policy-registry` | wrangler.jsonc에 설정 |

1. `.env.example`를 `.env.local`로 복사 후 값 확인/수정합니다.
2. `wrangler.jsonc`의 `vars` 및 `kv_namespaces`/`r2_buckets` 섹션이 프로덕션 바인딩과 일치하는지 확인합니다.
3. GitHub 토큰을 사용할 경우 Workers Secrets(`wrangler secret put GITHUB_TOKEN`)로 설정합니다.

## 로컬 개발 플로우
```bash
# 타입 검사
npm run typecheck

# 린트
npm run lint

# 전체 테스트
npm test

# 커버리지 보고서
npm run test:coverage

# 스케줄러 시뮬레이션 (GitHub 호출은 테스트 더블 사용)
wrangler dev --test-scheduled
```
## 배포
```bash
npm run deploy
```

배포 전 체크리스트:
- `npm run lint`, `npm run typecheck`, `npm test` 모두 성공
- `wrangler login`으로 계정 인증
- 프로덕션 환경에 `GITHUB_REPO`/`GITHUB_BRANCH` 변수가 설정되어 있는지 확인
- 필요 시 `GITHUB_TOKEN`을 시크릿으로 주입

## 관측 및 장애 대응
- 로그 항목: 시작/종료 타임스탬프, GitHub SHA(이전/현재), 변경 파일 수(added/modified/deleted), KV/R2 처리 결과, 총 소요 시간
- 실패 시 스택 트레이스를 포함해 에러를 다시 던져 Cloudflare 작업 대시보드에서 확인 가능
- GitHub 레이트 리밋(403, `X-RateLimit-Remaining: 0`) 발생 시 워커가 경고를 남기고 종료하며, 다음 크론 실행에서 자동 재시도합니다.
- 1MB 이상 블롭은 건너뛰고 경고 로그만 남겨 전체 동기화를 유지합니다.

## 마이그레이션 메모
- KV 키: `policy:{policyName}` (OLD: `policy:{title}`)
- R2 경로: `policies/{policyName}/policy.md` (OLD: `policies/{fileNo}/policy.md`)
- Sync 메타데이터: `metadata:sync:lastCommit`에 최신 커밋 SHA 저장
- Preview API 기반 파서 및 프리뷰 모듈은 2025-10-20에 완전히 제거되었습니다.

## 참고 문서
- `.spec/github-integration.spec.md` — GitHub API 계약
- `.spec/kv-sync-algorithm.spec.md` — policyName 기반 KV 동기화 알고리즘
- `.tasks/PLAN.md` — RSP-I 단계별 계획
- `.tasks/PROGRESS.md` — 구현 진행 로그 및 테스트 상태

## 라이선스
ISC

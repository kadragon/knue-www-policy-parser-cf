# Task Index — knue-www-policy-parser-cf

**Project**: `knue-www-policy-parser-cf`  
**Maintainer**: kadragon  
**Last Updated**: 2025-10-19

## Active Task Ledger

| Task ID | Title | Status | Last Update |
|---------|-------|--------|-------------|
| `init-policy-parser` | Daily policy sync worker | ✅ Completed | 2025-10-19 |

## Task Document Map

- **RESEARCH.md** — Source analysis, preview API contract, downstream requirements.  
- **SPEC-DELTA.md** — Acceptance criteria (cron, fetch, KV sync, Markdown export, preview integration).  
- **PLAN.md** — Phase breakdown aligned with RSP-I workflow.  
- **PROGRESS.md** — Timestamped implementation log with metrics.  
- **TASK_SUMMARY.md** — High-level deliverables, validation, next actions.

## Execution Snapshot

- Cron schedule: `0 16 * * *` (daily 01:00 KST).  
- Outputs: per-policy Markdown (`policies/{fileNo}/policy.md`) + legacy JSON snapshot (`policy/{pageKey}/{yyyy}_{mm}_{dd}_links.json`).  
- Registry: Cloudflare KV `policy-registry` retains canonical policy records + queue entries.  
- Preview integration: Bearer-authenticated API enriches Markdown with summaries/content.  
- Quality gates: ESLint, TypeScript `--noEmit`, Vitest unit + integration suites (all passing locally).

## Next Steps
1. Deploy worker via `npm run deploy` after confirming production secrets.  
2. Observe first cron run on 2025-10-20T01:00:00+09:00 via Cloudflare logs.  
3. Coordinate with downstream vectorizer on Markdown ingestion cadence.

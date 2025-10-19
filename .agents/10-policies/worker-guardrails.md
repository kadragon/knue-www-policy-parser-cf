---
id: AG-POLICY-WORKER-OPS-001
version: 1.0.0
scope: global
status: active
supersedes: []
depends: [AG-FOUND-TERMS-001]
last-updated: 2025-10-19
owner: project-admin
---
# Worker Operations Guardrails

- **Spec Authority**: `.spec/` documents define functional/technical truth; keep implementation, tests, and docs aligned.
- **TDD Expectation**: When modifying runtime behavior, introduce or update tests before production code. Maintain Vitest coverage for parser, KV sync, preview export, and R2 writers.
- **Observability**: Preserve structured logging (cron start/end, KV stats, R2 summary). Do not suppress error logs; redact secrets only.
- **Secrets Handling**: `BEARER_TOKEN` must only be read via Workers secrets. Never log or persist the token.
- **Schedules**: Cron updates require concurrent changes to `wrangler.jsonc`, `.spec/cron-timing.spec.md`, and `.tasks/SPEC-DELTA.md`.

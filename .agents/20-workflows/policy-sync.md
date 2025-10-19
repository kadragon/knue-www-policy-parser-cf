---
id: AG-WORKFLOW-POLICY-SYNC-001
version: 1.0.0
scope: global
status: active
supersedes: []
depends: [AG-FOUND-TERMS-001, AG-POLICY-WORKER-OPS-001]
last-updated: 2025-10-19
owner: project-admin
---
# Policy Sync Workflow (RSP-I Alignment)

1. **Research**  
   - Capture upstream schema or HTML changes in `.tasks/RESEARCH.md`.  
   - Record evidence (fixture hashes, diff summaries) before altering code.

2. **Spec**  
   - Update `.spec/` and `.tasks/SPEC-DELTA.md` with new acceptance criteria when behavior changes (e.g., KV schema, Markdown export fields).

3. **Plan**  
   - Document migration/rollback notes in `.tasks/PLAN.md`, including KV key impacts and R2 retention expectations.

4. **Implement (TDD)**  
   - Add failing tests across parser, KV synchronizer, preview fetcher, and R2 writers.  
   - Iterate until Vitest suite passes (`npm test`).  
   - Run lint/typecheck before merging.

5. **Inspect**  
   - Update `.tasks/PROGRESS.md` with timestamped notes.  
   - Summarize outcomes in `.tasks/TASK_SUMMARY.md` and archive evidence.

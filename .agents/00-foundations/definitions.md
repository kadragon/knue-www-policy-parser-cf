---
id: AG-FOUND-TERMS-001
version: 1.0.0
scope: global
status: active
supersedes: []
depends: []
last-updated: 2025-10-19
owner: project-admin
---
# Core Definitions

- **Policy Link**: Pair of preview/download URLs from the KNUE policy page identified by `fileNo`.
- **Policy Record**: Policy link enriched with title and metadata, persisted to KV and R2.
- **Snapshot File**: JSON document stored at `policy/{pageKey}/{yyyy}_{mm}_{dd}_links.json`.
- **Markdown Export**: Per-policy Markdown stored at `policies/{fileNo}/policy.md`, including optional preview content.
- **Registry**: Cloudflare KV namespace bound as `POLICY_REGISTRY`, treated as the system of record for deduplicated policies.

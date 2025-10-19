---
id: AG-LOADER-GLOBAL-001
version: 1.0.0
scope: global
status: active
supersedes: []
depends: []
last-updated: 2025-10-19
owner: project-admin
---
# Global AGENTS Loader — knue-www-policy-parser-cf

> Load order declaration for project-wide operating policies.

## Load Order

1. .agents/00-foundations/**
2. .agents/10-policies/**
3. .agents/20-workflows/**
4. .agents/30-roles/**
5. .agents/40-templates/**
6. .agents/90-overrides/**

## Notes

- Folders not present at runtime are skipped automatically.
- Local folder-level loaders (e.g., `<module>/.agents/AGENTS.md`) override these rules within their scope.

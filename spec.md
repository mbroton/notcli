# notion-lite v1 Specification (Revised)

## Summary

`notion-lite` is a workspace-agnostic Notion CLI that exposes compact, deterministic JSON for terminal and AI-agent workflows.

## Goals

- Work across arbitrary Notion workspaces without fixed schema assumptions.
- Keep outputs token-lean and machine-parseable.
- Provide generic primitives for search, data source operations, page CRUD, and block operations.
- Keep safety mechanisms internal (idempotency and conflict handling) without surfacing low-level knobs to users.

## Non-Goals

- Multi-tenant auth or OAuth flows.
- Manual schema cache lifecycle commands.
- User-managed idempotency or version tokens.

## Users

- Terminal user.
- AI agent invoking CLI commands.

## Functional Requirements

- Setup:
  - `auth` command for interactive/non-interactive auth configuration.
- Discovery:
  - `search` for workspace-wide title-oriented search.
  - `data-sources list|get|query`.
- Pages:
  - `pages get|create|update|archive|relate|unrelate`.
- Blocks:
  - `blocks get|append`.
- Health:
  - `doctor`.

## Contract

- Success envelope: `{ok:true,data,meta:{request_id,pagination?}}`
- Error envelope: `{ok:false,error:{code,message,retryable,details?},meta:{request_id}}`
- No schema/timing/token diagnostics in default success metadata.

## Internal Behavior

- Schema cache is internal and auto-refreshed on miss/staleness/inference failure.
- Idempotency keys are generated internally for mutating commands.
- Page mutations use best-effort internal optimistic-concurrency handling.

## Integrations

- Notion API version: `2025-09-03`.
- Notion SDK: `@notionhq/client`.
- Local persistence:
  - config JSON,
  - idempotency sqlite DB,
  - audit JSONL log.

## Edge Cases

- Missing config or token env -> fail-fast `auth_or_config` with setup guidance.
- Unknown data source property in mutation payload -> `invalid_input` with property hint.
- Concurrent updates can still conflict; CLI retries best-effort and surfaces structured conflict when unresolved.

## Acceptance Criteria

- CLI works in any workspace after `auth` setup only.
- No manual schema refresh command exists.
- No user-facing `--if-match` or `--idempotency-key` options.
- Search and generic data-source/page/block commands work with compact JSON envelopes.

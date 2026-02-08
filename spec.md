# notion-lite v1.1 Specification

## Summary

`notion-lite` is a workspace-agnostic Notion CLI that exposes compact, deterministic JSON for terminal and AI-agent workflows, with richer read/write ergonomics.

## Goals

- Work across arbitrary Notion workspaces without fixed schema assumptions.
- Keep outputs machine-parseable and relatively token-lean.
- Provide strong primitives for search, schema introspection, page CRUD, relation edits, and block content.
- Keep safety mechanisms internal (idempotency + best-effort conflict handling).

## Non-Goals

- Multi-tenant auth or OAuth flows.
- Manual schema cache lifecycle commands.
- User-managed idempotency keys or optimistic-concurrency tokens.

## Users

- Terminal user.
- AI agent invoking CLI commands.

## Functional Requirements

- Setup:
  - `auth` command for interactive/non-interactive auth configuration.
- Discovery:
  - `search` with optional scope/date/creator/object filters.
  - `data-sources list|get|schema|query`.
- Pages:
  - `pages get|create|create-bulk|update|archive|unarchive|relate|unrelate`.
  - `pages get --include-content` to fetch properties + block content in one call.
- Blocks:
  - `blocks get|append`.
  - `blocks append` supports `--blocks-json`, `--markdown`, or `--markdown-file`.
- Health:
  - `doctor`.

## Contract

- Success envelope: `{ok:true,data,meta:{request_id,pagination?}}`
- Error envelope: `{ok:false,error:{code,message,retryable,details?},meta:{request_id}}`
- No schema/timing/token diagnostics in default success metadata.

## Internal Behavior

- Schema cache is internal and auto-refreshed on miss/staleness/validation failures.
- Mutating commands use internal idempotency keys (SQLite-backed replay).
- Page mutations use best-effort internal optimistic-concurrency retries.
- Bulk create supports up to 100 pages per command.

## Integrations

- Notion API version: `2025-09-03`.
- Notion SDK: `@notionhq/client`.
- Local persistence:
  - config JSON,
  - idempotency sqlite DB,
  - audit JSONL log.

## Edge Cases

- Missing config/token env -> fail-fast `auth_or_config` with setup guidance.
- Unknown data source property in mutation payload -> `invalid_input` with property hint.
- Concurrent updates can still conflict after retries.
- Markdown input supports a constrained block subset; unsupported syntax degrades to paragraphs.

## Acceptance Criteria

- CLI works in any workspace after `auth` setup.
- `pages get` can return full page + content in a single response.
- Data-source schema output is rich enough to build valid `properties-json` payloads.
- Mutations can return full updated page state via `--return-view full`.
- `pages unarchive` and `pages create-bulk` are available.
- `search` supports scope/date/creator/object filtering.

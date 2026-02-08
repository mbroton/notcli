# notion-lite

Token-efficient, workspace-agnostic CLI for Notion, optimized for terminal and AI-agent use.

## Design

- Generic commands for any workspace (no fixed personal schema assumptions).
- Compact deterministic JSON envelopes.
- Automatic internal schema caching (no manual refresh command).
- Automatic internal idempotency for mutating commands.
- Best-effort internal conflict handling for page mutations.

## Install

```bash
npm install
npm run build
```

## Configure auth

Set your Notion integration token:

```bash
export NOTION_API_KEY="secret_xxx"
```

Then configure the CLI:

```bash
notion-lite auth
```

Non-interactive auth setup:

```bash
notion-lite auth --token-env NOTION_API_KEY
```

## Output contract

Success envelope:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "request_id": "..."
  }
}
```

Error envelope:

```json
{
  "ok": false,
  "error": {
    "code": "invalid_input",
    "message": "...",
    "retryable": false
  },
  "meta": {
    "request_id": "..."
  }
}
```

Pagination is returned in `meta.pagination` when relevant.

## Commands

### Discoverability

Start with:

```bash
notion-lite --help
```

Root help now highlights advanced features directly:

- `pages create-bulk` and `pages unarchive`
- `pages get --include-content --content-format markdown`
- `blocks append --markdown|--markdown-file`
- advanced search filters (`--scope`, created/edited ranges, `--created-by`, `--object`, `--scan-limit`)

Use targeted help when needed:

```bash
notion-lite pages --help
notion-lite search --help
notion-lite blocks append --help
```

### Search

```bash
notion-lite search --query "release notes" --limit 25
notion-lite search --query "infra" --object page --created-after 2026-01-01T00:00:00Z
notion-lite search --query "oncall" --scope <page_or_data_source_id> --created-by <user_id>
```

### Data sources

```bash
notion-lite data-sources list --query "tasks"
notion-lite data-sources get --id <data_source_id> --view full
notion-lite data-sources schema --id <data_source_id>
notion-lite data-sources query --id <data_source_id> --filter-json '{"property":"Status","status":{"equals":"In Progress"}}'
```

### Pages

```bash
notion-lite pages get --id <page_id>
notion-lite pages get --id <page_id> --view full --include-content --content-format markdown --content-max-blocks 200 --content-depth 1

notion-lite pages create \
  --parent-data-source-id <data_source_id> \
  --properties-json '{"Name":"Ship CLI","Status":"In Progress"}' \
  --return-view full

notion-lite pages create-bulk \
  --parent-data-source-id <data_source_id> \
  --items-json '[{"properties":{"Name":"Task A"}},{"properties":{"Name":"Task B"}}]' \
  --concurrency 5

notion-lite pages update \
  --id <page_id> \
  --patch-json '{"Status":"Done"}' \
  --return-view full

notion-lite pages archive --id <page_id>
notion-lite pages unarchive --id <page_id>

notion-lite pages relate \
  --from-id <page_id> \
  --property Project \
  --to-id <page_id> \
  --return-view full

notion-lite pages unrelate \
  --from-id <page_id> \
  --property Project \
  --to-id <page_id> \
  --return-view full
```

### Blocks

```bash
notion-lite blocks get --id <page_or_block_id> --max-blocks 200 --depth 1 --format markdown

notion-lite blocks append \
  --id <page_or_block_id> \
  --blocks-json '[{"object":"block","type":"paragraph","paragraph":{"rich_text":[{"type":"text","text":{"content":"hello"}}]}}]'

notion-lite blocks append --id <page_or_block_id> --markdown "# Title\n\nHello"
notion-lite blocks append --id <page_or_block_id> --markdown-file ./notes.md

notion-lite blocks insert \
  --parent-id <page_or_block_id> \
  --markdown "Inserted at top" \
  --position start

notion-lite blocks insert \
  --parent-id <page_or_block_id> \
  --markdown "Inserted after sibling" \
  --after-id <block_id>

notion-lite blocks select \
  --scope-id <page_or_block_id> \
  --selector-json '{"where":{"type":"paragraph","text_contains":"TODO"},"nth":1,"from":"start"}'

notion-lite blocks replace-range \
  --scope-id <page_or_block_id> \
  --start-selector-json '{"where":{"text_contains":"Start"}}' \
  --end-selector-json '{"where":{"text_contains":"End"}}' \
  --markdown "Replacement content"
```

### Health

```bash
notion-lite doctor
```

## Exit codes

- `0` success
- `2` invalid input
- `3` not found
- `4` conflict
- `5` retryable upstream error
- `6` auth/config error
- `1` generic failure

## Storage paths

- Config: `~/.config/notion-lite/config.json` (or `$XDG_CONFIG_HOME/notion-lite/config.json`)
- Idempotency DB: `~/.config/notion-lite/idempotency.db`
- Audit log: `~/.config/notion-lite/audit.log`

## Notes

- Notion API version is pinned to `2025-09-03`.
- This CLI assumes a single-user, personal automation context.

# notion-lite

Token-efficient, workspace-agnostic CLI for Notion, optimized for terminal + AI-agent use.

## Design

- Generic commands for any workspace (no fixed tasks/projects schema).
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

Set your Notion integration token in an environment variable:

```bash
export NOTION_API_KEY="secret_xxx"
```

Configure the CLI:

```bash
notion-lite auth
```

Non-interactive:

```bash
notion-lite auth --token-env NOTION_API_KEY
```

## Output contract

Success:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "request_id": "..."
  }
}
```

Error:

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

### Search

```bash
notion-lite search --query "release notes" --limit 25
```

### Data sources

```bash
notion-lite data-sources list --query "projects"
notion-lite data-sources get --id <data_source_id>
notion-lite data-sources query --id <data_source_id> --filter-json '{"property":"Status","status":{"equals":"In Progress"}}'
```

### Pages

```bash
notion-lite pages get --id <page_id>

notion-lite pages create \
  --parent-data-source-id <data_source_id> \
  --properties-json '{"Name":"Ship CLI","Status":"In Progress"}'

notion-lite pages update \
  --id <page_id> \
  --patch-json '{"Status":"Done"}'

notion-lite pages archive --id <page_id>

notion-lite pages relate \
  --from-id <page_id> \
  --property Project \
  --to-id <page_id>

notion-lite pages unrelate \
  --from-id <page_id> \
  --property Project \
  --to-id <page_id>
```

### Blocks

```bash
notion-lite blocks get --id <page_or_block_id> --max-blocks 200 --depth 1

notion-lite blocks append \
  --id <page_or_block_id> \
  --blocks-json '[{"object":"block","type":"paragraph","paragraph":{"rich_text":[{"type":"text","text":{"content":"hello"}}]}}]'
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

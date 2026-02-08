#!/usr/bin/env node

import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { executeMutationWithIdempotency } from "./commands/mutation.js";
import { loadRuntime, parseCommaFields, parsePositiveInt } from "./commands/context.js";
import { runAction } from "./commands/output.js";
import { getConfigPath } from "./config/paths.js";
import { buildInitialAuthConfig, loadConfigOrNull, saveConfig } from "./config/store.js";
import { CliError } from "./errors/cli-error.js";
import {
  appendBlocks,
  archivePage,
  createPage,
  getBlocks,
  getDataSource,
  getPage,
  listDataSources,
  queryDataSourcePages,
  searchWorkspace,
  setRelation,
  updatePage,
} from "./notion/repository.js";
import { parseJsonOption } from "./utils/json.js";

interface CommonOptions {
  pretty?: boolean;
  timeoutMs?: string;
  view?: string;
  fields?: string;
  limit?: string;
  cursor?: string;
  filterJson?: string;
  sortJson?: string;
}

function resolveView(input: string | undefined, fallback: "compact" | "full"): "compact" | "full" {
  const value = input ?? fallback;
  if (value === "compact" || value === "full") {
    return value;
  }
  throw new CliError("invalid_input", "--view must be either compact or full.");
}

function requireObjectJson(raw: string, label: string): Record<string, unknown> {
  const parsed = parseJsonOption<unknown>(label, raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError("invalid_input", `${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function requireArrayJson(raw: string, label: string): Array<Record<string, unknown>> {
  const parsed = parseJsonOption<unknown>(label, raw);
  if (!Array.isArray(parsed)) {
    throw new CliError("invalid_input", `${label} must be a JSON array.`);
  }
  return parsed as Array<Record<string, unknown>>;
}

function parseSortJson(raw: string | undefined): Array<Record<string, unknown>> | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = parseJsonOption<unknown>("sort-json", raw);
  if (Array.isArray(parsed)) {
    return parsed as Array<Record<string, unknown>>;
  }

  if (parsed && typeof parsed === "object") {
    return [parsed as Record<string, unknown>];
  }

  throw new CliError("invalid_input", "sort-json must be a JSON object or array of objects.");
}

function addCommonReadOptions(command: Command): Command {
  return command
    .option("--view <compact|full>", "response view mode")
    .option("--fields <csv>", "comma-separated fields to include in compact view")
    .option("--limit <n>", "max records to return")
    .option("--cursor <cursor>", "pagination cursor")
    .option("--pretty", "pretty-print JSON output")
    .option("--timeout-ms <n>", "request timeout in milliseconds");
}

async function runInteractiveAuthSetup(currentTokenEnv: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError(
      "invalid_input",
      "Interactive auth requires a TTY. Use `notion-lite auth --token-env <ENV_NAME>` in non-interactive environments.",
    );
  }

  const rl = createInterface({ input, output });
  try {
    const response = await rl.question(`Token environment variable name [${currentTokenEnv}]: `);
    const trimmed = response.trim();
    return trimmed.length > 0 ? trimmed : currentTokenEnv;
  } finally {
    rl.close();
  }
}

async function saveAuthConfig(tokenEnv: string): Promise<{ token_env: string; config_path: string }> {
  const existing = await loadConfigOrNull();
  const nextConfig =
    existing ??
    buildInitialAuthConfig({
      notionApiKeyEnv: tokenEnv,
    });

  nextConfig.notion_api_key_env = tokenEnv;
  await saveConfig(nextConfig);

  return {
    token_env: tokenEnv,
    config_path: getConfigPath(),
  };
}

const program = new Command();
program
  .name("notion-lite")
  .description("Token-efficient, workspace-agnostic Notion CLI")
  .showHelpAfterError();

program
  .command("auth")
  .description("Configure authentication")
  .option("--token-env <name>", "API key environment variable name")
  .option("--pretty", "pretty-print JSON output")
  .option("--timeout-ms <n>", "request timeout in milliseconds")
  .action(async (options: { tokenEnv?: string; pretty?: boolean; timeoutMs?: string }) => {
    await runAction(Boolean(options.pretty), async () => {
      const existing = await loadConfigOrNull();
      const defaultTokenEnv = existing?.notion_api_key_env ?? "NOTION_API_KEY";
      const tokenEnv = options.tokenEnv ?? (await runInteractiveAuthSetup(defaultTokenEnv));

      const saved = await saveAuthConfig(tokenEnv);
      const tokenPresent = Boolean(process.env[tokenEnv]);

      if (!tokenPresent) {
        return {
          data: {
            ...saved,
            token_present: false,
            verified: false,
            message: `Set ${tokenEnv} in your environment to enable API calls.`,
          },
        };
      }

      const { notion } = await loadRuntime({ timeoutMs: options.timeoutMs });
      await notion.search({ page_size: 1 });

      return {
        data: {
          ...saved,
          token_present: true,
          verified: true,
          message: "Authentication verified.",
        },
      };
    });
  });

addCommonReadOptions(program.command("search").description("Workspace-wide search"))
  .requiredOption("--query <text>", "search query text")
  .action(async (options: CommonOptions & { query: string }) => {
    await runAction(Boolean(options.pretty), async () => {
      const { config, notion } = await loadRuntime({ timeoutMs: options.timeoutMs });
      const { results, pagination } = await searchWorkspace(notion, {
        query: options.query,
        limit: parsePositiveInt(options.limit, "limit", config.defaults.limit),
        cursor: options.cursor,
      });

      return {
        data: {
          results,
        },
        pagination,
      };
    });
  });

const dataSourcesCommand = program.command("data-sources").description("Data source operations");

addCommonReadOptions(dataSourcesCommand.command("list").description("List accessible data sources"))
  .option("--query <text>", "search text for filtering data sources")
  .action(async (options: CommonOptions & { query?: string }) => {
    await runAction(Boolean(options.pretty), async () => {
      const { config, notion } = await loadRuntime({ timeoutMs: options.timeoutMs });
      const { data_sources, pagination } = await listDataSources(notion, {
        query: options.query,
        limit: parsePositiveInt(options.limit, "limit", config.defaults.limit),
        cursor: options.cursor,
      });

      return {
        data: {
          data_sources,
        },
        pagination,
      };
    });
  });

addCommonReadOptions(dataSourcesCommand.command("get").description("Get a data source by ID"))
  .requiredOption("--id <data_source_id>", "Notion data source ID")
  .action(async (options: CommonOptions & { id: string }) => {
    await runAction(Boolean(options.pretty), async () => {
      const { config, notion } = await loadRuntime({ timeoutMs: options.timeoutMs });
      const dataSource = await getDataSource(
        notion,
        options.id,
        resolveView(options.view, config.defaults.view),
      );

      return {
        data: {
          data_source: dataSource,
        },
      };
    });
  });

addCommonReadOptions(dataSourcesCommand.command("query").description("Query pages in a data source"))
  .requiredOption("--id <data_source_id>", "Notion data source ID")
  .option("--filter-json <json>", "Notion filter payload")
  .option("--sort-json <json>", "Notion sort payload")
  .action(
    async (
      options: CommonOptions & {
        id: string;
      },
    ) => {
      await runAction(Boolean(options.pretty), async () => {
        const { config, notion } = await loadRuntime({ timeoutMs: options.timeoutMs });

        const filter = options.filterJson
          ? requireObjectJson(options.filterJson, "filter-json")
          : undefined;

        const { records, pagination } = await queryDataSourcePages(
          {
            notion,
            config,
            saveConfig,
          },
          {
            dataSourceId: options.id,
            limit: parsePositiveInt(options.limit, "limit", config.defaults.limit),
            cursor: options.cursor,
            filter,
            sorts: parseSortJson(options.sortJson),
            view: resolveView(options.view, config.defaults.view),
            fields: parseCommaFields(options.fields),
          },
        );

        return {
          data: {
            records,
          },
          pagination,
        };
      });
    },
  );

const pagesCommand = program.command("pages").description("Page operations");

addCommonReadOptions(pagesCommand.command("get").description("Get a page by ID"))
  .requiredOption("--id <page_id>", "Notion page ID")
  .action(async (options: CommonOptions & { id: string }) => {
    await runAction(Boolean(options.pretty), async () => {
      const { config, notion } = await loadRuntime({ timeoutMs: options.timeoutMs });
      const page = await getPage(
        notion,
        options.id,
        resolveView(options.view, config.defaults.view),
        parseCommaFields(options.fields),
      );

      return {
        data: {
          page,
        },
      };
    });
  });

addCommonReadOptions(pagesCommand.command("create").description("Create a page in a data source"))
  .requiredOption("--parent-data-source-id <id>", "Parent data source ID")
  .requiredOption("--properties-json <json>", "JSON object of property values")
  .action(
    async (
      options: CommonOptions & {
        parentDataSourceId: string;
        propertiesJson: string;
      },
    ) => {
      await runAction(Boolean(options.pretty), async (requestId) => {
        const { config, notion } = await loadRuntime({ timeoutMs: options.timeoutMs });
        const propertiesPatch = requireObjectJson(options.propertiesJson, "properties-json");
        const view = resolveView(options.view, config.defaults.view);
        const fields = parseCommaFields(options.fields);

        const page = await executeMutationWithIdempotency({
          commandName: "pages.create",
          requestId,
          requestShape: {
            parent_data_source_id: options.parentDataSourceId,
            properties: propertiesPatch,
            view,
            fields,
          },
          targetIds: [options.parentDataSourceId],
          run: () =>
            createPage(
              {
                notion,
                config,
                saveConfig,
              },
              {
                parentDataSourceId: options.parentDataSourceId,
                propertiesPatch,
                view,
                fields,
              },
            ),
        });

        return {
          data: {
            page,
          },
        };
      });
    },
  );

addCommonReadOptions(pagesCommand.command("update").description("Update a page"))
  .requiredOption("--id <page_id>", "Notion page ID")
  .requiredOption("--patch-json <json>", "JSON object of property changes")
  .action(
    async (
      options: CommonOptions & {
        id: string;
        patchJson: string;
      },
    ) => {
      await runAction(Boolean(options.pretty), async (requestId) => {
        const { config, notion } = await loadRuntime({ timeoutMs: options.timeoutMs });
        const patch = requireObjectJson(options.patchJson, "patch-json");
        const view = resolveView(options.view, config.defaults.view);
        const fields = parseCommaFields(options.fields);

        const page = await executeMutationWithIdempotency({
          commandName: "pages.update",
          requestId,
          requestShape: {
            page_id: options.id,
            patch,
            view,
            fields,
          },
          targetIds: [options.id],
          run: () =>
            updatePage(
              {
                notion,
                config,
                saveConfig,
              },
              {
                pageId: options.id,
                patch,
                view,
                fields,
              },
            ),
        });

        return {
          data: {
            page,
          },
        };
      });
    },
  );

addCommonReadOptions(pagesCommand.command("archive").description("Archive a page"))
  .requiredOption("--id <page_id>", "Notion page ID")
  .action(async (options: CommonOptions & { id: string }) => {
    await runAction(Boolean(options.pretty), async (requestId) => {
      const { config, notion } = await loadRuntime({ timeoutMs: options.timeoutMs });
      const view = resolveView(options.view, config.defaults.view);
      const fields = parseCommaFields(options.fields);

      const page = await executeMutationWithIdempotency({
        commandName: "pages.archive",
        requestId,
        requestShape: {
          page_id: options.id,
          view,
          fields,
        },
        targetIds: [options.id],
        run: () =>
          archivePage(
            {
              notion,
              config,
              saveConfig,
            },
            {
              pageId: options.id,
              view,
              fields,
            },
          ),
      });

      return {
        data: {
          page,
        },
      };
    });
  });

pagesCommand
  .command("relate")
  .description("Add a relation link between pages")
  .requiredOption("--from-id <page_id>", "Source page ID")
  .requiredOption("--property <property_name>", "Relation property name on source page")
  .requiredOption("--to-id <page_id>", "Target page ID")
  .option("--pretty", "pretty-print JSON output")
  .option("--timeout-ms <n>", "request timeout in milliseconds")
  .action(
    async (options: {
      fromId: string;
      property: string;
      toId: string;
      pretty?: boolean;
      timeoutMs?: string;
    }) => {
      await runAction(Boolean(options.pretty), async (requestId) => {
        const { config, notion } = await loadRuntime({ timeoutMs: options.timeoutMs });

        const page = await executeMutationWithIdempotency({
          commandName: "pages.relate",
          requestId,
          requestShape: {
            from_id: options.fromId,
            property: options.property,
            to_id: options.toId,
          },
          targetIds: [options.fromId, options.toId],
          run: () =>
            setRelation(
              {
                notion,
                config,
                saveConfig,
              },
              {
                fromId: options.fromId,
                toId: options.toId,
                property: options.property,
                mode: "add",
              },
            ),
        });

        return {
          data: {
            page,
          },
        };
      });
    },
  );

pagesCommand
  .command("unrelate")
  .description("Remove a relation link between pages")
  .requiredOption("--from-id <page_id>", "Source page ID")
  .requiredOption("--property <property_name>", "Relation property name on source page")
  .requiredOption("--to-id <page_id>", "Target page ID")
  .option("--pretty", "pretty-print JSON output")
  .option("--timeout-ms <n>", "request timeout in milliseconds")
  .action(
    async (options: {
      fromId: string;
      property: string;
      toId: string;
      pretty?: boolean;
      timeoutMs?: string;
    }) => {
      await runAction(Boolean(options.pretty), async (requestId) => {
        const { config, notion } = await loadRuntime({ timeoutMs: options.timeoutMs });

        const page = await executeMutationWithIdempotency({
          commandName: "pages.unrelate",
          requestId,
          requestShape: {
            from_id: options.fromId,
            property: options.property,
            to_id: options.toId,
          },
          targetIds: [options.fromId, options.toId],
          run: () =>
            setRelation(
              {
                notion,
                config,
                saveConfig,
              },
              {
                fromId: options.fromId,
                toId: options.toId,
                property: options.property,
                mode: "remove",
              },
            ),
        });

        return {
          data: {
            page,
          },
        };
      });
    },
  );

const blocksCommand = program.command("blocks").description("Block operations");

blocksCommand
  .command("get")
  .description("Get blocks from a page or block")
  .requiredOption("--id <page_or_block_id>", "Notion page or block ID")
  .option("--max-blocks <n>", "Maximum block count")
  .option("--depth <n>", "Recursion depth", "1")
  .option("--view <compact|full>", "response view mode")
  .option("--pretty", "pretty-print JSON output")
  .option("--timeout-ms <n>", "request timeout in milliseconds")
  .action(
    async (options: {
      id: string;
      maxBlocks?: string;
      depth?: string;
      view?: string;
      pretty?: boolean;
      timeoutMs?: string;
    }) => {
      await runAction(Boolean(options.pretty), async () => {
        const { config, notion } = await loadRuntime({ timeoutMs: options.timeoutMs });
        const maxBlocks = parsePositiveInt(options.maxBlocks, "max-blocks", config.defaults.max_blocks);
        const depth = parsePositiveInt(options.depth, "depth", 1);
        const view = resolveView(options.view, config.defaults.view);

        const blocks = await getBlocks(notion, options.id, maxBlocks, depth, view);
        return {
          data: blocks,
        };
      });
    },
  );

blocksCommand
  .command("append")
  .description("Append blocks to a page or block")
  .requiredOption("--id <page_or_block_id>", "Notion page or block ID")
  .requiredOption("--blocks-json <json>", "JSON array of block children")
  .option("--dry-run", "Return append plan without mutating")
  .option("--pretty", "pretty-print JSON output")
  .option("--timeout-ms <n>", "request timeout in milliseconds")
  .action(
    async (options: {
      id: string;
      blocksJson: string;
      dryRun?: boolean;
      pretty?: boolean;
      timeoutMs?: string;
    }) => {
      await runAction(Boolean(options.pretty), async (requestId) => {
        const { notion } = await loadRuntime({ timeoutMs: options.timeoutMs });
        const blocks = requireArrayJson(options.blocksJson, "blocks-json");

        const result = await executeMutationWithIdempotency({
          commandName: options.dryRun ? "blocks.append.dry_run" : "blocks.append",
          requestId,
          requestShape: {
            id: options.id,
            blocks,
            dry_run: Boolean(options.dryRun),
          },
          targetIds: [options.id],
          run: () =>
            appendBlocks(notion, {
              parentId: options.id,
              blocks,
              dryRun: Boolean(options.dryRun),
            }),
        });

        return {
          data: result,
        };
      });
    },
  );

program
  .command("doctor")
  .description("Validate config and auth quickly")
  .option("--pretty", "pretty-print JSON output")
  .option("--timeout-ms <n>", "request timeout in milliseconds")
  .action(async (options: { pretty?: boolean; timeoutMs?: string }) => {
    await runAction(Boolean(options.pretty), async () => {
      const { config, notion } = await loadRuntime({ timeoutMs: options.timeoutMs });

      await notion.search({ page_size: 1 });

      return {
        data: {
          config_path: getConfigPath(),
          notion_api_key_env: config.notion_api_key_env,
          status: "ok",
        },
      };
    });
  });

await program.parseAsync(process.argv);

import { AppConfig } from "../config/types.js";
import { CliError } from "../errors/cli-error.js";
import { NotionClientAdapter } from "./client.js";
import {
  toCompactDataSource,
  toCompactPage,
  toFullDataSource,
  toFullPage,
  toSearchResult,
} from "./mappers.js";
import { buildPropertiesPayloadGeneric } from "./properties.js";

export interface PaginationResult {
  has_more: boolean;
  next_cursor: string | null;
  returned: number;
}

export interface QueryPagesInput {
  dataSourceId: string;
  limit: number;
  cursor?: string;
  filter?: Record<string, unknown>;
  sorts?: Array<Record<string, unknown>>;
  view: "compact" | "full";
  fields?: string[];
}

export interface RepositoryContext {
  notion: NotionClientAdapter;
  config: AppConfig;
  saveConfig: (config: AppConfig) => Promise<void>;
}

function getStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new CliError("internal_error", "Expected object response from Notion API.");
  }
  return value as Record<string, unknown>;
}

function asPage(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  if (record.object !== "page") {
    throw new CliError("invalid_input", "Expected a page object.");
  }
  return record;
}

function asDataSource(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  if (record.object !== "data_source") {
    throw new CliError("invalid_input", "Expected a data source object.");
  }
  return record;
}

function parseTimestampMs(raw: string | undefined): number {
  if (!raw) {
    return 0;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isSchemaStale(entry: { last_refreshed: string }, ttlHours: number): boolean {
  const refreshedAtMs = parseTimestampMs(entry.last_refreshed);
  if (!refreshedAtMs) {
    return true;
  }
  const ttlMs = ttlHours * 60 * 60 * 1000;
  return Date.now() - refreshedAtMs > ttlMs;
}

async function hydrateDataSourceSchema(
  ctx: RepositoryContext,
  dataSourceId: string,
  forceRefresh = false,
): Promise<Record<string, { id: string; type: string }>> {
  const cached = ctx.config.schema_cache[dataSourceId];
  if (!forceRefresh && cached && !isSchemaStale(cached, ctx.config.defaults.schema_ttl_hours)) {
    return cached.properties;
  }

  const dataSource = asDataSource(await ctx.notion.retrieveDataSource(dataSourceId));
  const properties = (dataSource.properties ?? {}) as Record<string, { id?: string; type?: string }>;

  const normalizedProperties: Record<string, { id: string; type: string }> = {};
  for (const [name, property] of Object.entries(properties)) {
    normalizedProperties[name] = {
      id: property.id ?? "",
      type: property.type ?? "unknown",
    };
  }

  ctx.config.schema_cache[dataSourceId] = {
    data_source_id: dataSourceId,
    last_refreshed: new Date().toISOString(),
    properties: normalizedProperties,
  };
  await ctx.saveConfig(ctx.config);

  return normalizedProperties;
}

function extractParentDataSourceId(page: Record<string, unknown>): string | null {
  const parent = page.parent;
  if (!parent || typeof parent !== "object") {
    return null;
  }

  const record = parent as Record<string, unknown>;
  const type = record.type;
  if (type === "data_source_id" && typeof record.data_source_id === "string") {
    return record.data_source_id;
  }

  if (type === "database_id" && typeof record.database_id === "string") {
    return record.database_id;
  }

  return null;
}

function readRelationProperty(page: Record<string, unknown>, propertyName: string): string[] {
  const properties = page.properties;
  if (!properties || typeof properties !== "object") {
    throw new CliError("invalid_input", `Page does not include property ${propertyName}.`);
  }

  const property = (properties as Record<string, unknown>)[propertyName];
  if (!property || typeof property !== "object") {
    throw new CliError("invalid_input", `Property ${propertyName} was not found on the page.`);
  }

  const relation = property as { type?: unknown; relation?: Array<{ id?: string }> };
  if (relation.type !== "relation") {
    throw new CliError("invalid_input", `Property ${propertyName} is not a relation property.`);
  }

  return (relation.relation ?? [])
    .map((item) => item.id)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

async function withBestEffortPageMutation(
  ctx: RepositoryContext,
  pageId: string,
  apply: (currentPage: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const attempts = 2;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const currentPage = asPage(await ctx.notion.retrievePage(pageId));
    try {
      return await apply(currentPage);
    } catch (error) {
      const status = getStatus(error);
      if (status === 409 && attempt < attempts) {
        continue;
      }
      throw error;
    }
  }

  throw new CliError("conflict", "Could not apply mutation due to concurrent updates.");
}

export async function searchWorkspace(
  notion: NotionClientAdapter,
  input: { query: string; limit: number; cursor?: string },
): Promise<{ results: Record<string, unknown>[]; pagination: PaginationResult }> {
  if (!input.query || input.query.trim().length === 0) {
    throw new CliError("invalid_input", "search requires a non-empty --query value.");
  }

  const payload: Record<string, unknown> = {
    query: input.query,
    page_size: Math.min(Math.max(1, input.limit), 100),
  };
  if (input.cursor) {
    payload.start_cursor = input.cursor;
  }

  const response = (await notion.search(payload)) as {
    results?: unknown[];
    has_more?: boolean;
    next_cursor?: string | null;
  };

  const results = (response.results ?? [])
    .filter((item) => item && typeof item === "object")
    .map((item) => toSearchResult(item as Record<string, unknown>));

  return {
    results,
    pagination: {
      has_more: Boolean(response.has_more),
      next_cursor: response.next_cursor ?? null,
      returned: results.length,
    },
  };
}

export async function listDataSources(
  notion: NotionClientAdapter,
  input: { query?: string; limit: number; cursor?: string },
): Promise<{ data_sources: Record<string, unknown>[]; pagination: PaginationResult }> {
  const payload: Record<string, unknown> = {
    page_size: Math.min(Math.max(1, input.limit), 100),
    filter: {
      property: "object",
      value: "data_source",
    },
  };

  if (input.query && input.query.trim().length > 0) {
    payload.query = input.query;
  }

  if (input.cursor) {
    payload.start_cursor = input.cursor;
  }

  const response = (await notion.search(payload)) as {
    results?: unknown[];
    has_more?: boolean;
    next_cursor?: string | null;
  };

  const dataSources = (response.results ?? []).map((item) => toCompactDataSource(asDataSource(item)));

  return {
    data_sources: dataSources,
    pagination: {
      has_more: Boolean(response.has_more),
      next_cursor: response.next_cursor ?? null,
      returned: dataSources.length,
    },
  };
}

export async function getDataSource(
  notion: NotionClientAdapter,
  dataSourceId: string,
  view: "compact" | "full",
): Promise<Record<string, unknown>> {
  const dataSource = asDataSource(await notion.retrieveDataSource(dataSourceId));
  return view === "full" ? toFullDataSource(dataSource) : toCompactDataSource(dataSource);
}

export async function queryDataSourcePages(
  ctx: RepositoryContext,
  input: QueryPagesInput,
): Promise<{ records: Record<string, unknown>[]; pagination: PaginationResult }> {
  const payload: Record<string, unknown> = {
    data_source_id: input.dataSourceId,
    page_size: Math.min(Math.max(1, input.limit), 100),
  };

  if (input.cursor) {
    payload.start_cursor = input.cursor;
  }
  if (input.filter) {
    payload.filter = input.filter;
  }
  if (input.sorts && input.sorts.length > 0) {
    payload.sorts = input.sorts;
  }

  const response = (await ctx.notion.queryDataSource(payload)) as {
    results?: unknown[];
    has_more?: boolean;
    next_cursor?: string | null;
  };

  const pages = (response.results ?? []).map(asPage);
  const records =
    input.view === "full"
      ? pages.map((page) => toFullPage(page))
      : pages.map((page) => toCompactPage(page, input.fields));

  return {
    records,
    pagination: {
      has_more: Boolean(response.has_more),
      next_cursor: response.next_cursor ?? null,
      returned: records.length,
    },
  };
}

export async function getPage(
  notion: NotionClientAdapter,
  pageId: string,
  view: "compact" | "full",
  fields?: string[],
): Promise<Record<string, unknown>> {
  const page = asPage(await notion.retrievePage(pageId));
  return view === "full" ? toFullPage(page) : toCompactPage(page, fields);
}

export async function createPage(
  ctx: RepositoryContext,
  input: {
    parentDataSourceId: string;
    propertiesPatch: Record<string, unknown>;
    view: "compact" | "full";
    fields?: string[];
  },
): Promise<Record<string, unknown>> {
  const schemaProperties = await hydrateDataSourceSchema(ctx, input.parentDataSourceId);
  let properties: Record<string, unknown>;

  try {
    properties = buildPropertiesPayloadGeneric(input.propertiesPatch, schemaProperties);
  } catch (error) {
    properties = buildPropertiesPayloadGeneric(
      input.propertiesPatch,
      await hydrateDataSourceSchema(ctx, input.parentDataSourceId, true),
    );
    if (!properties) {
      throw error;
    }
  }

  const page = asPage(
    await ctx.notion.createPage({
      parent: { data_source_id: input.parentDataSourceId },
      properties,
    }),
  );

  return input.view === "full" ? toFullPage(page) : toCompactPage(page, input.fields);
}

export async function updatePage(
  ctx: RepositoryContext,
  input: {
    pageId: string;
    patch: Record<string, unknown>;
    view: "compact" | "full";
    fields?: string[];
  },
): Promise<Record<string, unknown>> {
  const updatedPage = await withBestEffortPageMutation(ctx, input.pageId, async (currentPage) => {
    const parentDataSourceId = extractParentDataSourceId(currentPage);
    if (!parentDataSourceId) {
      throw new CliError(
        "invalid_input",
        "Page is not part of a data source. This command currently supports data-source pages.",
      );
    }

    let schema = await hydrateDataSourceSchema(ctx, parentDataSourceId);
    let properties: Record<string, unknown>;

    try {
      properties = buildPropertiesPayloadGeneric(input.patch, schema);
    } catch {
      schema = await hydrateDataSourceSchema(ctx, parentDataSourceId, true);
      properties = buildPropertiesPayloadGeneric(input.patch, schema);
    }

    return asPage(
      await ctx.notion.updatePage({
        page_id: input.pageId,
        properties,
      }),
    );
  });

  return input.view === "full" ? toFullPage(updatedPage) : toCompactPage(updatedPage, input.fields);
}

export async function archivePage(
  ctx: RepositoryContext,
  input: {
    pageId: string;
    view: "compact" | "full";
    fields?: string[];
  },
): Promise<Record<string, unknown>> {
  const updatedPage = await withBestEffortPageMutation(ctx, input.pageId, async () =>
    asPage(
      await ctx.notion.updatePage({
        page_id: input.pageId,
        archived: true,
      }),
    ),
  );

  return input.view === "full" ? toFullPage(updatedPage) : toCompactPage(updatedPage, input.fields);
}

export async function setRelation(
  ctx: RepositoryContext,
  args: {
    fromId: string;
    toId: string;
    property: string;
    mode: "add" | "remove";
  },
): Promise<Record<string, unknown>> {
  const updatedPage = await withBestEffortPageMutation(ctx, args.fromId, async (currentPage) => {
    const currentIds = new Set<string>(readRelationProperty(currentPage, args.property));

    if (args.mode === "add") {
      currentIds.add(args.toId);
    } else {
      currentIds.delete(args.toId);
    }

    return asPage(
      await ctx.notion.updatePage({
        page_id: args.fromId,
        properties: {
          [args.property]: {
            relation: Array.from(currentIds).map((id) => ({ id })),
          },
        },
      }),
    );
  });

  return toCompactPage(updatedPage);
}

function extractBlockText(block: Record<string, unknown>): string | null {
  const type = block.type;
  if (typeof type !== "string") {
    return null;
  }

  const typedData = block[type] as Record<string, unknown> | undefined;
  if (!typedData || typeof typedData !== "object") {
    return null;
  }

  const richText = typedData.rich_text;
  if (!Array.isArray(richText)) {
    return null;
  }

  return richText
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const plain = (item as { plain_text?: unknown }).plain_text;
      return typeof plain === "string" ? plain : "";
    })
    .join("");
}

function toCompactBlock(block: Record<string, unknown>): Record<string, unknown> {
  return {
    id: block.id ?? null,
    type: block.type ?? null,
    has_children: Boolean(block.has_children),
    text: extractBlockText(block),
  };
}

async function collectChildren(
  notion: NotionClientAdapter,
  args: {
    blockId: string;
    depth: number;
    maxBlocks: number;
    view: "compact" | "full";
  },
  state: { count: number; truncated: boolean },
): Promise<Array<Record<string, unknown>>> {
  let cursor: string | undefined;
  const results: Array<Record<string, unknown>> = [];

  while (state.count < args.maxBlocks) {
    const payload: Record<string, unknown> = {
      block_id: args.blockId,
      page_size: 100,
    };
    if (cursor) {
      payload.start_cursor = cursor;
    }

    const response = (await notion.listBlockChildren(payload)) as {
      results?: unknown[];
      has_more?: boolean;
      next_cursor?: string | null;
    };

    for (const rawBlock of response.results ?? []) {
      if (state.count >= args.maxBlocks) {
        state.truncated = true;
        break;
      }
      if (!rawBlock || typeof rawBlock !== "object") {
        continue;
      }

      state.count += 1;
      const block = rawBlock as Record<string, unknown>;
      const payloadBlock = args.view === "full" ? { ...block } : toCompactBlock(block);

      if (args.depth > 1 && block.has_children === true && typeof block.id === "string") {
        payloadBlock.children = await collectChildren(
          notion,
          {
            blockId: block.id,
            depth: args.depth - 1,
            maxBlocks: args.maxBlocks,
            view: args.view,
          },
          state,
        );
      }

      results.push(payloadBlock);
    }

    if (state.count >= args.maxBlocks) {
      if (response.has_more) {
        state.truncated = true;
      }
      break;
    }

    if (!response.has_more || !response.next_cursor) {
      break;
    }

    cursor = response.next_cursor;
  }

  return results;
}

export async function getBlocks(
  notion: NotionClientAdapter,
  pageOrBlockId: string,
  maxBlocks: number,
  depth: number,
  view: "compact" | "full",
): Promise<Record<string, unknown>> {
  const state = { count: 0, truncated: false };
  const blocks = await collectChildren(
    notion,
    {
      blockId: pageOrBlockId,
      depth,
      maxBlocks,
      view,
    },
    state,
  );

  return {
    id: pageOrBlockId,
    blocks,
    returned_blocks: state.count,
    truncated: state.truncated,
    max_blocks: maxBlocks,
    depth,
  };
}

function chunk<T>(items: T[], chunkSize: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    output.push(items.slice(index, index + chunkSize));
  }
  return output;
}

export async function appendBlocks(
  notion: NotionClientAdapter,
  args: {
    parentId: string;
    blocks: Array<Record<string, unknown>>;
    dryRun: boolean;
  },
): Promise<Record<string, unknown>> {
  if (args.dryRun) {
    return {
      dry_run: true,
      id: args.parentId,
      would_append_count: args.blocks.length,
      block_types: args.blocks.map((block) => block.type ?? "unknown"),
    };
  }

  const chunks = chunk(args.blocks, 100);
  let appended = 0;

  for (const children of chunks) {
    await notion.appendBlockChildren({
      block_id: args.parentId,
      children,
    });
    appended += children.length;
  }

  return {
    id: args.parentId,
    appended_count: appended,
  };
}

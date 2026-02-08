import { describe, expect, it, vi } from "vitest";
import { archivePage, createPagesBulk, setRelation, unarchivePage } from "../src/notion/repository.js";
import { NotionClientAdapter } from "../src/notion/client.js";
import { AppConfig } from "../src/config/types.js";

function runtimeConfig(): AppConfig {
  return {
    notion_api_key_env: "NOTION_API_KEY",
    defaults: {
      limit: 25,
      view: "compact",
      max_blocks: 200,
      timeout_ms: 30000,
      schema_ttl_hours: 24,
      bulk_create_concurrency: 5,
      search_scan_limit: 500,
    },
    schema_cache: {},
  };
}

function pageFixture(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    object: "page",
    id: "page-1",
    url: "https://notion.so/page-1",
    created_time: "2026-01-01T00:00:00.000Z",
    last_edited_time: "2026-01-02T00:00:00.000Z",
    archived: false,
    parent: { type: "data_source_id", data_source_id: "ds-1" },
    properties: {
      Name: {
        type: "title",
        title: [{ plain_text: "Task" }],
      },
      Project: {
        type: "relation",
        relation: [{ id: "project-a" }],
      },
    },
    ...overrides,
  };
}

function dataSourceFixture(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    object: "data_source",
    id: "ds-1",
    title: [{ plain_text: "Tasks" }],
    properties: {
      Name: {
        id: "title",
        type: "title",
        title: {},
      },
    },
    ...overrides,
  };
}

describe("repository mutation response views", () => {
  it("returns full page from setRelation when requested", async () => {
    const notion = {
      retrievePage: vi.fn().mockResolvedValue(pageFixture()),
      updatePage: vi.fn().mockResolvedValue(
        pageFixture({
          properties: {
            Name: {
              type: "title",
              title: [{ plain_text: "Task" }],
            },
            Project: {
              type: "relation",
              relation: [{ id: "project-a" }, { id: "project-b" }],
            },
          },
        }),
      ),
    } as unknown as NotionClientAdapter;

    const page = await setRelation(
      {
        notion,
        config: runtimeConfig(),
        saveConfig: async () => undefined,
      },
      {
        fromId: "page-1",
        toId: "project-b",
        property: "Project",
        mode: "add",
        view: "full",
      },
    );

    expect(page.properties).toBeDefined();
    expect(page.property_types).toBeDefined();
  });

  it("can unarchive pages", async () => {
    const notion = {
      retrievePage: vi.fn().mockResolvedValue(pageFixture({ archived: true })),
      updatePage: vi.fn().mockResolvedValue(pageFixture({ archived: false })),
    } as unknown as NotionClientAdapter;

    const page = await unarchivePage(
      {
        notion,
        config: runtimeConfig(),
        saveConfig: async () => undefined,
      },
      {
        pageId: "page-1",
        view: "compact",
      },
    );

    expect(page.archived).toBe(false);
  });

  it("archives pages", async () => {
    const notion = {
      retrievePage: vi.fn().mockResolvedValue(pageFixture({ archived: false })),
      updatePage: vi.fn().mockResolvedValue(pageFixture({ archived: true })),
    } as unknown as NotionClientAdapter;

    const page = await archivePage(
      {
        notion,
        config: runtimeConfig(),
        saveConfig: async () => undefined,
      },
      {
        pageId: "page-1",
        view: "compact",
      },
    );

    expect(page.archived).toBe(true);
  });

  it("preserves upstream error codes in create-bulk item failures", async () => {
    const notion = {
      retrieveDataSource: vi.fn().mockResolvedValue(dataSourceFixture()),
      createPage: vi.fn().mockRejectedValue({
        status: 400,
        message: "Bad Request",
      }),
    } as unknown as NotionClientAdapter;

    const result = await createPagesBulk(
      {
        notion,
        config: runtimeConfig(),
        saveConfig: async () => undefined,
      },
      {
        parentDataSourceId: "ds-1",
        items: [
          {
            propertiesPatch: {
              Name: "Task 1",
            },
          },
        ],
        view: "compact",
        concurrency: 1,
      },
    );

    expect(result.summary).toEqual({
      requested: 1,
      created: 0,
      failed: 1,
    });
    expect(result.items[0]).toMatchObject({
      index: 0,
      ok: false,
      error: {
        code: "invalid_input",
      },
    });
  });
});

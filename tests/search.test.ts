import { describe, expect, it, vi } from "vitest";
import { searchWorkspace } from "../src/notion/repository.js";
import { NotionClientAdapter } from "../src/notion/client.js";

function page(id: string, overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    object: "page",
    id,
    url: `https://notion.so/${id}`,
    created_time: "2026-01-01T00:00:00.000Z",
    last_edited_time: "2026-01-02T00:00:00.000Z",
    created_by: { id: "user-1" },
    parent: { type: "data_source_id", data_source_id: "ds-1" },
    properties: {
      Name: {
        type: "title",
        title: [{ plain_text: `Page ${id}` }],
      },
    },
    ...overrides,
  };
}

describe("searchWorkspace", () => {
  it("applies scope, creator, and date filters client-side", async () => {
    const notion = {
      search: vi.fn().mockResolvedValue({
        results: [
          page("p-1"),
          page("p-2", { created_by: { id: "user-2" } }),
          page("p-3", { created_time: "2025-01-01T00:00:00.000Z" }),
          page("p-4", { parent: { type: "page_id", page_id: "scope-1" } }),
        ],
        has_more: false,
        next_cursor: null,
      }),
    } as unknown as NotionClientAdapter;

    const result = await searchWorkspace(notion, {
      query: "page",
      limit: 10,
      scope: "scope-1",
      createdBy: "user-1",
      createdAfter: "2025-12-31T00:00:00.000Z",
      scanLimit: 500,
    });

    expect(result.results.map((item) => item.id)).toEqual(["p-4"]);
    expect(result.scan_count).toBe(4);
  });

  it("honors scan-limit and returns has_more when upstream has more", async () => {
    const upstream = [page("p-1"), page("p-2"), page("p-3")];
    const notion = {
      search: vi.fn().mockImplementation(async (payload: Record<string, unknown>) => {
        const pageSize = typeof payload.page_size === "number" ? payload.page_size : upstream.length;
        return {
          results: upstream.slice(0, pageSize),
          has_more: true,
          next_cursor: "cursor-2",
        };
      }),
    } as unknown as NotionClientAdapter;

    const result = await searchWorkspace(notion, {
      query: "page",
      limit: 2,
      scanLimit: 2,
    });

    expect(result.scan_count).toBe(2);
    expect(result.pagination.has_more).toBe(true);
    expect(result.pagination.next_cursor).toBe("cursor-2");
    expect(notion.search).toHaveBeenCalledWith(
      expect.objectContaining({
        page_size: 2,
      }),
    );
  });

  it("does not skip unprocessed hits when paginating with a small limit", async () => {
    const upstream = [page("p-1"), page("p-2"), page("p-3")];
    const notion = {
      search: vi.fn().mockImplementation(async (payload: Record<string, unknown>) => {
        const start =
          typeof payload.start_cursor === "string" ? Number.parseInt(payload.start_cursor, 10) : 0;
        const pageSize = typeof payload.page_size === "number" ? payload.page_size : 25;
        const batch = upstream.slice(start, start + pageSize);
        const next = start + batch.length;
        const hasMore = next < upstream.length;
        return {
          results: batch,
          has_more: hasMore,
          next_cursor: hasMore ? String(next) : null,
        };
      }),
    } as unknown as NotionClientAdapter;

    const first = await searchWorkspace(notion, {
      query: "page",
      limit: 1,
      scanLimit: 500,
    });
    expect(first.results.map((item) => item.id)).toEqual(["p-1"]);
    expect(first.pagination.has_more).toBe(true);
    expect(first.pagination.next_cursor).toBe("1");

    const second = await searchWorkspace(notion, {
      query: "page",
      limit: 1,
      cursor: first.pagination.next_cursor ?? undefined,
      scanLimit: 500,
    });
    expect(second.results.map((item) => item.id)).toEqual(["p-2"]);
    expect(second.pagination.next_cursor).toBe("2");
  });
});

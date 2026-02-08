import { describe, expect, it, vi } from "vitest";
import {
  insertBlocks,
  replaceBlockRange,
  selectBlocks,
} from "../src/notion/repository.js";
import { NotionClientAdapter } from "../src/notion/client.js";

function paragraphBlock(
  id: string,
  text: string,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    object: "block",
    id,
    type: "paragraph",
    has_children: false,
    last_edited_time: "2026-02-08T00:00:00.000Z",
    paragraph: {
      rich_text: [{ plain_text: text }],
    },
    ...overrides,
  };
}

function blockPayload(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, index) => ({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: `item ${index + 1}` } }],
    },
  }));
}

describe("surgical block editing", () => {
  it("inserts chunked blocks at start and chains subsequent chunks after inserted IDs", async () => {
    const appendBlockChildren = vi
      .fn()
      .mockResolvedValueOnce({
        results: Array.from({ length: 100 }, (_, index) => ({ id: `n-${index + 1}` })),
      })
      .mockResolvedValueOnce({
        results: [{ id: "n-101" }],
      });

    const notion = {
      appendBlockChildren,
    } as unknown as NotionClientAdapter;

    const result = await insertBlocks(notion, {
      parentId: "parent-1",
      blocks: blockPayload(101),
      position: { type: "start" },
      dryRun: false,
    });

    expect(appendBlockChildren).toHaveBeenCalledTimes(2);
    expect(appendBlockChildren.mock.calls[0][0]).toMatchObject({
      block_id: "parent-1",
      position: {
        type: "start",
      },
    });
    expect(appendBlockChildren.mock.calls[1][0]).toMatchObject({
      block_id: "parent-1",
      position: {
        type: "after_block",
        after_block: {
          id: "n-100",
        },
      },
    });
    expect(result.inserted_count).toBe(101);
    expect(result.inserted_ids).toHaveLength(101);
  });

  it("replaces a sibling range by inserting then deleting selected blocks", async () => {
    const appendBlockChildren = vi.fn().mockResolvedValue({
      results: [{ id: "n-1" }],
    });
    const deleteBlock = vi.fn().mockResolvedValue({});

    const notion = {
      listBlockChildren: vi
        .fn()
        .mockResolvedValueOnce({
          results: [
            paragraphBlock("b-1", "first"),
            paragraphBlock("b-2", "second"),
            paragraphBlock("b-3", "third"),
          ],
          has_more: false,
          next_cursor: null,
        })
        .mockResolvedValueOnce({
          results: [
            paragraphBlock("b-1", "first"),
            paragraphBlock("b-2", "second"),
            paragraphBlock("b-3", "third"),
          ],
          has_more: false,
          next_cursor: null,
        }),
      appendBlockChildren,
      deleteBlock,
    } as unknown as NotionClientAdapter;

    const result = await replaceBlockRange(notion, {
      scopeId: "page-1",
      startSelector: {
        where: {
          text_contains: "second",
        },
      },
      endSelector: {
        where: {
          text_contains: "second",
        },
      },
      blocks: blockPayload(1),
      inclusiveStart: true,
      inclusiveEnd: true,
      dryRun: false,
      maxBlocks: 5000,
    });

    expect(appendBlockChildren.mock.calls[0][0]).toMatchObject({
      block_id: "page-1",
      position: {
        type: "after_block",
        after_block: {
          id: "b-1",
        },
      },
    });
    expect(deleteBlock).toHaveBeenCalledWith({
      block_id: "b-2",
    });
    expect(result.delete_ids).toEqual(["b-2"]);
    expect(result.inserted_ids).toEqual(["n-1"]);
  });

  it("fails fast with conflict when sibling fingerprint changes before mutation", async () => {
    const appendBlockChildren = vi.fn();
    const deleteBlock = vi.fn();
    const notion = {
      listBlockChildren: vi
        .fn()
        .mockResolvedValueOnce({
          results: [paragraphBlock("b-1", "one"), paragraphBlock("b-2", "two")],
          has_more: false,
          next_cursor: null,
        })
        .mockResolvedValueOnce({
          results: [paragraphBlock("b-1", "one"), paragraphBlock("b-x", "changed")],
          has_more: false,
          next_cursor: null,
        }),
      appendBlockChildren,
      deleteBlock,
    } as unknown as NotionClientAdapter;

    await expect(
      replaceBlockRange(notion, {
        scopeId: "page-1",
        startSelector: {
          where: {
            text_contains: "one",
          },
        },
        endSelector: {
          where: {
            text_contains: "two",
          },
        },
        blocks: blockPayload(1),
        inclusiveStart: true,
        inclusiveEnd: true,
        dryRun: false,
        maxBlocks: 5000,
      }),
    ).rejects.toMatchObject({
      code: "conflict",
    });

    expect(appendBlockChildren).not.toHaveBeenCalled();
    expect(deleteBlock).not.toHaveBeenCalled();
  });

  it("returns ambiguous selector metadata when nth is omitted and matches are non-unique", async () => {
    const notion = {
      listBlockChildren: vi.fn().mockResolvedValue({
        results: [paragraphBlock("b-1", "todo"), paragraphBlock("b-2", "todo")],
        has_more: false,
        next_cursor: null,
      }),
    } as unknown as NotionClientAdapter;

    const result = await selectBlocks(notion, {
      scopeId: "page-1",
      selector: {
        where: {
          text_contains: "todo",
        },
      },
      maxBlocks: 5000,
    });

    expect(result.match_count).toBe(2);
    expect(result.ambiguous).toBe(true);
    expect(result.selected).toBeNull();
  });
});

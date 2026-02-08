import { describe, expect, it, vi } from "vitest";
import { getBlocks } from "../src/notion/repository.js";
import { NotionClientAdapter } from "../src/notion/client.js";

function paragraph(id: string): Record<string, unknown> {
  return {
    object: "block",
    id,
    type: "paragraph",
    has_children: false,
    paragraph: {
      rich_text: [],
    },
  };
}

describe("getBlocks truncation metadata", () => {
  it("marks truncated when maxBlocks is reached and upstream has more pages", async () => {
    const notion = {
      listBlockChildren: vi
        .fn()
        .mockResolvedValueOnce({
          results: [paragraph("b1"), paragraph("b2")],
          has_more: true,
          next_cursor: "cursor-2",
        })
        .mockResolvedValueOnce({
          results: [paragraph("b3")],
          has_more: false,
          next_cursor: null,
        }),
    } as unknown as NotionClientAdapter;

    const result = await getBlocks(notion, "page-1", 2, 1, "compact");

    expect(result.returned_blocks).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it("keeps truncated false when maxBlocks is reached exactly with no more results", async () => {
    const notion = {
      listBlockChildren: vi.fn().mockResolvedValueOnce({
        results: [paragraph("b1"), paragraph("b2")],
        has_more: false,
        next_cursor: null,
      }),
    } as unknown as NotionClientAdapter;

    const result = await getBlocks(notion, "page-1", 2, 1, "compact");

    expect(result.returned_blocks).toBe(2);
    expect(result.truncated).toBe(false);
  });
});

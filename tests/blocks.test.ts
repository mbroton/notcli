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

  it("returns markdown content when markdown format is requested", async () => {
    const notion = {
      listBlockChildren: vi
        .fn()
        .mockResolvedValueOnce({
          results: [
            {
              object: "block",
              id: "h1",
              type: "heading_1",
              has_children: false,
              heading_1: {
                rich_text: [{ plain_text: "Heading" }],
              },
            },
            {
              object: "block",
              id: "p1",
              type: "paragraph",
              has_children: false,
              paragraph: {
                rich_text: [{ plain_text: "Body text" }],
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
    } as unknown as NotionClientAdapter;

    const result = await getBlocks(notion, "page-1", 10, 1, "markdown");

    expect(result.format).toBe("markdown");
    expect(result.content_markdown).toContain("# Heading");
    expect(result.content_markdown).toContain("Body text");
    expect(result.returned_blocks).toBe(2);
    expect(result.truncated).toBe(false);
  });
});

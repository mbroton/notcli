import { describe, expect, it } from "vitest";
import { markdownToBlocks } from "../src/notion/markdown.js";

describe("markdownToBlocks", () => {
  it("converts key markdown constructs into Notion blocks", () => {
    const markdown = [
      "# Title",
      "",
      "A paragraph.",
      "- bullet item",
      "1. numbered item",
      "- [x] done item",
      "---",
      "```ts",
      "const x = 1;",
      "```",
    ].join("\n");

    const blocks = markdownToBlocks(markdown);
    expect(blocks.map((block) => block.type)).toEqual([
      "heading_1",
      "paragraph",
      "bulleted_list_item",
      "numbered_list_item",
      "to_do",
      "divider",
      "code",
    ]);
  });

  it("collapses contiguous quote lines into a single quote block", () => {
    const markdown = ["> line one", "> line two"].join("\n");
    const blocks = markdownToBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("quote");
  });
});

const MAX_RICH_TEXT_CHARS = 1800;

function chunkText(content: string): string[] {
  if (content.length <= MAX_RICH_TEXT_CHARS) {
    return [content];
  }

  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += MAX_RICH_TEXT_CHARS) {
    chunks.push(content.slice(index, index + MAX_RICH_TEXT_CHARS));
  }
  return chunks;
}

function toRichText(content: string): Array<{ type: "text"; text: { content: string } }> {
  const normalized = content.length > 0 ? content : " ";
  return chunkText(normalized).map((chunk) => ({
    type: "text",
    text: {
      content: chunk,
    },
  }));
}

function paragraphBlock(text: string): Record<string, unknown> {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: toRichText(text),
    },
  };
}

function headingBlock(level: 1 | 2 | 3, text: string): Record<string, unknown> {
  const type = `heading_${level}`;
  return {
    object: "block",
    type,
    [type]: {
      rich_text: toRichText(text),
    },
  };
}

function bulletedItemBlock(text: string): Record<string, unknown> {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: toRichText(text),
    },
  };
}

function numberedItemBlock(text: string): Record<string, unknown> {
  return {
    object: "block",
    type: "numbered_list_item",
    numbered_list_item: {
      rich_text: toRichText(text),
    },
  };
}

function todoBlock(text: string, checked: boolean): Record<string, unknown> {
  return {
    object: "block",
    type: "to_do",
    to_do: {
      rich_text: toRichText(text),
      checked,
    },
  };
}

function quoteBlock(text: string): Record<string, unknown> {
  return {
    object: "block",
    type: "quote",
    quote: {
      rich_text: toRichText(text),
    },
  };
}

function dividerBlock(): Record<string, unknown> {
  return {
    object: "block",
    type: "divider",
    divider: {},
  };
}

function normalizeCodeLanguage(raw: string): string {
  const language = raw.trim().toLowerCase();
  if (!language) {
    return "plain text";
  }

  switch (language) {
    case "ts":
    case "typescript":
      return "typescript";
    case "js":
    case "javascript":
      return "javascript";
    case "py":
    case "python":
      return "python";
    case "sh":
    case "bash":
    case "shell":
      return "shell";
    case "json":
      return "json";
    case "sql":
      return "sql";
    case "yaml":
    case "yml":
      return "yaml";
    case "md":
    case "markdown":
      return "markdown";
    case "html":
      return "html";
    case "css":
      return "css";
    case "go":
      return "go";
    case "java":
      return "java";
    case "ruby":
      return "ruby";
    case "rust":
      return "rust";
    default:
      return "plain text";
  }
}

function codeBlock(text: string, language: string): Record<string, unknown> {
  return {
    object: "block",
    type: "code",
    code: {
      rich_text: toRichText(text),
      language,
    },
  };
}

function isDivider(trimmed: string): boolean {
  return trimmed === "---" || trimmed === "***" || trimmed === "___";
}

export function markdownToBlocks(markdown: string): Array<Record<string, unknown>> {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const blocks: Array<Record<string, unknown>> = [];
  let paragraphLines: string[] = [];

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) {
      return;
    }
    const text = paragraphLines.join("\n").trim();
    paragraphLines = [];
    if (text.length > 0) {
      blocks.push(paragraphBlock(text));
    }
  };

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      const language = normalizeCodeLanguage(trimmed.slice(3));
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length && lines[index].trim().startsWith("```")) {
        index += 1;
      }
      blocks.push(codeBlock(codeLines.join("\n"), language));
      continue;
    }

    if (trimmed.length === 0) {
      flushParagraph();
      index += 1;
      continue;
    }

    if (isDivider(trimmed)) {
      flushParagraph();
      blocks.push(dividerBlock());
      index += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1].length as 1 | 2 | 3;
      blocks.push(headingBlock(level, headingMatch[2]));
      index += 1;
      continue;
    }

    const todoMatch = trimmed.match(/^[-*]\s+\[( |x|X)\]\s+(.+)$/);
    if (todoMatch) {
      flushParagraph();
      blocks.push(todoBlock(todoMatch[2], todoMatch[1].toLowerCase() === "x"));
      index += 1;
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      const quoteLines: string[] = [quoteMatch[1]];
      index += 1;
      while (index < lines.length) {
        const next = lines[index].trim();
        const nextMatch = next.match(/^>\s?(.*)$/);
        if (!nextMatch) {
          break;
        }
        quoteLines.push(nextMatch[1]);
        index += 1;
      }
      blocks.push(quoteBlock(quoteLines.join("\n")));
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      blocks.push(bulletedItemBlock(bulletMatch[1]));
      index += 1;
      continue;
    }

    const numberedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      flushParagraph();
      blocks.push(numberedItemBlock(numberedMatch[1]));
      index += 1;
      continue;
    }

    paragraphLines.push(line);
    index += 1;
  }

  flushParagraph();
  return blocks;
}

import { Client } from "@notionhq/client";
import { CliError } from "../errors/cli-error.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class RateLimiter {
  private queue: Promise<unknown> = Promise.resolve();
  private lastStartMs = 0;

  constructor(private readonly minIntervalMs: number) {}

  schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const now = Date.now();
      const waitMs = Math.max(0, this.minIntervalMs - (now - this.lastStartMs));
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      this.lastStartMs = Date.now();
      return task();
    };

    const result = this.queue.then(run, run);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function getStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") {
      return status;
    }
  }
  return undefined;
}

function getRetryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const headers = (error as { headers?: unknown }).headers;
  if (!headers) {
    return undefined;
  }

  if (typeof (headers as { get?: unknown }).get === "function") {
    const raw = (headers as { get(name: string): string | null }).get("retry-after");
    if (raw) {
      const seconds = Number.parseFloat(raw);
      if (!Number.isNaN(seconds)) {
        return seconds * 1000;
      }
    }
  }

  if (typeof headers === "object" && headers !== null) {
    const value = (headers as Record<string, unknown>)["retry-after"];
    if (typeof value === "string") {
      const seconds = Number.parseFloat(value);
      if (!Number.isNaN(seconds)) {
        return seconds * 1000;
      }
    }
  }

  return undefined;
}

function isRetryable(error: unknown): boolean {
  const status = getStatus(error);
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export class NotionClientAdapter {
  private readonly client: Client;
  private readonly limiter: RateLimiter;

  constructor(apiKey: string, timeoutMs: number) {
    if (!apiKey) {
      throw new CliError(
        "auth_or_config",
        "NOTION_API_KEY is missing. Set the configured token environment variable.",
      );
    }

    this.client = new Client({
      auth: apiKey,
      notionVersion: "2025-09-03",
      timeoutMs,
    } as never);
    this.limiter = new RateLimiter(350);
  }

  async execute<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const maxAttempts = 5;
    let attempt = 0;
    let delayMs = 500;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        return await this.limiter.schedule(fn);
      } catch (error) {
        if (!isRetryable(error) || attempt >= maxAttempts) {
          throw error;
        }

        const retryAfterMs = getRetryAfterMs(error);
        const jitter = Math.floor(Math.random() * 200);
        const waitMs = retryAfterMs ?? delayMs + jitter;
        await sleep(waitMs);
        delayMs *= 2;
      }
    }

    throw new CliError("retryable_upstream", `Failed operation ${operation} after retries.`, {
      retryable: true,
    });
  }

  queryDataSource(args: Record<string, unknown>): Promise<unknown> {
    return this.execute("dataSources.query", () =>
      (this.client.dataSources.query as (payload: Record<string, unknown>) => Promise<unknown>)(args),
    );
  }

  retrieveDataSource(dataSourceId: string): Promise<unknown> {
    return this.execute("dataSources.retrieve", () =>
      this.client.dataSources.retrieve({ data_source_id: dataSourceId } as never) as unknown as Promise<unknown>,
    );
  }

  retrievePage(pageId: string): Promise<unknown> {
    return this.execute("pages.retrieve", () =>
      this.client.pages.retrieve({ page_id: pageId } as never) as unknown as Promise<unknown>,
    );
  }

  retrieveBlock(blockId: string): Promise<unknown> {
    return this.execute("blocks.retrieve", () =>
      this.client.blocks.retrieve({ block_id: blockId } as never) as unknown as Promise<unknown>,
    );
  }

  createPage(args: Record<string, unknown>): Promise<unknown> {
    return this.execute("pages.create", () =>
      this.client.pages.create(args as never) as unknown as Promise<unknown>,
    );
  }

  updatePage(args: Record<string, unknown>): Promise<unknown> {
    return this.execute("pages.update", () =>
      this.client.pages.update(args as never) as unknown as Promise<unknown>,
    );
  }

  updateBlock(args: Record<string, unknown>): Promise<unknown> {
    return this.execute("blocks.update", () =>
      this.client.blocks.update(args as never) as unknown as Promise<unknown>,
    );
  }

  deleteBlock(args: Record<string, unknown>): Promise<unknown> {
    return this.execute("blocks.delete", () =>
      this.client.blocks.delete(args as never) as unknown as Promise<unknown>,
    );
  }

  listBlockChildren(args: Record<string, unknown>): Promise<unknown> {
    return this.execute("blocks.children.list", () =>
      this.client.blocks.children.list(args as never) as unknown as Promise<unknown>,
    );
  }

  appendBlockChildren(args: Record<string, unknown>): Promise<unknown> {
    return this.execute("blocks.children.append", () =>
      this.client.blocks.children.append(args as never) as unknown as Promise<unknown>,
    );
  }

  search(args: Record<string, unknown>): Promise<unknown> {
    return this.execute("search", () => this.client.search(args as never) as unknown as Promise<unknown>);
  }
}

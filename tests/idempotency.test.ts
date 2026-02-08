import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildInternalIdempotencyKey, IdempotencyStore } from "../src/idempotency/store.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("IdempotencyStore", () => {
  it("reserves once and replays after completion", () => {
    const dir = mkdtempSync(join(tmpdir(), "notion-lite-test-"));
    tempDirs.push(dir);

    const store = new IdempotencyStore(join(dir, "idem.db"));
    const first = store.reserve("k1", "pages.update", "h1");
    expect(first.kind).toBe("execute");

    const second = store.reserve("k1", "pages.update", "h1");
    expect(second.kind).toBe("pending");

    store.complete("k1", "pages.update", "h1", { ok: true, id: "t1" });

    const lookup = store.lookup("k1", "pages.update", "h1");
    expect(lookup.kind).toBe("replay");
    if (lookup.kind === "replay") {
      expect(lookup.response).toEqual({ ok: true, id: "t1" });
    }

    store.close();
  });

  it("builds deterministic internal idempotency keys", () => {
    const keyA = buildInternalIdempotencyKey("pages.update", {
      a: 1,
      b: { c: 2, d: 3 },
    });

    const keyB = buildInternalIdempotencyKey("pages.update", {
      b: { d: 3, c: 2 },
      a: 1,
    });

    expect(keyA).toBe(keyB);
  });
});

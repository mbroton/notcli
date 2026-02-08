import { describe, expect, it } from "vitest";
import { hashObject, stableStringify } from "../src/utils/json.js";

describe("json utils", () => {
  it("stableStringify sorts object keys recursively", () => {
    const value = {
      b: 1,
      a: {
        d: 2,
        c: 3,
      },
    };

    expect(stableStringify(value)).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("hashObject is deterministic for equivalent shapes", () => {
    const left = { a: 1, b: { c: 2, d: 3 } };
    const right = { b: { d: 3, c: 2 }, a: 1 };

    expect(hashObject(left)).toBe(hashObject(right));
  });
});

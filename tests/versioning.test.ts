import { describe, expect, it } from "vitest";
import { successEnvelope } from "../src/contracts/envelope.js";

describe("envelope contract", () => {
  it("includes request_id and omits schema/timing/token diagnostics by default", () => {
    const envelope = successEnvelope({ ok: true }, "req-123");

    expect(envelope.meta.request_id).toBe("req-123");
    expect("schema_version" in envelope.meta).toBe(false);
    expect("timing_ms" in envelope.meta).toBe(false);
    expect("estimated_tokens" in envelope.meta).toBe(false);
  });
});

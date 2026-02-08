import { createHash } from "node:crypto";
import { CliError } from "../errors/cli-error.js";

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const output: Record<string, unknown> = {};
    for (const [key, child] of entries) {
      output[key] = sortValue(child);
    }
    return output;
  }

  return value;
}

export function hashObject(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function parseJsonOption<T>(label: string, raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new CliError("invalid_input", `Failed to parse ${label} as JSON.`, {
      details: (error as Error).message,
    });
  }
}

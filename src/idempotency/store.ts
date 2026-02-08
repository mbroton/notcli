import Database from "better-sqlite3";
import { ensureConfigDir, getIdempotencyDbPath } from "../config/paths.js";
import { CliError } from "../errors/cli-error.js";
import { hashObject } from "../utils/json.js";

const PENDING_RESPONSE_JSON = JSON.stringify({ __notion_lite_pending: true });

export type IdempotencyLookup =
  | { kind: "miss" }
  | { kind: "pending" }
  | { kind: "replay"; response: unknown }
  | { kind: "conflict"; storedHash: string };

export type IdempotencyReservation =
  | { kind: "execute" }
  | { kind: "pending" }
  | { kind: "replay"; response: unknown }
  | { kind: "conflict"; storedHash: string };

export class IdempotencyStore {
  private readonly db: Database.Database;

  constructor(dbPath = getIdempotencyDbPath()) {
    ensureConfigDir();
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS idempotency_records (
        idempotency_key TEXT NOT NULL,
        command_name TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (idempotency_key, command_name)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  lookup(idempotencyKey: string, commandName: string, inputHash: string): IdempotencyLookup {
    const row = this.db
      .prepare(
        `SELECT input_hash, response_json FROM idempotency_records WHERE idempotency_key = ? AND command_name = ?`,
      )
      .get(idempotencyKey, commandName) as { input_hash: string; response_json: string } | undefined;

    if (!row) {
      return { kind: "miss" };
    }

    if (row.input_hash !== inputHash) {
      return { kind: "conflict", storedHash: row.input_hash };
    }

    if (row.response_json === PENDING_RESPONSE_JSON) {
      return { kind: "pending" };
    }

    try {
      return { kind: "replay", response: JSON.parse(row.response_json) };
    } catch {
      throw new CliError("internal_error", "Stored idempotency response is corrupt.");
    }
  }

  reserve(idempotencyKey: string, commandName: string, inputHash: string): IdempotencyReservation {
    const insertResult = this.db
      .prepare(
        `INSERT OR IGNORE INTO idempotency_records (idempotency_key, command_name, input_hash, response_json, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
      )
      .run(idempotencyKey, commandName, inputHash, PENDING_RESPONSE_JSON);

    if (insertResult.changes === 1) {
      return { kind: "execute" };
    }

    const existing = this.lookup(idempotencyKey, commandName, inputHash);
    if (existing.kind === "miss") {
      // Row can disappear if an owner reserved and then released due to failure.
      // Retry claim once and fallback to pending if another owner wins concurrently.
      const retryInsert = this.db
        .prepare(
          `INSERT OR IGNORE INTO idempotency_records (idempotency_key, command_name, input_hash, response_json, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))`,
        )
        .run(idempotencyKey, commandName, inputHash, PENDING_RESPONSE_JSON);
      if (retryInsert.changes === 1) {
        return { kind: "execute" };
      }
      return { kind: "pending" };
    }

    return existing;
  }

  complete(idempotencyKey: string, commandName: string, inputHash: string, response: unknown): void {
    const updateResult = this.db
      .prepare(
        `UPDATE idempotency_records
         SET response_json = ?, created_at = datetime('now')
         WHERE idempotency_key = ? AND command_name = ? AND input_hash = ?`,
      )
      .run(JSON.stringify(response), idempotencyKey, commandName, inputHash);

    if (updateResult.changes !== 1) {
      throw new CliError(
        "internal_error",
        "Failed to finalize idempotency record for mutation replay.",
      );
    }
  }

  release(idempotencyKey: string, commandName: string, inputHash: string): void {
    this.db
      .prepare(
        `DELETE FROM idempotency_records
         WHERE idempotency_key = ? AND command_name = ? AND input_hash = ? AND response_json = ?`,
      )
      .run(idempotencyKey, commandName, inputHash, PENDING_RESPONSE_JSON);
  }
}

export function buildInternalIdempotencyKey(commandName: string, requestShape: unknown): string {
  const bucket = Math.floor(Date.now() / 120000);
  const digest = hashObject({ commandName, requestShape });
  return `${commandName}:${bucket}:${digest}`;
}

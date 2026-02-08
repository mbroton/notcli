import { appendAuditLog } from "../audit/log.js";
import { CliError } from "../errors/cli-error.js";
import { buildInternalIdempotencyKey, IdempotencyStore } from "../idempotency/store.js";
import { hashObject } from "../utils/json.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeAppendAuditLog(event: Parameters<typeof appendAuditLog>[0]): Promise<void> {
  try {
    await appendAuditLog(event);
  } catch {
    // Audit logging must not alter mutation outcomes.
  }
}

export async function executeMutationWithIdempotency<T>(args: {
  commandName: string;
  requestId: string;
  requestShape: unknown;
  entity?: string;
  targetIds?: string[];
  run: () => Promise<T>;
}): Promise<T> {
  const store = new IdempotencyStore();
  const requestHash = hashObject(args.requestShape);
  const idempotencyKey = buildInternalIdempotencyKey(args.commandName, args.requestShape);
  let ownsReservation = false;

  try {
    let lookup = store.reserve(idempotencyKey, args.commandName, requestHash);

    while (lookup.kind === "pending") {
      const deadline = Date.now() + 15000;
      let resolved = false;

      while (Date.now() < deadline) {
        await sleep(50);
        const current = store.lookup(idempotencyKey, args.commandName, requestHash);
        if (current.kind === "pending") {
          continue;
        }
        if (current.kind === "miss") {
          lookup = store.reserve(idempotencyKey, args.commandName, requestHash);
          resolved = true;
          break;
        }
        lookup = current;
        resolved = true;
        break;
      }

      if (resolved) {
        break;
      }

      lookup = store.reserve(idempotencyKey, args.commandName, requestHash);
      if (lookup.kind === "pending") {
        throw new CliError(
          "retryable_upstream",
          "A matching mutation is already in progress. Retry this request shortly.",
          { retryable: true },
        );
      }
    }

    if (lookup.kind === "conflict") {
      throw new CliError("idempotency_key_conflict", "Internal idempotency key collision.", {
        details: {
          command: args.commandName,
          stored_hash: lookup.storedHash,
          incoming_hash: requestHash,
        },
      });
    }

    if (lookup.kind === "replay") {
      await safeAppendAuditLog({
        command: args.commandName,
        entity: args.entity,
        request_id: args.requestId,
        idempotency_key: idempotencyKey,
        target_ids: args.targetIds,
        ok: true,
        timestamp: new Date().toISOString(),
      });
      return lookup.response as T;
    }

    ownsReservation = true;

    const response = await args.run();
    store.complete(idempotencyKey, args.commandName, requestHash, response);

    await safeAppendAuditLog({
      command: args.commandName,
      entity: args.entity,
      request_id: args.requestId,
      idempotency_key: idempotencyKey,
      target_ids: args.targetIds,
      ok: true,
      timestamp: new Date().toISOString(),
    });

    return response;
  } catch (error) {
    if (ownsReservation) {
      store.release(idempotencyKey, args.commandName, requestHash);
    }

    await safeAppendAuditLog({
      command: args.commandName,
      entity: args.entity,
      request_id: args.requestId,
      idempotency_key: idempotencyKey,
      target_ids: args.targetIds,
      ok: false,
      timestamp: new Date().toISOString(),
    });
    throw error;
  } finally {
    store.close();
  }
}

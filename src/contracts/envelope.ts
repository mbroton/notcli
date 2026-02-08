import { randomUUID } from "node:crypto";
import { CliError, toCliError } from "../errors/cli-error.js";
import { EXIT_CODE_BY_ERROR } from "../errors/codes.js";

export interface PaginationMeta {
  has_more: boolean;
  next_cursor: string | null;
  returned: number;
}

export interface Meta {
  request_id: string;
  pagination?: PaginationMeta;
}

export interface SuccessEnvelope<T> {
  ok: true;
  data: T;
  meta: Meta;
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: unknown;
  };
  meta: Meta;
}

export function createRequestId(): string {
  return randomUUID();
}

export function successEnvelope<T>(
  data: T,
  requestId: string,
  pagination?: PaginationMeta,
): SuccessEnvelope<T> {
  return {
    ok: true,
    data,
    meta: {
      request_id: requestId,
      pagination,
    },
  };
}

export function errorEnvelope(error: unknown, requestId: string): {
  envelope: ErrorEnvelope;
  exitCode: number;
  cliError: CliError;
} {
  const cliError = toCliError(error);
  return {
    envelope: {
      ok: false,
      error: {
        code: cliError.code,
        message: cliError.message,
        retryable: cliError.retryable,
        details: cliError.details,
      },
      meta: {
        request_id: requestId,
      },
    },
    exitCode: EXIT_CODE_BY_ERROR[cliError.code],
    cliError,
  };
}

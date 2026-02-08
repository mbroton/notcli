import { ErrorCode } from "./codes.js";

export class CliError extends Error {
  public readonly code: ErrorCode;
  public readonly retryable: boolean;
  public readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { retryable?: boolean; details?: unknown },
  ) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.details = options?.details;
  }
}

function hasStatus(value: unknown): value is { status: number; body?: string } {
  return Boolean(value && typeof value === "object" && "status" in value);
}

function hasCode(value: unknown): value is { code: string; message?: string } {
  return Boolean(value && typeof value === "object" && "code" in value);
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  if (error instanceof Error && /ENOENT|not found/i.test(error.message)) {
    return new CliError("not_found", error.message);
  }

  if (hasStatus(error)) {
    if (error.status === 400) {
      return new CliError("invalid_input", "Upstream rejected the request as invalid.", {
        details: error,
      });
    }

    if (error.status === 401 || error.status === 403) {
      return new CliError(
        "auth_or_config",
        "Authentication failed. Check NOTION_API_KEY and integration permissions.",
        { details: error },
      );
    }

    if (error.status === 404) {
      return new CliError("not_found", "Requested Notion resource was not found.", {
        details: error,
      });
    }

    if (error.status === 409) {
      return new CliError("conflict", "Upstream rejected the request due to a conflict.", {
        details: error,
      });
    }

    if (error.status === 429 || error.status >= 500) {
      return new CliError("retryable_upstream", "Notion API is temporarily unavailable.", {
        retryable: true,
        details: error,
      });
    }
  }

  if (hasCode(error) && error.code === "idempotency_key_conflict") {
    return new CliError("idempotency_key_conflict", error.message ?? "Idempotency key conflict.", {
      details: error,
    });
  }

  const fallbackMessage = error instanceof Error ? error.message : "Unexpected error.";
  return new CliError("internal_error", fallbackMessage, { details: error });
}

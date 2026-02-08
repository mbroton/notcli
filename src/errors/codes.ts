export type ErrorCode =
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "retryable_upstream"
  | "auth_or_config"
  | "idempotency_key_conflict"
  | "internal_error";

export const EXIT_CODE_BY_ERROR: Record<ErrorCode, number> = {
  invalid_input: 2,
  not_found: 3,
  conflict: 4,
  retryable_upstream: 5,
  auth_or_config: 6,
  idempotency_key_conflict: 4,
  internal_error: 1,
};

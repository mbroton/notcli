import {
  ErrorEnvelope,
  PaginationMeta,
  SuccessEnvelope,
  createRequestId,
  errorEnvelope,
  successEnvelope,
} from "../contracts/envelope.js";

export interface ActionResult<T> {
  data: T;
  pagination?: PaginationMeta;
}

export function printEnvelope(
  envelope: SuccessEnvelope<unknown> | ErrorEnvelope,
  pretty: boolean,
  stream: "stdout" | "stderr",
): void {
  const payload = pretty ? JSON.stringify(envelope, null, 2) : JSON.stringify(envelope);
  if (stream === "stdout") {
    process.stdout.write(`${payload}\n`);
    return;
  }
  process.stderr.write(`${payload}\n`);
}

export async function runAction<T>(
  pretty: boolean,
  action: (requestId: string) => Promise<ActionResult<T>>,
): Promise<void> {
  const requestId = createRequestId();

  try {
    const { data, pagination } = await action(requestId);
    const envelope = successEnvelope(data, requestId, pagination);
    printEnvelope(envelope, pretty, "stdout");
  } catch (error) {
    const { envelope, exitCode } = errorEnvelope(error, requestId);
    printEnvelope(envelope, pretty, "stderr");
    process.exitCode = exitCode;
  }
}

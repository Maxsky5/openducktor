import { z } from "zod";

const TIMEOUT_ERROR_NAMES = new Set(["TimeoutError"]);
const TIMEOUT_ERROR_CODES = new Set([
  "ABORT_ERR",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

const runtimeFailureSchema = z
  .object({
    cause: z.unknown().optional(),
    code: z.unknown().optional(),
    details: z.unknown().optional(),
    name: z.unknown().optional(),
  })
  .passthrough();
type RuntimeFailure = z.output<typeof runtimeFailureSchema>;
const failureDetailsSchema = z.object({ failureKind: z.string() }).passthrough();

const isRuntimeFailure = (cause: unknown): cause is RuntimeFailure =>
  runtimeFailureSchema.safeParse(cause).success;

const readStringField = (cause: unknown, field: "code" | "name"): string | null => {
  if (!isRuntimeFailure(cause)) return null;
  const parsed = z.string().safeParse(cause[field]);
  return parsed.success ? parsed.data : null;
};

const readFailureKind = (cause: unknown): string | null => {
  if (!isRuntimeFailure(cause)) return null;
  const parsed = failureDetailsSchema.safeParse(cause.details);
  return parsed.success ? parsed.data.failureKind : null;
};

export const isTimeoutError = (cause: unknown): boolean => {
  const visited = new WeakSet<RuntimeFailure>();
  let current: unknown = cause;
  while (isRuntimeFailure(current)) {
    if (visited.has(current)) return false;
    visited.add(current);
    if (readFailureKind(current) === "timeout") return true;
    const name = readStringField(current, "name");
    if (name && TIMEOUT_ERROR_NAMES.has(name)) return true;
    const code = readStringField(current, "code");
    if (code && TIMEOUT_ERROR_CODES.has(code)) return true;
    current = current.cause;
  }
  return false;
};

const TIMEOUT_ERROR_NAMES = new Set(["TimeoutError"]);
const TIMEOUT_ERROR_CODES = new Set([
  "ABORT_ERR",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

interface RuntimeFailure {
  cause?: unknown;
  code?: unknown;
  details?: unknown;
  name?: unknown;
}

const isRuntimeFailure = (cause: unknown): cause is RuntimeFailure =>
  typeof cause === "object" && cause !== null;

const readStringField = (cause: unknown, field: "code" | "name"): string | null => {
  if (!isRuntimeFailure(cause)) return null;
  const value = cause[field];
  return typeof value === "string" ? value : null;
};

const readFailureKind = (cause: unknown): string | null => {
  if (!isRuntimeFailure(cause)) return null;
  const { details } = cause;
  if (!(typeof details === "object") || details === null || !("failureKind" in details))
    return null;
  return typeof details.failureKind === "string" ? details.failureKind : null;
};

export const isTimeoutError = (cause: unknown): boolean => {
  const visited = new WeakSet<RuntimeFailure>();
  let current = cause;
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

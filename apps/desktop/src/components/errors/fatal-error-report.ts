export interface FatalErrorReport {
  title: string;
  message: string;
  /** Present only when the original caught value carried a stack trace. */
  stack: string | undefined;
  source: "boundary" | "error" | "unhandledrejection";
  /** ISO-8601 timestamp. */
  timestamp: string;
}

/**
 * Duck-type check for PromiseRejectionEvent since the constructor is not
 * available in every JS runtime (e.g. Bun).
 */
function isPromiseRejectionLike(value: unknown): value is Event & { reason: unknown } {
  return (
    typeof Event !== "undefined" &&
    value instanceof Event &&
    value.type === "unhandledrejection" &&
    "reason" in value
  );
}

export function buildFatalErrorReport(
  value: unknown,
  source: FatalErrorReport["source"],
): FatalErrorReport {
  const timestamp = new Date().toISOString();

  if (value instanceof ErrorEvent) {
    const inner = value.error;
    if (inner instanceof Error) {
      return {
        title: inner.name || "Error",
        message: inner.message,
        stack: inner.stack,
        source,
        timestamp,
      };
    }
    return {
      title: "Uncaught error",
      message: value.message || String(inner ?? value),
      stack: undefined,
      source,
      timestamp,
    };
  }

  if (isPromiseRejectionLike(value)) {
    const reason = value.reason;
    if (reason instanceof Error) {
      return {
        title: reason.name || "Unhandled rejection",
        message: reason.message,
        stack: reason.stack,
        source,
        timestamp,
      };
    }
    return {
      title: "Unhandled promise rejection",
      message: typeof reason === "string" ? reason : safeStringify(reason),
      stack: undefined,
      source,
      timestamp,
    };
  }

  if (value instanceof Error) {
    return {
      title: value.name || "Error",
      message: value.message,
      stack: value.stack,
      source,
      timestamp,
    };
  }

  if (typeof value === "string") {
    return { title: "Error", message: value, stack: undefined, source, timestamp };
  }

  return {
    title: "Unknown error",
    message: safeStringify(value),
    stack: undefined,
    source,
    timestamp,
  };
}

function safeStringify(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" ? json : String(value);
  } catch {
    return String(value);
  }
}

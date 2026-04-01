export interface FatalErrorReport {
  title: string;
  message: string;
  /** Present only when the original caught value carried a stack trace. */
  stack: string | undefined;
  componentStack?: string;
  location?: string;
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
    const location = formatErrorLocation(value);
    if (inner instanceof Error) {
      return {
        title: inner.name || "Error",
        message: inner.message,
        stack: inner.stack,
        ...(location ? { location } : {}),
        source,
        timestamp,
      };
    }
    return {
      title: "Uncaught error",
      message: value.message || String(inner ?? value),
      stack: undefined,
      ...(location ? { location } : {}),
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

/**
 * Centralized fatal-error logger.
 *
 * Emits a structured `console.error` with the normalized report metadata,
 * the **original raw thrown value / event** (so devtools can inspect the live
 * object), and an optional React component stack when available.
 */
export function logFatalError(
  report: FatalErrorReport,
  rawValue: unknown,
  componentStack?: string,
): void {
  const context: Record<string, unknown> = {
    source: report.source,
    timestamp: report.timestamp,
    rawValue,
  };
  if (report.location) {
    context.location = report.location;
  }
  if (componentStack) {
    context.componentStack = componentStack;
  }

  console.error(
    `[AppCrashShell] Fatal error (${report.source}):`,
    report.title,
    "-",
    report.message,
    context,
  );
}

function formatErrorLocation(event: ErrorEvent): string | undefined {
  const line = event.lineno > 0 ? event.lineno : null;
  const column = event.colno > 0 ? event.colno : null;

  if (event.filename) {
    if (line === null) {
      return event.filename;
    }
    if (column === null) {
      return `${event.filename}:${line}`;
    }
    return `${event.filename}:${line}:${column}`;
  }

  if (line === null) {
    return undefined;
  }

  if (column === null) {
    return `line ${line}`;
  }

  return `line ${line}, column ${column}`;
}

function safeStringify(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" ? json : String(value);
  } catch {
    return String(value);
  }
}

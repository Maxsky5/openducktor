import { z } from "zod";

const thrownStringSchema = z.string();

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
function isPromiseRejectionLike(cause: unknown): cause is Event & { reason: unknown } {
  const EventConstructor = globalThis.Event;
  return (
    EventConstructor !== undefined &&
    cause instanceof EventConstructor &&
    cause.type === "unhandledrejection" &&
    "reason" in cause
  );
}

export function buildFatalErrorReport(
  cause: unknown,
  source: FatalErrorReport["source"],
): FatalErrorReport {
  const timestamp = new Date().toISOString();

  if (cause instanceof ErrorEvent) {
    const inner = cause.error;
    const location = formatErrorLocation(cause);
    if (inner instanceof Error) {
      const report: FatalErrorReport = {
        title: inner.name || "Error",
        message: inner.message,
        stack: inner.stack,
        source,
        timestamp,
      };
      if (location) {
        report.location = location;
      }
      return report;
    }
    const report: FatalErrorReport = {
      title: "Uncaught error",
      message: cause.message || String(inner ?? cause),
      stack: undefined,
      source,
      timestamp,
    };
    if (location) {
      report.location = location;
    }
    return report;
  }

  if (isPromiseRejectionLike(cause)) {
    const reason = cause.reason;
    if (reason instanceof Error) {
      return {
        title: reason.name || "Unhandled rejection",
        message: reason.message,
        stack: reason.stack,
        source,
        timestamp,
      };
    }
    const parsedReason = thrownStringSchema.safeParse(reason);
    return {
      title: "Unhandled promise rejection",
      message: parsedReason.success ? parsedReason.data : safeStringify(reason),
      stack: undefined,
      source,
      timestamp,
    };
  }

  if (cause instanceof Error) {
    return {
      title: cause.name || "Error",
      message: cause.message,
      stack: cause.stack,
      source,
      timestamp,
    };
  }

  const parsedCause = thrownStringSchema.safeParse(cause);
  if (parsedCause.success) {
    return { title: "Error", message: parsedCause.data, stack: undefined, source, timestamp };
  }

  return {
    title: "Unknown error",
    message: safeStringify(cause),
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
type FatalErrorContext = {
  source: FatalErrorReport["source"];
  timestamp: string;
  rawValue: unknown;
  location?: string;
  componentStack?: string;
};

export function logFatalError(
  report: FatalErrorReport,
  cause: unknown,
  componentStack?: string,
): void {
  const context: FatalErrorContext = {
    source: report.source,
    timestamp: report.timestamp,
    rawValue: cause,
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

function safeStringify(cause: unknown): string {
  try {
    const json = JSON.stringify(cause);
    return json ?? String(cause);
  } catch {
    return String(cause);
  }
}

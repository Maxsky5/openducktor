type ResponseMetadata = {
  status?: unknown;
  statusText?: unknown;
};

export type OpenCodeRequestFailureKind = "timeout" | "error";

const TIMEOUT_STATUS_CODES = new Set([408, 504]);
const TIMEOUT_ERROR_CODES = new Set([
  "ABORT_ERR",
  "ECONNABORTED",
  "ETIMEDOUT",
  "TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

export class OpenCodeRequestError extends Error {
  readonly status?: number;
  readonly statusText?: string;
  readonly code?: string;
  readonly failureKind: OpenCodeRequestFailureKind;

  constructor(
    message: string,
    failure: {
      failureKind: OpenCodeRequestFailureKind;
      status?: number;
      statusText?: string;
      code?: string;
    },
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OpenCodeRequestError";
    this.failureKind = failure.failureKind;
    if (failure.status !== undefined) {
      this.status = failure.status;
    }
    if (failure.statusText !== undefined) {
      this.statusText = failure.statusText;
    }
    if (failure.code !== undefined) {
      this.code = failure.code;
    }
  }
}

const readUnknownProp = (value: unknown, key: string): unknown => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
};

const readStringProp = (value: unknown, key: string): string | undefined => {
  const candidate = readUnknownProp(value, key);
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined;
};

const readNumberProp = (value: unknown, key: string): number | undefined => {
  const candidate = readUnknownProp(value, key);
  return typeof candidate === "number" ? candidate : undefined;
};

const readStringPropFromSources = (sources: unknown[], key: string): string | undefined => {
  for (const source of sources) {
    const candidate = readStringProp(source, key);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
};

const readNumberPropFromSources = (sources: unknown[], key: string): number | undefined => {
  for (const source of sources) {
    const candidate = readNumberProp(source, key);
    if (candidate !== undefined) {
      return candidate;
    }
  }
  return undefined;
};

const classifyOpenCodeRequestFailureKind = (failure: {
  status: number | undefined;
  code: string | undefined;
}): OpenCodeRequestFailureKind => {
  if (typeof failure.status === "number" && TIMEOUT_STATUS_CODES.has(failure.status)) {
    return "timeout";
  }

  const normalizedCode = failure.code?.trim().toUpperCase();
  if (normalizedCode && TIMEOUT_ERROR_CODES.has(normalizedCode)) {
    return "timeout";
  }

  return "error";
};

const buildOpenCodeRequestErrorMessage = (
  action: string,
  failure: {
    message?: string;
    status?: number;
    statusText?: string;
    code?: string;
  },
): string => {
  const prefix = `OpenCode request failed: ${action}`;
  const detailParts: string[] = [];

  if (typeof failure.status === "number") {
    detailParts.push(
      failure.statusText && failure.statusText.trim().length > 0
        ? `${failure.status} ${failure.statusText}`
        : String(failure.status),
    );
  } else if (failure.statusText && failure.statusText.trim().length > 0) {
    detailParts.push(failure.statusText);
  }

  if (failure.code && failure.code.trim().length > 0) {
    detailParts.push(`code=${failure.code}`);
  }

  const base = detailParts.length > 0 ? `${prefix} (${detailParts.join(", ")})` : prefix;
  if (!failure.message || failure.message === prefix) {
    return base;
  }
  return `${base}: ${failure.message}`;
};

export const toOpenCodeRequestError = (
  action: string,
  error: unknown,
  response?: ResponseMetadata,
): OpenCodeRequestError => {
  const prefix = `OpenCode request failed: ${action}`;
  if (error instanceof Error && error.message.startsWith(prefix)) {
    return error instanceof OpenCodeRequestError
      ? error
      : new OpenCodeRequestError(
          error.message,
          {
            failureKind:
              typeof (error as { failureKind?: unknown }).failureKind === "string" &&
              ((error as { failureKind?: unknown }).failureKind === "timeout" ||
                (error as { failureKind?: unknown }).failureKind === "error")
                ? ((error as { failureKind?: unknown }).failureKind as OpenCodeRequestFailureKind)
                : "error",
          },
          { cause: error.cause },
        );
  }

  const sources = [error, readUnknownProp(error, "cause"), readUnknownProp(error, "data")];

  const message =
    (error instanceof Error && error.message.trim().length > 0 ? error.message : undefined) ??
    readStringPropFromSources(sources, "message") ??
    prefix;
  const status = readNumberPropFromSources(sources, "status");
  const statusText = readStringPropFromSources(sources, "statusText");
  const codeRaw =
    readUnknownProp(error, "code") ??
    readUnknownProp(readUnknownProp(error, "cause"), "code") ??
    readUnknownProp(readUnknownProp(error, "data"), "code");
  const code =
    typeof codeRaw === "string" || typeof codeRaw === "number" ? String(codeRaw) : undefined;
  const resolvedStatus =
    typeof status === "number"
      ? status
      : typeof response?.status === "number"
        ? response.status
        : undefined;
  const resolvedStatusText =
    statusText ??
    (typeof response?.statusText === "string" && response.statusText.trim().length > 0
      ? response.statusText
      : undefined);

  return new OpenCodeRequestError(
    buildOpenCodeRequestErrorMessage(action, {
      message,
      ...(resolvedStatus !== undefined ? { status: resolvedStatus } : {}),
      ...(resolvedStatusText ? { statusText: resolvedStatusText } : {}),
      ...(code ? { code } : {}),
    }),
    {
      failureKind: classifyOpenCodeRequestFailureKind({
        status: resolvedStatus,
        code,
      }),
      ...(resolvedStatus !== undefined ? { status: resolvedStatus } : {}),
      ...(resolvedStatusText ? { statusText: resolvedStatusText } : {}),
      ...(code ? { code } : {}),
    },
    error instanceof Error ? { cause: error } : undefined,
  );
};

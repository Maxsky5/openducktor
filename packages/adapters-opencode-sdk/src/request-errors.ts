type ResponseMetadata = {
  status?: unknown;
  statusText?: unknown;
};

export type OpenCodeRequestFailureKind = "timeout" | "error";

type OpenCodeRequestErrorInit = {
  failureKind: OpenCodeRequestFailureKind;
  status?: number;
  statusText?: string;
  code?: string;
};

type NormalizedRequestFailure = OpenCodeRequestErrorInit & {
  message: string;
  cause?: unknown;
  hasPrefixedMessage: boolean;
};

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

  constructor(message: string, failure: OpenCodeRequestErrorInit, options?: ErrorOptions) {
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

const readCodeProp = (value: unknown, key: string): string | undefined => {
  const candidate = readUnknownProp(value, key);
  return typeof candidate === "string" || typeof candidate === "number"
    ? String(candidate)
    : undefined;
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

const readCodePropFromSources = (sources: unknown[], key: string): string | undefined => {
  for (const source of sources) {
    const candidate = readCodeProp(source, key);
    if (candidate !== undefined) {
      return candidate;
    }
  }
  return undefined;
};

const readFailureKind = (value: unknown): OpenCodeRequestFailureKind | undefined => {
  const candidate = readUnknownProp(value, "failureKind");
  return candidate === "timeout" || candidate === "error" ? candidate : undefined;
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

const buildFailureSources = (error: unknown): unknown[] => {
  return [error, readUnknownProp(error, "cause"), readUnknownProp(error, "data")];
};

const extractRequestFailure = (
  action: string,
  error: unknown,
  response?: ResponseMetadata,
): NormalizedRequestFailure => {
  const prefix = `OpenCode request failed: ${action}`;

  if (error instanceof OpenCodeRequestError) {
    return {
      message: error.message,
      failureKind: error.failureKind,
      hasPrefixedMessage: true,
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.statusText !== undefined ? { statusText: error.statusText } : {}),
      ...(error.code !== undefined ? { code: error.code } : {}),
      ...(error.cause !== undefined ? { cause: error.cause } : {}),
    };
  }

  const sources = buildFailureSources(error);
  const status = readNumberPropFromSources(sources, "status");
  const statusText = readStringPropFromSources(sources, "statusText");
  const code = readCodePropFromSources(sources, "code");
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

  if (error instanceof Error && error.message.startsWith(prefix)) {
    return {
      message: error.message,
      failureKind:
        readFailureKind(error) ??
        classifyOpenCodeRequestFailureKind({
          status: resolvedStatus,
          code,
        }),
      hasPrefixedMessage: true,
      ...(resolvedStatus !== undefined ? { status: resolvedStatus } : {}),
      ...(resolvedStatusText !== undefined ? { statusText: resolvedStatusText } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(error.cause !== undefined ? { cause: error.cause } : {}),
    };
  }

  const message =
    (error instanceof Error && error.message.trim().length > 0 ? error.message : undefined) ??
    readStringPropFromSources(sources, "message") ??
    prefix;

  return {
    message,
    failureKind: classifyOpenCodeRequestFailureKind({
      status: resolvedStatus,
      code,
    }),
    hasPrefixedMessage: false,
    ...(resolvedStatus !== undefined ? { status: resolvedStatus } : {}),
    ...(resolvedStatusText !== undefined ? { statusText: resolvedStatusText } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(error instanceof Error ? { cause: error } : {}),
  };
};

export const toOpenCodeRequestError = (
  action: string,
  error: unknown,
  response?: ResponseMetadata,
): OpenCodeRequestError => {
  const failure = extractRequestFailure(action, error, response);

  return new OpenCodeRequestError(
    failure.hasPrefixedMessage
      ? failure.message
      : buildOpenCodeRequestErrorMessage(action, {
          message: failure.message,
          ...(failure.status !== undefined ? { status: failure.status } : {}),
          ...(failure.statusText !== undefined ? { statusText: failure.statusText } : {}),
          ...(failure.code !== undefined ? { code: failure.code } : {}),
        }),
    {
      failureKind: failure.failureKind,
      ...(failure.status !== undefined ? { status: failure.status } : {}),
      ...(failure.statusText !== undefined ? { statusText: failure.statusText } : {}),
      ...(failure.code !== undefined ? { code: failure.code } : {}),
    },
    failure.cause !== undefined ? { cause: failure.cause } : undefined,
  );
};

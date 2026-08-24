import { type FailureKind, failureKindSchema } from "@openducktor/contracts";

type ResponseMetadata = {
  status?: unknown;
  statusText?: unknown;
};

export type OpenCodeRequestFailureKind = FailureKind;

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

type RequestFailureProperties = {
  cause?: unknown;
  code?: unknown;
  data?: unknown;
  failureKind?: unknown;
  message?: unknown;
  status?: unknown;
  statusText?: unknown;
};

const isRequestFailureRecord = (cause: unknown): cause is RequestFailureProperties =>
  typeof cause === "object" && cause !== null && !Array.isArray(cause);

const readStringProp = (
  cause: unknown,
  key: keyof RequestFailureProperties,
): string | undefined => {
  if (!isRequestFailureRecord(cause)) return undefined;
  const candidate = cause[key];
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined;
};

const readNumberProp = (
  cause: unknown,
  key: keyof RequestFailureProperties,
): number | undefined => {
  if (!isRequestFailureRecord(cause)) return undefined;
  const candidate = cause[key];
  return typeof candidate === "number" ? candidate : undefined;
};

const readCodeProp = (cause: unknown, key: keyof RequestFailureProperties): string | undefined => {
  if (!isRequestFailureRecord(cause)) return undefined;
  const candidate = cause[key];
  return typeof candidate === "string" || typeof candidate === "number"
    ? String(candidate)
    : undefined;
};

const readStringPropFromSources = (
  sources: unknown[],
  key: keyof RequestFailureProperties,
): string | undefined => {
  for (const source of sources) {
    const candidate = readStringProp(source, key);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
};

const readNumberPropFromSources = (
  sources: unknown[],
  key: keyof RequestFailureProperties,
): number | undefined => {
  for (const source of sources) {
    const candidate = readNumberProp(source, key);
    if (candidate !== undefined) {
      return candidate;
    }
  }
  return undefined;
};

const readCodePropFromSources = (
  sources: unknown[],
  key: keyof RequestFailureProperties,
): string | undefined => {
  for (const source of sources) {
    const candidate = readCodeProp(source, key);
    if (candidate !== undefined) {
      return candidate;
    }
  }
  return undefined;
};

const readFailureKind = (cause: unknown): OpenCodeRequestFailureKind | undefined => {
  if (!isRequestFailureRecord(cause)) return undefined;
  const candidate = cause.failureKind;
  const result = failureKindSchema.safeParse(candidate);
  return result.success ? result.data : undefined;
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

const buildFailureSources = (cause: unknown): unknown[] => {
  return isRequestFailureRecord(cause) ? [cause, cause.cause, cause.data] : [cause];
};

const extractRequestFailure = (
  action: string,
  cause: unknown,
  response?: ResponseMetadata,
): NormalizedRequestFailure => {
  const prefix = `OpenCode request failed: ${action}`;

  if (cause instanceof OpenCodeRequestError) {
    return {
      message: cause.message,
      failureKind: cause.failureKind,
      hasPrefixedMessage: true,
      ...(cause.status !== undefined ? { status: cause.status } : undefined),
      ...(cause.statusText !== undefined ? { statusText: cause.statusText } : undefined),
      ...(cause.code !== undefined ? { code: cause.code } : undefined),
      ...(cause.cause !== undefined ? { cause: cause.cause } : undefined),
    };
  }

  const sources = buildFailureSources(cause);
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

  if (cause instanceof Error && cause.message.startsWith(prefix)) {
    return {
      message: cause.message,
      failureKind:
        readFailureKind(cause) ??
        classifyOpenCodeRequestFailureKind({
          status: resolvedStatus,
          code,
        }),
      hasPrefixedMessage: true,
      ...(resolvedStatus !== undefined ? { status: resolvedStatus } : undefined),
      ...(resolvedStatusText !== undefined ? { statusText: resolvedStatusText } : undefined),
      ...(code !== undefined ? { code } : undefined),
      ...(cause.cause !== undefined ? { cause: cause.cause } : undefined),
    };
  }

  const message =
    (cause instanceof Error && cause.message.trim().length > 0 ? cause.message : undefined) ??
    readStringPropFromSources(sources, "message") ??
    prefix;

  return {
    message,
    failureKind: classifyOpenCodeRequestFailureKind({
      status: resolvedStatus,
      code,
    }),
    hasPrefixedMessage: false,
    ...(resolvedStatus !== undefined ? { status: resolvedStatus } : undefined),
    ...(resolvedStatusText !== undefined ? { statusText: resolvedStatusText } : undefined),
    ...(code !== undefined ? { code } : undefined),
    ...(cause instanceof Error ? { cause } : undefined),
  };
};

export const toOpenCodeRequestError = (
  action: string,
  cause: unknown,
  response?: ResponseMetadata,
): OpenCodeRequestError => {
  const failure = extractRequestFailure(action, cause, response);

  return new OpenCodeRequestError(
    failure.hasPrefixedMessage
      ? failure.message
      : buildOpenCodeRequestErrorMessage(action, {
          message: failure.message,
          ...(failure.status !== undefined ? { status: failure.status } : undefined),
          ...(failure.statusText !== undefined ? { statusText: failure.statusText } : undefined),
          ...(failure.code !== undefined ? { code: failure.code } : undefined),
        }),
    {
      failureKind: failure.failureKind,
      ...(failure.status !== undefined ? { status: failure.status } : undefined),
      ...(failure.statusText !== undefined ? { statusText: failure.statusText } : undefined),
      ...(failure.code !== undefined ? { code: failure.code } : undefined),
    },
    failure.cause !== undefined ? { cause: failure.cause } : undefined,
  );
};

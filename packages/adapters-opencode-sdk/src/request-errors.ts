import { type FailureKind, failureKindSchema, hasRuntimeType } from "@openducktor/contracts";

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

const readUnknownProp = (
  cause: unknown,
  key: keyof RequestFailureProperties,
): RequestFailureProperties[keyof RequestFailureProperties] => {
  if (!isRequestFailureRecord(cause)) {
    return undefined;
  }
  return cause[key];
};

const readStringProp = (
  cause: unknown,
  key: keyof RequestFailureProperties,
): string | undefined => {
  const candidate = readUnknownProp(cause, key);
  return hasRuntimeType(candidate, "string") && candidate.trim().length > 0 ? candidate : undefined;
};

const readNumberProp = (
  cause: unknown,
  key: keyof RequestFailureProperties,
): number | undefined => {
  const candidate = readUnknownProp(cause, key);
  return hasRuntimeType(candidate, "number") ? candidate : undefined;
};

const readCodeProp = (cause: unknown, key: keyof RequestFailureProperties): string | undefined => {
  const candidate = readUnknownProp(cause, key);
  return hasRuntimeType(candidate, "string") || hasRuntimeType(candidate, "number")
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
  const candidate = readUnknownProp(cause, "failureKind");
  const result = failureKindSchema.safeParse(candidate);
  return result.success ? result.data : undefined;
};

const classifyOpenCodeRequestFailureKind = (failure: {
  status: number | undefined;
  code: string | undefined;
}): OpenCodeRequestFailureKind => {
  if (hasRuntimeType(failure.status, "number") && TIMEOUT_STATUS_CODES.has(failure.status)) {
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

  if (hasRuntimeType(failure.status, "number")) {
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
  return [cause, readUnknownProp(cause, "cause"), readUnknownProp(cause, "data")];
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
      ...(() => {
        if (cause.status !== undefined) {
          return { status: cause.status };
        }
        return {};
      })(),
      ...(() => {
        if (cause.statusText !== undefined) {
          return { statusText: cause.statusText };
        }
        return {};
      })(),
      ...(() => {
        if (cause.code !== undefined) {
          return { code: cause.code };
        }
        return {};
      })(),
      ...(() => {
        if (cause.cause !== undefined) {
          return { cause: cause.cause };
        }
        return {};
      })(),
    };
  }

  const sources = buildFailureSources(cause);
  const status = readNumberPropFromSources(sources, "status");
  const statusText = readStringPropFromSources(sources, "statusText");
  const code = readCodePropFromSources(sources, "code");
  const resolvedStatus = hasRuntimeType(status, "number")
    ? status
    : hasRuntimeType(response?.status, "number")
      ? response.status
      : undefined;
  const resolvedStatusText =
    statusText ??
    (hasRuntimeType(response?.statusText, "string") && response.statusText.trim().length > 0
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
      ...(() => {
        if (resolvedStatus !== undefined) {
          return { status: resolvedStatus };
        }
        return {};
      })(),
      ...(() => {
        if (resolvedStatusText !== undefined) {
          return { statusText: resolvedStatusText };
        }
        return {};
      })(),
      ...(() => {
        if (code !== undefined) {
          return { code };
        }
        return {};
      })(),
      ...(() => {
        if (cause.cause !== undefined) {
          return { cause: cause.cause };
        }
        return {};
      })(),
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
    ...(() => {
      if (resolvedStatus !== undefined) {
        return { status: resolvedStatus };
      }
      return {};
    })(),
    ...(() => {
      if (resolvedStatusText !== undefined) {
        return { statusText: resolvedStatusText };
      }
      return {};
    })(),
    ...(() => {
      if (code !== undefined) {
        return { code };
      }
      return {};
    })(),
    ...(() => {
      if (cause instanceof Error) {
        return { cause };
      }
      return {};
    })(),
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
          ...(() => {
            if (failure.status !== undefined) {
              return { status: failure.status };
            }
            return {};
          })(),
          ...(() => {
            if (failure.statusText !== undefined) {
              return { statusText: failure.statusText };
            }
            return {};
          })(),
          ...(() => {
            if (failure.code !== undefined) {
              return { code: failure.code };
            }
            return {};
          })(),
        }),
    {
      failureKind: failure.failureKind,
      ...(() => {
        if (failure.status !== undefined) {
          return { status: failure.status };
        }
        return {};
      })(),
      ...(() => {
        if (failure.statusText !== undefined) {
          return { statusText: failure.statusText };
        }
        return {};
      })(),
      ...(() => {
        if (failure.code !== undefined) {
          return { code: failure.code };
        }
        return {};
      })(),
    },
    failure.cause !== undefined ? { cause: failure.cause } : undefined,
  );
};

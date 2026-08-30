import { type FailureKind, failureKindSchema } from "@openducktor/contracts";
import { z } from "zod";

type ResponseMetadata = {
  status?: number;
  statusText?: string;
};

export type OpenCodeRequestFailureKind = FailureKind;

type OpenCodeRequestErrorInit = {
  failureKind: OpenCodeRequestFailureKind;
  status?: number;
  statusText?: string;
  code?: string;
};

type OpenCodeRequestMessageFailure = Pick<
  NormalizedRequestFailure,
  "message" | "status" | "statusText" | "code"
>;

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

const requestFailureSourceSchema = z.object({
  code: z.union([z.string(), z.number()]).optional(),
  failureKind: failureKindSchema.optional(),
  message: z.string().optional(),
  status: z.number().optional(),
  statusText: z.string().optional(),
});
type RequestFailureSource = z.output<typeof requestFailureSourceSchema>;
type RequestFailureProperty = keyof RequestFailureSource;

const readStringPropFromSources = (
  sources: RequestFailureSource[],
  key: RequestFailureProperty,
): string | undefined => {
  for (const source of sources) {
    const candidate = z.string().safeParse(source[key]);
    if (candidate.success && candidate.data.trim().length > 0) {
      return candidate.data;
    }
  }
  return undefined;
};

const readNumberPropFromSources = (
  sources: RequestFailureSource[],
  key: RequestFailureProperty,
): number | undefined => {
  for (const source of sources) {
    const candidate = z.number().safeParse(source[key]);
    if (candidate.success) {
      return candidate.data;
    }
  }
  return undefined;
};

const readCodePropFromSources = (
  sources: RequestFailureSource[],
  key: RequestFailureProperty,
): string | undefined => {
  for (const source of sources) {
    const candidate = z.union([z.string(), z.number()]).safeParse(source[key]);
    if (candidate.success) {
      return String(candidate.data);
    }
  }
  return undefined;
};

const readFailureKind = (cause: unknown): OpenCodeRequestFailureKind | undefined => {
  const parsed = requestFailureSourceSchema.safeParse(cause);
  return parsed.success ? parsed.data.failureKind : undefined;
};

const classifyOpenCodeRequestFailureKind = (failure: {
  status: number | undefined;
  code: string | undefined;
}): OpenCodeRequestFailureKind => {
  if (failure.status !== undefined && TIMEOUT_STATUS_CODES.has(failure.status)) {
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
  failure: OpenCodeRequestMessageFailure,
): string => {
  const prefix = `OpenCode request failed: ${action}`;
  const detailParts: string[] = [];

  if (failure.status !== undefined) {
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

const buildFailureSources = (cause: unknown): RequestFailureSource[] => {
  const envelope = z
    .object({ cause: z.unknown().optional(), data: z.unknown().optional() })
    .safeParse(cause);
  const candidates = envelope.success ? [cause, envelope.data.cause, envelope.data.data] : [cause];
  return candidates.flatMap((candidate) => {
    const parsed = requestFailureSourceSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
};

const extractRequestFailure = (
  action: string,
  cause: unknown,
  response?: ResponseMetadata,
): NormalizedRequestFailure => {
  const prefix = `OpenCode request failed: ${action}`;

  if (cause instanceof OpenCodeRequestError) {
    const failure: NormalizedRequestFailure = {
      message: cause.message,
      failureKind: cause.failureKind,
      hasPrefixedMessage: true,
    };
    if (cause.status !== undefined) failure.status = cause.status;
    if (cause.statusText !== undefined) failure.statusText = cause.statusText;
    if (cause.code !== undefined) failure.code = cause.code;
    if (cause.cause !== undefined) failure.cause = cause.cause;
    return failure;
  }

  const sources = buildFailureSources(cause);
  const status = readNumberPropFromSources(sources, "status");
  const statusText = readStringPropFromSources(sources, "statusText");
  const code = readCodePropFromSources(sources, "code");
  const resolvedStatus = status ?? response?.status;
  const resolvedStatusText =
    statusText ?? (response?.statusText?.trim() ? response.statusText : undefined);

  if (cause instanceof Error && cause.message.startsWith(prefix)) {
    const failure: NormalizedRequestFailure = {
      message: cause.message,
      failureKind:
        readFailureKind(cause) ??
        classifyOpenCodeRequestFailureKind({
          status: resolvedStatus,
          code,
        }),
      hasPrefixedMessage: true,
    };
    if (resolvedStatus !== undefined) failure.status = resolvedStatus;
    if (resolvedStatusText !== undefined) failure.statusText = resolvedStatusText;
    if (code !== undefined) failure.code = code;
    if (cause.cause !== undefined) failure.cause = cause.cause;
    return failure;
  }

  const message =
    (cause instanceof Error && cause.message.trim().length > 0 ? cause.message : undefined) ??
    readStringPropFromSources(sources, "message") ??
    prefix;

  const failure: NormalizedRequestFailure = {
    message,
    failureKind: classifyOpenCodeRequestFailureKind({
      status: resolvedStatus,
      code,
    }),
    hasPrefixedMessage: false,
  };
  if (resolvedStatus !== undefined) failure.status = resolvedStatus;
  if (resolvedStatusText !== undefined) failure.statusText = resolvedStatusText;
  if (code !== undefined) failure.code = code;
  if (cause instanceof Error) failure.cause = cause;
  return failure;
};

export const toOpenCodeRequestError = (
  action: string,
  cause: unknown,
  response?: ResponseMetadata,
): OpenCodeRequestError => {
  const failure = extractRequestFailure(action, cause, response);
  const messageFailure: OpenCodeRequestMessageFailure = { message: failure.message };
  if (failure.status !== undefined) messageFailure.status = failure.status;
  if (failure.statusText !== undefined) messageFailure.statusText = failure.statusText;
  if (failure.code !== undefined) messageFailure.code = failure.code;
  const errorInit: OpenCodeRequestErrorInit = { failureKind: failure.failureKind };
  if (failure.status !== undefined) errorInit.status = failure.status;
  if (failure.statusText !== undefined) errorInit.statusText = failure.statusText;
  if (failure.code !== undefined) errorInit.code = failure.code;

  return new OpenCodeRequestError(
    failure.hasPrefixedMessage
      ? failure.message
      : buildOpenCodeRequestErrorMessage(action, messageFailure),
    errorInit,
    failure.cause !== undefined ? { cause: failure.cause } : undefined,
  );
};

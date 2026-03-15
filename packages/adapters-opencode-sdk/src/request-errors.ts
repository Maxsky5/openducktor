type ResponseMetadata = {
  status?: unknown;
  statusText?: unknown;
};

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
): Error => {
  const prefix = `OpenCode request failed: ${action}`;
  if (error instanceof Error && error.message.startsWith(prefix)) {
    return error;
  }

  const message =
    (error instanceof Error && error.message.trim().length > 0 ? error.message : undefined) ??
    readStringProp(error, "message") ??
    readStringProp(readUnknownProp(error, "data"), "message") ??
    prefix;
  const status = readNumberProp(error, "status");
  const statusText = readStringProp(error, "statusText");
  const codeRaw = readUnknownProp(error, "code");
  const code =
    typeof codeRaw === "string" || typeof codeRaw === "number" ? String(codeRaw) : undefined;

  return new Error(
    buildOpenCodeRequestErrorMessage(action, {
      message,
      ...(typeof status === "number"
        ? { status }
        : typeof response?.status === "number"
          ? { status: response.status }
          : {}),
      ...(statusText
        ? { statusText }
        : typeof response?.statusText === "string" && response.statusText.trim().length > 0
          ? { statusText: response.statusText }
          : {}),
      ...(code ? { code } : {}),
    }),
    error instanceof Error ? { cause: error } : undefined,
  );
};

import type { CodexAppServerRequestId } from "@openducktor/contracts";

const CODEX_SERVER_REQUEST_ID_METADATA_KEY = "codexServerRequestId";
const STRING_CODEX_SERVER_REQUEST_KEY_PREFIX = "codex-string-id:";

export const codexServerRequestIdMetadata = (
  requestId: CodexAppServerRequestId,
): Record<string, CodexAppServerRequestId> => ({
  [CODEX_SERVER_REQUEST_ID_METADATA_KEY]: requestId,
});

export const codexServerRequestKey = (requestId: CodexAppServerRequestId): string => {
  if (typeof requestId === "number") {
    return String(requestId);
  }
  if (/^\d+$/.test(requestId) || requestId.startsWith(STRING_CODEX_SERVER_REQUEST_KEY_PREFIX)) {
    return `${STRING_CODEX_SERVER_REQUEST_KEY_PREFIX}${requestId}`;
  }
  return requestId;
};

const requireCodexServerRequestId = (
  requestId: string,
  requestType: string,
): CodexAppServerRequestId => {
  const trimmed = requestId.trim();
  if (trimmed.length === 0) {
    throw new Error(`Codex ${requestType} request id must not be empty.`);
  }

  if (trimmed.startsWith(STRING_CODEX_SERVER_REQUEST_KEY_PREFIX)) {
    return trimmed.slice(STRING_CODEX_SERVER_REQUEST_KEY_PREFIX.length);
  }

  if (!/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(
      `Codex ${requestType} request id '${requestId}' exceeds the safe integer range.`,
    );
  }

  return parsed;
};

export const requireCodexPendingRequestKey = (requestId: string, requestType: string): void => {
  if (requestId.trim().length === 0) {
    throw new Error(`Codex ${requestType} request id must not be empty.`);
  }
};

export const requireCodexServerResponseRequestId = (
  requestId: string,
  metadata: Record<string, unknown>,
  requestType: string,
): CodexAppServerRequestId => {
  const metadataRequestId = metadata[CODEX_SERVER_REQUEST_ID_METADATA_KEY];
  if (typeof metadataRequestId === "string" || typeof metadataRequestId === "number") {
    return metadataRequestId;
  }
  return requireCodexServerRequestId(requestId, requestType);
};

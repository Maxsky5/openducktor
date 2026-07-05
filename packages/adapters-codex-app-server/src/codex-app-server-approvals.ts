import type { CodexAppServerRequestId } from "@openducktor/contracts";

const CODEX_SERVER_REQUEST_ID_METADATA_KEY = "codexServerRequestId";

export const codexServerRequestIdMetadata = (
  requestId: CodexAppServerRequestId,
): Record<string, CodexAppServerRequestId> => ({
  [CODEX_SERVER_REQUEST_ID_METADATA_KEY]: requestId,
});

const requireCodexServerRequestId = (
  requestId: string,
  requestType: string,
): CodexAppServerRequestId => {
  const trimmed = requestId.trim();
  if (trimmed.length === 0) {
    throw new Error(`Codex ${requestType} request id must not be empty.`);
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

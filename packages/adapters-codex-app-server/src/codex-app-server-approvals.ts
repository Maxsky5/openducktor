import type { CodexAppServerRequestId } from "@openducktor/contracts";

const STRING_CODEX_SERVER_REQUEST_KEY_PREFIX = "codex-string-id:";

export const codexServerRequestKey = (requestId: CodexAppServerRequestId): string => {
  if (typeof requestId === "number") {
    return String(requestId);
  }
  if (/^\d+$/.test(requestId) || requestId.startsWith(STRING_CODEX_SERVER_REQUEST_KEY_PREFIX)) {
    return `${STRING_CODEX_SERVER_REQUEST_KEY_PREFIX}${requestId}`;
  }
  return requestId;
};

export const requireCodexPendingRequestKey = (requestId: string, requestType: string): void => {
  if (requestId.trim().length === 0) {
    throw new Error(`Codex ${requestType} request id must not be empty.`);
  }
};

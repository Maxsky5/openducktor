import type { CodexAppServerRequestId } from "@openducktor/contracts";

export const requireCodexServerRequestId = (
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

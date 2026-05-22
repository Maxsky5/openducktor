export const requireCodexServerRequestId = (requestId: string, requestType: string): number => {
  const trimmed = requestId.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Codex ${requestType} request id '${requestId}' must be numeric.`);
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(
      `Codex ${requestType} request id '${requestId}' exceeds the safe integer range.`,
    );
  }

  return parsed;
};

import type { CodexAppServerRequestId } from "@openducktor/contracts";
import { z } from "zod";

const STRING_CODEX_SERVER_REQUEST_KEY_PREFIX = "codex-string-id:";
const codexRequestIdNumberSchema = z.number();

export const codexServerRequestKey = (requestId: CodexAppServerRequestId): string => {
  const parsedNumber = codexRequestIdNumberSchema.safeParse(requestId);
  if (parsedNumber.success) {
    return String(parsedNumber.data);
  }
  const requestIdText = z.string().parse(requestId);
  if (
    /^\d+$/.test(requestIdText) ||
    requestIdText.startsWith(STRING_CODEX_SERVER_REQUEST_KEY_PREFIX)
  ) {
    return `${STRING_CODEX_SERVER_REQUEST_KEY_PREFIX}${requestIdText}`;
  }
  return requestIdText;
};

export const requireCodexPendingRequestKey = (requestId: string, requestType: string): void => {
  if (requestId.trim().length === 0) {
    throw new Error(`Codex ${requestType} request id must not be empty.`);
  }
};

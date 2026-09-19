import type { CodexJsonRpcRequest } from "../types";

export const codexRpcRequestError = (
  method: CodexJsonRpcRequest["method"],
  code: number,
  message: string,
): Error =>
  Object.assign(new Error(`Codex app-server request ${method} failed: ${message}`), {
    cause: { code, message },
    details: { method },
  });

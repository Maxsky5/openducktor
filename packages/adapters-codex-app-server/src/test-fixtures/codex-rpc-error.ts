import type { CodexJsonRpcRequest } from "../types";

export const EMPTY_ROLLOUT_MESSAGE =
  "failed to read thread: thread-store internal error: failed to read thread /repo/rollout.jsonl: rollout at /repo/rollout.jsonl is empty";

export const NESTED_EMPTY_ROLLOUT_MESSAGE =
  "failed to read thread: thread-store internal error: failed to read session metadata /repo/rollout.jsonl: thread-store internal error: failed to read session metadata /repo/rollout.jsonl: rollout at /repo/rollout.jsonl is empty";

export const codexRpcRequestError = (
  method: CodexJsonRpcRequest["method"],
  code: number,
  message: string,
): Error =>
  Object.assign(new Error(`Codex app-server request ${method} failed: ${message}`), {
    cause: { code, message },
    details: { method },
  });

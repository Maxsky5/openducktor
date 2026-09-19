import type { CodexJsonRpcRequest } from "@openducktor/adapters-codex-app-server";
import { AgentRuntimeQueryError } from "@openducktor/core";
import { Effect, Exit } from "effect";
import {
  causeToHostBoundaryError,
  HostOperationError,
  HostResourceError,
} from "../../effect/host-errors";
import type {
  CodexAppServerPort,
  CodexAppServerError,
  CodexAppServerRequestResult,
} from "../../ports/codex-app-server-port";
import type { CodexSessionHistoryError } from "../../ports/codex-session-history-error";
import type { CodexSessionHistoryPort } from "../../ports/codex-session-history-port";

const TRANSPORT_LOSS_OPERATIONS = new Set([
  "codexAppServerTransport.ensureOpen",
  "codexAppServerTransport.childProcess",
  "codexAppServerTransport.sendMessage",
  "codexAppServerTransport.close",
  "codexAppServerTransport.rejectPendingRequestsForShutdown",
]);

const RUNTIME_UNAVAILABLE_MESSAGE =
  "The Codex runtime is not reachable. Start the runtime and retry.";

/**
 * A transport-loss failure means the request never reached a live runtime.
 * Pending requests wrap that failure with the request operation, so inspect
 * the cause chain. RPC errors and request timeouts keep the transport alive
 * and stay isolated to the caller.
 */
const isTransportLoss = (cause: unknown): boolean => {
  const visited = new Set<unknown>();
  let current: unknown = cause;
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    if (current instanceof HostResourceError) {
      if (current.resource === "codexAppServerTransport") {
        return true;
      }
    } else if (
      current instanceof HostOperationError &&
      TRANSPORT_LOSS_OPERATIONS.has(current.operation)
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
};

export const createCodexRuntimeTransport = (
  port: CodexAppServerPort & CodexSessionHistoryPort,
  runtimeId: string,
) => ({
  request: async (request: CodexJsonRpcRequest) => {
    const operation: Effect.Effect<
      CodexAppServerRequestResult,
      CodexAppServerError | CodexSessionHistoryError
    > =
      request.method === "thread/turns/list"
        ? port.listThreadTurns({ runtimeId, ...request.params })
        : port.request({ runtimeId, ...request });
    const exit = await Effect.runPromiseExit(operation);
    if (Exit.isSuccess(exit)) return exit.value;
    const error = causeToHostBoundaryError(exit.cause);
    if (isTransportLoss(error)) {
      throw new AgentRuntimeQueryError("runtime_unavailable", RUNTIME_UNAVAILABLE_MESSAGE);
    }
    throw error;
  },
});

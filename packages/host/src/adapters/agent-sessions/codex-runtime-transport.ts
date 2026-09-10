import type { CodexJsonRpcRequest } from "@openducktor/adapters-codex-app-server";
import { Effect, Exit } from "effect";
import { causeToHostBoundaryError } from "../../effect/host-errors";
import type {
  CodexAppServerPort,
  CodexAppServerError,
  CodexAppServerRequestResult,
} from "../../ports/codex-app-server-port";
import type { CodexSessionHistoryError } from "../../ports/codex-session-history-error";
import type { CodexSessionHistoryPort } from "../../ports/codex-session-history-port";

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
    throw causeToHostBoundaryError(exit.cause);
  },
});

import type {
  CodexAppServerThreadTurnsListResponse,
  CodexAppServerTurn,
  RuntimeRoute,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { CodexAppServerError, CodexAppServerPort } from "../../ports/codex-app-server-port";
import { readCodexThread, runtimeIdFromStdioRoute } from "./codex-thread-lookup";

export type CodexSessionStopInput = {
  codexAppServer: Pick<CodexAppServerPort, "request">;
  runtimeRoute: RuntimeRoute;
  externalSessionId: string;
  workingDirectory: string;
};

export type CodexSessionStopError = CodexAppServerError;

const requireExactThread = (input: CodexSessionStopInput, runtimeId: string) =>
  Effect.gen(function* () {
    const thread = yield* readCodexThread(input.codexAppServer, runtimeId, input.externalSessionId);
    if (thread.cwd === input.workingDirectory) {
      return thread;
    }
    return yield* Effect.fail(
      new HostOperationError({
        operation: "codexSessionStop.requireExactThread",
        message: "Codex session stop could not find the target thread for the session.",
        details: {
          runtimeId,
          externalSessionId: input.externalSessionId,
          workingDirectory: input.workingDirectory,
        },
      }),
    );
  });

const isActiveTurn = (turn: CodexAppServerTurn): boolean =>
  typeof turn.id === "string" &&
  turn.id.length > 0 &&
  turn.startedAt !== null &&
  turn.completedAt === null;

const loadActiveTurnId = (input: CodexSessionStopInput, runtimeId: string) =>
  Effect.gen(function* () {
    const response = (yield* input.codexAppServer.request({
      runtimeId,
      method: "thread/turns/list",
      params: {
        threadId: input.externalSessionId,
        limit: 20,
        sortDirection: "desc",
        itemsView: "summary",
      },
    })) as CodexAppServerThreadTurnsListResponse;
    const activeTurn = response.data.find(isActiveTurn);
    if (!activeTurn) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "codexSessionStop.loadActiveTurnId",
          message: "Codex session is active but no interruptible active turn was found.",
          details: {
            runtimeId,
            externalSessionId: input.externalSessionId,
            workingDirectory: input.workingDirectory,
          },
        }),
      );
    }
    return activeTurn.id;
  });

export const stopCodexSession = (
  input: CodexSessionStopInput,
): Effect.Effect<void, CodexSessionStopError> =>
  Effect.gen(function* () {
    const runtimeId = runtimeIdFromStdioRoute(input.runtimeRoute);
    if (runtimeId === null) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "runtimeRoute",
          message: "Codex session stop requires a stdio runtime route.",
          details: { runtimeRouteType: input.runtimeRoute.type },
        }),
      );
    }
    const thread = yield* requireExactThread(input, runtimeId);
    if (thread.status.type === "idle" || thread.status.type === "notLoaded") {
      return;
    }
    if (thread.status.type === "systemError") {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "codexSessionStop",
          message: "Codex session thread is in systemError state and cannot be interrupted.",
          details: {
            runtimeId,
            externalSessionId: input.externalSessionId,
            workingDirectory: input.workingDirectory,
          },
        }),
      );
    }
    const turnId = yield* loadActiveTurnId(input, runtimeId);
    yield* input.codexAppServer.request({
      runtimeId,
      method: "turn/interrupt",
      params: { threadId: input.externalSessionId, turnId },
    });
  });

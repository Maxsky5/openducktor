import type { CodexAppServerTurn, RuntimeRoute } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type {
  CodexAppServerError,
  CodexAppServerPort,
  CodexAppServerThreadEntry,
} from "../../ports/codex-app-server-port";
import {
  findExactCodexThread,
  loadCodexLoadedThreadIds,
  runtimeIdFromStdioRoute,
} from "./codex-thread-lookup";

export type CodexSessionStopInput = {
  codexAppServer: Pick<CodexAppServerPort, "listLoadedThreads" | "listThreads" | "request">;
  runtimeRoute: RuntimeRoute;
  externalSessionId: string;
  workingDirectory: string;
};

export type CodexSessionStopError = CodexAppServerError | HostOperationError | HostValidationError;

const loadExactThread = (input: CodexSessionStopInput, runtimeId: string) =>
  Effect.gen(function* () {
    const thread = yield* findExactCodexThread({
      codexAppServer: input.codexAppServer,
      runtimeId,
      externalSessionId: input.externalSessionId,
      workingDirectory: input.workingDirectory,
      operationPrefix: "codexSessionStop",
    });
    if (thread) {
      return thread;
    }
    return yield* Effect.fail(
      new HostOperationError({
        operation: "codexSessionStop.loadExactThread",
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
    const result = yield* input.codexAppServer.request({
      runtimeId,
      method: "thread/turns/list",
      params: {
        threadId: input.externalSessionId,
        limit: 20,
        sortDirection: "desc",
        itemsView: "summary",
      },
    });
    if (typeof result !== "object" || result === null || !("data" in result)) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "codexSessionStop.loadActiveTurnId",
          message: "Codex thread/turns/list returned a malformed response.",
          details: { runtimeId, externalSessionId: input.externalSessionId },
        }),
      );
    }
    const data = (result as { data: unknown }).data;
    if (!Array.isArray(data)) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "codexSessionStop.loadActiveTurnId",
          message: "Codex thread/turns/list response data must be an array.",
          details: { runtimeId, externalSessionId: input.externalSessionId },
        }),
      );
    }
    const activeTurn = data.find((turn): turn is CodexAppServerTurn => {
      if (typeof turn !== "object" || turn === null) {
        return false;
      }
      return isActiveTurn(turn as CodexAppServerTurn);
    });
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

const assertInterruptibleThread = (
  input: CodexSessionStopInput,
  runtimeId: string,
  thread: CodexAppServerThreadEntry,
  loadedThreadIds: Set<string>,
) =>
  Effect.gen(function* () {
    if (thread.status === "idle" || thread.status === "notLoaded") {
      return null;
    }
    if (thread.status === "systemError") {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "codexSessionStop.assertInterruptibleThread",
          message: "Codex session thread is in systemError state and cannot be interrupted.",
          details: {
            runtimeId,
            externalSessionId: input.externalSessionId,
            workingDirectory: input.workingDirectory,
          },
        }),
      );
    }
    if (!loadedThreadIds.has(thread.id)) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "codexSessionStop.assertInterruptibleThread",
          message: "Codex session is active but the target thread is not loaded.",
          details: {
            runtimeId,
            externalSessionId: input.externalSessionId,
            workingDirectory: input.workingDirectory,
          },
        }),
      );
    }
    return yield* loadActiveTurnId(input, runtimeId);
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
    const loadedThreadIds = yield* loadCodexLoadedThreadIds(
      input.codexAppServer,
      runtimeId,
      "codexSessionStop",
    );
    const thread = yield* loadExactThread(input, runtimeId);
    const turnId = yield* assertInterruptibleThread(input, runtimeId, thread, loadedThreadIds);
    if (turnId === null) {
      return;
    }
    yield* input.codexAppServer.request({
      runtimeId,
      method: "turn/interrupt",
      params: { threadId: input.externalSessionId, turnId },
    });
  });

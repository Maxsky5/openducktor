import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { CodexAppServerError, CodexAppServerPort } from "../../ports/codex-app-server-port";
import { readCodexThread } from "./codex-thread-lookup";
import { findActiveCodexTurnId } from "./codex-turn-lookup";

export type CodexSessionStopInput = {
  codexAppServer: Pick<CodexAppServerPort, "request">;
  runtimeId: string;
  externalSessionId: string;
  workingDirectory: string;
};

export type CodexSessionStopError = CodexAppServerError;

const requireExactThread = (input: CodexSessionStopInput) =>
  Effect.gen(function* () {
    const thread = yield* readCodexThread(
      input.codexAppServer,
      input.runtimeId,
      input.externalSessionId,
    );
    if (thread.cwd === input.workingDirectory) {
      return thread;
    }
    return yield* Effect.fail(
      new HostOperationError({
        operation: "codexSessionStop.requireExactThread",
        message: "Codex session stop could not find the target thread for the session.",
        details: {
          runtimeId: input.runtimeId,
          externalSessionId: input.externalSessionId,
          workingDirectory: input.workingDirectory,
        },
      }),
    );
  });

export const stopCodexSession = (
  input: CodexSessionStopInput,
): Effect.Effect<void, CodexSessionStopError> =>
  Effect.gen(function* () {
    const thread = yield* requireExactThread(input);
    if (thread.status.type === "idle" || thread.status.type === "notLoaded") {
      return;
    }
    if (thread.status.type === "systemError") {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "codexSessionStop",
          message: "Codex session thread is in systemError state and cannot be interrupted.",
          details: {
            runtimeId: input.runtimeId,
            externalSessionId: input.externalSessionId,
            workingDirectory: input.workingDirectory,
          },
        }),
      );
    }
    const turnId = yield* findActiveCodexTurnId(
      input.codexAppServer,
      input.runtimeId,
      input.externalSessionId,
    );
    if (turnId === null) {
      return yield* Effect.fail(
        new HostOperationError({
          operation: "codexSessionStop",
          message: "Codex session is active but no interruptible active turn was found.",
          details: {
            runtimeId: input.runtimeId,
            externalSessionId: input.externalSessionId,
            workingDirectory: input.workingDirectory,
          },
        }),
      );
    }
    yield* input.codexAppServer.request({
      runtimeId: input.runtimeId,
      method: "turn/interrupt",
      params: { threadId: input.externalSessionId, turnId },
    });
  });

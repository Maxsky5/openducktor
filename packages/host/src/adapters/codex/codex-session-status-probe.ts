import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { CodexAppServerError, CodexAppServerPort } from "../../ports/codex-app-server-port";
import { readCodexThread } from "./codex-thread-lookup";

export type CodexSessionStatusProbeInput = {
  codexAppServer: Pick<CodexAppServerPort, "request">;
  runtimeId: string;
  externalSessionId: string;
  workingDirectory: string;
};

export type CodexSessionStatusProbeError = CodexAppServerError;

const isCodexThreadNotFoundError = (cause: CodexAppServerError): boolean =>
  cause instanceof HostOperationError &&
  cause.details?.method === "thread/read" &&
  cause.message.toLowerCase().includes("not found");

export const probeCodexSessionStatus = (
  input: CodexSessionStatusProbeInput,
): Effect.Effect<
  {
    supported: boolean;
    hasLiveSession: boolean;
  },
  CodexSessionStatusProbeError
> =>
  Effect.gen(function* () {
    const threadResult = yield* Effect.either(
      readCodexThread(input.codexAppServer, input.runtimeId, input.externalSessionId),
    );
    if (threadResult._tag === "Left") {
      if (isCodexThreadNotFoundError(threadResult.left)) {
        return { supported: true, hasLiveSession: false };
      }
      return yield* Effect.fail(threadResult.left);
    }
    const thread = threadResult.right;
    return {
      supported: true,
      hasLiveSession: thread.cwd === input.workingDirectory && thread.status.type !== "notLoaded",
    };
  });

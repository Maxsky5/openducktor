import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type {
  CodexAppServerError,
  CodexAppServerPort,
  CodexSessionStatus,
} from "../../ports/codex-app-server-port";
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

const isLiveCodexThreadStatus = (
  statusType: CodexSessionStatus,
): Effect.Effect<boolean, HostValidationError> => {
  switch (statusType) {
    case "active":
    case "systemError":
      return Effect.succeed(true);
    case "idle":
    case "notLoaded":
      return Effect.succeed(false);
    default: {
      const unhandledStatus: never = statusType;
      return Effect.fail(
        new HostValidationError({
          message: `Unsupported Codex thread status: ${String(unhandledStatus)}`,
          details: { statusType: unhandledStatus },
        }),
      );
    }
  }
};

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
    const hasLiveSession =
      thread.cwd === input.workingDirectory
        ? yield* isLiveCodexThreadStatus(thread.status.type)
        : false;
    return {
      supported: true,
      hasLiveSession,
    };
  });

import { Effect } from "effect";
import { z } from "zod";
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

const threadReadErrorDetailsSchema = z.object({ method: z.literal("thread/read") });

const isCodexThreadNotFoundError = (cause: CodexAppServerError): boolean => {
  if (!(cause instanceof HostOperationError)) {
    return false;
  }
  return (
    threadReadErrorDetailsSchema.safeParse(cause.details).success &&
    cause.message.toLowerCase().includes("not found")
  );
};

const isLiveCodexThreadStatus = (
  statusType: CodexSessionStatus,
): Effect.Effect<boolean, HostValidationError<never>> => {
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
    const threadResult = yield* Effect.result(
      readCodexThread(input.codexAppServer, input.runtimeId, input.externalSessionId),
    );
    if (threadResult._tag === "Failure") {
      if (isCodexThreadNotFoundError(threadResult.failure)) {
        return { supported: true, hasLiveSession: false };
      }
      return yield* Effect.fail(threadResult.failure);
    }
    const thread = threadResult.success;
    const hasLiveSession =
      thread.cwd === input.workingDirectory
        ? yield* isLiveCodexThreadStatus(thread.status.type)
        : false;
    return {
      supported: true,
      hasLiveSession,
    };
  });

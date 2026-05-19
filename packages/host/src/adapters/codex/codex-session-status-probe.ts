import { Effect } from "effect";
import type { CodexAppServerError, CodexAppServerPort } from "../../ports/codex-app-server-port";
import { readCodexThread } from "./codex-thread-lookup";

export type CodexSessionStatusProbeInput = {
  codexAppServer: Pick<CodexAppServerPort, "request">;
  runtimeId: string;
  externalSessionId: string;
  workingDirectory: string;
};

export type CodexSessionStatusProbeError = CodexAppServerError;

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
    const thread = yield* readCodexThread(
      input.codexAppServer,
      input.runtimeId,
      input.externalSessionId,
    );
    return {
      supported: true,
      hasLiveSession: thread.cwd === input.workingDirectory && thread.status.type === "active",
    };
  });

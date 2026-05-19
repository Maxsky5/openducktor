import type { RuntimeRoute } from "@openducktor/contracts";
import { Effect } from "effect";
import type { CodexAppServerError, CodexAppServerPort } from "../../ports/codex-app-server-port";
import { readCodexThread, runtimeIdFromStdioRoute } from "./codex-thread-lookup";

export type CodexSessionStatusProbeInput = {
  codexAppServer: Pick<CodexAppServerPort, "request">;
  runtimeRoute: RuntimeRoute;
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
    const runtimeId = runtimeIdFromStdioRoute(input.runtimeRoute);
    if (runtimeId === null) {
      return { supported: false, hasLiveSession: false };
    }
    const thread = yield* readCodexThread(input.codexAppServer, runtimeId, input.externalSessionId);
    return {
      supported: true,
      hasLiveSession: thread.cwd === input.workingDirectory && thread.status.type === "active",
    };
  });

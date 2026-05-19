import type { RuntimeRoute } from "@openducktor/contracts";
import { Effect } from "effect";
import type { HostOperationError } from "../../effect/host-errors";
import type { CodexAppServerError, CodexAppServerPort } from "../../ports/codex-app-server-port";
import {
  findExactCodexThread,
  loadCodexLoadedThreadIds,
  runtimeIdFromStdioRoute,
} from "./codex-thread-lookup";

export type CodexSessionStatusProbeInput = {
  codexAppServer: Pick<CodexAppServerPort, "listLoadedThreads" | "listThreads">;
  runtimeRoute: RuntimeRoute;
  externalSessionId: string;
  workingDirectory: string;
};

export type CodexSessionStatusProbeError = CodexAppServerError | HostOperationError;

const hasBusyLoadedThread = (
  input: CodexSessionStatusProbeInput,
  runtimeId: string,
  loadedThreadIds: Set<string>,
) =>
  Effect.gen(function* () {
    const thread = yield* findExactCodexThread({
      codexAppServer: input.codexAppServer,
      runtimeId,
      externalSessionId: input.externalSessionId,
      workingDirectory: input.workingDirectory,
      operationPrefix: "codexSessionStatusProbe",
    });
    return thread !== null && loadedThreadIds.has(thread.id) && thread.status === "active";
  });

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
    const loadedThreadIds = yield* loadCodexLoadedThreadIds(
      input.codexAppServer,
      runtimeId,
      "codexSessionStatusProbe",
    );
    if (loadedThreadIds.size === 0) {
      return { supported: true, hasLiveSession: false };
    }
    return {
      supported: true,
      hasLiveSession: yield* hasBusyLoadedThread(input, runtimeId, loadedThreadIds),
    };
  });

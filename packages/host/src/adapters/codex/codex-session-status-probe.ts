import type { RuntimeRoute } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type {
  CodexAppServerError,
  CodexAppServerLoadedThreadListResponse,
  CodexAppServerPort,
  CodexAppServerThreadListResponse,
} from "../../ports/codex-app-server-port";

export type CodexSessionStatusProbeInput = {
  codexAppServer: Pick<CodexAppServerPort, "listLoadedThreads" | "listThreads">;
  runtimeRoute: RuntimeRoute;
  externalSessionId: string;
  workingDirectory: string;
};
export type CodexSessionStatusProbeError = CodexAppServerError | HostOperationError;
const runtimeIdFromRoute = (runtimeRoute: RuntimeRoute): string | null =>
  runtimeRoute.type === "stdio" ? runtimeRoute.identity : null;
const loadLoadedThreadIds = (
  codexAppServer: Pick<CodexAppServerPort, "listLoadedThreads">,
  runtimeId: string,
) =>
  Effect.gen(function* () {
    const loadedThreadIds = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    while (true) {
      if (cursor !== null) {
        if (seenCursors.has(cursor)) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "codexSessionStatusProbe.loadLoadedThreadIds",
              message: "Codex thread/loaded/list returned a repeated pagination cursor",
              details: { runtimeId, cursor },
            }),
          );
        }
        seenCursors.add(cursor);
      }
      const response: CodexAppServerLoadedThreadListResponse =
        yield* codexAppServer.listLoadedThreads({
          runtimeId,
          cursor,
          limit: 100,
        });
      for (const threadId of response.data) {
        loadedThreadIds.add(threadId);
      }
      cursor = response.nextCursor;
      if (cursor === null) {
        return loadedThreadIds;
      }
    }
  });
const hasBusyLoadedThread = (
  input: CodexSessionStatusProbeInput,
  runtimeId: string,
  loadedThreadIds: Set<string>,
) =>
  Effect.gen(function* () {
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    while (true) {
      if (cursor !== null) {
        if (seenCursors.has(cursor)) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "codexSessionStatusProbe.hasBusyLoadedThread",
              message: "Codex thread/list returned a repeated pagination cursor",
              details: { runtimeId, cursor },
            }),
          );
        }
        seenCursors.add(cursor);
      }
      const response: CodexAppServerThreadListResponse = yield* input.codexAppServer.listThreads({
        runtimeId,
        cursor,
        limit: 100,
      });
      for (const thread of response.data) {
        if (thread.id !== input.externalSessionId) {
          continue;
        }
        if (!loadedThreadIds.has(thread.id)) {
          continue;
        }
        if (thread.cwd !== input.workingDirectory) {
          continue;
        }
        return thread.status === "active";
      }
      cursor = response.nextCursor;
      if (cursor === null) {
        return false;
      }
    }
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
    const runtimeId = runtimeIdFromRoute(input.runtimeRoute);
    if (runtimeId === null) {
      return { supported: false, hasLiveSession: false };
    }
    const loadedThreadIds = yield* loadLoadedThreadIds(input.codexAppServer, runtimeId);
    if (loadedThreadIds.size === 0) {
      return { supported: true, hasLiveSession: false };
    }
    return {
      supported: true,
      hasLiveSession: yield* hasBusyLoadedThread(input, runtimeId, loadedThreadIds),
    };
  });

import type { RuntimeRoute } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type {
  CodexAppServerError,
  CodexAppServerLoadedThreadListResponse,
  CodexAppServerPort,
  CodexAppServerThreadEntry,
  CodexAppServerThreadListResponse,
} from "../../ports/codex-app-server-port";

export type CodexThreadLookupPort = Pick<CodexAppServerPort, "listLoadedThreads" | "listThreads">;

export type CodexThreadLookupInput = {
  codexAppServer: CodexThreadLookupPort;
  runtimeId: string;
  externalSessionId: string;
  workingDirectory: string;
  operationPrefix: string;
};

export const runtimeIdFromStdioRoute = (runtimeRoute: RuntimeRoute): string | null =>
  runtimeRoute.type === "stdio" ? runtimeRoute.identity : null;

export const loadCodexLoadedThreadIds = (
  codexAppServer: Pick<CodexAppServerPort, "listLoadedThreads">,
  runtimeId: string,
  operationPrefix: string,
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
              operation: `${operationPrefix}.loadLoadedThreadIds`,
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

export const findExactCodexThread = (
  input: CodexThreadLookupInput,
): Effect.Effect<CodexAppServerThreadEntry | null, CodexAppServerError | HostOperationError> =>
  Effect.gen(function* () {
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    while (true) {
      if (cursor !== null) {
        if (seenCursors.has(cursor)) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: `${input.operationPrefix}.findExactThread`,
              message: "Codex thread/list returned a repeated pagination cursor",
              details: { runtimeId: input.runtimeId, cursor },
            }),
          );
        }
        seenCursors.add(cursor);
      }
      const response: CodexAppServerThreadListResponse = yield* input.codexAppServer.listThreads({
        runtimeId: input.runtimeId,
        cursor,
        limit: 100,
      });
      for (const thread of response.data) {
        if (thread.id === input.externalSessionId && thread.cwd === input.workingDirectory) {
          return thread;
        }
      }
      cursor = response.nextCursor;
      if (cursor === null) {
        return null;
      }
    }
  });

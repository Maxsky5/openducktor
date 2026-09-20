import type { CodexAppServerThread, WorkspaceSessionExternal } from "@openducktor/contracts";
import type { ExternalRuntimeSessionPage, SessionRef } from "@openducktor/core";
import type { CodexAppServerClient } from "./types";

const isRoot = (thread: CodexAppServerThread): boolean => {
  if (thread.parentThreadId !== null) return false;
  switch (thread.source) {
    case "cli":
    case "vscode":
    case "exec":
    case "appServer":
    case "unknown":
      return true;
    default:
      return "custom" in thread.source;
  }
};
const metadata = (thread: CodexAppServerThread): WorkspaceSessionExternal => ({
  externalSessionId: thread.id,
  runtimeKind: "codex",
  workingDirectory: thread.cwd,
  title: thread.name ?? null,
  updatedAt: thread.updatedAt * 1000,
});
export const listCodexExternalSessions = async (
  client: CodexAppServerClient,
  input: { cursor?: string; signal: AbortSignal },
): Promise<ExternalRuntimeSessionPage> => {
  type Stream = { cursor?: string | null; rows: WorkspaceSessionExternal[] };
  const streams: [Stream, Stream] = input.cursor
    ? JSON.parse(input.cursor)
    : [{ rows: [] }, { rows: [] }];
  const sessions = new Map<string, WorkspaceSessionExternal>();
  while (sessions.size < 100) {
    input.signal.throwIfAborted();
    await Promise.all(
      streams.map(async (stream, index) => {
        if (stream.rows.length || stream.cursor === null) return;
        const request: Parameters<CodexAppServerClient["threadList"]>[0] = {
          limit: 100,
          archived: index === 1,
          sortKey: "updated_at",
          useStateDbOnly: true,
          modelProviders: [],
          sourceKinds: ["cli", "vscode", "exec", "appServer", "unknown"],
        };
        if (stream.cursor) request.cursor = stream.cursor;
        const result = await client.threadList(request);
        input.signal.throwIfAborted();
        if (result.nextCursor && result.nextCursor === stream.cursor)
          throw new Error("Codex repeated a session page. Update Codex and retry.");
        stream.cursor = result.nextCursor;
        stream.rows = result.data.filter(isRoot).map(metadata);
      }),
    );
    const ready = streams.filter((stream) => stream.rows.length > 0);
    if (!ready.length) {
      if (streams.every((stream) => stream.cursor === null)) break;
      continue;
    }
    // An empty unfinished stream needs its next page before the two streams can be merged.
    if (streams.some((stream) => !stream.rows.length && stream.cursor !== null)) continue;
    ready.sort(
      (a, b) =>
        (b.rows[0]!.updatedAt ?? -Infinity) - (a.rows[0]!.updatedAt ?? -Infinity) ||
        a.rows[0]!.externalSessionId.localeCompare(b.rows[0]!.externalSessionId),
    );
    const row = ready[0]!.rows.shift()!;
    sessions.set(row.externalSessionId, row);
  }
  return {
    sessions: [...sessions.values()],
    nextCursor: streams.some((stream) => stream.rows.length || stream.cursor !== null)
      ? JSON.stringify(streams)
      : null,
  };
};
export const inspectCodexExternalSession = async (
  client: CodexAppServerClient,
  ref: SessionRef,
): Promise<WorkspaceSessionExternal> => {
  const { thread } = await client.threadRead({
    threadId: ref.externalSessionId,
    includeTurns: false,
  });
  if (!isRoot(thread)) throw new Error("Subagent conversations cannot be imported.");
  if (thread.id !== ref.externalSessionId || thread.cwd !== ref.workingDirectory)
    throw new Error("The source conversation identity or directory changed. Reload sessions.");
  return metadata(thread);
};

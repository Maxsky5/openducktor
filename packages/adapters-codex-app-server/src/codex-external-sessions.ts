import type { CodexAppServerThread, WorkspaceSessionExternal } from "@openducktor/contracts";
import type { ExternalRuntimeSessionPage, SessionRef } from "@openducktor/core";
import type { CodexAppServerClient } from "./types";

const isRoot = (thread: CodexAppServerThread): boolean => {
  switch (thread.source) {
    case "cli":
    case "vscode":
    case "exec":
    case "appServer":
    case "unknown":
      return true;
    default:
      return false;
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
  input.signal.throwIfAborted();
  const decoded: { archived: boolean; cursor?: string } = input.cursor
    ? JSON.parse(input.cursor)
    : { archived: false };
  const request: Parameters<CodexAppServerClient["threadList"]>[0] = {
    limit: 100,
    archived: decoded.archived,
    modelProviders: [],
    sourceKinds: ["cli", "vscode", "exec", "appServer", "unknown"],
  };
  if (decoded.cursor) request.cursor = decoded.cursor;
  const result = await client.threadList(request);
  input.signal.throwIfAborted();
  return {
    sessions: result.data.filter(isRoot).map(metadata),
    nextCursor: result.nextCursor
      ? JSON.stringify({ archived: decoded.archived, cursor: result.nextCursor })
      : decoded.archived
        ? null
        : JSON.stringify({ archived: true }),
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

import { getSessionInfo, listSessions } from "@anthropic-ai/claude-agent-sdk";
import type { ExternalRuntimeSessionPage, SessionRef } from "@openducktor/core";
import type { WorkspaceSessionExternal } from "@openducktor/contracts";

const metadata = (
  row: Awaited<ReturnType<typeof listSessions>>[number],
): WorkspaceSessionExternal | null =>
  row.cwd
    ? {
        externalSessionId: row.sessionId,
        runtimeKind: "claude",
        workingDirectory: row.cwd,
        title: row.customTitle || row.summary || null,
        updatedAt: row.lastModified,
      }
    : null;
export const listClaudeExternalSessions = async (
  signal: AbortSignal,
): Promise<ExternalRuntimeSessionPage> => {
  signal.throwIfAborted();
  // The supported SDK can omit unreadable local history. This native limitation is accepted.
  const sessions = await listSessions({ includeProgrammatic: true });
  signal.throwIfAborted();
  return {
    sessions: sessions.flatMap((row) => {
      const value = metadata(row);
      return value ? [value] : [];
    }),
    nextCursor: null,
  };
};
export const inspectClaudeExternalSession = async (
  ref: SessionRef,
): Promise<WorkspaceSessionExternal> => {
  const row = await getSessionInfo(ref.externalSessionId, { dir: ref.workingDirectory });
  if (!row)
    throw new Error("Claude conversation is missing or unreadable. Check its directory and retry.");
  const value = metadata(row);
  if (
    !value ||
    value.externalSessionId !== ref.externalSessionId ||
    value.workingDirectory !== ref.workingDirectory
  )
    throw new Error("Claude conversation directory changed or is unknown. Reload sessions.");
  return value;
};

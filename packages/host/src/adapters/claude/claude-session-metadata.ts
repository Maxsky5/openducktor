import { getSessionInfo, getSessionMessages, listSessions } from "@anthropic-ai/claude-agent-sdk";
import type { SessionRef } from "@openducktor/core";
import { z } from "zod";
import type { AgentSessionModelSelection, WorkspaceSessionExternal } from "@openducktor/contracts";

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
export const listClaudeSessionMetadata = async (
  signal: AbortSignal,
): Promise<WorkspaceSessionExternal[]> => {
  signal.throwIfAborted();
  // The supported SDK can omit unreadable local history. This native limitation is accepted.
  const sessions = await listSessions({ includeProgrammatic: true });
  signal.throwIfAborted();
  return sessions.flatMap((row) => {
    const value = metadata(row);
    return value ? [value] : [];
  });
};
export const getClaudeSessionMetadata = async (
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

export const readClaudeSessionModel = async (
  ref: SessionRef,
): Promise<AgentSessionModelSelection | null> => {
  const messages = await getSessionMessages(ref.externalSessionId, { dir: ref.workingDirectory });
  for (const entry of messages.toReversed()) {
    if (entry.type !== "assistant") continue;
    const { model: modelId } = z.object({ model: z.string().optional() }).parse(entry.message);
    if (modelId && modelId !== "<synthetic>")
      return { runtimeKind: "claude", providerId: "claude", modelId };
  }
  return null;
};

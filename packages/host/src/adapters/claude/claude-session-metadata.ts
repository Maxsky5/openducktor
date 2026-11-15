import { getSessionInfo, listSessions } from "@anthropic-ai/claude-agent-sdk";
import { type SessionRef } from "@openducktor/core";
import type { AgentSessionModelSelection, WorkspaceSessionExternal } from "@openducktor/contracts";
import { Effect } from "effect";
import { readLatestHistoryAssistantModel } from "./claude-agent-sdk-history-entry";
import {
  loadClaudeSessionMessages,
  type ClaudeHistoryReadFailure,
} from "./claude-agent-sdk-history-messages";
import type { ClaudeTranscriptReader } from "./claude-transcript-reader";

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

/** Reads the model and effort of the latest root reply. SDK session messages omit the effort. */
export const loadClaudeSessionModel = (
  ref: SessionRef,
  reader: ClaudeTranscriptReader,
): Effect.Effect<AgentSessionModelSelection | null, ClaudeHistoryReadFailure> =>
  loadClaudeSessionMessages(
    { ...ref, runtimeKind: "claude", runtimePolicy: { kind: "claude" } },
    { reader },
  ).pipe(Effect.map(readLatestHistoryAssistantModel));

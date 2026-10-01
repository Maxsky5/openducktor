import {
  getSessionInfo,
  getSessionMessages,
  importSessionToStore,
  listSessions,
} from "@anthropic-ai/claude-agent-sdk";
import { AgentRuntimeQueryError, type SessionRef } from "@openducktor/core";
import { z } from "zod";
import type {
  AgentSessionMetadata,
  AgentSessionModelSelection,
  WorkspaceSessionExternal,
} from "@openducktor/contracts";
import { parseClaudeHistoryStoreEntry } from "./claude-agent-sdk-ingress-schemas";

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

/** Reads conversation activity without opening the session or counting native bookkeeping writes. */
export const loadClaudeSessionMetadata = async (ref: SessionRef): Promise<AgentSessionMetadata> => {
  const row = await getSessionInfo(ref.externalSessionId, { dir: ref.workingDirectory });
  if (!row)
    throw new AgentRuntimeQueryError(
      "request_failed",
      "Claude conversation is missing or unreadable. Check its directory and retry.",
    );
  if (row.sessionId !== ref.externalSessionId || row.cwd !== ref.workingDirectory)
    throw new AgentRuntimeQueryError(
      "scope_mismatch",
      "The native session does not match the selected session and working directory. Select the matching session.",
    );
  const { repoPath, runtimeKind, workingDirectory, externalSessionId } = ref;
  return {
    ref: { repoPath, runtimeKind, workingDirectory, externalSessionId },
    lastActivityAt: await readActivityTime(ref),
  };
};

// The SDK's message API drops timestamps. Read root entries in batches and retain only their time.
const readActivityTime = async (ref: SessionRef): Promise<number | null> => {
  let latest: number | null = null;
  await importSessionToStore(
    ref.externalSessionId,
    {
      append: async (_key, entries) => {
        for (const entry of entries) {
          if (
            (entry.type !== "user" && entry.type !== "assistant" && entry.type !== "result") ||
            entry.isSidechain === true
          ) {
            continue;
          }
          const { timestamp } = parseClaudeHistoryStoreEntry(entry);
          if (timestamp === undefined) continue;
          const time = Date.parse(timestamp);
          if (!Number.isNaN(time)) latest = Math.max(latest ?? time, time);
        }
      },
      load: async () => null,
    },
    { dir: ref.workingDirectory, includeSubagents: false },
  );
  return latest;
};

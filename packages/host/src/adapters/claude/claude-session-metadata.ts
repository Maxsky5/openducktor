import {
  getSessionInfo,
  getSessionMessages,
  listSessions,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import { findTurnCatalogModel, type SessionRef } from "@openducktor/core";
import { z } from "zod";
import type { AgentSessionModelSelection, WorkspaceSessionExternal } from "@openducktor/contracts";
import { loadClaudeModelCatalog } from "./claude-agent-sdk-catalog";
import type { CreateClaudeAgentSdkServiceInput } from "./claude-agent-sdk-types";

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

/** Reads the model of the latest turn as a catalog selection, such as `opus`. */
export const readClaudeSessionModel = async (
  ref: SessionRef,
  runtime: Pick<CreateClaudeAgentSdkServiceInput, "claudeExecutablePath" | "processEnv">,
): Promise<AgentSessionModelSelection | null> => {
  const messages = await getSessionMessages(ref.externalSessionId, { dir: ref.workingDirectory });
  for (const entry of messages.toReversed()) {
    if (entry.type !== "assistant") continue;
    const { model: modelId } = z.object({ model: z.string().optional() }).parse(entry.message);
    if (!modelId || modelId === "<synthetic>") continue;
    const reported = { runtimeKind: "claude" as const, providerId: "claude", modelId };
    // Claude history reports the resolved model ID, not the ID of the catalog entry.
    const catalog = await loadClaudeModelCatalog(
      ref.workingDirectory,
      runtime.processEnv,
      runtime.claudeExecutablePath,
      query,
    );
    const model = findTurnCatalogModel(catalog, reported);
    return model ? { ...reported, modelId: model.modelId } : reported;
  }
  return null;
};

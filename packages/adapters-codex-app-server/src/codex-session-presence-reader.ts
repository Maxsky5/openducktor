import type {
  AgentSessionPresenceSnapshot,
  ListLiveAgentSessionsInput,
  ListSessionPresenceInput,
  LiveAgentSessionSummary,
  ReadSessionPresenceInput,
} from "@openducktor/core";
import {
  stalePresence,
  toPresenceSnapshotFromThread,
  toRefreshedPresenceSnapshot,
} from "./codex-app-server-presence";
import type { CodexThreadInventory, CodexThreadSnapshot } from "./codex-app-server-threads";
import type { CodexHistoryPresenceOverlay } from "./codex-history-presence-overlay";
import type { CodexPendingInputState } from "./codex-pending-input-state";
import type { CodexRuntimeClientResolver } from "./codex-runtime-client-resolver";
import type { CodexThreadInventoryReader } from "./codex-thread-inventory";
import type { CodexSessionState } from "./types";

export type CodexSessionPresenceReaderDeps = {
  runtimeClients: CodexRuntimeClientResolver;
  threadInventory: CodexThreadInventoryReader;
  sessions: Map<string, CodexSessionState>;
  historyPresenceOverlay: CodexHistoryPresenceOverlay;
  pendingInput: CodexPendingInputState;
  hasActiveTurn: (externalSessionId: string) => boolean;
};

const directoriesFromInput = (directories: readonly string[] | undefined): Set<string> =>
  new Set(directories ?? []);

const threadMatchesDirectories = (thread: CodexThreadSnapshot, directories: Set<string>): boolean =>
  directories.size === 0 || directories.has(thread.cwd);

const toLiveSessionSummary = (thread: CodexThreadSnapshot): LiveAgentSessionSummary => ({
  externalSessionId: thread.id,
  title: thread.title,
  workingDirectory: thread.cwd,
  startedAt: thread.startedAt,
  status: thread.status.status,
});

const toLocalPresenceSnapshot = async (
  deps: CodexSessionPresenceReaderDeps,
  session: CodexSessionState,
  input?: ReadSessionPresenceInput,
): Promise<AgentSessionPresenceSnapshot> => {
  const inventory = await deps.threadInventory.refresh(
    deps.runtimeClients.clientForRuntime(session.runtimeId),
    session.runtimeId,
  );
  return toRefreshedPresenceSnapshot({
    session,
    inventory,
    ...(input ? { input } : {}),
    pendingApprovals: deps.pendingInput.pendingApprovalsForSession(session.threadId),
    pendingQuestions: deps.pendingInput.pendingQuestionsForSession(session.threadId),
    hasActiveTurn: deps.hasActiveTurn(session.threadId),
  });
};

const refreshRuntimeInventoryOnce = (
  deps: CodexSessionPresenceReaderDeps,
  inventoriesByRuntimeId: Map<string, Promise<CodexThreadInventory>>,
  runtimeId: string,
): Promise<CodexThreadInventory> => {
  const existing = inventoriesByRuntimeId.get(runtimeId);
  if (existing) {
    return existing;
  }
  const inventory = deps.threadInventory.refresh(
    deps.runtimeClients.clientForRuntime(runtimeId),
    runtimeId,
  );
  inventoriesByRuntimeId.set(runtimeId, inventory);
  return inventory;
};

export const listLiveCodexAgentSessions = async (
  deps: CodexSessionPresenceReaderDeps,
  input: ListLiveAgentSessionsInput,
): Promise<LiveAgentSessionSummary[]> => {
  const { client, runtimeId } = await deps.runtimeClients.resolve(input, "list live sessions", {
    requireLive: true,
  });
  const inventory = await deps.threadInventory.refresh(client, runtimeId);
  deps.historyPresenceOverlay.clearMissingLoadedThreads(inventory);
  if (inventory.loadedIds.size === 0) {
    return [];
  }
  const directories = directoriesFromInput(input.directories);
  return [...inventory.threadsById.values()]
    .filter((thread) => inventory.loadedIds.has(thread.id))
    .filter((thread) => threadMatchesDirectories(thread, directories))
    .map((thread) => deps.historyPresenceOverlay.apply(thread, input.repoPath))
    .map(toLiveSessionSummary);
};

export const listCodexSessionPresence = async (
  deps: CodexSessionPresenceReaderDeps,
  input: ListSessionPresenceInput,
): Promise<AgentSessionPresenceSnapshot[]> => {
  const directories = directoriesFromInput(input.directories);
  const localSessions = [...deps.sessions.values()]
    .filter((session) => session.repoPath === input.repoPath)
    .filter((session) => directories.size === 0 || directories.has(session.workingDirectory));
  const inventoryByRuntimeId = new Map<string, Promise<CodexThreadInventory>>();
  const localSnapshots = await Promise.all(
    localSessions.map(async (session) =>
      toRefreshedPresenceSnapshot({
        session,
        inventory: await refreshRuntimeInventoryOnce(deps, inventoryByRuntimeId, session.runtimeId),
        pendingApprovals: deps.pendingInput.pendingApprovalsForSession(session.threadId),
        pendingQuestions: deps.pendingInput.pendingQuestionsForSession(session.threadId),
        hasActiveTurn: deps.hasActiveTurn(session.threadId),
      }),
    ),
  );
  const localThreadIds = new Set(localSessions.map((session) => session.threadId));
  const { client, runtimeId } = await deps.runtimeClients.resolve(input, "list session presence", {
    requireLive: true,
  });
  const inventory = await deps.threadInventory.refresh(client, runtimeId);
  deps.historyPresenceOverlay.clearMissingLoadedThreads(inventory);
  const remoteSnapshots = [...inventory.threadsById.values()]
    .filter((thread) => inventory.loadedIds.has(thread.id))
    .filter((thread) => !localThreadIds.has(thread.id))
    .filter((thread) => threadMatchesDirectories(thread, directories))
    .map((thread) =>
      toPresenceSnapshotFromThread(
        deps.historyPresenceOverlay.apply(thread, input.repoPath),
        input,
      ),
    );
  return [...localSnapshots, ...remoteSnapshots];
};

export const readCodexSessionPresence = async (
  deps: CodexSessionPresenceReaderDeps,
  input: ReadSessionPresenceInput,
): Promise<AgentSessionPresenceSnapshot> => {
  const session = deps.sessions.get(input.externalSessionId);
  if (session) {
    return toLocalPresenceSnapshot(deps, session, input);
  }

  const { client, runtimeId } = await deps.runtimeClients.resolve(input, "read session presence", {
    requireLive: true,
  });
  const inventory = await deps.threadInventory.refresh(client, runtimeId);
  deps.historyPresenceOverlay.clearMissingLoadedThreads(inventory);
  if (!inventory.loadedIds.has(input.externalSessionId)) {
    return stalePresence(input);
  }
  const snapshot = inventory.threadsById.get(input.externalSessionId) ?? null;
  if (!snapshot || snapshot.cwd !== input.workingDirectory) {
    return stalePresence(input);
  }
  return toPresenceSnapshotFromThread(
    deps.historyPresenceOverlay.apply(snapshot, input.repoPath),
    input,
  );
};

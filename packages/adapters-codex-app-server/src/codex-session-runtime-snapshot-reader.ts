import type {
  AgentSessionRuntimeSnapshot,
  ListSessionRuntimeSnapshotsInput,
  ReadSessionRuntimeSnapshotInput,
} from "@openducktor/core";
import {
  missingRuntimeSnapshot,
  toRefreshedRuntimeSnapshot,
  toRuntimeSnapshotFromThread,
} from "./codex-app-server-runtime-snapshot";
import type { CodexThreadInventory, CodexThreadSnapshot } from "./codex-app-server-threads";
import type { CodexSessionLookup } from "./codex-local-session-state";
import type { CodexPendingInputState } from "./codex-pending-input-state";
import type { CodexRuntimeClientResolver } from "./codex-runtime-client-resolver";
import type { CodexSubagentLinkState } from "./codex-subagent-link-state";
import type { CodexThreadInventoryReader } from "./codex-thread-inventory";
import type { CodexSessionState } from "./types";

export type CodexSessionRuntimeSnapshotReaderDeps = {
  runtimeClients: CodexRuntimeClientResolver;
  threadInventory: CodexThreadInventoryReader;
  sessions: CodexSessionLookup;
  pendingInput: CodexPendingInputState;
  subagents: CodexSubagentLinkState;
  hasActiveTurn: (externalSessionId: string) => boolean;
};

const directoriesFromInput = (directories: readonly string[] | undefined): Set<string> =>
  new Set(directories ?? []);

const threadMatchesDirectories = (thread: CodexThreadSnapshot, directories: Set<string>): boolean =>
  directories.size === 0 || directories.has(thread.cwd);

const recordInventorySubagentLinks = (
  deps: CodexSessionRuntimeSnapshotReaderDeps,
  inventory: CodexThreadInventory,
  runtimeId: string,
): CodexThreadInventory => {
  for (const thread of inventory.threadsById.values()) {
    deps.subagents.recordThread(thread, runtimeId);
  }
  return inventory;
};

const toLocalRuntimeSnapshot = async (
  deps: CodexSessionRuntimeSnapshotReaderDeps,
  session: CodexSessionState,
  input?: ReadSessionRuntimeSnapshotInput,
): Promise<AgentSessionRuntimeSnapshot> => {
  const inventory = recordInventorySubagentLinks(
    deps,
    await deps.threadInventory.read(
      deps.runtimeClients.clientForRuntime(session.runtimeId),
      session.runtimeId,
    ),
    session.runtimeId,
  );
  return toRefreshedRuntimeSnapshot({
    session,
    inventory,
    ...(input ? { input } : {}),
    pendingApprovals: deps.pendingInput.pendingApprovalsForSession(session.threadId),
    pendingQuestions: deps.pendingInput.pendingQuestionsForSession(session.threadId),
    hasActiveTurn: deps.hasActiveTurn(session.threadId),
  });
};

const readRuntimeInventoryOnce = (
  deps: CodexSessionRuntimeSnapshotReaderDeps,
  inventoriesByRuntimeId: Map<string, Promise<CodexThreadInventory>>,
  runtimeId: string,
): Promise<CodexThreadInventory> => {
  const existing = inventoriesByRuntimeId.get(runtimeId);
  if (existing) {
    return existing;
  }
  const inventory = deps.threadInventory.read(
    deps.runtimeClients.clientForRuntime(runtimeId),
    runtimeId,
  );
  inventoriesByRuntimeId.set(runtimeId, inventory);
  return inventory;
};

export const listCodexSessionRuntimeSnapshots = async (
  deps: CodexSessionRuntimeSnapshotReaderDeps,
  input: ListSessionRuntimeSnapshotsInput,
): Promise<AgentSessionRuntimeSnapshot[]> => {
  const directories = directoriesFromInput(input.directories);
  const localSessions = [...deps.sessions.values()]
    .filter((session) => session.repoPath === input.repoPath)
    .filter((session) => directories.size === 0 || directories.has(session.workingDirectory));
  const inventoryByRuntimeId = new Map<string, Promise<CodexThreadInventory>>();
  const localSnapshots = await Promise.all(
    localSessions.map(async (session) =>
      toRefreshedRuntimeSnapshot({
        session,
        inventory: recordInventorySubagentLinks(
          deps,
          await readRuntimeInventoryOnce(deps, inventoryByRuntimeId, session.runtimeId),
          session.runtimeId,
        ),
        pendingApprovals: deps.pendingInput.pendingApprovalsForSession(session.threadId),
        pendingQuestions: deps.pendingInput.pendingQuestionsForSession(session.threadId),
        hasActiveTurn: deps.hasActiveTurn(session.threadId),
      }),
    ),
  );
  const localThreadIds = new Set(localSessions.map((session) => session.threadId));
  const { client, runtimeId } = await deps.runtimeClients.resolve(
    input,
    "list session runtime snapshots",
  );
  const inventory = recordInventorySubagentLinks(
    deps,
    await deps.threadInventory.refresh(client, runtimeId),
    runtimeId,
  );
  const remoteSnapshots = [...inventory.threadsById.values()]
    .filter((thread) => inventory.loadedIds.has(thread.id))
    .filter((thread) => !localThreadIds.has(thread.id))
    .filter((thread) => threadMatchesDirectories(thread, directories))
    .map((thread) =>
      toRuntimeSnapshotFromThread(thread, input, {
        pendingApprovals: deps.pendingInput.pendingApprovalsForSession(thread.id),
        pendingQuestions: deps.pendingInput.pendingQuestionsForSession(thread.id),
      }),
    );
  return [...localSnapshots, ...remoteSnapshots];
};

export const readCodexSessionRuntimeSnapshot = async (
  deps: CodexSessionRuntimeSnapshotReaderDeps,
  input: ReadSessionRuntimeSnapshotInput,
): Promise<AgentSessionRuntimeSnapshot> => {
  const session = deps.sessions.get(input.externalSessionId);
  if (session) {
    return toLocalRuntimeSnapshot(deps, session, input);
  }

  const { client, runtimeId } = await deps.runtimeClients.resolve(
    input,
    "read session runtime snapshot",
  );
  const inventory = recordInventorySubagentLinks(
    deps,
    await deps.threadInventory.refresh(client, runtimeId),
    runtimeId,
  );
  if (!inventory.loadedIds.has(input.externalSessionId)) {
    return missingRuntimeSnapshot(input);
  }
  const snapshot = inventory.threadsById.get(input.externalSessionId) ?? null;
  if (!snapshot || snapshot.cwd !== input.workingDirectory) {
    return missingRuntimeSnapshot(input);
  }
  return toRuntimeSnapshotFromThread(snapshot, input, {
    pendingApprovals: deps.pendingInput.pendingApprovalsForSession(snapshot.id),
    pendingQuestions: deps.pendingInput.pendingQuestionsForSession(snapshot.id),
  });
};

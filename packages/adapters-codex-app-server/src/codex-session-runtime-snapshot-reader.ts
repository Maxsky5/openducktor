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
import type { CodexThreadInventory } from "./codex-app-server-threads";
import type { CodexSessionLookup } from "./codex-local-session-state";
import type { CodexPendingInputState } from "./codex-pending-input-state";
import type { CodexRuntimeClientResolver } from "./codex-runtime-client-resolver";
import type { CodexThreadInventoryReader } from "./codex-thread-inventory";
import type { CodexSessionState } from "./types";

export type CodexSessionRuntimeSnapshotReaderDeps = {
  runtimeClients: Pick<CodexRuntimeClientResolver, "clientForRuntime" | "resolve">;
  threadInventory: Pick<CodexThreadInventoryReader, "read" | "refresh">;
  sessions: CodexSessionLookup;
  pendingInput: CodexPendingInputState;
  hasActiveTurn: (externalSessionId: string) => boolean;
};

const directoriesFromInput = (directories: readonly string[] | undefined): Set<string> =>
  new Set(directories ?? []);

const toLocalRuntimeSnapshot = async (
  deps: CodexSessionRuntimeSnapshotReaderDeps,
  session: CodexSessionState,
  input?: ReadSessionRuntimeSnapshotInput,
): Promise<AgentSessionRuntimeSnapshot> => {
  const inventory = await deps.threadInventory.read(
    deps.runtimeClients.clientForRuntime(session.runtimeId),
    session.runtimeId,
  );
  const refreshInput: Parameters<typeof toRefreshedRuntimeSnapshot>[0] = {
    session,
    inventory,
    pendingApprovals: deps.pendingInput.pendingApprovalsForSession(
      session.threadId,
      session.runtimeId,
    ),
    pendingQuestions: deps.pendingInput.pendingQuestionsForSession(
      session.threadId,
      session.runtimeId,
    ),
    hasActiveTurn: deps.hasActiveTurn(session.threadId),
  };
  if (input) {
    refreshInput.input = input;
  }
  return toRefreshedRuntimeSnapshot(refreshInput);
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
        inventory: await readRuntimeInventoryOnce(deps, inventoryByRuntimeId, session.runtimeId),
        pendingApprovals: deps.pendingInput.pendingApprovalsForSession(
          session.threadId,
          session.runtimeId,
        ),
        pendingQuestions: deps.pendingInput.pendingQuestionsForSession(
          session.threadId,
          session.runtimeId,
        ),
        hasActiveTurn: deps.hasActiveTurn(session.threadId),
      }),
    ),
  );
  return localSnapshots;
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
  const inventory = await deps.threadInventory.refresh(client, runtimeId);
  if (!inventory.loadedIds.has(input.externalSessionId)) {
    return missingRuntimeSnapshot(input);
  }
  const snapshot = inventory.threadsById.get(input.externalSessionId) ?? null;
  if (!snapshot || snapshot.cwd !== input.workingDirectory) {
    return missingRuntimeSnapshot(input);
  }
  return toRuntimeSnapshotFromThread(snapshot, input, {
    pendingApprovals: deps.pendingInput.pendingApprovalsForSession(snapshot.id, runtimeId),
    pendingQuestions: deps.pendingInput.pendingQuestionsForSession(snapshot.id, runtimeId),
  });
};

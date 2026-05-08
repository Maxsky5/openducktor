import type {
  AgentSessionRecord,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  type AgentSessionPresenceSnapshot,
  toAgentSessionPresenceSnapshotFromLiveSnapshot,
} from "@openducktor/core";
import { createQueryClient } from "@/lib/query-client";
import { runtimeQueryKeys } from "@/state/queries/runtime";
import {
  findSessionMessageForTest,
  sessionMessageAt,
  sessionMessagesToArray,
  someSessionMessageForTest,
} from "@/test-utils/session-message-test-helpers";
import type { AgentSessionState as BaseAgentSessionState } from "@/types/agent-orchestrator";
import {
  createAgentSessionPresenceSnapshotFixture,
  createDeferred,
  createTaskCardFixture,
} from "../test-utils";
import { createLoadAgentSessions as createLoadAgentSessionsBase } from "./load-sessions";
import type { SessionLifecycleAdapter } from "./load-sessions-stages";
import { agentSessionPresenceLookupKey } from "./session-presence-cache";
import { AgentSessionPresenceStore } from "./session-presence-store";

export type AgentSessionState = BaseAgentSessionState & { runId?: string | null };

export const createLoadAgentSessions = createLoadAgentSessionsBase;

export const createTestQueryClient = createQueryClient;

export type LegacyRunSummary = { runId: string; worktreePath: string };

export type LoadSessionHistoryInput = Parameters<
  NonNullable<SessionLifecycleAdapter["loadSessionHistory"]>
>[0];
export type ResumeSessionInput = Parameters<
  NonNullable<SessionLifecycleAdapter["resumeSession"]>
>[0];
export type AttachSessionInput = Parameters<
  NonNullable<SessionLifecycleAdapter["attachSession"]>
>[0];
export type ListSessionPresenceInput = Parameters<
  NonNullable<SessionLifecycleAdapter["listSessionPresence"]>
>[0];
export type ReadSessionPresenceInput = Parameters<
  NonNullable<SessionLifecycleAdapter["readSessionPresence"]>
>[0];
export type AgentSessionPresenceSnapshotFromLiveSnapshotInput = Parameters<
  typeof toAgentSessionPresenceSnapshotFromLiveSnapshot
>[0];

export type SessionLifecycleAdapterOverrides = Partial<
  Omit<SessionLifecycleAdapter, "listSessionPresence" | "readSessionPresence">
> & {
  listSessionPresence?: (input: ListSessionPresenceInput) => Promise<unknown[]>;
  readSessionPresence?: (input: ReadSessionPresenceInput) => Promise<unknown>;
};

export const createTaskFixture = () => createTaskCardFixture({ title: "Task" });

export const createPresence = (
  externalSessionId: string,
  workingDirectory: string,
  overrides: Record<string, unknown> = {},
) =>
  createAgentSessionPresenceSnapshotFixture({
    ref: { externalSessionId, workingDirectory },
    snapshot: {
      externalSessionId,
      workingDirectory,
      ...overrides,
    },
  });

export const getSession = (
  state: Record<string, AgentSessionState>,
  externalSessionId: string,
): AgentSessionState => {
  const session = state[externalSessionId];
  if (!session) {
    throw new Error(`Expected session ${externalSessionId}`);
  }
  return session;
};

export const persistedSessionRecord = (
  input: {
    externalSessionId: string;
    role: AgentSessionRecord["role"];
    startedAt: string;
    workingDirectory: string;
    runtimeKind?: AgentSessionRecord["runtimeKind"];
    selectedModel?: AgentSessionRecord["selectedModel"];
  } & Record<string, unknown>,
): AgentSessionRecord => {
  const {
    runtimeKind,
    externalSessionId,
    role,
    startedAt,
    workingDirectory,
    selectedModel,
    ...rest
  } = input;

  return {
    runtimeKind: runtimeKind ?? "opencode",
    externalSessionId,
    role,
    startedAt,
    workingDirectory,
    selectedModel: selectedModel ?? null,
    ...rest,
  };
};

export const createAdapter = (
  overrides: SessionLifecycleAdapterOverrides = {},
): SessionLifecycleAdapter => {
  const loadPresences = async (input: ListSessionPresenceInput) => {
    const snapshots = (await overrides.listSessionPresence?.(input)) ?? [];
    return snapshots.map((entry) => {
      if (entry && typeof entry === "object" && "ref" in entry) {
        return entry as AgentSessionPresenceSnapshot;
      }

      const snapshot = entry as AgentSessionPresenceSnapshotFromLiveSnapshotInput["snapshot"] & {
        externalSessionId: string;
        workingDirectory: string;
      };

      return toAgentSessionPresenceSnapshotFromLiveSnapshot({
        ref: {
          repoPath: input.repoPath,
          runtimeKind: input.runtimeKind,
          externalSessionId: snapshot.externalSessionId,
          workingDirectory: snapshot.workingDirectory,
        },
        runtimeId: "runtime-1",
        snapshot: snapshot as AgentSessionPresenceSnapshotFromLiveSnapshotInput["snapshot"],
      });
    });
  };

  const readSessionPresence = overrides.readSessionPresence
    ? async (input: ReadSessionPresenceInput) =>
        overrides.readSessionPresence?.(input) as Promise<AgentSessionPresenceSnapshot>
    : async (record: ReadSessionPresenceInput) => {
        const snapshots = await loadPresences({
          repoPath: record.repoPath ?? "/tmp/repo",
          runtimeKind: record.runtimeKind ?? "opencode",
          directories: [record.workingDirectory ?? "/tmp/repo/worktree"],
        });

        const match = snapshots.find(
          (snapshot) => snapshot.ref.externalSessionId === record.externalSessionId,
        );
        if (match) {
          return match;
        }

        return toAgentSessionPresenceSnapshotFromLiveSnapshot({
          ref: {
            repoPath: record.repoPath ?? "/tmp/repo",
            runtimeKind: record.runtimeKind ?? "opencode",
            externalSessionId: record.externalSessionId,
            workingDirectory: record.workingDirectory ?? "/tmp/repo/worktree",
          },
          runtimeId: null,
          snapshot: null,
        });
      };

  return {
    hasSession: () => false,
    loadSessionHistory: async () => [],
    resumeSession: async (input: ResumeSessionInput) => ({
      externalSessionId: input.externalSessionId,
      role: input.role,
      startedAt: "2026-02-22T08:00:00.000Z",
      status: "idle",
      runtimeKind: input.runtimeKind,
    }),
    attachSession: async (input: AttachSessionInput) => ({
      externalSessionId: input.externalSessionId,
      role: input.role,
      startedAt: "2026-02-22T08:00:00.000Z",
      status: "idle",
      runtimeKind: input.runtimeKind,
    }),
    ...overrides,
    listSessionPresence: loadPresences,
    readSessionPresence,
  };
};

export const setupDefaultLoadSessionsHost = async (): Promise<{
  legacyHost: { runsList: (repoPath?: string) => Promise<LegacyRunSummary[]> };
  restore: () => void;
}> => {
  const hostModule = await import("../../shared/host");
  const host = hostModule.host;
  const legacyHost = host as typeof host & {
    runsList: (repoPath?: string) => Promise<LegacyRunSummary[]>;
  };
  const originalRuntimeList = host.runtimeList;
  const originalRuntimeEnsure = host.runtimeEnsure;
  const originalRunsList = legacyHost.runsList;

  host.runtimeList = async (repoPath = "/tmp/repo", runtimeKind = "opencode") => [
    {
      kind: runtimeKind,
      runtimeId: "runtime-1",
      repoPath,
      taskId: null,
      role: "workspace",
      workingDirectory: repoPath,
      runtimeRoute: {
        type: "local_http",
        endpoint: "http://127.0.0.1:4444",
      },
      startedAt: "2026-02-22T08:00:00.000Z",
      descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    },
  ];
  legacyHost.runsList = async () => [];
  host.runtimeEnsure = async (repoPath) => ({
    kind: "opencode",
    runtimeId: "runtime-1",
    repoPath,
    taskId: null,
    role: "workspace",
    workingDirectory: repoPath,
    runtimeRoute: {
      type: "local_http",
      endpoint: "http://127.0.0.1:4444",
    },
    startedAt: "2026-02-22T08:00:00.000Z",
    descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
  });

  return {
    legacyHost,
    restore: () => {
      host.runtimeList = originalRuntimeList;
      host.runtimeEnsure = originalRuntimeEnsure;
      legacyHost.runsList = originalRunsList;
    },
  };
};

export const waitForHistoryCallCount = async (
  getHistoryCalls: () => number,
  expectedCalls: number,
): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (getHistoryCalls() >= expectedCalls) {
      return;
    }
    await Promise.resolve();
  }

  throw new Error(
    `Expected at least ${expectedCalls} history calls, received ${getHistoryCalls()}.`,
  );
};

export type {
  AgentSessionPresenceSnapshot,
  AgentSessionRecord,
  RuntimeInstanceSummary,
  RuntimeKind,
  SessionLifecycleAdapter,
};
export {
  AgentSessionPresenceStore,
  agentSessionPresenceLookupKey,
  createAgentSessionPresenceSnapshotFixture,
  createDeferred,
  findSessionMessageForTest,
  OPENCODE_RUNTIME_DESCRIPTOR,
  runtimeQueryKeys,
  sessionMessageAt,
  sessionMessagesToArray,
  someSessionMessageForTest,
};

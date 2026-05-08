import { beforeEach, describe, expect, test } from "bun:test";
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
import { appQueryClient, clearAppQueryClient } from "@/lib/query-client";
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

type AgentSessionState = BaseAgentSessionState & { runId?: string | null };

const createLoadAgentSessions = createLoadAgentSessionsBase;

type LegacyRunSummary = { runId: string; worktreePath: string };

type LoadSessionHistoryInput = Parameters<
  NonNullable<SessionLifecycleAdapter["loadSessionHistory"]>
>[0];
type ResumeSessionInput = Parameters<NonNullable<SessionLifecycleAdapter["resumeSession"]>>[0];
type AttachSessionInput = Parameters<NonNullable<SessionLifecycleAdapter["attachSession"]>>[0];
type ListSessionPresenceInput = Parameters<
  NonNullable<SessionLifecycleAdapter["listSessionPresence"]>
>[0];
type ReadSessionPresenceInput = Parameters<
  NonNullable<SessionLifecycleAdapter["readSessionPresence"]>
>[0];
type AgentSessionPresenceSnapshotFromLiveSnapshotInput = Parameters<
  typeof toAgentSessionPresenceSnapshotFromLiveSnapshot
>[0];

type SessionLifecycleAdapterOverrides = Partial<
  Omit<SessionLifecycleAdapter, "listSessionPresence" | "readSessionPresence">
> & {
  listSessionPresence?: (input: ListSessionPresenceInput) => Promise<unknown[]>;
  readSessionPresence?: (input: ReadSessionPresenceInput) => Promise<unknown>;
};

let legacyHost!: { runsList: (repoPath?: string) => Promise<LegacyRunSummary[]> };

const taskFixture = createTaskCardFixture({ title: "Task" });

const createPresence = (
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

const getSession = (
  state: Record<string, AgentSessionState>,
  externalSessionId: string,
): AgentSessionState => {
  const session = state[externalSessionId];
  if (!session) {
    throw new Error(`Expected session ${externalSessionId}`);
  }
  return session;
};

const persistedSessionRecord = (
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

const createAdapter = (
  overrides: SessionLifecycleAdapterOverrides = {},
): SessionLifecycleAdapter => {
  const loadPresences = async (...args: [ListSessionPresenceInput]) => {
    const snapshots = (await overrides.listSessionPresence?.(...args)) ?? [];
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
          repoPath: "/tmp/repo",
          runtimeKind: "opencode",
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

const waitForHistoryCallCount = async (
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

describe("agent-orchestrator live session reconciliation", () => {
  beforeEach(async () => {
    await clearAppQueryClient();
    const hostModule = await import("../../shared/host");
    legacyHost = hostModule.host as typeof hostModule.host & {
      runsList: (repoPath?: string) => Promise<LegacyRunSummary[]>;
    };
    hostModule.host.runtimeList = async (repoPath = "/tmp/repo", runtimeKind = "opencode") => [
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
    hostModule.host.runtimeEnsure = async (repoPath) => ({
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
  });

  test("live reconciliation does not attach stale persisted sessions to the repo runtime", async () => {
    const persistedRecord = persistedSessionRecord({
      runtimeKind: "opencode",
      externalSessionId: "external-stale",
      taskId: "task-1",
      role: "build",
      startedAt: "2026-02-22T08:00:00.000Z",
      updatedAt: "2026-02-22T08:00:00.000Z",
      workingDirectory: "/tmp/repo/worktree",
    });
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "external-stale": {
          ...persistedRecord,
          repoPath: "/tmp/repo",
          taskId: "task-1",
          status: "stopped",
          runtimeKind: "opencode",
          runtimeId: null,
          historyHydrationState: "not_requested",
          messages: [],
          draftAssistantText: "",
          draftAssistantMessageId: null,
          draftReasoningText: "",
          draftReasoningMessageId: null,
          contextUsage: null,
          pendingApprovals: [],
          pendingQuestions: [],
          todos: [],
          modelCatalog: null,
          selectedModel: null,
          isLoadingModelCatalog: false,
          promptOverrides: {},
        },
      },
    };
    let state = sessionsRef.current;
    let liveSnapshotCalls = 0;
    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      queryClient: appQueryClient,
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        listSessionPresence: async () => {
          liveSnapshotCalls += 1;
          return [];
        },
        loadSessionHistory: async () => {
          throw new Error("reconcile_live must not hydrate transcript history");
        },
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession: (externalSessionId, updater) => {
        const current = state[externalSessionId];
        if (!current) {
          return;
        }
        state = {
          ...state,
          [externalSessionId]: updater(current),
        };
        sessionsRef.current = state;
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    await loadAgentSessions("task-1", {
      mode: "reconcile_live",
      historyPolicy: "none",
      persistedRecords: [persistedRecord],
      preloadedRuntimeLists: new Map([
        [
          "opencode",
          [
            {
              kind: "opencode",
              runtimeId: "runtime-repo",
              repoPath: "/tmp/repo",
              taskId: null,
              role: "workspace",
              workingDirectory: "/tmp/repo",
              runtimeRoute: {
                type: "local_http",
                endpoint: "http://127.0.0.1:4444",
              },
              startedAt: "2026-02-22T08:00:00.000Z",
              descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
            },
          ],
        ],
      ]),
    });

    expect(liveSnapshotCalls).toBe(1);
    expect(getSession(state, "external-stale").runtimeId).toBeNull();
    expect(getSession(state, "external-stale").workingDirectory).toBe("/tmp/repo/worktree");
  });

  test("recovers a worktree session from a repo-root runtime after verifying the live external session", async () => {
    const persistedRecord = persistedSessionRecord({
      runtimeKind: "opencode",
      externalSessionId: "external-1",
      taskId: "task-1",
      role: "build",
      startedAt: "2026-02-22T08:00:00.000Z",
      updatedAt: "2026-02-22T08:00:00.000Z",
      workingDirectory: "/tmp/repo/worktree",
    });
    const sessionsRef: { current: Record<string, AgentSessionState> } = {
      current: {
        "external-1": {
          ...persistedRecord,
          externalSessionId: "external-1",
          runtimeKind: "opencode",
          repoPath: "/tmp/repo",
          taskId: "task-1",
          status: "stopped",
          runtimeId: null,
          historyHydrationState: "not_requested",
          messages: [],
          draftAssistantText: "",
          draftAssistantMessageId: null,
          draftReasoningText: "",
          draftReasoningMessageId: null,
          contextUsage: null,
          pendingApprovals: [],
          pendingQuestions: [],
          todos: [],
          modelCatalog: null,
          selectedModel: null,
          isLoadingModelCatalog: false,
          promptOverrides: {},
        },
      },
    };
    let state = sessionsRef.current;
    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };
    const observedSnapshotDirectories: string[][] = [];

    const loadAgentSessions = createLoadAgentSessions({
      queryClient: appQueryClient,
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        listSessionPresence: async (input: ListSessionPresenceInput) => {
          observedSnapshotDirectories.push(input.directories ?? []);
          return [
            createAgentSessionPresenceSnapshotFixture({
              ref: { externalSessionId: "external-1", workingDirectory: "/tmp/repo/worktree" },
              runtimeId: "runtime-root",
              snapshot: {
                externalSessionId: "external-1",
                title: "BUILD task-1",
                workingDirectory: "/tmp/repo/worktree",
                startedAt: "2026-02-22T08:00:00.000Z",
                status: { type: "busy" },
                pendingApprovals: [],
                pendingQuestions: [],
              },
            }),
          ];
        },
        loadSessionHistory: async () => {
          throw new Error("recover_runtime_attachment must not hydrate transcript history");
        },
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession: (externalSessionId, updater) => {
        const current = state[externalSessionId];
        if (!current) {
          return;
        }
        state = {
          ...state,
          [externalSessionId]: updater(current),
        };
        sessionsRef.current = state;
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    await loadAgentSessions("task-1", {
      mode: "recover_runtime_attachment",
      targetExternalSessionId: "external-1",
      historyPolicy: "none",
      persistedRecords: [persistedRecord],
      preloadedRuntimeLists: new Map([
        [
          "opencode",
          [
            {
              kind: "opencode",
              runtimeId: "runtime-root",
              repoPath: "/tmp/repo",
              taskId: null,
              role: "workspace",
              workingDirectory: "/tmp/repo",
              runtimeRoute: {
                type: "local_http",
                endpoint: "http://127.0.0.1:4444",
              },
              startedAt: "2026-02-22T08:00:00.000Z",
              descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
            },
          ],
        ],
      ]),
    });

    expect(observedSnapshotDirectories).toEqual([["/tmp/repo/worktree"]]);
    expect(getSession(state, "external-1").runtimeId).toBe("runtime-root");
    expect(getSession(state, "external-1").workingDirectory).toBe("/tmp/repo/worktree");
    expect(getSession(state, "external-1").historyHydrationState).toBe("not_requested");
    expect(sessionMessagesToArray(getSession(state, "external-1"))).toEqual([]);
  });

  test("live reconciliation leaves unmatched records detached from the repo runtime", async () => {
    const firstRecord = persistedSessionRecord({
      runtimeKind: "opencode",
      externalSessionId: "external-1",
      taskId: "task-1",
      role: "build",
      startedAt: "2026-02-22T08:00:00.000Z",
      updatedAt: "2026-02-22T08:00:00.000Z",
      workingDirectory: "/tmp/repo/worktree",
    });
    const secondRecord = persistedSessionRecord({
      runtimeKind: "opencode",
      externalSessionId: "external-2",
      taskId: "task-1",
      role: "qa",
      startedAt: "2026-02-22T08:00:00.000Z",
      updatedAt: "2026-02-22T08:00:00.000Z",
      workingDirectory: "/tmp/repo/worktree",
    });
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      queryClient: appQueryClient,
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        listSessionPresence: async () => [
          createAgentSessionPresenceSnapshotFixture({
            ref: {
              repoPath: "/tmp/repo",
              runtimeKind: "opencode",
              externalSessionId: "external-1",
              workingDirectory: "/tmp/repo/worktree",
            },
            runtimeId: "runtime-root",
            snapshot: {
              title: "BUILD task-1",
              status: { type: "busy" },
              pendingApprovals: [],
              pendingQuestions: [],
            },
          }),
        ],
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession: (externalSessionId, updater) => {
        const current = state[externalSessionId];
        if (!current) {
          return;
        }
        state = {
          ...state,
          [externalSessionId]: updater(current),
        };
        sessionsRef.current = state;
      },
      loadRepoPromptOverrides: async () => ({}),
    });

    await loadAgentSessions("task-1", {
      mode: "reconcile_live",
      historyPolicy: "none",
      persistedRecords: [firstRecord, secondRecord],
      preloadedRuntimeLists: new Map([
        [
          "opencode",
          [
            {
              kind: "opencode",
              runtimeId: "runtime-root",
              repoPath: "/tmp/repo",
              taskId: null,
              role: "workspace",
              workingDirectory: "/tmp/repo",
              runtimeRoute: {
                type: "local_http",
                endpoint: "http://127.0.0.1:4444",
              },
              startedAt: "2026-02-22T08:00:00.000Z",
              descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
            },
          ],
        ],
      ]),
    });

    expect(getSession(state, "external-1").runtimeId).toBe("runtime-root");
    expect(getSession(state, "external-1").workingDirectory).toBe("/tmp/repo/worktree");
    expect(getSession(state, "external-2").runtimeId).toBeNull();
    expect(getSession(state, "external-2").workingDirectory).toBe("/tmp/repo/worktree");
    expect(sessionMessagesToArray(getSession(state, "external-1"))).toEqual([]);
    expect(sessionMessagesToArray(getSession(state, "external-2"))).toEqual([]);
  });

  test("composes bootstrap, requested history hydration, and live reconciliation without cross-mode regressions", async () => {
    const sessionsRef: { current: Record<string, AgentSessionState> } = { current: {} };
    let state: Record<string, AgentSessionState> = {};
    let attachedToAdapter = false;
    let sessionPresenceLoads = 0;
    let historyLoads = 0;
    let resumeCalls = 0;
    let attachCalls = 0;
    let attachedListeners = 0;
    let promptOverrideLoads = 0;

    const persistedRecords = [
      persistedSessionRecord({
        runtimeKind: "opencode",
        externalSessionId: "external-1",
        taskId: "task-1",
        role: "planner",
        startedAt: "2026-02-22T08:00:00.000Z",
        updatedAt: "2026-02-22T08:00:00.000Z",
        workingDirectory: "/tmp/repo",
      }),
    ];
    const runtimeLists = new Map<"opencode", RuntimeInstanceSummary[]>([
      [
        "opencode",
        [
          {
            kind: "opencode",
            runtimeId: "runtime-1",
            repoPath: "/tmp/repo",
            taskId: null,
            role: "workspace",
            workingDirectory: "/tmp/repo",
            runtimeRoute: {
              type: "local_http",
              endpoint: "http://127.0.0.1:4444",
            },
            startedAt: "2026-02-22T08:00:00.000Z",
            descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
          },
        ],
      ],
    ]);

    const setSessionsById = (
      updater:
        | Record<string, AgentSessionState>
        | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
    ) => {
      state = typeof updater === "function" ? updater(state) : updater;
      sessionsRef.current = state;
    };
    const updateSession = (
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
    ) => {
      const current = state[externalSessionId];
      if (!current) {
        return;
      }
      state = {
        ...state,
        [externalSessionId]: updater(current),
      };
      sessionsRef.current = state;
    };

    const loadAgentSessions = createLoadAgentSessions({
      queryClient: appQueryClient,
      activeWorkspace: {
        repoPath: "/tmp/repo",
        workspaceId: "workspace-1",
        workspaceName: "Active Workspace",
      },
      adapter: createAdapter({
        hasSession: () => attachedToAdapter,
        listSessionPresence: async () => {
          sessionPresenceLoads += 1;
          return [
            {
              externalSessionId: "external-1",
              title: "PLANNER task-1",
              role: "planner",
              workingDirectory: "/tmp/repo/worktree",
              startedAt: "2026-02-22T08:00:00.000Z",
              status: { type: "busy" },
              pendingApprovals: [
                {
                  requestId: "permission-live",
                  requestType: "permission_grant" as const,
                  title: `Approve permission: ${"read"}`,
                  summary: `Approval request for ${"read"}.`,
                  affectedPaths: ["README.md"],
                  action: { name: "read" },
                  mutation: "read_only" as const,
                  supportedReplyOutcomes: [
                    "approve_once" as const,
                    "approve_session" as const,
                    "reject" as const,
                  ],
                },
              ],
              pendingQuestions: [
                {
                  requestId: "question-live",
                  questions: [
                    {
                      header: "Confirm",
                      question: "Continue?",
                      options: [{ label: "Yes", description: "Proceed" }],
                    },
                  ],
                },
              ],
            },
          ];
        },
        loadSessionHistory: async () => {
          historyLoads += 1;
          return [
            {
              messageId: "history-1",
              role: "assistant",
              timestamp: "2026-02-22T08:00:01.000Z",
              text: "Requested history",
              parts: [
                {
                  kind: "text",
                  messageId: "history-1",
                  partId: "part-1",
                  text: "Requested history",
                  completed: true,
                },
              ],
            },
          ];
        },
        resumeSession: async (input: ResumeSessionInput) => {
          resumeCalls += 1;
          attachedToAdapter = true;
          return {
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-02-22T08:00:00.000Z",
            status: "running",
            runtimeKind: input.runtimeKind,
          };
        },
        attachSession: async (input: AttachSessionInput) => {
          attachCalls += 1;
          attachedToAdapter = true;
          return {
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-02-22T08:00:00.000Z",
            status: "running",
            runtimeKind: input.runtimeKind,
          };
        },
      }),
      repoEpochRef: { current: 2 },
      currentWorkspaceRepoPathRef: { current: "/tmp/repo" },
      sessionsRef,
      setSessionsById,
      taskRef: { current: [taskFixture] },
      updateSession,
      attachSessionListener: () => {
        attachedListeners += 1;
      },
      loadRepoPromptOverrides: async () => {
        promptOverrideLoads += 1;
        return {};
      },
      loadTaskDocuments: async () => ({
        specMarkdown: "",
        planMarkdown: "",
        qaMarkdown: "",
      }),
    });

    await loadAgentSessions("task-1", {
      mode: "bootstrap",
      persistedRecords,
      preloadedRuntimeLists: runtimeLists,
      historyPolicy: "none",
    });

    expect(state["external-1"]).toMatchObject({
      status: "stopped",
      messages: [],
      pendingApprovals: [],
      pendingQuestions: [],
    });
    expect(historyLoads).toBe(0);
    expect(resumeCalls).toBe(0);
    expect(attachCalls).toBe(0);
    expect(attachedListeners).toBe(0);
    expect(promptOverrideLoads).toBe(0);

    await loadAgentSessions("task-1", {
      mode: "requested_history",
      targetExternalSessionId: "external-1",
      persistedRecords,
      preloadedRuntimeLists: runtimeLists,
      historyPolicy: "requested_only",
      allowLiveSessionResume: true,
    });

    const hydratedSession = state["external-1"];
    expect(hydratedSession).toMatchObject({
      status: "idle",
      historyHydrationState: "hydrated",
      pendingApprovals: [
        {
          requestId: "permission-live",
          requestType: "permission_grant" as const,
          title: `Approve permission: ${"read"}`,
          summary: `Approval request for ${"read"}.`,
          affectedPaths: ["README.md"],
          action: { name: "read" },
          mutation: "read_only" as const,
          supportedReplyOutcomes: [
            "approve_once" as const,
            "approve_session" as const,
            "reject" as const,
          ],
        },
      ],
    });
    expect(hydratedSession?.pendingQuestions).toHaveLength(1);
    const hydratedContents = hydratedSession
      ? sessionMessagesToArray(hydratedSession).map((message) => message.content)
      : [];
    expect(hydratedContents[0]).toContain("System prompt:");
    expect(hydratedContents.slice(1)).toEqual(["Requested history"]);
    expect(historyLoads).toBe(1);
    expect(resumeCalls).toBe(0);
    expect(attachCalls).toBe(1);
    expect(attachedListeners).toBe(1);

    const hydratedMessageIds = hydratedSession
      ? sessionMessagesToArray(hydratedSession).map((message) => message.id)
      : [];

    await loadAgentSessions("task-1", {
      mode: "reconcile_live",
      persistedRecords,
      preloadedRuntimeLists: runtimeLists,
      historyPolicy: "live_if_empty",
    });

    expect(historyLoads).toBe(1);
    expect(resumeCalls).toBe(0);
    expect(attachCalls).toBe(1);
    expect(attachedListeners).toBe(2);
    expect(sessionPresenceLoads).toBe(2);
    expect(
      sessionMessagesToArray(getSession(state, "external-1")).map((message) => message.id),
    ).toEqual(hydratedMessageIds);
    expect(state["external-1"]).toMatchObject({
      status: "idle",
      historyHydrationState: "hydrated",
      pendingApprovals: [
        {
          requestId: "permission-live",
          requestType: "permission_grant" as const,
          title: `Approve permission: ${"read"}`,
          summary: `Approval request for ${"read"}.`,
          affectedPaths: ["README.md"],
          action: { name: "read" },
          mutation: "read_only" as const,
          supportedReplyOutcomes: [
            "approve_once" as const,
            "approve_session" as const,
            "reject" as const,
          ],
        },
      ],
    });
    expect(state["external-1"]?.pendingQuestions).toHaveLength(1);
    expect(promptOverrideLoads).toBe(1);
  });
});

import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { PolicyBoundSessionRef, SessionRef } from "@openducktor/core";
import { toAgentSessionRuntimeSnapshot } from "@openducktor/core";
import {
  type AgentSessionCollection,
  createAgentSessionCollection,
  emptyAgentSessionCollection,
  listAgentSessions,
} from "@/state/agent-session-collection";
import { type AgentSessionsStore, createAgentSessionsStore } from "@/state/agent-sessions-store";
import {
  createAgentSessionFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentApprovalRequest } from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "../support/messages";
import { resolveAgentSessionRuntimePolicyFromSnapshot } from "../support/session-runtime-policy";
import type { ResolveSessionRuntimePolicySync } from "./adapters/session-runtime-policy-resolver";
import { loadRepoSessionReadModel } from "./repo-session-read-model-loader";
import type { TaskSessionRecords } from "./task-session-records";

const record: AgentSessionRecord = {
  externalSessionId: "external-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  startedAt: "2026-06-12T08:00:00.000Z",
  selectedModel: null,
};

const taskSessionRecords: TaskSessionRecords = {
  taskIds: ["task-1"],
  records: [{ taskId: "task-1", record }],
};

const secondRecord: AgentSessionRecord = {
  externalSessionId: "external-2",
  role: "qa",
  runtimeKind: "opencode",
  workingDirectory: "/repo/second-worktree",
  startedAt: "2026-06-12T08:05:00.000Z",
  selectedModel: null,
};

const createTestRuntimePolicyResolver = (): ResolveSessionRuntimePolicySync => {
  const snapshot = createSettingsSnapshotFixture();
  return ({ runtimeKind, sessionScope }) =>
    resolveAgentSessionRuntimePolicyFromSnapshot({
      runtimeKind,
      snapshot,
      ...(sessionScope !== undefined ? { sessionScope } : {}),
    });
};

const createCommitSessionCollection = (
  initialSessionCollection = emptyAgentSessionCollection(),
) => {
  let sessionCollection = initialSessionCollection;

  return {
    commitSessionCollection: ((commit) => {
      const { collection, result } = commit(sessionCollection);
      sessionCollection = collection;
      return result;
    }) satisfies AgentSessionsStore["commitSessionCollection"],
    getSession: (externalSessionId: string) =>
      listAgentSessions(sessionCollection).find(
        (session) => session.externalSessionId === externalSessionId,
      ) ?? null,
    listSessions: () => listAgentSessions(sessionCollection),
  };
};

const loadReadModel = async ({
  initialSessionCollection,
  listSessionRuntimeSnapshots,
  observeAgentSession = async () => undefined,
  clearSessionObservationState = () => undefined,
  loadLiveSessionHistory = async () => undefined,
  records = taskSessionRecords,
}: {
  initialSessionCollection?: AgentSessionCollection;
  listSessionRuntimeSnapshots: () => Promise<
    Awaited<ReturnType<typeof toAgentSessionRuntimeSnapshot>>[]
  >;
  observeAgentSession?: (session: PolicyBoundSessionRef) => Promise<void>;
  clearSessionObservationState?: (sessions: readonly SessionRef[]) => void;
  loadLiveSessionHistory?: (session: PolicyBoundSessionRef) => Promise<unknown>;
  records?: TaskSessionRecords;
}) => {
  const collection = createCommitSessionCollection(initialSessionCollection);
  const result = await loadRepoSessionReadModel({
    repoPath: "/repo",
    taskSessionRecords: records,
    adapter: {
      listSessionRuntimeSnapshots: async () => listSessionRuntimeSnapshots(),
    },
    commitSessionCollection: collection.commitSessionCollection,
    observeAgentSession,
    clearSessionObservationState,
    loadLiveSessionHistory,
    loadSessionRuntimePolicyResolver: async () => createTestRuntimePolicyResolver(),
    isStaleRepoOperation: () => false,
  });

  return { ...collection, result };
};

describe("repo session read model loader", () => {
  test("publishes known running sessions before runtime policy loading finishes", async () => {
    const codexRecord: AgentSessionRecord = {
      ...record,
      runtimeKind: "codex",
    };
    const codexRecords: TaskSessionRecords = {
      taskIds: ["task-1"],
      records: [{ taskId: "task-1", record: codexRecord }],
    };
    const store = createAgentSessionsStore("/repo");
    let markRuntimePolicyLoadStarted!: () => void;
    let releaseRuntimePolicy!: () => void;
    const runtimePolicyLoadStarted = new Promise<void>((resolve) => {
      markRuntimePolicyLoadStarted = resolve;
    });
    const runtimePolicyGate = new Promise<void>((resolve) => {
      releaseRuntimePolicy = resolve;
    });

    const load = loadRepoSessionReadModel({
      repoPath: "/repo",
      taskSessionRecords: codexRecords,
      adapter: {
        listSessionRuntimeSnapshots: async () => [
          toAgentSessionRuntimeSnapshot({
            ref: {
              repoPath: "/repo",
              runtimeKind: "codex",
              workingDirectory: codexRecord.workingDirectory,
              externalSessionId: codexRecord.externalSessionId,
            },
            snapshot: {
              title: "Builder",
              startedAt: codexRecord.startedAt,
              runtimeActivity: "running",
              pendingApprovals: [],
              pendingQuestions: [],
            },
          }),
        ],
      },
      commitSessionCollection: store.commitSessionCollection,
      observeAgentSession: async () => undefined,
      clearSessionObservationState: () => undefined,
      loadLiveSessionHistory: async () => undefined,
      loadSessionRuntimePolicyResolver: async () => {
        markRuntimePolicyLoadStarted();
        await runtimePolicyGate;
        return createTestRuntimePolicyResolver();
      },
      isStaleRepoOperation: () => false,
    });

    await runtimePolicyLoadStarted;

    expect(store.getActivitySnapshot().sessions).toEqual([
      expect.objectContaining({
        externalSessionId: codexRecord.externalSessionId,
        runtimeKind: "codex",
        activityState: "running",
      }),
    ]);

    releaseRuntimePolicy();
    await load;
  });

  test("does not clear a live Codex approval with an older runtime snapshot", async () => {
    const codexRecord: AgentSessionRecord = {
      ...record,
      runtimeKind: "codex",
    };
    const codexRecords: TaskSessionRecords = {
      taskIds: ["task-1"],
      records: [{ taskId: "task-1", record: codexRecord }],
    };
    const initialSession = createAgentSessionFixture({
      externalSessionId: codexRecord.externalSessionId,
      taskId: "task-1",
      runtimeKind: "codex",
      role: "build",
      status: "running",
      startedAt: codexRecord.startedAt,
      workingDirectory: codexRecord.workingDirectory,
    });
    const collection = createCommitSessionCollection(
      createAgentSessionCollection([initialSession]),
    );
    const pendingApproval: AgentApprovalRequest = {
      requestId: "mcp-approval-1",
      requestInstanceId: "runtime-a\u0000mcp-approval-1",
      requestType: "runtime_tool",
      title: "Approve MCP tool",
      summary: "Allow the MCP tool call.",
      affectedPaths: [],
      action: { name: "odt_read_task" },
      mutation: "read_only",
      supportedReplyOutcomes: ["approve_once", "reject"],
    };
    let runtimePendingApprovals: AgentApprovalRequest[] = [];
    let releaseSettingsSnapshot!: () => void;
    let markSettingsLoadStarted!: () => void;
    const settingsLoadStarted = new Promise<void>((resolve) => {
      markSettingsLoadStarted = resolve;
    });
    const settingsSnapshotGate = new Promise<void>((resolve) => {
      releaseSettingsSnapshot = resolve;
    });

    const load = loadRepoSessionReadModel({
      repoPath: "/repo",
      taskSessionRecords: codexRecords,
      adapter: {
        listSessionRuntimeSnapshots: async () => [
          toAgentSessionRuntimeSnapshot({
            ref: {
              repoPath: "/repo",
              runtimeKind: "codex",
              workingDirectory: codexRecord.workingDirectory,
              externalSessionId: codexRecord.externalSessionId,
            },
            snapshot: {
              title: "Builder",
              startedAt: codexRecord.startedAt,
              runtimeActivity: "running",
              pendingApprovals: runtimePendingApprovals,
              pendingQuestions: [],
            },
          }),
        ],
      },
      commitSessionCollection: collection.commitSessionCollection,
      observeAgentSession: async () => undefined,
      clearSessionObservationState: () => undefined,
      loadLiveSessionHistory: async () => undefined,
      loadSessionRuntimePolicyResolver: async () => {
        markSettingsLoadStarted();
        await settingsSnapshotGate;
        return createTestRuntimePolicyResolver();
      },
      isStaleRepoOperation: () => false,
    });

    await settingsLoadStarted;
    runtimePendingApprovals = [pendingApproval];
    collection.commitSessionCollection((current) => ({
      collection: createAgentSessionCollection(
        listAgentSessions(current).map((session) => ({
          ...session,
          pendingApprovals: [pendingApproval],
        })),
      ),
      result: undefined,
    }));
    releaseSettingsSnapshot();
    await load;

    expect(collection.getSession(codexRecord.externalSessionId)?.pendingApprovals).toEqual([
      pendingApproval,
    ]);
  });

  test("materializes the persisted session baseline before its snapshot read completes", async () => {
    const codexRecord: AgentSessionRecord = {
      ...record,
      runtimeKind: "codex",
    };
    const codexRecords: TaskSessionRecords = {
      taskIds: ["task-1"],
      records: [{ taskId: "task-1", record: codexRecord }],
    };
    const collection = createCommitSessionCollection();
    const pendingApproval: AgentApprovalRequest = {
      requestId: "mcp-approval-from-snapshot",
      requestInstanceId: "runtime-a\u0000mcp-approval-from-snapshot",
      requestType: "runtime_tool",
      title: "Approve MCP tool",
      summary: "Allow the MCP tool call.",
      affectedPaths: [],
      action: { name: "odt_read_task" },
      mutation: "read_only",
      supportedReplyOutcomes: ["approve_once", "reject"],
    };
    let markSnapshotReadStarted!: () => void;
    let releaseSnapshot!: () => void;
    const snapshotReadStarted = new Promise<void>((resolve) => {
      markSnapshotReadStarted = resolve;
    });
    const snapshotGate = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });

    const load = loadRepoSessionReadModel({
      repoPath: "/repo",
      taskSessionRecords: codexRecords,
      adapter: {
        listSessionRuntimeSnapshots: async () => {
          markSnapshotReadStarted();
          await snapshotGate;
          return [
            toAgentSessionRuntimeSnapshot({
              ref: {
                repoPath: "/repo",
                runtimeKind: "codex",
                workingDirectory: codexRecord.workingDirectory,
                externalSessionId: codexRecord.externalSessionId,
              },
              snapshot: {
                title: "Builder",
                startedAt: codexRecord.startedAt,
                runtimeActivity: "running",
                pendingApprovals: [pendingApproval],
                pendingQuestions: [],
              },
            }),
          ];
        },
      },
      commitSessionCollection: collection.commitSessionCollection,
      observeAgentSession: async () => undefined,
      clearSessionObservationState: () => undefined,
      loadLiveSessionHistory: async () => undefined,
      loadSessionRuntimePolicyResolver: async () => createTestRuntimePolicyResolver(),
      isStaleRepoOperation: () => false,
    });

    await snapshotReadStarted;
    expect(collection.getSession(codexRecord.externalSessionId)).toMatchObject({
      externalSessionId: codexRecord.externalSessionId,
      pendingApprovals: [],
      pendingQuestions: [],
    });
    releaseSnapshot();
    await load;

    expect(collection.getSession(codexRecord.externalSessionId)?.pendingApprovals).toEqual([
      pendingApproval,
    ]);
  });

  test("does not resurrect snapshot input resolved after baseline materialization", async () => {
    const codexRecord: AgentSessionRecord = {
      ...record,
      runtimeKind: "codex",
    };
    const codexRecords: TaskSessionRecords = {
      taskIds: ["task-1"],
      records: [{ taskId: "task-1", record: codexRecord }],
    };
    const collection = createCommitSessionCollection();
    const pendingApproval: AgentApprovalRequest = {
      requestId: "mcp-approval-resolved-live",
      requestInstanceId: "runtime-a\u0000mcp-approval-resolved-live",
      requestType: "runtime_tool",
      title: "Approve MCP tool",
      summary: "Allow the MCP tool call.",
      affectedPaths: [],
      action: { name: "odt_read_task" },
      mutation: "read_only",
      supportedReplyOutcomes: ["approve_once", "reject"],
    };
    let markSnapshotReadStarted!: () => void;
    let releaseSnapshot!: () => void;
    const snapshotReadStarted = new Promise<void>((resolve) => {
      markSnapshotReadStarted = resolve;
    });
    const snapshotGate = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });

    const load = loadRepoSessionReadModel({
      repoPath: "/repo",
      taskSessionRecords: codexRecords,
      adapter: {
        listSessionRuntimeSnapshots: async () => {
          markSnapshotReadStarted();
          await snapshotGate;
          return [
            toAgentSessionRuntimeSnapshot({
              ref: {
                repoPath: "/repo",
                runtimeKind: "codex",
                workingDirectory: codexRecord.workingDirectory,
                externalSessionId: codexRecord.externalSessionId,
              },
              snapshot: {
                title: "Builder",
                startedAt: codexRecord.startedAt,
                runtimeActivity: "running",
                pendingApprovals: [pendingApproval],
                pendingQuestions: [],
              },
            }),
          ];
        },
      },
      commitSessionCollection: collection.commitSessionCollection,
      observeAgentSession: async () => undefined,
      clearSessionObservationState: () => undefined,
      loadLiveSessionHistory: async () => undefined,
      loadSessionRuntimePolicyResolver: async () => createTestRuntimePolicyResolver(),
      isStaleRepoOperation: () => false,
    });

    await snapshotReadStarted;
    collection.commitSessionCollection((current) => ({
      collection: createAgentSessionCollection(
        listAgentSessions(current).map((session) => ({
          ...session,
          pendingApprovals: [pendingApproval],
        })),
      ),
      result: undefined,
    }));
    collection.commitSessionCollection((current) => ({
      collection: createAgentSessionCollection(
        listAgentSessions(current).map((session) => ({
          ...session,
          pendingApprovals: [],
        })),
      ),
      result: undefined,
    }));
    releaseSnapshot();
    await load;

    expect(collection.getSession(codexRecord.externalSessionId)?.pendingApprovals).toEqual([]);
  });

  test("does not clear a live Codex approval while another runtime snapshot is loading", async () => {
    const codexRecord: AgentSessionRecord = {
      ...record,
      runtimeKind: "codex",
    };
    const mixedRuntimeRecords: TaskSessionRecords = {
      taskIds: ["task-1", "task-2"],
      records: [
        { taskId: "task-1", record: codexRecord },
        { taskId: "task-2", record: secondRecord },
      ],
    };
    const collection = createCommitSessionCollection(
      createAgentSessionCollection([
        createAgentSessionFixture({
          externalSessionId: codexRecord.externalSessionId,
          taskId: "task-1",
          runtimeKind: "codex",
          role: "build",
          status: "running",
          startedAt: codexRecord.startedAt,
          workingDirectory: codexRecord.workingDirectory,
        }),
        createAgentSessionFixture({
          externalSessionId: secondRecord.externalSessionId,
          taskId: "task-2",
          runtimeKind: "opencode",
          role: "qa",
          status: "running",
          startedAt: secondRecord.startedAt,
          workingDirectory: secondRecord.workingDirectory,
        }),
      ]),
    );
    let markCodexSnapshotReturned!: () => void;
    let releaseOpenCodeSnapshot!: () => void;
    const codexSnapshotReturned = new Promise<void>((resolve) => {
      markCodexSnapshotReturned = resolve;
    });
    const openCodeSnapshotGate = new Promise<void>((resolve) => {
      releaseOpenCodeSnapshot = resolve;
    });
    const pendingApproval: AgentApprovalRequest = {
      requestId: "mcp-approval-2",
      requestInstanceId: "runtime-a\u0000mcp-approval-2",
      requestType: "runtime_tool",
      title: "Approve MCP tool",
      summary: "Allow the MCP tool call.",
      affectedPaths: [],
      action: { name: "odt_read_task" },
      mutation: "read_only",
      supportedReplyOutcomes: ["approve_once", "reject"],
    };

    const load = loadRepoSessionReadModel({
      repoPath: "/repo",
      taskSessionRecords: mixedRuntimeRecords,
      adapter: {
        listSessionRuntimeSnapshots: async ({ runtimeKind }) => {
          if (runtimeKind === "codex") {
            markCodexSnapshotReturned();
            return [
              toAgentSessionRuntimeSnapshot({
                ref: {
                  repoPath: "/repo",
                  runtimeKind: "codex",
                  workingDirectory: codexRecord.workingDirectory,
                  externalSessionId: codexRecord.externalSessionId,
                },
                snapshot: {
                  title: "Builder",
                  startedAt: codexRecord.startedAt,
                  runtimeActivity: "running",
                  pendingApprovals: [],
                  pendingQuestions: [],
                },
              }),
            ];
          }
          await openCodeSnapshotGate;
          return [
            toAgentSessionRuntimeSnapshot({
              ref: {
                repoPath: "/repo",
                runtimeKind: "opencode",
                workingDirectory: secondRecord.workingDirectory,
                externalSessionId: secondRecord.externalSessionId,
              },
              snapshot: {
                title: "QA",
                startedAt: secondRecord.startedAt,
                runtimeActivity: "running",
                pendingApprovals: [],
                pendingQuestions: [],
              },
            }),
          ];
        },
      },
      commitSessionCollection: collection.commitSessionCollection,
      observeAgentSession: async () => undefined,
      clearSessionObservationState: () => undefined,
      loadLiveSessionHistory: async () => undefined,
      loadSessionRuntimePolicyResolver: async () => createTestRuntimePolicyResolver(),
      isStaleRepoOperation: () => false,
    });

    await codexSnapshotReturned;
    collection.commitSessionCollection((current) => ({
      collection: createAgentSessionCollection(
        listAgentSessions(current).map((session) =>
          session.externalSessionId === codexRecord.externalSessionId
            ? { ...session, pendingApprovals: [pendingApproval] }
            : session,
        ),
      ),
      result: undefined,
    }));
    releaseOpenCodeSnapshot();
    await load;

    expect(collection.getSession(codexRecord.externalSessionId)?.pendingApprovals).toEqual([
      pendingApproval,
    ]);
  });

  test("commits persisted sessions with one runtime snapshot scan", async () => {
    let runtimeSnapshotReads = 0;
    const observedSessions: PolicyBoundSessionRef[] = [];
    const harness = await loadReadModel({
      listSessionRuntimeSnapshots: async () => {
        runtimeSnapshotReads += 1;
        return [
          toAgentSessionRuntimeSnapshot({
            ref: {
              repoPath: "/repo",
              runtimeKind: "opencode",
              workingDirectory: "/repo/worktree",
              externalSessionId: "external-1",
            },
            snapshot: {
              title: "Builder",
              startedAt: "2026-06-12T08:00:00.000Z",
              runtimeActivity: "running",
              pendingApprovals: [],
              pendingQuestions: [],
            },
          }),
        ];
      },
      observeAgentSession: async (session) => {
        observedSessions.push(session);
      },
    });

    expect(harness.result).toBe(true);
    expect(runtimeSnapshotReads).toBe(1);
    expect(harness.getSession("external-1")).toEqual(
      expect.objectContaining({
        externalSessionId: "external-1",
        status: "running",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      }),
    );
    expect(observedSessions).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        runtimePolicy: { kind: "opencode" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      },
    ]);
  });

  test("preloads detected live session histories after observation", async () => {
    const events: string[] = [];
    const loadedSessionHistories: PolicyBoundSessionRef[] = [];
    const harness = await loadReadModel({
      listSessionRuntimeSnapshots: async () => [
        toAgentSessionRuntimeSnapshot({
          ref: {
            repoPath: "/repo",
            runtimeKind: "opencode",
            workingDirectory: "/repo/worktree",
            externalSessionId: "external-1",
          },
          snapshot: {
            title: "Builder",
            startedAt: "2026-06-12T08:00:00.000Z",
            runtimeActivity: "running",
            pendingApprovals: [],
            pendingQuestions: [],
          },
        }),
      ],
      observeAgentSession: async (session) => {
        events.push(`observe:${session.externalSessionId}`);
      },
      loadLiveSessionHistory: async (session) => {
        events.push(`history:${session.externalSessionId}`);
        loadedSessionHistories.push(session);
      },
    });

    expect(harness.result).toBe(true);
    expect(events).toEqual(["observe:external-1", "history:external-1"]);
    expect(loadedSessionHistories).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
        runtimePolicy: { kind: "opencode" },
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      },
    ]);
  });

  test("clears observations for mounted sessions no longer listed by persistence", async () => {
    const cleanedSessions: SessionRef[] = [];
    const removedSession = createAgentSessionFixture({
      externalSessionId: "removed-session",
      taskId: "task-1",
      runtimeKind: "opencode",
      role: "build",
      status: "running",
      workingDirectory: "/repo/old-worktree",
    });

    await loadReadModel({
      initialSessionCollection: createAgentSessionCollection([removedSession]),
      listSessionRuntimeSnapshots: async () => [],
      clearSessionObservationState: (sessions) => {
        cleanedSessions.push(...sessions);
      },
    });

    expect(cleanedSessions).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: "removed-session",
        runtimeKind: "opencode",
        workingDirectory: "/repo/old-worktree",
      },
    ]);
  });

  test("clears stale Codex observations without loading settings", async () => {
    const cleanedSessions: SessionRef[] = [];
    const removedSession = createAgentSessionFixture({
      externalSessionId: "removed-codex-session",
      taskId: "task-1",
      runtimeKind: "codex",
      role: "build",
      status: "running",
      workingDirectory: "/repo/old-codex-worktree",
    });

    await loadReadModel({
      initialSessionCollection: createAgentSessionCollection([removedSession]),
      listSessionRuntimeSnapshots: async () => [],
      clearSessionObservationState: (sessions) => {
        cleanedSessions.push(...sessions);
      },
    });

    expect(cleanedSessions).toEqual([
      {
        repoPath: "/repo",
        externalSessionId: "removed-codex-session",
        runtimeKind: "codex",
        workingDirectory: "/repo/old-codex-worktree",
      },
    ]);
  });

  test("commits the read model when one live session observer fails", async () => {
    const observedSessions: PolicyBoundSessionRef[] = [];
    const records: TaskSessionRecords = {
      taskIds: ["task-1", "task-2"],
      records: [
        { taskId: "task-1", record },
        { taskId: "task-2", record: secondRecord },
      ],
    };
    const harness = await loadReadModel({
      records,
      listSessionRuntimeSnapshots: async () => [
        toAgentSessionRuntimeSnapshot({
          ref: {
            repoPath: "/repo",
            runtimeKind: "opencode",
            workingDirectory: record.workingDirectory,
            externalSessionId: record.externalSessionId,
          },
          snapshot: {
            title: "Builder",
            startedAt: record.startedAt,
            runtimeActivity: "running",
            pendingApprovals: [],
            pendingQuestions: [],
          },
        }),
        toAgentSessionRuntimeSnapshot({
          ref: {
            repoPath: "/repo",
            runtimeKind: "opencode",
            workingDirectory: secondRecord.workingDirectory,
            externalSessionId: secondRecord.externalSessionId,
          },
          snapshot: {
            title: "QA",
            startedAt: secondRecord.startedAt,
            runtimeActivity: "running",
            pendingApprovals: [],
            pendingQuestions: [],
          },
        }),
      ],
      observeAgentSession: async (session) => {
        observedSessions.push(session);
        if (session.externalSessionId === secondRecord.externalSessionId) {
          throw new Error("subscription failed");
        }
      },
    });

    const firstSession = harness.getSession(record.externalSessionId);
    const failedSession = harness.getSession(secondRecord.externalSessionId);

    expect(harness.result).toBe(true);
    expect(firstSession?.status).toBe("running");
    expect(failedSession?.status).toBe("error");
    expect(failedSession?.messages.items.at(-1)).toEqual(
      expect.objectContaining({
        role: "system",
        content: "Failed to observe live session: subscription failed",
        meta: expect.objectContaining({
          kind: "session_notice",
          reason: "session_error",
        }),
      }),
    );
    expect(observedSessions).toHaveLength(2);
  });

  test("settles mounted live state without clearing transcript when runtime snapshot is missing", async () => {
    const mountedSession = {
      ...createAgentSessionFixture({
        externalSessionId: record.externalSessionId,
        taskId: "task-1",
        runtimeKind: "opencode",
        role: "build",
        status: "running",
        startedAt: record.startedAt,
        workingDirectory: record.workingDirectory,
        historyLoadState: "loaded",
      }),
      pendingUserMessageStartedAt: 123,
      messages: createSessionMessagesState(record.externalSessionId, [
        {
          id: "streamed-message",
          role: "assistant",
          content: "Already visible",
          timestamp: "2026-06-12T08:00:01.000Z",
        },
      ]),
    };
    const harness = await loadReadModel({
      initialSessionCollection: createAgentSessionCollection([mountedSession]),
      listSessionRuntimeSnapshots: async () => [],
    });
    const session = harness.getSession(record.externalSessionId);

    expect(session?.status).toBe("idle");
    expect(session?.historyLoadState).toBe("loaded");
    expect(session?.pendingUserMessageStartedAt).toBeUndefined();
    expect(session?.messages).toBe(mountedSession.messages);
  });
});

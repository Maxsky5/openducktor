import { describe, expect, mock, test } from "bun:test";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveReplyApprovalInput,
  AgentSessionLiveSnapshot,
  AgentSessionRecord,
  RepoConfig,
} from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { type AgentSessionReadPort, agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { workspaceQueryKeys } from "@/state/queries/workspace";
import { summarizeAgentActivity } from "@/state/read-models/agent-activity-read-model";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionTranscriptEventConsumer } from "../events/session-transcript-events";
import type { AgentSessionLiveFrontendPort } from "./use-repo-session-read-model";
import { useRepoSessionReadModel } from "./use-repo-session-read-model";

const record: AgentSessionRecord = {
  externalSessionId: "thread-1",
  role: "build",
  runtimeKind: "codex",
  workingDirectory: "/repo/worktree",
  startedAt: "2026-07-16T08:00:00.000Z",
  selectedModel: null,
};

const snapshot = (overrides: Partial<AgentSessionLiveSnapshot> = {}): AgentSessionLiveSnapshot => ({
  ref: {
    repoPath: "/repo",
    runtimeKind: "codex",
    workingDirectory: record.workingDirectory,
    externalSessionId: record.externalSessionId,
  },
  activity: "idle",
  title: "Builder",
  startedAt: record.startedAt,
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
  ...overrides,
});

const createState = (
  duringObservation: (
    emit: (event: AgentSessionLiveEnvelope) => void,
    observeIndex: number,
  ) => void,
  taskRecords: AgentSessionRecord | AgentSessionRecord[] = record,
  sessionReadPort: AgentSessionReadPort = {
    agentSessionsList: async () => {
      throw new Error("Per-task session cache should already be hydrated.");
    },
    agentSessionsListForTasks: async () => {
      throw new Error("Per-task session cache should already be hydrated.");
    },
  },
) => {
  const queryClient = new QueryClient();
  const records = Array.isArray(taskRecords) ? taskRecords : [taskRecords];
  queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), records);
  const sessionStore = createAgentSessionsStore("/repo");
  let listener: ((payload: AgentSessionLiveEnvelope) => void) | null = null;
  const callOrder: string[] = [];
  const observeAgentSessionLive = mock(
    async (
      _input: { repoPath: string },
      nextListener: (payload: AgentSessionLiveEnvelope) => void,
    ) => {
      callOrder.push("observe");
      listener = nextListener;
      duringObservation(nextListener, observeAgentSessionLive.mock.calls.length);
      return mock(() => undefined);
    },
  );
  const agentSessionLiveReplyApproval = mock(
    async (_input: AgentSessionLiveReplyApprovalInput) => undefined,
  );
  const liveSessionPort: AgentSessionLiveFrontendPort = {
    observeAgentSessionLive,
    agentSessionLiveReplyApproval,
  };
  const transcriptEvents: AgentSessionTranscriptEventConsumer = {
    handle: mock(() => undefined),
    close: mock(() => undefined),
  };
  const recoverTranscriptGap = mock(async (_message: string) => undefined);
  const props = {
    workspaceRepoPath: "/repo",
    taskIds: ["task-1"],
    isLoadingTasks: false,
    currentWorkspaceRepoPathRef: { current: "/repo" },
    repoEpochRef: { current: 0 },
    commitSessionCollection: sessionStore.commitSessionCollection,
    liveSessionPort,
    transcriptEvents,
    recoverTranscriptGap,
    queryClient,
    sessionReadPort,
  };

  return {
    callOrder,
    getSession: () =>
      sessionStore.getSessionSnapshot({
        externalSessionId: record.externalSessionId,
        runtimeKind: record.runtimeKind,
        workingDirectory: record.workingDirectory,
      }),
    getActivitySummary: () =>
      summarizeAgentActivity({ sessions: sessionStore.getActivitySnapshot().sessions }),
    harness: createHookHarness(useRepoSessionReadModel, props),
    props,
    observeAgentSessionLive,
    agentSessionLiveReplyApproval,
    recoverTranscriptGap,
    transcriptEvents,
    emit: (payload: AgentSessionLiveEnvelope) => {
      if (!listener) {
        throw new Error("Live-session listener is not ready.");
      }
      listener(payload);
    },
    queryClient,
  };
};

describe("useRepoSessionReadModel", () => {
  test("observes the repository and commits snapshot plus ordered creation once", async () => {
    const state = createState((emit) => {
      emit({
        type: "snapshot",
        repoPath: "/repo",
        sessions: [snapshot()],
      });
      emit({
        type: "session_upsert",
        session: snapshot({
          activity: "waiting_for_permission",
          pendingApprovals: [
            {
              requestId: "opaque-1",
              requestType: "command_execution",
              title: "Run command",
            },
          ],
        }),
      });
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(state.callOrder).toEqual(["observe"]);
      expect(state.getSession()?.pendingApprovals).toEqual([
        expect.objectContaining({ requestId: "opaque-1" }),
      ]);
      expect(state.observeAgentSessionLive).toHaveBeenCalledWith(
        { repoPath: "/repo" },
        expect.any(Function),
      );
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps observing transcript events while tasks synchronize", async () => {
    const state = createState((emit) => {
      emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
    });
    const transcriptEnvelope = {
      type: "transcript_event",
      event: {
        type: "assistant_message",
        externalSessionId: record.externalSessionId,
        messageId: "message-after-record-update",
        message: "Still streaming",
        timestamp: "2026-07-17T14:00:00.000Z",
        sessionRef: snapshot().ref,
      },
    } as const satisfies AgentSessionLiveEnvelope;

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      await state.harness.update({ ...state.props, isLoadingTasks: true });

      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(1);
      expect(state.transcriptEvents.close).not.toHaveBeenCalled();

      await state.harness.run(async () => {
        state.emit(transcriptEnvelope);
      });

      expect(state.transcriptEvents.handle).toHaveBeenCalledWith(transcriptEnvelope.event);

      await state.harness.update({ ...state.props, isLoadingTasks: false });
      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(1);
    } finally {
      await state.harness.unmount();
    }
  });

  test("derives the waiting counter from the same initial snapshot collection commit", async () => {
    const records = [
      record,
      { ...record, externalSessionId: "thread-2", role: "planner" as const },
      { ...record, externalSessionId: "thread-3", role: "qa" as const },
    ];
    const waitingSnapshot = (sessionRecord: AgentSessionRecord): AgentSessionLiveSnapshot =>
      snapshot({
        ref: {
          repoPath: "/repo",
          runtimeKind: sessionRecord.runtimeKind,
          workingDirectory: sessionRecord.workingDirectory,
          externalSessionId: sessionRecord.externalSessionId,
        },
        activity: "waiting_for_permission",
        pendingApprovals: [
          {
            requestId: `approval-${sessionRecord.externalSessionId}`,
            requestType: "command_execution",
            title: "Run command",
          },
        ],
      });
    const state = createState((emit) => {
      emit({
        type: "snapshot",
        repoPath: "/repo",
        sessions: records.map(waitingSnapshot),
      });
    }, records);

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(state.getSession()?.pendingApprovals).toHaveLength(1);
      expect(state.getActivitySummary()).toMatchObject({
        activeSessionCount: 0,
        waitingForInputCount: 3,
      });
      expect(
        state
          .getActivitySummary()
          .waitingForInputSessions.map(({ externalSessionId }) => externalSessionId),
      ).toEqual(["thread-3", "thread-2", "thread-1"]);
    } finally {
      await state.harness.unmount();
    }
  });

  test("does not resurrect a request resolved during observation", async () => {
    const state = createState((emit) => {
      emit({
        type: "snapshot",
        repoPath: "/repo",
        sessions: [
          snapshot({
            pendingApprovals: [
              {
                requestId: "opaque-1",
                requestType: "command_execution",
                title: "Run command",
              },
            ],
          }),
        ],
      });
      emit({
        type: "session_upsert",
        session: snapshot({ pendingApprovals: [] }),
      });
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getSession()?.pendingApprovals).toEqual([]);
    } finally {
      await state.harness.unmount();
    }
  });

  test("invalidates the normalized skills query scope from the ordered stream", async () => {
    const state = createState((emit) => {
      emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
    });
    const invalidateQueries = mock(async () => undefined);
    state.queryClient.invalidateQueries =
      invalidateQueries as typeof state.queryClient.invalidateQueries;

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(async () => {
        state.emit({
          type: "catalog_invalidated",
          scope: {
            repoPath: "/repo",
            runtimeKind: "codex",
            workingDirectory: "/repo/worktree",
          },
        });
      });

      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["runtime-catalog", "skills", "/repo", "codex", "/repo/worktree"],
      });
    } finally {
      await state.harness.unmount();
    }
  });

  test("recovers loaded transcripts when the live stream reports a replay gap", async () => {
    const state = createState((emit) => {
      emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(async () => {
        state.emit({
          type: "transcript_gap",
          repoPath: "/repo",
          message: "Host event replay skipped transcript events.",
        });
      });

      expect(state.recoverTranscriptGap).toHaveBeenCalledWith(
        "Host event replay skipped transcript events.",
      );
      expect(state.harness.getLatest().sessionReadModelLoadState.kind).toBe("ready");
    } finally {
      await state.harness.unmount();
    }
  });

  test("surfaces transcript-gap recovery failures in the read-model state", async () => {
    const state = createState((emit) => {
      emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
    });
    state.recoverTranscriptGap.mockImplementation(async () => {
      throw new Error("history reload failed");
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(async () => {
        state.emit({
          type: "transcript_gap",
          repoPath: "/repo",
          message: "Host event replay skipped transcript events.",
        });
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      expect(state.harness.getLatest().sessionReadModelLoadState).toEqual({
        kind: "failed",
        workspaceRepoPath: "/repo",
        message:
          "Failed to recover transcript history after a live-stream gap: history reload failed",
      });
    } finally {
      await state.harness.unmount();
    }
  });

  test("explicit retry recovers a failed task session query without reloading healthy caches", async () => {
    const recoveredRecord = { ...record, externalSessionId: "thread-recovered" };
    const batchList = mock(async () => [{ taskId: "task-1", agentSessions: [recoveredRecord] }]);
    const state = createState(
      (emit) => {
        emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
      },
      record,
      {
        agentSessionsList: async () => {
          throw new Error("Exact reads are not used by explicit batch retry.");
        },
        agentSessionsListForTasks: batchList,
      },
    );

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await expect(
        state.queryClient.fetchQuery({
          queryKey: agentSessionQueryKeys.list("/repo", "task-1"),
          queryFn: async () => {
            throw new Error("temporary exact refresh failure");
          },
          staleTime: 0,
          retry: false,
        }),
      ).rejects.toThrow("temporary exact refresh failure");
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      await state.harness.run(() => {
        state.harness.getLatest().reloadSessionReadModel();
      });

      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(batchList).toHaveBeenCalledTimes(1);
      expect(batchList).toHaveBeenCalledWith("/repo", ["task-1"]);
      expect(
        state.queryClient.getQueryData<AgentSessionRecord[]>(
          agentSessionQueryKeys.list("/repo", "task-1"),
        ),
      ).toEqual([recoveredRecord]);
    } finally {
      await state.harness.unmount();
    }
  });

  test("applies one runtime-neutral role policy to initial and newly added pending ids", async () => {
    const initialApproval = {
      requestId: "initial-mutating",
      requestType: "file_change" as const,
      title: "Edit file",
      mutation: "mutating" as const,
    };
    const laterApproval = {
      ...initialApproval,
      requestId: "later-mutating",
    };
    const state = createState(
      (emit) => {
        emit({
          type: "snapshot",
          repoPath: "/repo",
          sessions: [snapshot({ pendingApprovals: [initialApproval] })],
        });
      },
      { ...record, role: "spec" },
    );
    const repoConfig: RepoConfig = {
      workspaceId: "/repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      defaultRuntimeKind: "codex",
      branchPrefix: "odt/",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: { providers: {} },
      hooks: { preStart: [], postComplete: [] },
      devServers: [],
      promptOverrides: {
        "permission.read_only.reject": {
          template: "Custom read-only rejection for {{role}}.",
          baseVersion: 1,
          enabled: true,
        },
      },
      worktreeCopyPaths: [],
      agentDefaults: {},
    };
    state.queryClient.setQueryData(workspaceQueryKeys.repoConfig("/repo"), repoConfig);
    state.queryClient.setQueryData(
      workspaceQueryKeys.settingsSnapshot(),
      createSettingsSnapshotFixture(),
    );

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(state.agentSessionLiveReplyApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo/worktree",
          externalSessionId: "thread-1",
          requestId: "initial-mutating",
          outcome: "reject",
          message: "Custom read-only rejection for spec.",
        }),
      );
      expect(state.getSession()?.pendingApprovals.map(({ requestId }) => requestId)).toEqual([
        "initial-mutating",
      ]);

      await state.harness.run(async () => {
        state.emit({
          type: "session_upsert",
          session: snapshot({ pendingApprovals: [initialApproval, laterApproval] }),
        });
      });

      expect(state.agentSessionLiveReplyApproval).toHaveBeenCalledTimes(2);
      expect(
        state.agentSessionLiveReplyApproval.mock.calls.map(([input]) => input.requestId),
      ).toEqual(["initial-mutating", "later-mutating"]);
      expect(state.getSession()?.pendingApprovals.map(({ requestId }) => requestId)).toEqual([
        "initial-mutating",
        "later-mutating",
      ]);
    } finally {
      await state.harness.unmount();
    }
  });
});

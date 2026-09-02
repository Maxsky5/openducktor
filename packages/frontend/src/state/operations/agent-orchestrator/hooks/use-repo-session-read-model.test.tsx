import { describe, expect, mock, test } from "bun:test";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveRefreshInput,
  AgentSessionLiveReplyApprovalInput,
  AgentSessionLiveSnapshot,
  AgentSessionRecord,
  RepoConfig,
} from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { type AgentSessionReadPort, agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { workspaceQueryKeys } from "@/state/queries/workspace";
import { summarizeAgentActivity } from "@/state/read-models/agent-activity-read-model";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import {
  createAgentSessionFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
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

const createReadOnlyRepoConfig = (): RepoConfig => ({
  workspaceId: "/repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "codex",
  branchPrefix: "odt/",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
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
});

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

type TaskSessionRecordBatch = Array<{
  taskId: string;
  agentSessions: AgentSessionRecord[];
}>;

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

const scopedFault = (ref = snapshot().ref) =>
  ({
    type: "fault",
    repoPath: "/repo",
    message: "The runtime lost this session.",
    ref,
  }) as const satisfies AgentSessionLiveEnvelope;

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
  if (records.length === 0) {
    sessionStore.replaceSession(
      createAgentSessionFixture({
        externalSessionId: record.externalSessionId,
        runtimeKind: record.runtimeKind,
        workingDirectory: record.workingDirectory,
        sessionAssociation: { kind: "unbound" },
        status: "idle",
        startedAt: record.startedAt,
      }),
    );
  }
  let listener: ((payload: AgentSessionLiveEnvelope) => void) | null = null;
  const callOrder: string[] = [];
  const unsubscribe = mock(() => undefined);
  const observeAgentSessionLive = mock(
    async (
      _input: AgentSessionLiveRefreshInput,
      nextListener: (payload: AgentSessionLiveEnvelope) => void,
    ) => {
      callOrder.push("observe");
      listener = nextListener;
      duringObservation(nextListener, observeAgentSessionLive.mock.calls.length);
      return unsubscribe;
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
  const props: Parameters<typeof useRepoSessionReadModel>[0] = {
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
    getStoredSession: (identity: {
      externalSessionId: string;
      runtimeKind: AgentSessionRecord["runtimeKind"];
      workingDirectory: string;
    }) => sessionStore.getSessionSnapshot(identity),
    getActivitySummary: () =>
      summarizeAgentActivity({ sessions: sessionStore.getActivitySnapshot().sessions }),
    harness: createHookHarness(useRepoSessionReadModel, props),
    props,
    observeAgentSessionLive,
    unsubscribe,
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
    updateSession: sessionStore.updateSession,
  };
};

const createRepositoryConflictRetryState = (
  agentSessionsListForTasks: AgentSessionReadPort["agentSessionsListForTasks"],
  duringObservation: Parameters<typeof createState>[0] = (emit) => {
    emit({
      type: "snapshot",
      repoPath: "/repo",
      sessions: [snapshot({ repositoryScope: { kind: "repository" } })],
    });
  },
) =>
  createState(duringObservation, [], {
    agentSessionsList: async () => [],
    agentSessionsListForTasks,
  });

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
      expect(state.getSession()?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });
      expect(state.observeAgentSessionLive).toHaveBeenCalledWith(
        { repoPath: "/repo" },
        expect.any(Function),
      );
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps a live workflow session across a later task-record refresh", async () => {
    const state = createState((emit) => {
      emit({
        type: "snapshot",
        repoPath: "/repo",
        sessions: [snapshot()],
      });
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getSession()?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });

      // The durable record list changes while the runtime still reports thread-1.
      // A new historical record proves the refresh actually applied.
      const refreshedRecords = [{ ...record, externalSessionId: "thread-refreshed-in" }];
      await state.harness.run(() => {
        state.queryClient.setQueryData(
          agentSessionQueryKeys.list("/repo", "task-1"),
          refreshedRecords,
        );
      });
      const refreshedIdentity = {
        externalSessionId: "thread-refreshed-in",
        runtimeKind: record.runtimeKind,
        workingDirectory: record.workingDirectory,
      };
      await state.harness.waitFor(() => state.getStoredSession(refreshedIdentity) !== null);

      expect(state.getStoredSession(refreshedIdentity)?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });
      expect(state.getSession()).not.toBeNull();
      expect(state.getSession()?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });
    } finally {
      await state.harness.unmount();
    }
  });

  test("preserves a fresher selected model across live snapshots", async () => {
    const state = createState((emit) => {
      emit({
        type: "snapshot",
        repoPath: "/repo",
        sessions: [snapshot()],
      });
    });
    const selectedModel = {
      runtimeKind: "codex",
      providerId: "openai",
      modelId: "gpt-5.2",
    } as const;

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      await state.harness.run(() => {
        const updated = state.updateSession(snapshot().ref, (current) => ({
          ...current,
          selectedModel,
        }));
        if (!updated) {
          throw new Error("Expected the selected model to change.");
        }
      });
      expect(state.getSession()?.selectedModel).toEqual(selectedModel);

      await state.harness.run(() => {
        state.emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
      });

      expect(state.getSession()?.selectedModel).toEqual(selectedModel);
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps a live workflow session when records refresh during an observer restart gap", async () => {
    const releaseRestartSnapshot = createDeferred<void>();
    const state = createState((emit, observeIndex) => {
      if (observeIndex === 1) {
        emit({
          type: "snapshot",
          repoPath: "/repo",
          sessions: [snapshot()],
        });
        return;
      }
      // The restarted observer delays its authoritative snapshot.
      void releaseRestartSnapshot.promise.then(() => {
        emit({
          type: "snapshot",
          repoPath: "/repo",
          sessions: [snapshot()],
        });
      });
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getSession()?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });

      await state.harness.run(() => {
        state.harness.getLatest().reloadSessionReadModel();
      });
      await state.harness.waitFor(() => state.observeAgentSessionLive.mock.calls.length === 2);

      // Task records refresh while the restarted observer waits for its snapshot.
      const refreshedRecords = [{ ...record, externalSessionId: "thread-refreshed-in-gap" }];
      await state.harness.run(() => {
        state.queryClient.setQueryData(
          agentSessionQueryKeys.list("/repo", "task-1"),
          refreshedRecords,
        );
      });
      const refreshedIdentity = {
        externalSessionId: "thread-refreshed-in-gap",
        runtimeKind: record.runtimeKind,
        workingDirectory: record.workingDirectory,
      };
      await state.harness.waitFor(() => state.getStoredSession(refreshedIdentity) !== null);

      expect(state.getSession()).not.toBeNull();
      expect(state.getSession()?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });

      releaseRestartSnapshot.resolve();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getSession()).not.toBeNull();
    } finally {
      await state.harness.unmount();
      releaseRestartSnapshot.resolve();
    }
  });

  test("finishes deletion when the runtime removes a session whose record already disappeared", async () => {
    const historical = { ...record, externalSessionId: "hist-thread", role: "planner" as const };
    const state = createState(
      (emit) => {
        emit({
          type: "snapshot",
          repoPath: "/repo",
          sessions: [snapshot()],
        });
      },
      [record, historical],
    );
    const historicalIdentity = {
      externalSessionId: historical.externalSessionId,
      runtimeKind: historical.runtimeKind,
      workingDirectory: historical.workingDirectory,
    };

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getSession()).not.toBeNull();

      // A loaded task refresh empties the durable list: the historical row is
      // pruned immediately (proof the refresh applied) while the live session stays.
      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), []);
      });
      await state.harness.waitFor(() => state.getStoredSession(historicalIdentity) === null);
      expect(state.getSession()).not.toBeNull();
      expect(state.getSession()?.livePresence).toBe("present");

      // The runtime withdraws live evidence; no further query update is needed.
      await state.harness.run(() => {
        state.emit({ type: "session_removed", ref: snapshot().ref });
      });
      await state.harness.waitFor(() => state.getSession() === null);
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps a removed live session while the switched task set is still hydrating", async () => {
    const task2Hydration = createDeferred<TaskSessionRecordBatch>();
    const state = createState(
      (emit) => {
        emit({
          type: "snapshot",
          repoPath: "/repo",
          sessions: [snapshot()],
        });
      },
      [],
      {
        agentSessionsList: async () => [],
        agentSessionsListForTasks: () => task2Hydration.promise,
      },
    );

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getSession()?.livePresence).toBe("present");

      // Same-repo task-set change while task 2 hydration is still pending.
      const threadTwo = { ...record, externalSessionId: "thread-two", role: "qa" as const };
      await state.harness.update({ ...state.props, taskIds: ["task-2"] });

      // The runtime withdraws the live session before any current-scope read
      // has succeeded; the stale task-1 records must not become deletion proof.
      await state.harness.run(() => {
        state.emit({ type: "session_removed", ref: snapshot().ref });
      });
      expect(state.getSession()).not.toBeNull();
      expect(state.getSession()?.livePresence).toBe("absent");

      // Task 2 finishes hydrating; its owner set cannot prove anything about
      // the task-1 session either.
      await state.harness.run(async () => {
        task2Hydration.resolve([{ taskId: "task-2", agentSessions: [threadTwo] }]);
        await task2Hydration.promise;
      });
      const threadTwoIdentity = {
        externalSessionId: threadTwo.externalSessionId,
        runtimeKind: threadTwo.runtimeKind,
        workingDirectory: threadTwo.workingDirectory,
      };
      await state.harness.waitFor(() => state.getStoredSession(threadTwoIdentity) !== null);
      expect(state.getStoredSession(threadTwoIdentity)?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-2",
        role: "qa",
      });
      expect(state.getSession()).not.toBeNull();
    } finally {
      await state.harness.unmount();
    }
  });

  test("recovers the read model when a successful task set follows a failed one", async () => {
    const batchList = mock(async () => [
      {
        taskId: "task-3",
        agentSessions: [{ ...record, externalSessionId: "thread-three", role: "qa" as const }],
      },
    ]);
    const state = createState(
      (emit) => {
        emit({
          type: "snapshot",
          repoPath: "/repo",
          sessions: [snapshot()],
        });
      },
      [],
      {
        agentSessionsList: async () => [],
        agentSessionsListForTasks: batchList,
      },
    );
    const threadThreeIdentity = {
      externalSessionId: "thread-three",
      runtimeKind: record.runtimeKind,
      workingDirectory: record.workingDirectory,
    };

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      // Task 2's durable read fails for its exact list query.
      await expect(
        state.queryClient.fetchQuery({
          queryKey: agentSessionQueryKeys.list("/repo", "task-2"),
          queryFn: async () => {
            throw new Error("task 2 read failed");
          },
          staleTime: 0,
          retry: false,
        }),
      ).rejects.toThrow("task 2 read failed");
      await state.harness.update({ ...state.props, taskIds: ["task-2"] });
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.message.endsWith("task 2 read failed"),
      );

      // Task 3 loads successfully on the same live observation; its collection
      // applies and the stale task-2 failure no longer describes this scope.
      await state.harness.update({ ...state.props, taskIds: ["task-3"] });
      await state.harness.waitFor(() => state.getStoredSession(threadThreeIdentity) !== null);
      const threadThree = state.getStoredSession(threadThreeIdentity);
      if (!threadThree) {
        throw new Error("Expected task-3 historical session.");
      }
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(threadThree.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-3",
        role: "qa",
      });
      expect(state.getSession()).not.toBeNull();
      expect(batchList).toHaveBeenCalledTimes(1);
      expect(batchList).toHaveBeenCalledWith("/repo", ["task-3"]);
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps an unresolved repository fault failed across a successful record refresh", async () => {
    const state = createState((emit) => {
      emit({
        type: "snapshot",
        repoPath: "/repo",
        sessions: [snapshot()],
      });
    });
    const refreshedIdentity = {
      externalSessionId: "thread-refreshed",
      runtimeKind: record.runtimeKind,
      workingDirectory: record.workingDirectory,
    };

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      await state.harness.run(() => {
        state.emit({
          type: "fault",
          repoPath: "/repo",
          message: "The observation stream stopped.",
        });
      });
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.message.endsWith("The observation stream stopped."),
      );

      // A healthy durable-record refresh applies, proves it applied by
      // materializing its session, and still cannot clear the live fault.
      const refreshedRecords = [{ ...record, externalSessionId: "thread-refreshed" }];
      await state.harness.run(() => {
        state.queryClient.setQueryData(
          agentSessionQueryKeys.list("/repo", "task-1"),
          refreshedRecords,
        );
      });
      await state.harness.waitFor(() => state.getStoredSession(refreshedIdentity) !== null);

      const latest = state.harness.getLatest().sessionReadModelLoadState;
      if (latest.kind !== "failed") {
        throw new Error("Expected the observation failure to stay failed.");
      }
      expect(latest.source).toBe("live-stream");
      expect(latest.message).toContain("The observation stream stopped.");
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps an unresolved transcript-gap recovery failure across a successful record refresh", async () => {
    const state = createState((emit) => {
      emit({
        type: "snapshot",
        repoPath: "/repo",
        sessions: [snapshot()],
      });
    });
    state.recoverTranscriptGap.mockImplementation(async () => {
      throw new Error("history reload failed");
    });
    const refreshedIdentity = {
      externalSessionId: "thread-refreshed-gap",
      runtimeKind: record.runtimeKind,
      workingDirectory: record.workingDirectory,
    };

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
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.message.endsWith("history reload failed"),
      );

      const refreshedRecords = [{ ...record, externalSessionId: "thread-refreshed-gap" }];
      await state.harness.run(() => {
        state.queryClient.setQueryData(
          agentSessionQueryKeys.list("/repo", "task-1"),
          refreshedRecords,
        );
      });
      await state.harness.waitFor(() => state.getStoredSession(refreshedIdentity) !== null);

      const latest = state.harness.getLatest().sessionReadModelLoadState;
      if (latest.kind !== "failed") {
        throw new Error("Expected the transcript-gap recovery failure to stay failed.");
      }
      expect(latest.source).toBe("live-stream");
      expect(latest.message).toContain("history reload failed");
    } finally {
      await state.harness.unmount();
    }
  });

  test("shows loading while a hydrating task set supersedes a stale failure", async () => {
    const deferredB = createDeferred<TaskSessionRecordBatch>();
    const batchList = mock(() => deferredB.promise);
    const state = createState(
      (emit) => {
        emit({
          type: "snapshot",
          repoPath: "/repo",
          sessions: [snapshot()],
        });
      },
      [],
      {
        agentSessionsList: async () => [],
        agentSessionsListForTasks: batchList,
      },
    );
    const threadThree = { ...record, externalSessionId: "thread-three", role: "qa" as const };

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      // Task 2's durable read fails for its exact list query.
      await expect(
        state.queryClient.fetchQuery({
          queryKey: agentSessionQueryKeys.list("/repo", "task-2"),
          queryFn: async () => {
            throw new Error("task 2 read failed");
          },
          staleTime: 0,
          retry: false,
        }),
      ).rejects.toThrow("task 2 read failed");
      await state.harness.update({ ...state.props, taskIds: ["task-2"] });
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.message.endsWith("task 2 read failed"),
      );

      // Switching to task 3 demotes the stale failure to loading, and a live
      // snapshot mid-hydration must not bring the old failure back.
      await state.harness.update({ ...state.props, taskIds: ["task-3"] });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "loading");
      await state.harness.run(() => {
        state.emit({
          type: "snapshot",
          repoPath: "/repo",
          sessions: [snapshot()],
        });
      });
      expect(state.harness.getLatest().sessionReadModelLoadState.kind).toBe("loading");

      deferredB.resolve([{ taskId: "task-3", agentSessions: [threadThree] }]);
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(
        state.getStoredSession({
          externalSessionId: threadThree.externalSessionId,
          runtimeKind: threadThree.runtimeKind,
          workingDirectory: threadThree.workingDirectory,
        }),
      ).not.toBeNull();
    } finally {
      await state.harness.unmount();
      deferredB.resolve([]);
    }
  });

  test("keeps a live-stream failure failed across record recovery until the stream recovers", async () => {
    const state = createState((emit) => {
      emit({
        type: "snapshot",
        repoPath: "/repo",
        sessions: [snapshot()],
      });
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      // The live stream breaks.
      await state.harness.run(() => {
        state.emit({
          type: "fault",
          repoPath: "/repo",
          message: "The observation stream stopped.",
        });
      });
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.message.endsWith("The observation stream stopped."),
      );

      // A task-record read failure then overwrites the public slot.
      await expect(
        state.queryClient.fetchQuery({
          queryKey: agentSessionQueryKeys.list("/repo", "task-1"),
          queryFn: async () => {
            throw new Error("record read failed");
          },
          staleTime: 0,
          retry: false,
        }),
      ).rejects.toThrow("record read failed");
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.message.endsWith("record read failed"),
      );

      // The record read recovers; the live-stream failure must surface again.
      const refreshedRecords = [{ ...record, externalSessionId: "thread-after-recovery" }];
      await state.harness.run(() => {
        state.queryClient.setQueryData(
          agentSessionQueryKeys.list("/repo", "task-1"),
          refreshedRecords,
        );
      });
      const recoveredIdentity = {
        externalSessionId: "thread-after-recovery",
        runtimeKind: record.runtimeKind,
        workingDirectory: record.workingDirectory,
      };
      await state.harness.waitFor(() => state.getStoredSession(recoveredIdentity) !== null);

      const latest = state.harness.getLatest().sessionReadModelLoadState;
      if (latest.kind !== "failed") {
        throw new Error("Expected the live-stream failure to stay failed.");
      }
      expect(latest.source).toBe("live-stream");
      expect(latest.message).toContain("The observation stream stopped.");

      // A fresh authoritative snapshot proves the stream is healthy again.
      await state.harness.run(() => {
        state.emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
    } finally {
      await state.harness.unmount();
    }
  });

  test("clears a public live failure when the stream recovers during task hydration", async () => {
    const deferredRecords = createDeferred<TaskSessionRecordBatch>();
    const state = createState(
      (emit) => {
        emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
      },
      [],
      {
        agentSessionsList: async () => [],
        agentSessionsListForTasks: mock(() => deferredRecords.promise),
      },
    );

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      await state.harness.update({ ...state.props, taskIds: ["task-2"] });
      await state.harness.run(() => {
        state.emit({
          type: "fault",
          repoPath: "/repo",
          message: "The observation stream stopped.",
        });
      });
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.source === "live-stream",
      );

      await state.harness.run(() => {
        state.emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "loading");

      deferredRecords.resolve([{ taskId: "task-2", agentSessions: [] }]);
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
    } finally {
      await state.harness.unmount();
      deferredRecords.resolve([]);
    }
  });

  test("waits for the initial live snapshot after task-record recovery", async () => {
    const state = createState(() => undefined);
    const recoveredRecord = { ...record, externalSessionId: "thread-after-recovery" };
    const recoveredIdentity = {
      externalSessionId: recoveredRecord.externalSessionId,
      runtimeKind: recoveredRecord.runtimeKind,
      workingDirectory: recoveredRecord.workingDirectory,
    };

    try {
      await state.harness.mount();
      await state.harness.waitFor(() => state.observeAgentSessionLive.mock.calls.length === 1);
      await expect(
        state.queryClient.fetchQuery({
          queryKey: agentSessionQueryKeys.list("/repo", "task-1"),
          queryFn: async () => {
            throw new Error("record read failed before snapshot");
          },
          staleTime: 0,
          retry: false,
        }),
      ).rejects.toThrow("record read failed before snapshot");
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [
          recoveredRecord,
        ]);
      });
      await state.harness.waitFor(() => state.getStoredSession(recoveredIdentity) !== null);

      expect(state.harness.getLatest().sessionReadModelLoadState.kind).toBe("loading");

      await state.harness.run(() => {
        state.emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
    } finally {
      await state.harness.unmount();
    }
  });

  test("resurfaces an unresolved live failure after a hydrating task set supersedes a stale one", async () => {
    const deferredB = createDeferred<TaskSessionRecordBatch>();
    const batchList = mock(() => deferredB.promise);
    const state = createState(
      (emit) => {
        emit({
          type: "snapshot",
          repoPath: "/repo",
          sessions: [snapshot()],
        });
      },
      [],
      {
        agentSessionsList: async () => [],
        agentSessionsListForTasks: batchList,
      },
    );

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      // The live stream breaks.
      await state.harness.run(() => {
        state.emit({
          type: "fault",
          repoPath: "/repo",
          message: "The observation stream stopped.",
        });
      });
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.message.endsWith("The observation stream stopped."),
      );

      // A task-record read failure then overwrites the public slot.
      await expect(
        state.queryClient.fetchQuery({
          queryKey: agentSessionQueryKeys.list("/repo", "task-2"),
          queryFn: async () => {
            throw new Error("task 2 read failed");
          },
          staleTime: 0,
          retry: false,
        }),
      ).rejects.toThrow("task 2 read failed");
      await state.harness.update({ ...state.props, taskIds: ["task-2"] });
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.message.endsWith("task 2 read failed"),
      );

      // Switching task sets demotes the stale failure to loading; when the
      // new scope loads, the still-unresolved live failure must surface again.
      await state.harness.update({ ...state.props, taskIds: ["task-3"] });
      deferredB.resolve([
        {
          taskId: "task-3",
          agentSessions: [{ ...record, externalSessionId: "thread-three", role: "qa" as const }],
        },
      ]);
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      const latest = state.harness.getLatest().sessionReadModelLoadState;
      if (latest.kind !== "failed") {
        throw new Error("Expected the live-stream failure to stay failed.");
      }
      expect(latest.source).toBe("live-stream");
      expect(latest.message).toContain("The observation stream stopped.");
    } finally {
      await state.harness.unmount();
      deferredB.resolve([]);
    }
  });

  test("permits historical pruning after the runtime removes a live session", async () => {
    const state = createState((emit) => {
      emit({
        type: "snapshot",
        repoPath: "/repo",
        sessions: [snapshot()],
      });
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getSession()).not.toBeNull();

      await state.harness.run(() => {
        state.emit({ type: "session_removed", ref: snapshot().ref });
      });
      expect(state.getSession()).not.toBeNull();

      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), []);
      });
      await state.harness.waitFor(() => state.getSession() === null);
    } finally {
      await state.harness.unmount();
    }
  });

  test("projects repository association into session state", async () => {
    const state = createState((emit) => {
      emit({
        type: "snapshot",
        repoPath: "/repo",
        sessions: [snapshot({ repositoryScope: { kind: "repository" } })],
      });
    }, []);

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(state.getSession()?.sessionAssociation).toEqual({ kind: "repository" });
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps the current collection and reports a task-refresh association conflict", async () => {
    const state = createState((emit) => {
      emit({
        type: "snapshot",
        repoPath: "/repo",
        sessions: [snapshot({ repositoryScope: { kind: "repository" } })],
      });
    }, []);

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      expect(state.getSession()?.sessionAssociation).toEqual({ kind: "repository" });

      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [record]);
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      expect(state.getSession()?.sessionAssociation).toEqual({ kind: "repository" });
      expect(state.harness.getLatest().sessionReadModelLoadState).toEqual({
        kind: "failed",
        workspaceRepoPath: "/repo",
        message:
          "Failed to reconcile task session records for repo '/repo': Cannot reconcile persisted session 'thread-1' because its registered repository scope does not match the incoming workflow scope for task 'task-1' and role 'build'.",
        source: "task-records",
      });

      await state.harness.run(() => {
        state.emit({
          type: "snapshot",
          repoPath: "/repo",
          sessions: [snapshot({ repositoryScope: { kind: "repository" } })],
        });
      });
      expect(state.harness.getLatest().sessionReadModelLoadState.kind).toBe("failed");
      expect(state.getSession()?.sessionAssociation).toEqual({ kind: "repository" });
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps an unchanged association conflict failed after retry", async () => {
    const batchList = mock(async () => [{ taskId: "task-1", agentSessions: [record] }]);
    const state = createState(
      (emit) => {
        emit({
          type: "snapshot",
          repoPath: "/repo",
          sessions: [snapshot({ repositoryScope: { kind: "repository" } })],
        });
      },
      [],
      {
        agentSessionsList: async () => [],
        agentSessionsListForTasks: batchList,
      },
    );

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [record]);
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      await state.harness.waitFor(() => batchList.mock.calls.length === 1);

      expect(state.harness.getLatest().sessionReadModelLoadState).toEqual({
        kind: "failed",
        workspaceRepoPath: "/repo",
        message:
          "Failed to reconcile task session records for repo '/repo': Cannot reconcile persisted session 'thread-1' because its registered repository scope does not match the incoming workflow scope for task 'task-1' and role 'build'.",
        source: "task-records",
      });
      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(1);
      expect(state.getSession()?.sessionAssociation).toEqual({ kind: "repository" });
    } finally {
      await state.harness.unmount();
    }
  });

  test("recovers an association conflict after retry reads corrected task records", async () => {
    const batchList = mock(async () => [{ taskId: "task-1", agentSessions: [] }]);
    const state = createState(
      (emit) => {
        emit({
          type: "snapshot",
          repoPath: "/repo",
          sessions: [snapshot({ repositoryScope: { kind: "repository" } })],
        });
      },
      [],
      {
        agentSessionsList: async () => [],
        agentSessionsListForTasks: batchList,
      },
    );

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [record]);
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(batchList).toHaveBeenCalledTimes(1);
      expect(batchList).toHaveBeenCalledWith("/repo", ["task-1"]);
      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(2);
      expect(state.getSession()?.sessionAssociation).toEqual({ kind: "repository" });
      expect(
        state.queryClient.getQueryData<AgentSessionRecord[]>(
          agentSessionQueryKeys.list("/repo", "task-1"),
        ),
      ).toEqual([]);
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps forced record retry mode after a transient retry failure", async () => {
    const batchList = mock(async () => {
      if (batchList.mock.calls.length === 1) {
        throw new Error("forced retry failed");
      }
      return [{ taskId: "task-1", agentSessions: [] }];
    });
    const state = createRepositoryConflictRetryState(batchList);

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [record]);
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "failed" &&
          value.sessionReadModelLoadState.message.endsWith("forced retry failed"),
      );

      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      await state.harness.waitFor(() => batchList.mock.calls.length === 2);
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(batchList).toHaveBeenCalledTimes(2);
      expect(
        state.queryClient.getQueryData<AgentSessionRecord[]>(
          agentSessionQueryKeys.list("/repo", "task-1"),
        ),
      ).toEqual([]);
    } finally {
      await state.harness.unmount();
    }
  });

  test("does not replay stale task records when task IDs change during conflict retry", async () => {
    const retry = createDeferred<TaskSessionRecordBatch>();
    const batchList = mock(() => retry.promise);
    const state = createRepositoryConflictRetryState(batchList);

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [record]);
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      await state.harness.waitFor(() => batchList.mock.calls.length === 1);
      await state.harness.update({ ...state.props, taskIds: [] });

      retry.resolve([{ taskId: "task-1", agentSessions: [record] }]);
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(batchList).toHaveBeenCalledWith("/repo", ["task-1"]);
      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(2);
      expect(state.getSession()?.sessionAssociation).toEqual({ kind: "repository" });
    } finally {
      await state.harness.unmount();
    }
  });

  test("does not surface a stale retry failure after task IDs change", async () => {
    const retry = createDeferred<TaskSessionRecordBatch>();
    const batchList = mock(() => retry.promise);
    const state = createRepositoryConflictRetryState(batchList);

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [record]);
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      await state.harness.waitFor(() => batchList.mock.calls.length === 1);
      await state.harness.update({ ...state.props, taskIds: [] });

      retry.reject(new Error("stale retry failed"));
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(2);
      expect(state.getSession()?.sessionAssociation).toEqual({ kind: "repository" });
    } finally {
      await state.harness.unmount();
    }
  });

  test("does not restart a new repository for a pending retry from the old repository", async () => {
    const retry = createDeferred<TaskSessionRecordBatch>();
    const batchList = mock(() => retry.promise);
    const state = createRepositoryConflictRetryState(batchList, (emit, observeIndex) => {
      const repoPath = observeIndex === 1 ? "/repo" : "/repo-b";
      emit({
        type: "snapshot",
        repoPath,
        sessions:
          observeIndex === 1
            ? [
                snapshot({
                  ref: { ...snapshot().ref, repoPath },
                  repositoryScope: { kind: "repository" },
                }),
              ]
            : [],
      });
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [record]);
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      await state.harness.waitFor(() => batchList.mock.calls.length === 1);
      await state.harness.update({
        ...state.props,
        taskIds: ["task-2"],
        isLoadingTasks: true,
      });
      await state.harness.run(async () => {
        retry.resolve([{ taskId: "task-1", agentSessions: [record] }]);
        await retry.promise;
        await Promise.resolve();
      });

      state.props.currentWorkspaceRepoPathRef.current = "/repo-b";
      state.props.repoEpochRef.current += 1;
      await state.harness.update({
        ...state.props,
        workspaceRepoPath: "/repo-b",
        taskIds: [],
      });
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "ready" &&
          value.sessionReadModelLoadState.workspaceRepoPath === "/repo-b",
      );

      expect(state.observeAgentSessionLive.mock.calls.map(([input]) => input.repoPath)).toEqual([
        "/repo",
        "/repo-b",
      ]);
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps the persisted collection and reports an initial snapshot association conflict", async () => {
    const state = createState(() => undefined);

    try {
      await state.harness.mount();
      await state.harness.waitFor(() => state.observeAgentSessionLive.mock.calls.length === 1);
      expect(state.getSession()?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });

      await state.harness.run(() => {
        state.emit({
          type: "snapshot",
          repoPath: "/repo",
          sessions: [snapshot({ repositoryScope: { kind: "repository" } })],
        });
      });
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      expect(state.getSession()?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });
      expect(state.harness.getLatest().sessionReadModelLoadState).toEqual({
        kind: "failed",
        workspaceRepoPath: "/repo",
        message:
          "Failed to apply initial live-session snapshot for repo '/repo': Cannot apply live snapshot for session 'thread-1' because its registered workflow scope for task 'task-1' and role 'build' does not match the incoming repository scope.",
        source: "live-stream",
      });
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps the current collection and records a later delta association conflict", async () => {
    const state = createState((emit) => {
      emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
    });
    const identity = {
      externalSessionId: record.externalSessionId,
      runtimeKind: record.runtimeKind,
      workingDirectory: record.workingDirectory,
    };

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      await state.harness.run(() => {
        state.emit({
          type: "session_upsert",
          session: snapshot({ repositoryScope: { kind: "repository" } }),
        });
      });

      expect(state.getSession()?.sessionAssociation).toEqual({
        kind: "workflow",
        taskId: "task-1",
        role: "build",
      });
      expect(state.harness.getLatest().getSessionFault(identity)).toEqual({
        message:
          "Failed to apply live-session update: Cannot apply live snapshot for session 'thread-1' because its registered workflow scope for task 'task-1' and role 'build' does not match the incoming repository scope.",
      });
      expect(state.harness.getLatest().sessionReadModelLoadState.kind).toBe("ready");
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

  test("keeps the active observation stable when stream callbacks refresh", async () => {
    const state = createState((emit) => {
      emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
    });
    const refreshedTranscriptEvents: AgentSessionTranscriptEventConsumer = {
      handle: mock(() => undefined),
      close: mock(() => undefined),
    };
    const refreshedRecoverTranscriptGap = mock(async (_message: string) => undefined);

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      await state.harness.update({
        ...state.props,
        liveSessionPort: { ...state.props.liveSessionPort },
        transcriptEvents: refreshedTranscriptEvents,
        recoverTranscriptGap: refreshedRecoverTranscriptGap,
      });

      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(1);
      expect(state.transcriptEvents.close).toHaveBeenCalledTimes(1);

      await state.harness.run(async () => {
        state.emit({
          type: "transcript_event",
          event: {
            type: "assistant_message",
            externalSessionId: record.externalSessionId,
            messageId: "message-after-callback-refresh",
            message: "Still streaming",
            timestamp: "2026-07-17T14:00:00.000Z",
            sessionRef: snapshot().ref,
          },
        });
        state.emit({
          type: "transcript_gap",
          repoPath: "/repo",
          message: "Refresh history with the latest callback.",
        });
      });

      expect(state.transcriptEvents.handle).not.toHaveBeenCalled();
      expect(refreshedTranscriptEvents.handle).toHaveBeenCalledTimes(1);
      expect(state.recoverTranscriptGap).not.toHaveBeenCalled();
      expect(refreshedRecoverTranscriptGap).toHaveBeenCalledWith(
        "Refresh history with the latest callback.",
      );
    } finally {
      await state.harness.unmount();
    }

    expect(state.transcriptEvents.close).toHaveBeenCalledTimes(1);
    expect(refreshedTranscriptEvents.close).toHaveBeenCalledTimes(1);
  });

  test("uses the latest observe callback when stream identity changes", async () => {
    const state = createState((emit) => {
      emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
    });
    const secondUnsubscribe = mock(() => undefined);
    const secondObserveAgentSessionLive = mock(
      async (
        _input: { repoPath: string },
        listener: (payload: AgentSessionLiveEnvelope) => void,
      ) => {
        listener({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
        return secondUnsubscribe;
      },
    );
    const refreshedProps = {
      ...state.props,
      liveSessionPort: {
        ...state.props.liveSessionPort,
        observeAgentSessionLive: secondObserveAgentSessionLive,
      },
    };

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      await state.harness.update(refreshedProps);
      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(1);
      expect(secondObserveAgentSessionLive).not.toHaveBeenCalled();
      expect(state.unsubscribe).not.toHaveBeenCalled();

      await state.harness.update({ ...refreshedProps, workspaceRepoPath: null });
      expect(state.unsubscribe).toHaveBeenCalledTimes(1);

      await state.harness.update(refreshedProps);
      await state.harness.waitFor(() => secondObserveAgentSessionLive.mock.calls.length === 1);
    } finally {
      await state.harness.unmount();
    }

    expect(secondUnsubscribe).toHaveBeenCalledTimes(1);
  });

  test("uses the latest approval reply callback without restarting observation", async () => {
    const mutatingApproval = {
      requestId: "latest-mutating",
      requestType: "file_change" as const,
      title: "Edit file",
      mutation: "mutating" as const,
    };
    const state = createState(
      (emit) => {
        emit({
          type: "snapshot",
          repoPath: "/repo",
          sessions: [snapshot()],
        });
      },
      { ...record, role: "spec" },
    );
    const refreshedReplyApproval = mock(
      async (_input: AgentSessionLiveReplyApprovalInput) => undefined,
    );
    const refreshedProps = {
      ...state.props,
      liveSessionPort: {
        ...state.props.liveSessionPort,
        agentSessionLiveReplyApproval: refreshedReplyApproval,
      },
    };
    state.queryClient.setQueryData(
      workspaceQueryKeys.repoConfig("/repo"),
      createReadOnlyRepoConfig(),
    );
    state.queryClient.setQueryData(
      workspaceQueryKeys.settingsSnapshot(),
      createSettingsSnapshotFixture(),
    );

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      await state.harness.update(refreshedProps);
      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(1);

      await state.harness.run(async () => {
        state.emit({
          type: "session_upsert",
          session: snapshot({
            pendingApprovals: [mutatingApproval],
          }),
        });
      });
      await waitFor(() => expect(refreshedReplyApproval).toHaveBeenCalledTimes(1), {
        timeout: 750,
      });

      expect(state.agentSessionLiveReplyApproval).not.toHaveBeenCalled();
      expect(refreshedReplyApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "latest-mutating",
          outcome: "reject",
          message: "Custom read-only rejection for spec.",
        }),
      );
      expect(state.observeAgentSessionLive).toHaveBeenCalledTimes(1);
    } finally {
      await state.harness.unmount();
    }
  });

  test("unsubscribes exactly once when repository observation resolves after unmount", async () => {
    const state = createState(() => undefined);
    const deferredObservation = createDeferred<() => void>();
    const unsubscribe = mock(() => undefined);
    const observeAgentSessionLive = mock(async () => deferredObservation.promise);
    state.props.liveSessionPort.observeAgentSessionLive = observeAgentSessionLive;
    let observationResolved = false;
    let harnessUnmounted = false;

    try {
      await state.harness.mount();
      await state.harness.waitFor(() => observeAgentSessionLive.mock.calls.length === 1);
      await state.harness.unmount();
      harnessUnmounted = true;

      expect(unsubscribe).not.toHaveBeenCalled();
      deferredObservation.resolve(unsubscribe);
      observationResolved = true;
      await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1), { timeout: 750 });
    } finally {
      try {
        if (!harnessUnmounted) {
          await state.harness.unmount();
        }
      } finally {
        if (!observationResolved) {
          deferredObservation.resolve(unsubscribe);
        }
      }
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

  test("invalidates repo-scoped skills and slash commands from the ordered stream", async () => {
    const state = createState((emit) => {
      emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
    });
    const invalidateQueries = mock(async () => undefined);
    state.queryClient.invalidateQueries = invalidateQueries;

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(async () => {
        state.emit({
          type: "catalog_invalidated",
          scope: {
            repoPath: "/repo",
            runtimeKind: "codex",
          },
        });
      });

      expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
        queryKey: ["runtime-catalog", "skills", "/repo", "codex"],
      });
      expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
        queryKey: ["runtime-catalog", "slash-commands", "/repo", "codex"],
      });
    } finally {
      await state.harness.unmount();
    }
  });

  test("replaces the slash-command cache from the authoritative ordered stream payload", async () => {
    const state = createState((emit) => {
      emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
    });
    const invalidateQueries = mock(async () => undefined);
    state.queryClient.invalidateQueries = invalidateQueries;
    const catalog = {
      commands: [
        {
          id: "review",
          trigger: "review",
          title: "review",
          source: "command" as const,
          hints: [],
        },
      ],
    };

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(async () => {
        state.emit({
          type: "slash_command_catalog_updated",
          scope: {
            repoPath: "/repo",
            runtimeKind: "claude",
            workingDirectory: "/repo/worktree",
          },
          catalog,
        } satisfies AgentSessionLiveEnvelope);
      });

      expect(
        state.queryClient.getQueryData<typeof catalog>([
          "runtime-catalog",
          "slash-commands",
          "/repo",
          "claude",
          "/repo/worktree",
        ]),
      ).toEqual(catalog);
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["runtime-catalog", "skills", "/repo", "claude", "/repo/worktree"],
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
        source: "live-stream",
      });
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps a scoped fault isolated to its exact session identity", async () => {
    const secondRecord = { ...record, externalSessionId: "thread-2" };
    const state = createState(
      (emit) => {
        emit({
          type: "snapshot",
          repoPath: "/repo",
          sessions: [
            snapshot(),
            snapshot({
              ref: {
                repoPath: "/repo",
                runtimeKind: secondRecord.runtimeKind,
                workingDirectory: secondRecord.workingDirectory,
                externalSessionId: secondRecord.externalSessionId,
              },
            }),
          ],
        });
      },
      [record, secondRecord],
    );

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.emit(
          scopedFault({
            repoPath: "/repo",
            runtimeKind: secondRecord.runtimeKind,
            workingDirectory: secondRecord.workingDirectory,
            externalSessionId: secondRecord.externalSessionId,
          }),
        );
      });

      expect(
        state.harness.getLatest().getSessionFault({
          externalSessionId: record.externalSessionId,
          runtimeKind: record.runtimeKind,
          workingDirectory: record.workingDirectory,
        }),
      ).toBeNull();
      expect(
        state.harness.getLatest().getSessionFault({
          externalSessionId: secondRecord.externalSessionId,
          runtimeKind: secondRecord.runtimeKind,
          workingDirectory: secondRecord.workingDirectory,
        }),
      ).toEqual({ message: "Live-session observation failed: The runtime lost this session." });
      expect(state.harness.getLatest().sessionReadModelLoadState.kind).toBe("ready");
    } finally {
      await state.harness.unmount();
    }
  });

  test("records a scoped fault before the initial snapshot without failing the repository", async () => {
    const state = createState((emit) => {
      emit(scopedFault());
      emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");

      expect(
        state.harness.getLatest().getSessionFault({
          externalSessionId: record.externalSessionId,
          runtimeKind: record.runtimeKind,
          workingDirectory: record.workingDirectory,
        }),
      ).toEqual({ message: "Live-session observation failed: The runtime lost this session." });
    } finally {
      await state.harness.unmount();
    }
  });

  test("normalizes repository paths when looking up a scoped fault", async () => {
    const state = createState((emit) => {
      emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.emit(scopedFault({ ...snapshot().ref, repoPath: "/repo/" }));
      });

      expect(
        state.harness.getLatest().getSessionFault({
          externalSessionId: record.externalSessionId,
          runtimeKind: record.runtimeKind,
          workingDirectory: record.workingDirectory,
        }),
      ).toEqual({ message: "Live-session observation failed: The runtime lost this session." });
    } finally {
      await state.harness.unmount();
    }
  });

  test("clears only the fault matching a successful live session delta", async () => {
    const secondRecord = { ...record, externalSessionId: "thread-2" };
    const state = createState(
      (emit) => {
        emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
      },
      [record, secondRecord],
    );
    const firstIdentity = {
      externalSessionId: record.externalSessionId,
      runtimeKind: record.runtimeKind,
      workingDirectory: record.workingDirectory,
    };
    const secondIdentity = {
      externalSessionId: secondRecord.externalSessionId,
      runtimeKind: secondRecord.runtimeKind,
      workingDirectory: secondRecord.workingDirectory,
    };

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.emit(scopedFault());
        state.emit(
          scopedFault({
            repoPath: "/repo",
            runtimeKind: secondRecord.runtimeKind,
            workingDirectory: secondRecord.workingDirectory,
            externalSessionId: secondRecord.externalSessionId,
          }),
        );
        state.emit({
          type: "session_upsert",
          session: snapshot({
            ref: {
              repoPath: "/repo",
              ...secondIdentity,
            },
          }),
        });
      });

      expect(state.harness.getLatest().getSessionFault(firstIdentity)).toEqual({
        message: "Live-session observation failed: The runtime lost this session.",
      });
      expect(state.harness.getLatest().getSessionFault(secondIdentity)).toBeNull();

      await state.harness.run(() => {
        state.emit({ type: "session_removed", ref: { repoPath: "/repo", ...firstIdentity } });
      });
      expect(state.harness.getLatest().getSessionFault(firstIdentity)).toBeNull();
    } finally {
      await state.harness.unmount();
    }
  });

  test("clears only the matching fault when a transcript event recovers a session", async () => {
    const secondRecord = { ...record, externalSessionId: "thread-2" };
    const state = createState(
      (emit) => {
        emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
      },
      [record, secondRecord],
    );
    const firstIdentity = {
      externalSessionId: record.externalSessionId,
      runtimeKind: record.runtimeKind,
      workingDirectory: record.workingDirectory,
    };
    const secondIdentity = {
      externalSessionId: secondRecord.externalSessionId,
      runtimeKind: secondRecord.runtimeKind,
      workingDirectory: secondRecord.workingDirectory,
    };
    const transcriptEvent = {
      type: "assistant_message",
      externalSessionId: secondIdentity.externalSessionId,
      messageId: "recovered-message",
      message: "The session is streaming again.",
      timestamp: "2026-07-17T14:00:00.000Z",
      sessionRef: { repoPath: "/repo", ...secondIdentity },
    } as const;

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await state.harness.run(() => {
        state.emit(scopedFault({ repoPath: "/repo", ...firstIdentity }));
        state.emit(scopedFault({ repoPath: "/repo", ...secondIdentity }));
        state.emit({ type: "transcript_event", event: transcriptEvent });
      });

      expect(state.harness.getLatest().getSessionFault(firstIdentity)).toEqual({
        message: "Live-session observation failed: The runtime lost this session.",
      });
      expect(state.harness.getLatest().getSessionFault(secondIdentity)).toBeNull();
      expect(state.transcriptEvents.handle).toHaveBeenCalledWith(transcriptEvent);
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps a fault without a session reference as a repository failure", async () => {
    const state = createState((emit) => {
      emit({
        type: "fault",
        repoPath: "/repo",
        message: "The observation stream stopped.",
      });
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      expect(state.harness.getLatest().sessionReadModelLoadState).toEqual({
        kind: "failed",
        workspaceRepoPath: "/repo",
        message: "Live-session observation failed: The observation stream stopped.",
        source: "live-stream",
      });
    } finally {
      await state.harness.unmount();
    }
  });

  test("keeps sibling scoped faults when retry fails before observation restarts", async () => {
    const secondRecord = { ...record, externalSessionId: "thread-2" };
    const batchList = mock(async () => {
      throw new Error("retry failed");
    });
    const state = createState(
      (emit) => {
        emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
      },
      [record, secondRecord],
      {
        agentSessionsList: async () => [],
        agentSessionsListForTasks: batchList,
      },
    );
    const firstIdentity = {
      externalSessionId: record.externalSessionId,
      runtimeKind: record.runtimeKind,
      workingDirectory: record.workingDirectory,
    };
    const secondIdentity = {
      externalSessionId: secondRecord.externalSessionId,
      runtimeKind: secondRecord.runtimeKind,
      workingDirectory: secondRecord.workingDirectory,
    };

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      await expect(
        state.queryClient.fetchQuery({
          queryKey: agentSessionQueryKeys.list("/repo", "task-1"),
          queryFn: async () => {
            throw new Error("initial retry trigger");
          },
          staleTime: 0,
          retry: false,
        }),
      ).rejects.toThrow("initial retry trigger");
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");
      await state.harness.run(() => {
        state.emit(scopedFault());
        state.emit(
          scopedFault({
            repoPath: "/repo",
            runtimeKind: secondRecord.runtimeKind,
            workingDirectory: secondRecord.workingDirectory,
            externalSessionId: secondRecord.externalSessionId,
          }),
        );
        state.harness.getLatest().reloadSessionReadModel();
      });
      await state.harness.waitFor(() => batchList.mock.calls.length === 1);

      expect(batchList).toHaveBeenCalledTimes(1);
      expect(state.harness.getLatest().getSessionFault(firstIdentity)).toEqual({
        message: "Live-session observation failed: The runtime lost this session.",
      });
      expect(state.harness.getLatest().getSessionFault(secondIdentity)).toEqual({
        message: "Live-session observation failed: The runtime lost this session.",
      });
    } finally {
      await state.harness.unmount();
    }
  });

  test("retry recovers a failed task session query without reloading healthy caches", async () => {
    const recoveredRecord = { ...record, externalSessionId: "thread-recovered" };
    const batchList = mock(async () => [{ taskId: "task-1", agentSessions: [recoveredRecord] }]);
    const state = createState(
      (emit) => {
        emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
      },
      record,
      {
        agentSessionsList: async () => {
          throw new Error("Batch retry does not use exact reads.");
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

  test("an older failed retry cannot overwrite a newer successful retry", async () => {
    const firstRetry = createDeferred<TaskSessionRecordBatch>();
    const secondRetry = createDeferred<TaskSessionRecordBatch>();
    const batchList = mock(() =>
      batchList.mock.calls.length === 1 ? firstRetry.promise : secondRetry.promise,
    );
    const state = createState(
      (emit) => {
        emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
      },
      record,
      {
        agentSessionsList: async () => [],
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
            throw new Error("initial refresh failed");
          },
          staleTime: 0,
          retry: false,
        }),
      ).rejects.toThrow("initial refresh failed");
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      expect(batchList).toHaveBeenCalledTimes(2);

      secondRetry.resolve([{ taskId: "task-1", agentSessions: [record] }]);
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      firstRetry.reject(new Error("older retry failed"));
      await state.harness.run(async () => {
        await Promise.resolve();
      });

      expect(state.harness.getLatest().sessionReadModelLoadState.kind).toBe("ready");
    } finally {
      await state.harness.unmount();
    }
  });

  test("an older successful retry cannot overwrite a newer failed retry", async () => {
    const staleRecord = { ...record, externalSessionId: "external-stale" };
    const firstRetry = createDeferred<TaskSessionRecordBatch>();
    const secondRetry = createDeferred<TaskSessionRecordBatch>();
    const batchList = mock(() =>
      batchList.mock.calls.length === 1 ? firstRetry.promise : secondRetry.promise,
    );
    const state = createState(
      (emit) => {
        emit({ type: "snapshot", repoPath: "/repo", sessions: [snapshot()] });
      },
      record,
      {
        agentSessionsList: async () => [],
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
            throw new Error("initial refresh failed");
          },
          staleTime: 0,
          retry: false,
        }),
      ).rejects.toThrow("initial refresh failed");
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");

      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      await state.harness.run(() => state.harness.getLatest().reloadSessionReadModel());
      expect(batchList).toHaveBeenCalledTimes(2);

      secondRetry.reject(new Error("newer retry failed"));
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "failed");
      firstRetry.resolve([{ taskId: "task-1", agentSessions: [staleRecord] }]);
      await state.harness.run(async () => {
        await Promise.resolve();
      });

      expect(state.harness.getLatest().sessionReadModelLoadState).toEqual({
        kind: "failed",
        workspaceRepoPath: "/repo",
        message: "Failed to retry task session records for repo '/repo': newer retry failed",
        source: "task-records",
      });
      const queryKey = agentSessionQueryKeys.list("/repo", "task-1");
      expect(state.queryClient.getQueryData<AgentSessionRecord[]>(queryKey)).toEqual([record]);
      expect(state.queryClient.getQueryState(queryKey)?.status).toBe("error");
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
          sessions: [
            snapshot({
              pendingApprovals: [initialApproval],
            }),
          ],
        });
      },
      { ...record, role: "spec" },
    );
    state.queryClient.setQueryData(
      workspaceQueryKeys.repoConfig("/repo"),
      createReadOnlyRepoConfig(),
    );
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
          session: snapshot({
            pendingApprovals: [initialApproval, laterApproval],
          }),
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

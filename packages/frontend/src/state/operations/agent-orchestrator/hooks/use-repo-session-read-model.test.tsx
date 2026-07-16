import { describe, expect, mock, test } from "bun:test";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveReplyApprovalInput,
  AgentSessionLiveSnapshot,
  AgentSessionRecord,
} from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { summarizeAgentActivity } from "@/state/read-models/agent-activity-read-model";
import { createHookHarness } from "@/test-utils/react-hook-harness";
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
  duringAttach: (
    emit: (event: AgentSessionLiveEnvelope) => void,
    attachmentId: string,
    attachIndex: number,
  ) => void,
  taskRecords: AgentSessionRecord | AgentSessionRecord[] = record,
) => {
  const queryClient = new QueryClient();
  const records = Array.isArray(taskRecords) ? taskRecords : [taskRecords];
  queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), records);
  const sessionStore = createAgentSessionsStore("/repo");
  let listener: ((payload: unknown) => void) | null = null;
  const callOrder: string[] = [];
  const subscribeAgentSessionLiveEvents = mock(async (nextListener: (payload: unknown) => void) => {
    callOrder.push("listener-ready");
    listener = nextListener;
    return {
      transportEpoch: "test-epoch",
      unsubscribe: mock(() => undefined),
    };
  });
  const agentSessionLiveAttach = mock(async ({ attachmentId }: { attachmentId: string }) => {
    callOrder.push("attach");
    const emit = listener;
    if (!emit) {
      throw new Error("Attach ran before the event listener was ready.");
    }
    duringAttach(emit, attachmentId, agentSessionLiveAttach.mock.calls.length);
  });
  const agentSessionLiveDetach = mock(async () => undefined);
  const agentSessionLiveReplyApproval = mock(
    async (_input: AgentSessionLiveReplyApprovalInput) => undefined,
  );
  const liveSessionPort: AgentSessionLiveFrontendPort = {
    subscribeAgentSessionLiveEvents,
    agentSessionLiveAttach,
    agentSessionLiveDetach,
    agentSessionLiveReplyApproval,
  };
  const transcriptEvents: AgentSessionTranscriptEventConsumer = {
    handle: mock(() => undefined),
    close: mock(() => undefined),
  };
  const props = {
    workspaceRepoPath: "/repo",
    taskIds: ["task-1"],
    isLoadingTasks: false,
    currentWorkspaceRepoPathRef: { current: "/repo" },
    repoEpochRef: { current: 0 },
    commitSessionCollection: sessionStore.commitSessionCollection,
    liveSessionPort,
    transcriptEvents,
    queryClient,
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
    agentSessionLiveAttach,
    agentSessionLiveDetach,
    agentSessionLiveReplyApproval,
    emit: (payload: unknown) => {
      if (!listener) {
        throw new Error("Live-session listener is not ready.");
      }
      listener(payload);
    },
    queryClient,
  };
};

describe("useRepoSessionReadModel", () => {
  test("registers the listener before attach and commits snapshot plus ordered creation once", async () => {
    const state = createState((emit, attachmentId) => {
      emit({
        type: "snapshot",
        attachmentId,
        sessions: [snapshot()],
      });
      emit({
        type: "session_upsert",
        attachmentId,
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

      expect(state.callOrder).toEqual(["listener-ready", "attach"]);
      expect(state.getSession()?.pendingApprovals).toEqual([
        expect.objectContaining({ requestId: "opaque-1" }),
      ]);
      expect(state.agentSessionLiveAttach).toHaveBeenCalledTimes(1);
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
    const state = createState((emit, attachmentId) => {
      emit({
        type: "snapshot",
        attachmentId,
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

  test("does not resurrect a request resolved during attachment", async () => {
    const state = createState((emit, attachmentId) => {
      emit({
        type: "snapshot",
        attachmentId,
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
        attachmentId,
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

  test("reconnects with a new attachment identity from the new transport epoch", async () => {
    const state = createState((emit, attachmentId) => {
      emit({ type: "snapshot", attachmentId, sessions: [snapshot()] });
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      const firstAttachmentId = state.agentSessionLiveAttach.mock.calls[0]?.[0].attachmentId;
      expect(firstAttachmentId).toStartWith("test-epoch:");

      await state.harness.run(async () => {
        state.emit({
          __openducktorBrowserLive: true,
          kind: "reconnected",
          transportEpoch: "test-epoch-2",
        });
      });
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "ready" &&
          state.agentSessionLiveAttach.mock.calls.length === 2,
      );

      const secondAttachmentId = state.agentSessionLiveAttach.mock.calls[1]?.[0].attachmentId;
      expect(secondAttachmentId).toStartWith("test-epoch-2:");
      expect(secondAttachmentId).not.toBe(firstAttachmentId);
      expect(state.agentSessionLiveDetach).toHaveBeenCalledWith({
        attachmentId: firstAttachmentId,
      });

      state.emit({
        type: "session_upsert",
        attachmentId: firstAttachmentId ?? "missing",
        session: snapshot({
          pendingApprovals: [
            {
              requestId: "stale-request",
              requestType: "command_execution",
              title: "Stale approval",
            },
          ],
        }),
      });
      expect(state.getSession()?.pendingApprovals).toEqual([]);
    } finally {
      await state.harness.unmount();
    }
  });

  test("recovers a stream warning through one detach and fresh attachment handshake", async () => {
    const state = createState((emit, attachmentId) => {
      emit({ type: "snapshot", attachmentId, sessions: [snapshot()] });
    });

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      const firstAttachmentId = state.agentSessionLiveAttach.mock.calls[0]?.[0].attachmentId;

      await state.harness.run(async () => {
        state.emit({
          __openducktorBrowserLive: true,
          kind: "stream-warning",
          message: "Replay gap",
        });
      });
      await state.harness.waitFor(
        (value) =>
          value.sessionReadModelLoadState.kind === "ready" &&
          state.agentSessionLiveAttach.mock.calls.length === 2,
      );

      const secondAttachmentId = state.agentSessionLiveAttach.mock.calls[1]?.[0].attachmentId;
      expect(secondAttachmentId).toStartWith("test-epoch:");
      expect(secondAttachmentId).not.toBe(firstAttachmentId);
      expect(state.agentSessionLiveDetach).toHaveBeenCalledTimes(1);
      expect(state.agentSessionLiveDetach).toHaveBeenCalledWith({
        attachmentId: firstAttachmentId,
      });
    } finally {
      await state.harness.unmount();
    }
  });

  test("invalidates the normalized skills query scope from the ordered stream", async () => {
    const state = createState((emit, attachmentId) => {
      emit({ type: "snapshot", attachmentId, sessions: [snapshot()] });
    });
    const invalidateQueries = mock(async () => undefined);
    state.queryClient.invalidateQueries =
      invalidateQueries as typeof state.queryClient.invalidateQueries;

    try {
      await state.harness.mount();
      await state.harness.waitFor((value) => value.sessionReadModelLoadState.kind === "ready");
      const attachmentId = state.agentSessionLiveAttach.mock.calls[0]?.[0].attachmentId;

      await state.harness.run(async () => {
        state.emit({
          type: "catalog_invalidated",
          attachmentId: attachmentId ?? "missing",
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
      (emit, attachmentId) => {
        emit({
          type: "snapshot",
          attachmentId,
          sessions: [snapshot({ pendingApprovals: [initialApproval] })],
        });
      },
      { ...record, role: "spec" },
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
          message:
            "Rejected by OpenDucktor spec read-only policy: this role cannot use mutating tools in this session.",
        }),
      );
      expect(state.getSession()?.pendingApprovals.map(({ requestId }) => requestId)).toEqual([
        "initial-mutating",
      ]);

      const attachmentId = state.agentSessionLiveAttach.mock.calls[0]?.[0].attachmentId;
      await state.harness.run(async () => {
        state.emit({
          type: "session_upsert",
          attachmentId: attachmentId ?? "missing",
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

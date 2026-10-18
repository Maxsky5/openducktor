import "../../test-support/dom-environment";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { HostClient } from "@openducktor/host-client";
import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { createAgentRuntimeServices } from "../agent-runtime-services";
import { agentSessionQueryKeys } from "../../queries/agent-sessions";
import { getSessionHistoryFreshnessTracker } from "../../queries/agent-session-history-freshness-tracker";
import { hasLoadedSessionHistory } from "./transcript/session-transcript-content";
import {
  acceptedUserMessageForInput,
  BUILD_SELECTION,
  createAgentSessionLiveSnapshotFixture,
  createHookHarness,
  createLiveSessionStreamFixture,
  createTestDependencies,
  createUnavailableBuildTaskFixture,
  listHarnessSessions,
  AgentRuntimeTestAdapter,
  persistedSessionFixture,
  sessionMessagesToArray,
  setupOrchestratorOperationsTestEnvironment,
  taskFixture,
  taskFixtureWithPersistedBuildSession,
} from "./use-agent-orchestrator-operations.test-helpers";
import { createLiveSnapshotEnvelope } from "../../test-support/agent-session-live-fixture";

interface ReceivedHistoryInputRefContract {
  current: Parameters<HostClient["agentRuntimeLoadSessionHistory"]>[0] | null;
}

interface ReceivedContextInputRefContract {
  current: Parameters<HostClient["agentSessionLiveLoadContext"]>[0] | null;
}

describe("use-agent-orchestrator-operations session state", () => {
  let host: HostClient;
  let restoreEnvironment: (() => void) | null = null;

  beforeEach(() => {
    const environment = setupOrchestratorOperationsTestEnvironment();
    host = environment.host;
    restoreEnvironment = environment.restore;
  });

  afterEach(() => {
    restoreEnvironment?.();
    restoreEnvironment = null;
  });

  test("exposes startup read-model failures as one load state", async () => {
    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies(host, {
        agentSessionsListForTasks: async () => {
          throw new Error("session store unavailable");
        },
      }),
    });

    try {
      await harness.mount();
      const latest = await harness.waitFor(
        (state) => state.readModelState.sessionReadModelLoadState.kind === "failed",
      );

      const readModelLoadState = latest.readModelState.sessionReadModelLoadState;
      expect(readModelLoadState.kind).toBe("failed");
      if (readModelLoadState.kind !== "failed") {
        throw new Error("Expected failed session read-model load state.");
      }
      expect(readModelLoadState.message).toContain("session store unavailable");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the repo session read model loading until task data is ready", async () => {
    let sessionListCalls = 0;

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [],
      isLoadingTasks: true,
      refreshTaskData: async () => {},
      dependencies: createTestDependencies(host, {
        agentSessionsListForTasks: async (_repoPath, taskIds) => {
          sessionListCalls += 1;
          return taskIds.map((taskId) => ({ taskId, agentSessions: [] }));
        },
      }),
    });

    try {
      await harness.mount();

      expect(harness.getLatest().readModelState.sessionReadModelLoadState).toEqual({
        kind: "loading",
        workspaceRepoPath: "/tmp/repo",
      });
      expect(sessionListCalls).toBe(0);

      await harness.updateArgs({
        tasks: [taskFixture],
        isLoadingTasks: false,
      });

      const latest = await harness.waitFor(
        (state) => state.readModelState.sessionReadModelLoadState.kind === "ready",
      );
      expect(latest.readModelState.sessionReadModelLoadState).toEqual({
        kind: "ready",
        workspaceRepoPath: "/tmp/repo",
      });
      expect(sessionListCalls).toBe(1);
    } finally {
      await harness.unmount();
    }
  });

  test("blocks free-form sends while the host snapshot reports pending input", async () => {
    let stopCalls = 0;
    let resumeCalls = 0;
    let sendCalls = 0;

    const originalAgentSessionsList = host.agentSessionsList;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalStopSession = AgentRuntimeTestAdapter.prototype.stopSession;
    const originalResumeSession = AgentRuntimeTestAdapter.prototype.resumeSession;
    const originalSendUserMessage = AgentRuntimeTestAdapter.prototype.sendUserMessage;
    const originalLoadRuntimeCatalog = AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog;
    const originalLoadSessionTodos = AgentRuntimeTestAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = AgentRuntimeTestAdapter.prototype.loadSessionHistory;

    host.agentSessionsList = async () => [persistedSessionFixture];
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    AgentRuntimeTestAdapter.prototype.stopSession = async () => {
      stopCalls += 1;
    };
    AgentRuntimeTestAdapter.prototype.resumeSession = async (input) => {
      resumeCalls += 1;
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: "external-1",
        startedAt: "2026-02-22T08:00:00.000Z",
        sessionAssociation: input.sessionScope ?? { kind: "unbound" },
        status: "idle",
      };
    };
    AgentRuntimeTestAdapter.prototype.sendUserMessage = async (input) => {
      sendCalls += 1;
      return acceptedUserMessageForInput(input);
    };
    AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog = async () => ({
      models: {
        status: "available",
        catalog: { models: [], defaultModelsByProvider: {}, profiles: [] },
      },
    });
    AgentRuntimeTestAdapter.prototype.loadSessionTodos = async () => [];
    AgentRuntimeTestAdapter.prototype.loadSessionHistory = async () => [];

    const liveSession = createAgentSessionLiveSnapshotFixture({
      activity: "waiting_for_permission",
      title: "SPEC task-1",
      pendingApprovals: [
        {
          requestId: "approval-occurrence-1",
          requestType: "permission_grant",
          title: "Approve permission: read",
          summary: "Approval request for read.",
          affectedPaths: ["*.md"],
          action: { name: "read" },
          mutation: "read_only",
          supportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
        },
      ],
      pendingQuestions: [
        {
          requestId: "question-occurrence-1",
          questions: [
            {
              header: "Confirm",
              question: "Confirm",
              options: [],
              multiple: false,
              custom: false,
            },
          ],
        },
      ],
    });
    const liveStream = createLiveSessionStreamFixture([liveSession]);

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies(
        host,
        {
          agentSessionsListForTasks: async () => [
            { taskId: "task-1", agentSessions: [persistedSessionFixture] },
          ],
        },
        liveStream.portOverrides,
      ),
    });

    try {
      await harness.mount();

      const loadedState = await harness.waitFor((state) => listHarnessSessions(state).length === 1);
      const session = listHarnessSessions(loadedState)[0];
      if (!session) {
        throw new Error("Expected loaded session");
      }

      const pendingState = await harness.waitFor(
        (state) =>
          listHarnessSessions(state).find((entry) => entry.externalSessionId === "external-1")
            ?.pendingApprovals.length === 1,
      );
      const pendingSession = listHarnessSessions(pendingState).find(
        (entry) => entry.externalSessionId === "external-1",
      );
      expect(pendingSession?.pendingApprovals).toHaveLength(1);
      expect(pendingSession?.pendingQuestions).toHaveLength(1);

      const recoveredSession = listHarnessSessions(harness.getLatest()).find(
        (entry) => entry.externalSessionId === "external-1",
      );

      await harness.run(async () => {
        await expect(
          harness
            .getLatest()
            .operations.sendAgentMessage(session, [{ kind: "text", text: "blocked" }]),
        ).rejects.toThrow("Answer or reject the blocking request first");
      });

      expect(stopCalls).toBe(0);
      expect(resumeCalls).toBe(0);
      expect(sendCalls).toBe(0);
      expect(liveStream.getObserveCount()).toBe(1);
      expect(recoveredSession?.pendingApprovals).toHaveLength(1);
      expect(recoveredSession?.pendingQuestions).toHaveLength(1);
    } finally {
      await harness.unmount();

      host.agentSessionsList = originalAgentSessionsList;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      AgentRuntimeTestAdapter.prototype.stopSession = originalStopSession;
      AgentRuntimeTestAdapter.prototype.resumeSession = originalResumeSession;
      AgentRuntimeTestAdapter.prototype.sendUserMessage = originalSendUserMessage;
      AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog = originalLoadRuntimeCatalog;
      AgentRuntimeTestAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      AgentRuntimeTestAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("keeps an existing session sendable after task workflow availability changes", async () => {
    let sendCalls = 0;

    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalSendUserMessage = AgentRuntimeTestAdapter.prototype.sendUserMessage;
    const originalLoadRuntimeCatalog = AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog;
    const originalLoadSessionTodos = AgentRuntimeTestAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = AgentRuntimeTestAdapter.prototype.loadSessionHistory;

    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    AgentRuntimeTestAdapter.prototype.sendUserMessage = async (input) => {
      sendCalls += 1;
      return acceptedUserMessageForInput(input);
    };
    AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog = async () => ({
      models: {
        status: "available",
        catalog: { models: [], defaultModelsByProvider: {}, profiles: [] },
      },
    });
    AgentRuntimeTestAdapter.prototype.loadSessionTodos = async () => [];
    AgentRuntimeTestAdapter.prototype.loadSessionHistory = async () => [];

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies(host, {
        agentSessionsListForTasks: async () => [
          { taskId: "task-1", agentSessions: [persistedSessionFixture] },
        ],
      }),
    });

    const unavailableTask = createUnavailableBuildTaskFixture();

    try {
      await harness.mount();

      const loadedState = await harness.waitFor((state) => listHarnessSessions(state).length === 1);
      const session = listHarnessSessions(loadedState)[0];
      if (!session) {
        throw new Error("Expected loaded session");
      }
      await harness.updateArgs({ tasks: [unavailableTask] });

      await harness.run(async () => {
        await harness
          .getLatest()
          .operations.sendAgentMessage(session, [{ kind: "text", text: "hello" }]);
      });

      expect(sendCalls).toBe(1);
    } finally {
      await harness.unmount();

      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      AgentRuntimeTestAdapter.prototype.sendUserMessage = originalSendUserMessage;
      AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog = originalLoadRuntimeCatalog;
      AgentRuntimeTestAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      AgentRuntimeTestAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("updates local state after the host accepts a model update", async () => {
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalUpdateSessionModel = AgentRuntimeTestAdapter.prototype.updateSessionModel;
    const originalLoadRuntimeCatalog = AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog;
    const originalLoadSessionTodos = AgentRuntimeTestAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = AgentRuntimeTestAdapter.prototype.loadSessionHistory;

    const storedSession = structuredClone(persistedSessionFixture);
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    AgentRuntimeTestAdapter.prototype.updateSessionModel = async () => {};
    AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog = async () => ({
      models: {
        status: "available",
        catalog: { models: [], defaultModelsByProvider: {}, profiles: [] },
      },
    });
    AgentRuntimeTestAdapter.prototype.loadSessionTodos = async () => [];
    AgentRuntimeTestAdapter.prototype.loadSessionHistory = async () => [];

    const liveStream = createLiveSessionStreamFixture([createAgentSessionLiveSnapshotFixture()]);

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies(
        host,
        {
          agentSessionsListForTasks: async () => [
            { taskId: "task-1", agentSessions: [storedSession] },
          ],
        },
        liveStream.portOverrides,
      ),
    });

    try {
      await harness.mount();
      const loaded = await harness.waitFor((state) =>
        listHarnessSessions(state).some((session) => session.externalSessionId === "external-1"),
      );
      const session = listHarnessSessions(loaded).find(
        (entry) => entry.externalSessionId === "external-1",
      );
      if (!session) {
        throw new Error("Expected loaded session");
      }

      await harness.run(() => {
        harness.getLatest().operations.updateAgentSessionModel(session, BUILD_SELECTION);
      });
      const updated = await harness.waitFor((state) =>
        listHarnessSessions(state).some(
          (entry) =>
            entry.externalSessionId === "external-1" &&
            entry.selectedModel?.modelId === BUILD_SELECTION.modelId,
        ),
      );
      const updatedSession = listHarnessSessions(updated).find(
        (entry) => entry.externalSessionId === "external-1",
      );
      expect(updatedSession?.selectedModel).toEqual(BUILD_SELECTION);
    } finally {
      await harness.unmount();
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      AgentRuntimeTestAdapter.prototype.updateSessionModel = originalUpdateSessionModel;
      AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog = originalLoadRuntimeCatalog;
      AgentRuntimeTestAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      AgentRuntimeTestAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("task session record query changes remove sessions whose durable records disappeared", async () => {
    const dependencies = createTestDependencies(host);
    dependencies.queryClient.setQueryData(agentSessionQueryKeys.list("/tmp/repo", "task-1"), [
      persistedSessionFixture,
      {
        ...persistedSessionFixture,
        externalSessionId: "external-spec",
        role: "spec",
      },
    ]);
    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
      dependencies,
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => listHarnessSessions(state).length === 2);

      expect(
        listHarnessSessions(harness.getLatest())
          .map((session) => session.externalSessionId)
          .sort(),
      ).toEqual(["external-1", "external-spec"]);

      await harness.run(async () => {
        dependencies.queryClient.setQueryData(agentSessionQueryKeys.list("/tmp/repo", "task-1"), [
          {
            ...persistedSessionFixture,
            externalSessionId: "external-spec",
            role: "spec",
          },
        ]);
      });

      await harness.waitFor((state) =>
        listHarnessSessions(state).every((session) => session.externalSessionId !== "external-1"),
      );
      expect(
        listHarnessSessions(harness.getLatest()).map((session) => session.externalSessionId),
      ).toEqual(["external-spec"]);
    } finally {
      await harness.unmount();
    }
  });

  test("revisit to the same repo refreshes task sessions again", async () => {
    let persistedListCalls = 0;

    const harness = createHookHarness({
      activeRepo: "/tmp/repo-a",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies(host, {
        agentSessionsListForTasks: async () => {
          persistedListCalls += 1;
          return [{ taskId: "task-1", agentSessions: [persistedSessionFixture] }];
        },
      }),
    });

    try {
      await harness.mount();
      await harness.updateArgs({
        activeRepo: null,
        tasks: [],
      });
      await harness.updateArgs({
        activeRepo: "/tmp/repo-a",
        tasks: [taskFixtureWithPersistedBuildSession],
      });
      const loaded = await harness.waitFor((state) => listHarnessSessions(state).length === 1);
      expect(listHarnessSessions(loaded)[0]?.externalSessionId).toBe("external-1");
      expect(persistedListCalls).toBe(1);
    } finally {
      await harness.unmount();
    }
  });

  test("uses the host live snapshot when persisted records omit status", async () => {
    const originalAgentSessionsList = host.agentSessionsList;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalLoadRuntimeCatalog = AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog;
    const originalLoadSessionTodos = AgentRuntimeTestAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = AgentRuntimeTestAdapter.prototype.loadSessionHistory;

    host.agentSessionsList = async () => [persistedSessionFixture];
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog = async () => ({
      models: {
        status: "available",
        catalog: { models: [], defaultModelsByProvider: {}, profiles: [] },
      },
    });
    AgentRuntimeTestAdapter.prototype.loadSessionTodos = async () => [];
    AgentRuntimeTestAdapter.prototype.loadSessionHistory = async () => [];

    const liveStream = createLiveSessionStreamFixture([
      createAgentSessionLiveSnapshotFixture({
        activity: "running",
      }),
    ]);

    const dependencies = createTestDependencies(
      host,
      {
        agentSessionsListForTasks: async () => [
          { taskId: "task-1", agentSessions: [persistedSessionFixture] },
        ],
      },
      liveStream.portOverrides,
    );
    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
      agentEngine: createAgentRuntimeServices(host, dependencies.queryClient).agentEngine,
      dependencies,
    });

    try {
      await harness.mount();
      const resolved = await harness.waitFor((state) =>
        listHarnessSessions(state).some(
          (session) => session.externalSessionId === "external-1" && session.status === "running",
        ),
      );
      expect(
        listHarnessSessions(resolved).find((session) => session.externalSessionId === "external-1")
          ?.status,
      ).toBe("running");
      expect(liveStream.getObserveCount()).toBe(1);
    } finally {
      await harness.unmount();
      host.agentSessionsList = originalAgentSessionsList;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog = originalLoadRuntimeCatalog;
      AgentRuntimeTestAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      AgentRuntimeTestAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test("passes prompt context to Codex session history loads", async () => {
    const originalAgentSessionsList = host.agentSessionsList;
    const originalCodexLoadSessionHistory = host.agentRuntimeLoadSessionHistory;
    const codexRecord = {
      ...persistedSessionFixture,
      runtimeKind: "codex" as const,
    };
    const receivedHistoryInputRef: ReceivedHistoryInputRefContract = { current: null };

    host.agentSessionsList = async () => [codexRecord];
    host.agentRuntimeLoadSessionHistory = async (input) => {
      receivedHistoryInputRef.current = input;
      return [
        {
          messageId: "history-system-1",
          role: "system",
          timestamp: input.systemPromptContext?.startedAt ?? codexRecord.startedAt,
          text: `System prompt:\n\n${input.systemPromptContext?.systemPrompt ?? ""}`,
          parts: [],
        },
      ];
    };

    const liveStream = createLiveSessionStreamFixture([
      createAgentSessionLiveSnapshotFixture({
        ref: {
          runtimeKind: "codex",
          externalSessionId: codexRecord.externalSessionId,
          workingDirectory: codexRecord.workingDirectory,
        },
        activity: "running",
      }),
    ]);

    const dependencies = createTestDependencies(
      host,
      {
        agentSessionsListForTasks: async () => [{ taskId: "task-1", agentSessions: [codexRecord] }],
      },
      liveStream.portOverrides,
    );
    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
      agentEngine: createAgentRuntimeServices(host, dependencies.queryClient).agentEngine,
      dependencies,
    });

    try {
      await harness.mount();
      await harness.waitFor((state) =>
        listHarnessSessions(state).some(
          (session) => session.externalSessionId === codexRecord.externalSessionId,
        ),
      );
      await harness.run(async () => {
        await harness.getLatest().operations.loadAgentSessionHistory({
          externalSessionId: codexRecord.externalSessionId,
          runtimeKind: codexRecord.runtimeKind,
          workingDirectory: codexRecord.workingDirectory,
        });
      });
      const loaded = await harness.waitFor((state) =>
        listHarnessSessions(state).some(
          (session) =>
            session.externalSessionId === codexRecord.externalSessionId &&
            hasLoadedSessionHistory(session),
        ),
      );
      const session = listHarnessSessions(loaded).find(
        (entry) => entry.externalSessionId === codexRecord.externalSessionId,
      );
      const receivedHistoryInput = receivedHistoryInputRef.current;
      if (!receivedHistoryInput) {
        throw new Error("Expected startup history to be loaded.");
      }

      expect(receivedHistoryInput.systemPromptContext).toMatchObject({
        startedAt: codexRecord.startedAt,
        systemPrompt: expect.stringContaining("Task context"),
      });
      expect(
        session ? sessionMessagesToArray(session).map((message) => message.content) : [],
      ).toEqual([expect.stringContaining("System prompt:\n\n")]);
    } finally {
      await harness.unmount();
      host.agentSessionsList = originalAgentSessionsList;
      host.agentRuntimeLoadSessionHistory = originalCodexLoadSessionHistory;
    }
  });

  test.each(["healthy", "missed-event", "pending-read"] as const)(
    "reattaches the selected observer with %s history continuity",
    async (continuity) => {
      const baseline: AgentSessionHistoryMessage = {
        messageId: "baseline",
        role: "assistant",
        timestamp: "2026-02-22T08:00:01.000Z",
        text: "Before reload",
        parts: [],
      };
      const latest = { ...baseline, messageId: "latest", text: "During selected disconnect" };
      const delayedRead = Promise.withResolvers<void>();
      let historyCalls = 0;
      let missedEvent = false;
      let emitOnDisconnect = false;
      let attachCount = 0;
      let pendingRead: Promise<unknown> | undefined;
      const originalLoadSessionHistory = AgentRuntimeTestAdapter.prototype.loadSessionHistory;
      AgentRuntimeTestAdapter.prototype.loadSessionHistory = async () => {
        historyCalls += 1;
        if (continuity === "pending-read" && historyCalls === 1) {
          await delayedRead.promise;
          return [{ ...baseline, text: "Obsolete response" }];
        }
        return missedEvent ? [baseline, latest] : [baseline];
      };
      const snapshot = createAgentSessionLiveSnapshotFixture({ ref: { repoPath: "/tmp/repo-a" } });
      const liveStream = createLiveSessionStreamFixture([snapshot]);
      const observe = liveStream.portOverrides.observeAgentSessionLive!;
      const dependencies = createTestDependencies(
        host,
        {
          agentSessionsListForTasks: async () => [
            { taskId: "task-1", agentSessions: [persistedSessionFixture] },
          ],
        },
        {
          ...liveStream.portOverrides,
          observeAgentSessionLive: async (input, listener) => {
            attachCount += 1;
            const stop = await observe(input, (envelope) =>
              listener(
                envelope.type === "snapshot"
                  ? { ...envelope, isConnectionSnapshot: true }
                  : envelope,
              ),
            );
            return () => {
              stop();
              if (!emitOnDisconnect) return;
              emitOnDisconnect = false;
              missedEvent = true;
              historyObservation.recordEvent({
                type: "transcript_event",
                sequence: 2,
                event: {
                  type: "assistant_message",
                  sessionRef: snapshot.ref,
                  externalSessionId: snapshot.ref.externalSessionId,
                  messageId: latest.messageId,
                  message: latest.text,
                  timestamp: latest.timestamp,
                },
              });
            };
          },
        },
      );
      const historyObservation = getSessionHistoryFreshnessTracker(
        dependencies.queryClient,
      ).observeWorkspace("/tmp/repo-a");
      historyObservation.recordEvent(
        createLiveSnapshotEnvelope({ repoPath: "/tmp/repo-a", sessions: [snapshot] }),
      );
      const harness = createHookHarness({
        activeRepo: "/tmp/repo-a",
        tasks: [taskFixtureWithPersistedBuildSession],
        refreshTaskData: async () => {},
        dependencies,
      });
      try {
        await harness.mount();
        await harness.waitFor((state) =>
          listHarnessSessions(state).some(
            (session) => session.externalSessionId === snapshot.ref.externalSessionId,
          ),
        );
        await harness.run(() => {
          pendingRead = harness.getLatest().operations.loadAgentSessionHistory(snapshot.ref);
        });
        await harness.waitFor(() => historyCalls === 1);
        if (continuity !== "pending-read") {
          await harness.run(async () => {
            await pendingRead;
          });
        }
        emitOnDisconnect = continuity !== "healthy";
        await harness.run(() => harness.getLatest().readModelState.reloadSessionReadModel());
        await harness.waitFor(
          (state) =>
            attachCount >= 2 && state.readModelState.sessionReadModelLoadState.kind === "ready",
        );
        const sessionBeforeRead = listHarnessSessions(harness.getLatest()).find(
          (session) => session.externalSessionId === snapshot.ref.externalSessionId,
        );
        expect(sessionBeforeRead?.historyLoadState).toBe(
          continuity === "healthy"
            ? "loaded"
            : continuity === "pending-read"
              ? "not_requested"
              : "stale",
        );
        delayedRead.resolve();
        await harness.run(async () => {
          await pendingRead;
        });
        if (continuity === "pending-read") {
          expect(
            listHarnessSessions(harness.getLatest()).find(
              (entry) => entry.externalSessionId === snapshot.ref.externalSessionId,
            )?.historyLoadState,
          ).toBe("not_requested");
        }
        await harness.run(async () => {
          await harness.getLatest().operations.loadAgentSessionHistory(snapshot.ref);
        });
        const session = listHarnessSessions(harness.getLatest()).find(
          (entry) => entry.externalSessionId === snapshot.ref.externalSessionId,
        );
        expect(historyCalls).toBe(continuity === "healthy" ? 1 : 2);
        expect(
          session ? sessionMessagesToArray(session).map((message) => message.content) : [],
        ).toEqual(continuity === "healthy" ? [baseline.text] : [baseline.text, latest.text]);
      } finally {
        emitOnDisconnect = false;
        delayedRead.resolve();
        await pendingRead;
        await harness.unmount();
        historyObservation.close();
        AgentRuntimeTestAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      }
    },
  );

  const retentionCoverageCases = [
    "unknown",
    "covered",
    "gap",
    "root-fault",
    "child-fault",
    "peer-fault",
    "read-fault",
    "rail-first-recovery",
    "rail-late-recovery",
    "applied-rail-first",
    "applied-selected-first",
  ] as const;
  test.each([...retentionCoverageCases])(
    "keeps loaded workspace history consistent with %s continuity",
    async (continuity) => {
      const baselineHistory: AgentSessionHistoryMessage[] = [
        {
          messageId: "history-1",
          role: "assistant",
          timestamp: "2026-02-22T08:00:01.000Z",
          text: "Retained transcript",
          parts: [],
        },
      ];
      let historyCalls = 0;
      let hasLiveMessage = false;
      const liveHistoryMessage: AgentSessionHistoryMessage = {
        ...baselineHistory[0]!,
        messageId: "live-message",
        text: "Latest live message",
      };
      const delayedRead = Promise.withResolvers<void>();
      const originalLoadSessionHistory = AgentRuntimeTestAdapter.prototype.loadSessionHistory;
      AgentRuntimeTestAdapter.prototype.loadSessionHistory = async () => {
        historyCalls += 1;
        if (continuity === "read-fault" && historyCalls === 2) {
          await delayedRead.promise;
          return [{ ...baselineHistory[0]!, text: "Obsolete response" }];
        }
        return hasLiveMessage ? [...baselineHistory, liveHistoryMessage] : baselineHistory;
      };

      const snapshot = createAgentSessionLiveSnapshotFixture({ ref: { repoPath: "/tmp/repo-a" } });
      const child = createAgentSessionLiveSnapshotFixture({
        ref: { ...snapshot.ref, externalSessionId: "child" },
        parentExternalSessionId: snapshot.ref.externalSessionId,
      });
      const peer = createAgentSessionLiveSnapshotFixture({
        ref: { ...snapshot.ref, externalSessionId: "peer" },
      });
      const snapshots = [snapshot, child, peer];
      const liveStream = createLiveSessionStreamFixture(snapshots);
      const observe = liveStream.portOverrides.observeAgentSessionLive!;
      const dependencies = createTestDependencies(
        host,
        {
          agentSessionsListForTasks: async (repoPath) =>
            repoPath === "/tmp/repo-a"
              ? [{ taskId: "task-1", agentSessions: [persistedSessionFixture] }]
              : [{ taskId: "task-1", agentSessions: [] }],
        },
        {
          ...liveStream.portOverrides,
          observeAgentSessionLive: (input, listener) =>
            observe(input, (envelope) =>
              listener(
                envelope.type === "snapshot"
                  ? { ...envelope, isConnectionSnapshot: true }
                  : envelope,
              ),
            ),
        },
      );
      const historyObservation = getSessionHistoryFreshnessTracker(
        dependencies.queryClient,
      ).observeWorkspace("/tmp/repo-a");
      if (continuity !== "unknown")
        historyObservation.recordEvent(
          createLiveSnapshotEnvelope({ repoPath: "/tmp/repo-a", sessions: snapshots }),
        );
      const harness = createHookHarness({
        activeRepo: "/tmp/repo-a",
        tasks: [taskFixtureWithPersistedBuildSession],
        refreshTaskData: async () => {},
        dependencies,
      });

      try {
        await harness.mount();
        const loadedState = await harness.waitFor((state) =>
          listHarnessSessions(state).some((entry) => entry.externalSessionId === "external-1"),
        );
        const session = listHarnessSessions(loadedState).find(
          (entry) => entry.externalSessionId === "external-1",
        );
        if (!session) {
          throw new Error("Expected loaded session");
        }

        await harness.run(async () => {
          await harness.getLatest().operations.loadAgentSessionHistory({
            externalSessionId: session.externalSessionId,
            runtimeKind: session.runtimeKind,
            workingDirectory: session.workingDirectory,
          });
        });
        await harness.waitFor((state) =>
          listHarnessSessions(state).some(
            (entry) =>
              entry.externalSessionId === "external-1" &&
              hasLoadedSessionHistory(entry) &&
              sessionMessagesToArray(entry).some(
                (message) => message.content === "Retained transcript",
              ),
          ),
        );

        if (
          continuity === "rail-first-recovery" ||
          continuity === "applied-rail-first" ||
          continuity === "applied-selected-first"
        ) {
          const event: AgentSessionLiveEnvelope = {
            type: "transcript_event",
            sequence: 2,
            event: {
              type: "assistant_message",
              sessionRef: snapshot.ref,
              externalSessionId: snapshot.ref.externalSessionId,
              messageId: liveHistoryMessage.messageId,
              message: liveHistoryMessage.text,
              timestamp: "2026-02-22T08:00:02.000Z",
            },
          };
          hasLiveMessage = true;
          await harness.run(() => {
            if (continuity === "rail-first-recovery") {
              // The rail's recovery attach finished while the selected attach still holds events.
              historyObservation.recordEvent(
                createLiveSnapshotEnvelope({
                  repoPath: "/tmp/repo-a",
                  sessions: snapshots,
                  historyReplayGap: true,
                }),
              );
              historyObservation.recordEvent(event);
            } else if (continuity === "applied-selected-first") {
              liveStream.emit(structuredClone(event));
              historyObservation.recordEvent(event);
            } else {
              historyObservation.recordEvent(event);
              liveStream.emit(structuredClone(event));
            }
          });
        }

        if (
          continuity === "root-fault" ||
          continuity === "child-fault" ||
          continuity === "peer-fault" ||
          continuity === "read-fault"
        ) {
          let faultRef = snapshot.ref;
          if (continuity === "child-fault") faultRef = child.ref;
          if (continuity === "peer-fault") faultRef = peer.ref;
          const fault = {
            type: "fault",
            repoPath: "/tmp/repo-a",
            ref: faultRef,
            message: "The runtime lost this session.",
          } as const satisfies AgentSessionLiveEnvelope;
          await harness.run(() => {
            historyObservation.recordEvent(fault);
            liveStream.emit(fault);
          });
          if (continuity === "read-fault") {
            let pendingRead: Promise<unknown> | undefined;
            await harness.run(() => {
              pendingRead = harness
                .getLatest()
                .operations.loadAgentSessionHistory(persistedSessionFixture);
            });
            await harness.waitFor(() => historyCalls === 2);
            await harness.run(async () => {
              historyObservation.recordEvent(fault);
              liveStream.emit(fault);
              delayedRead.resolve();
              await pendingRead;
            });
            expect(
              listHarnessSessions(harness.getLatest()).find(
                (entry) => entry.externalSessionId === "external-1",
              )?.historyLoadState,
            ).toBe("stale");
          }
        }
        if (continuity === "gap")
          historyObservation.recordEvent(
            createLiveSnapshotEnvelope({
              repoPath: "/tmp/repo-a",
              sessions: snapshots,
              historyReplayGap: true,
            }),
          );
        await harness.run(() =>
          liveStream.emit(
            createLiveSnapshotEnvelope({
              repoPath: "/tmp/repo-a",
              sessions: snapshots,
              isConnectionSnapshot: true,
            }),
          ),
        );

        const restored = await harness.waitFor((state) =>
          listHarnessSessions(state).some(
            (entry) =>
              entry.externalSessionId === "external-1" &&
              hasLoadedSessionHistory(entry) &&
              sessionMessagesToArray(entry).some(
                (message) => message.content === "Retained transcript",
              ),
          ),
        );
        let restoredSession = listHarnessSessions(restored).find(
          (entry) => entry.externalSessionId === "external-1",
        );

        if (continuity === "rail-late-recovery") {
          expect(restoredSession?.historyLoadState).toBe("loaded");
          await harness.run(() => {
            historyObservation.recordEvent(
              createLiveSnapshotEnvelope({
                repoPath: "/tmp/repo-a",
                sessions: snapshots,
                historyReplayGap: true,
              }),
            );
          });
          restoredSession = listHarnessSessions(harness.getLatest()).find(
            (entry) => entry.externalSessionId === "external-1",
          );
        }

        const reusesHistory =
          continuity === "covered" ||
          continuity === "peer-fault" ||
          continuity === "applied-rail-first" ||
          continuity === "applied-selected-first";

        expect(restoredSession?.historyLoadState).toBe(reusesHistory ? "loaded" : "stale");
        const callsBeforeRepair = continuity === "read-fault" ? 2 : 1;
        expect(historyCalls).toBe(callsBeforeRepair);
        await harness.run(async () => {
          await harness.getLatest().operations.loadAgentSessionHistory(persistedSessionFixture);
        });
        expect(historyCalls).toBe(reusesHistory ? 1 : callsBeforeRepair + 1);
        if (hasLiveMessage) {
          expect(
            sessionMessagesToArray(
              listHarnessSessions(harness.getLatest()).find(
                (entry) => entry.externalSessionId === "external-1",
              )!,
            ).some((message) => message.content === "Latest live message"),
          ).toBe(true);
        }
      } finally {
        delayedRead.resolve();
        historyObservation.close();
        dependencies.queryClient.clear();
        await harness.unmount();
        AgentRuntimeTestAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
      }
    },
  );

  test("a reconnect snapshot leaves hidden sessions stale and discards an older read", async () => {
    const secondRecord = {
      ...persistedSessionFixture,
      externalSessionId: "external-2",
      role: "qa" as const,
    };
    const history = (text: string): AgentSessionHistoryMessage[] => [
      {
        messageId: "answer",
        role: "assistant",
        timestamp: "2026-02-22T08:00:01.000Z",
        text,
        parts: [],
      },
    ];
    const oldRead = Promise.withResolvers<AgentSessionHistoryMessage[]>();
    const historyReads: string[] = [];
    const originalLoad = AgentRuntimeTestAdapter.prototype.loadSessionHistory;
    AgentRuntimeTestAdapter.prototype.loadSessionHistory = async (input) => {
      historyReads.push(input.externalSessionId);
      if (historyReads.length === 3) return oldRead.promise;
      return history(historyReads.length === 4 ? "Fresh answer" : "Baseline");
    };
    const liveSnapshots = [
      createAgentSessionLiveSnapshotFixture(),
      createAgentSessionLiveSnapshotFixture({
        ref: { externalSessionId: secondRecord.externalSessionId },
      }),
    ];
    const liveStream = createLiveSessionStreamFixture(liveSnapshots);
    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixture],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies(
        host,
        {
          agentSessionsListForTasks: async () => [
            { taskId: "task-1", agentSessions: [persistedSessionFixture, secondRecord] },
          ],
        },
        liveStream.portOverrides,
      ),
    });
    try {
      await harness.mount();
      await harness.waitFor((state) => listHarnessSessions(state).length === 2);
      await harness.run(async () => {
        for (const identity of [persistedSessionFixture, secondRecord])
          await harness.getLatest().operations.loadAgentSessionHistory(identity);
      });
      const baselines = listHarnessSessions(harness.getLatest()).map((session) => session.messages);
      // The transport installs a new connection snapshot after missed events.
      const emitGap = () =>
        liveStream.emit(
          createLiveSnapshotEnvelope({
            repoPath: "/tmp/repo",
            sessions: liveSnapshots,
            isConnectionSnapshot: true,
          }),
        );
      await harness.run(emitGap);
      expect(historyReads).toEqual(["external-1", "external-2"]);
      expect(
        listHarnessSessions(harness.getLatest()).map((session) => session.historyLoadState),
      ).toEqual(["stale", "stale"]);
      expect(listHarnessSessions(harness.getLatest()).map((session) => session.messages)).toEqual(
        baselines,
      );
      let interruptedRead: Promise<unknown> | undefined;
      await harness.run(() => {
        interruptedRead = harness
          .getLatest()
          .operations.loadAgentSessionHistory(persistedSessionFixture);
      });
      await harness.waitFor(() => historyReads.length === 3);
      await harness.run(emitGap);
      await harness.run(async () => {
        await interruptedRead;
      });
      await harness.run(async () => {
        await harness.getLatest().operations.loadAgentSessionHistory(persistedSessionFixture);
      });
      await harness.run(() => {
        oldRead.resolve(history("Obsolete answer"));
      });
      const sessions = listHarnessSessions(harness.getLatest());
      expect(historyReads).toEqual(["external-1", "external-2", "external-1", "external-1"]);
      expect(
        sessions
          .find((session) => session.externalSessionId === "external-1")
          ?.messages.items.map((message) => message.content),
      ).toContain("Fresh answer");
      expect(
        sessions
          .find((session) => session.externalSessionId === "external-1")
          ?.messages.items.map((message) => message.content),
      ).not.toContain("Obsolete answer");
      expect(
        sessions.find((session) => session.externalSessionId === "external-2")?.historyLoadState,
      ).toBe("stale");
    } finally {
      oldRead.resolve([]);
      await harness.unmount();
      AgentRuntimeTestAdapter.prototype.loadSessionHistory = originalLoad;
    }
  });

  test("attaches idle host live sessions without resuming them on repo refresh", async () => {
    const originalAgentSessionsList = host.agentSessionsList;
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;
    const originalResumeSession = AgentRuntimeTestAdapter.prototype.resumeSession;
    const originalLoadRuntimeCatalog = AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog;
    const originalLoadSessionTodos = AgentRuntimeTestAdapter.prototype.loadSessionTodos;
    const originalLoadSessionHistory = AgentRuntimeTestAdapter.prototype.loadSessionHistory;
    let resumeCalls = 0;

    host.agentSessionsList = async () => [persistedSessionFixture];
    host.specGet = async () => ({ markdown: "", updatedAt: null });
    host.planGet = async () => ({ markdown: "", updatedAt: null });
    host.qaGetReport = async () => ({ markdown: "", updatedAt: null });
    AgentRuntimeTestAdapter.prototype.resumeSession = async (input) => {
      resumeCalls += 1;
      return {
        runtimeKind: "opencode",
        workingDirectory: input.workingDirectory,
        externalSessionId: input.externalSessionId,
        startedAt: "2026-02-22T08:00:00.000Z",
        sessionAssociation: input.sessionScope ?? { kind: "unbound" },
        status: "idle",
      };
    };
    AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog = async () => ({
      models: {
        status: "available",
        catalog: { models: [], defaultModelsByProvider: {}, profiles: [] },
      },
    });
    AgentRuntimeTestAdapter.prototype.loadSessionTodos = async () => [];
    AgentRuntimeTestAdapter.prototype.loadSessionHistory = async () => [];

    const liveStream = createLiveSessionStreamFixture([createAgentSessionLiveSnapshotFixture()]);

    const harness = createHookHarness({
      activeRepo: "/tmp/repo",
      tasks: [taskFixtureWithPersistedBuildSession],
      refreshTaskData: async () => {},
      dependencies: createTestDependencies(
        host,
        {
          agentSessionsListForTasks: async () => [
            { taskId: "task-1", agentSessions: [persistedSessionFixture] },
          ],
        },
        liveStream.portOverrides,
      ),
    });

    try {
      await harness.mount();
      await harness.waitFor((state) =>
        listHarnessSessions(state).some((session) => session.externalSessionId === "external-1"),
      );
      expect(liveStream.getObserveCount()).toBe(1);
      expect(resumeCalls).toBe(0);
    } finally {
      await harness.unmount();
      host.agentSessionsList = originalAgentSessionsList;
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
      AgentRuntimeTestAdapter.prototype.resumeSession = originalResumeSession;
      AgentRuntimeTestAdapter.prototype.loadRuntimeCatalog = originalLoadRuntimeCatalog;
      AgentRuntimeTestAdapter.prototype.loadSessionTodos = originalLoadSessionTodos;
      AgentRuntimeTestAdapter.prototype.loadSessionHistory = originalLoadSessionHistory;
    }
  });

  test.each([null, 222_747, 3_000])(
    "applies context loads without overwriting a newer stream update: %s",
    async (streamedTokens) => {
      const originalAgentSessionsList = host.agentSessionsList;
      const contextUsage = {
        totalTokens: 12_345,
        contextWindow: 200_000,
        providerId: "openai",
        modelId: "gpt-5",
      };
      const receivedContextInput: ReceivedContextInputRefContract = { current: null };
      let contextReadCount = 0;
      let releaseContextRead: (() => void) | undefined;
      const contextReadGate = new Promise<void>((resolve) => {
        releaseContextRead = resolve;
      });

      host.agentSessionsList = async () => [persistedSessionFixture];
      const liveStream = createLiveSessionStreamFixture();
      const dependencies = createTestDependencies(
        host,
        {
          agentSessionsListForTasks: async () => [
            { taskId: "task-1", agentSessions: [persistedSessionFixture] },
          ],
        },
        {
          ...liveStream.portOverrides,
          agentSessionLiveLoadContext: async (input) => {
            contextReadCount += 1;
            receivedContextInput.current = input;
            await contextReadGate;
            return contextUsage;
          },
        },
      );
      const harness = createHookHarness({
        activeRepo: "/tmp/repo",
        tasks: [taskFixtureWithPersistedBuildSession],
        refreshTaskData: async () => {},
        dependencies,
      });

      try {
        await harness.mount();
        const loaded = await harness.waitFor((state) =>
          listHarnessSessions(state).some(
            (session) => session.externalSessionId === persistedSessionFixture.externalSessionId,
          ),
        );
        const persistedSession = listHarnessSessions(loaded).find(
          (session) => session.externalSessionId === persistedSessionFixture.externalSessionId,
        );
        if (!persistedSession) {
          throw new Error("Expected persisted session");
        }
        expect(persistedSession.contextUsage).toBeNull();

        await harness.run(async () => {
          liveStream.emit({
            type: "session_upsert",
            session: createAgentSessionLiveSnapshotFixture({
              contextUsage: { totalTokens: 6_086, contextWindow: 258_400 },
            }),
          });
        });

        await harness.run(async () => {
          const target = {
            externalSessionId: persistedSession.externalSessionId,
            runtimeKind: persistedSession.runtimeKind,
            workingDirectory: persistedSession.workingDirectory,
          };
          const firstLoad = harness.getLatest().operations.loadAgentSessionContext(target);
          const secondLoad = harness.getLatest().operations.loadAgentSessionContext(target);
          liveStream.emit({
            type: "session_upsert",
            session: createAgentSessionLiveSnapshotFixture({
              title: "Updated session title",
              contextUsage: { totalTokens: streamedTokens ?? 6_086, contextWindow: 258_400 },
            }),
          });
          releaseContextRead?.();
          await Promise.all([firstLoad, secondLoad]);
        });

        expect(contextReadCount).toBe(1);
        expect(receivedContextInput.current).toEqual({
          repoPath: "/tmp/repo",
          externalSessionId: persistedSession.externalSessionId,
          runtimeKind: persistedSession.runtimeKind,
          workingDirectory: persistedSession.workingDirectory,
        });
        expect(
          listHarnessSessions(harness.getLatest()).find(
            (session) => session.externalSessionId === persistedSession.externalSessionId,
          )?.contextUsage,
        ).toEqual(
          streamedTokens === null
            ? contextUsage
            : { totalTokens: streamedTokens, contextWindow: 258_400 },
        );
      } finally {
        await harness.unmount();
        host.agentSessionsList = originalAgentSessionsList;
      }
    },
  );
});

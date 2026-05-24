import { describe, expect, test } from "bun:test";
import {
  type AgentSessionRecord,
  type AttachSessionInput,
  createLifecycleAdapter,
  createRecord,
  createSession,
  createSessionPresenceSnapshot,
  createStalePresence,
  createStateHarness,
  type HydrationRuntimePlanner,
  hydrateSessionRecordsStage,
  type LoadAgentSessionHistoryInput,
  type ResumeSessionInput,
  type UpdateSession,
} from "./load-sessions-stages-test-harness";

const pendingUserMessageStartedAt = Date.parse("2026-03-01T09:00:00.000Z");

const createCompletedAssistantHistory = (reason = "stop") => [
  {
    messageId: "assistant-final",
    role: "assistant" as const,
    timestamp: "2026-03-01T09:00:02.000Z",
    text: "Done",
    parts: [
      {
        kind: "text" as const,
        messageId: "assistant-final",
        partId: "assistant-final-text",
        text: "Done",
        completed: true,
      },
      {
        kind: "step" as const,
        messageId: "assistant-final",
        partId: "assistant-final-finish",
        phase: "finish" as const,
        reason,
      },
    ],
  },
];

const createSuccessfulHydrationRuntimePlanner = (
  status: "busy" | "idle" = "busy",
): HydrationRuntimePlanner => ({
  repoPath: "/tmp/repo",
  resolveHydrationRuntime: async () => ({
    ok: true,
    runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
    workingDirectory: "/tmp/repo/worktree",
  }),
  readSessionPresence: async () =>
    createSessionPresenceSnapshot("external-1", "/tmp/repo/worktree", {
      status: { type: status },
    }),
});

describe("load-sessions-stages", () => {
  test("skips hydration work when there are no records to hydrate", async () => {
    const initialSession = createSession({ historyHydrationState: "not_requested" });
    const stateHarness = createStateHarness({ "external-1": initialSession });
    let setSessionsCalls = 0;
    let updateSessionCalls = 0;
    let promptLoads = 0;

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: createLifecycleAdapter({
        loadSessionHistory: async () => {
          throw new Error("history should not load without records");
        },
      }),
      setSessionsById: (updater) => {
        setSessionsCalls += 1;
        stateHarness.setSessionsById(updater);
      },
      updateSession: (externalSessionId, updater) => {
        updateSessionCalls += 1;
        stateHarness.updateSession(externalSessionId, updater);
      },
      isStaleRepoOperation: () => false,
      recordsToHydrate: [],
      historyHydrationSessionIds: new Set(["external-1"]),
      runtimePlanner: {
        repoPath: "/tmp/repo",
        resolveHydrationRuntime: async () => {
          throw new Error("runtime should not resolve without records");
        },
        readSessionPresence: async () => {
          throw new Error("presence should not load without records");
        },
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => {
          promptLoads += 1;
          return [];
        },
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(setSessionsCalls).toBe(0);
    expect(updateSessionCalls).toBe(0);
    expect(promptLoads).toBe(0);
    expect(stateHarness.getState()["external-1"]).toBe(initialSession);
  });

  test("marks requested-history hydration failed when runtime resolution fails", async () => {
    const stateHarness = createStateHarness({ "external-1": createSession() });
    let promptLoads = 0;

    await expect(
      hydrateSessionRecordsStage({
        repoPath: "/tmp/repo",
        adapter: createLifecycleAdapter(),
        setSessionsById: stateHarness.setSessionsById,
        updateSession: stateHarness.updateSession,
        isStaleRepoOperation: () => false,
        recordsToHydrate: [createRecord()],
        historyHydrationSessionIds: new Set(["external-1"]),
        runtimePlanner: {
          repoPath: "/tmp/repo",
          resolveHydrationRuntime: async () => ({
            ok: false,
            runtimeKind: "opencode",
            reason: "No live runtime found for working directory /tmp/repo/worktree.",
          }),
          readSessionPresence: async () => createStalePresence("external-1", "/tmp/repo/worktree"),
        } satisfies HydrationRuntimePlanner,
        promptAssembler: {
          buildHydrationPreludeMessages: async () => [],
          buildHydrationSystemPrompt: async () => "",
        },
        getRepoPromptOverrides: async () => {
          promptLoads += 1;
          return {};
        },
      }),
    ).rejects.toThrow("No live runtime found for working directory /tmp/repo/worktree.");

    expect(promptLoads).toBe(0);
    expect(stateHarness.getState()["external-1"]?.historyHydrationState).toBe("failed");
  });

  test("throws runtime resolution failures for reconcile hydration without marking the task reconciled", async () => {
    const initialSession = createSession();
    const stateHarness = createStateHarness({ "external-1": initialSession });
    let updateCalls = 0;

    await expect(
      hydrateSessionRecordsStage({
        repoPath: "/tmp/repo",
        adapter: createLifecycleAdapter(),
        setSessionsById: stateHarness.setSessionsById,
        updateSession: (externalSessionId: string, updater: Parameters<UpdateSession>[1]) => {
          updateCalls += 1;
          stateHarness.updateSession(externalSessionId, updater);
        },
        isStaleRepoOperation: () => false,
        recordsToHydrate: [createRecord()],
        historyHydrationSessionIds: new Set(),
        failOnRuntimeResolutionError: true,
        runtimePlanner: {
          repoPath: "/tmp/repo",
          resolveHydrationRuntime: async () => ({
            ok: false,
            runtimeKind: "opencode",
            reason: "Multiple live stdio runtimes found for working directory /tmp/repo/worktree.",
          }),
          readSessionPresence: async () => createStalePresence("external-1", "/tmp/repo/worktree"),
        },
        promptAssembler: {
          buildHydrationPreludeMessages: async () => [],
          buildHydrationSystemPrompt: async () => "",
        },
        getRepoPromptOverrides: async () => ({}),
      }),
    ).rejects.toThrow(
      "Multiple live stdio runtimes found for working directory /tmp/repo/worktree.",
    );

    expect(stateHarness.getState()["external-1"]).toEqual(initialSession);
    expect(updateCalls).toBe(0);
  });

  test("keeps starting sessions active when reconcile sees idle runtime presence", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({ status: "starting" }),
    });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: createLifecycleAdapter(),
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(),
      runtimePlanner: {
        repoPath: "/tmp/repo",
        resolveHydrationRuntime: async () => ({
          ok: true,
          runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
          workingDirectory: "/tmp/repo/worktree",
        }),
        readSessionPresence: async () =>
          createSessionPresenceSnapshot("external-1", "/tmp/repo/worktree", {
            status: { type: "idle" },
          }),
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(stateHarness.getState()["external-1"]?.status).toBe("starting");
  });

  test("keeps pending outbound sends when adapter reports the session is still active", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({
        status: "running",
        pendingUserMessageStartedAt: 123,
        draftAssistantText: "partial assistant",
        draftAssistantMessageId: "assistant-draft",
        draftReasoningText: "partial reasoning",
        draftReasoningMessageId: "reasoning-draft",
      }),
    });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: createLifecycleAdapter(),
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(),
      runtimePlanner: {
        repoPath: "/tmp/repo",
        resolveHydrationRuntime: async () => ({
          ok: true,
          runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
          workingDirectory: "/tmp/repo/worktree",
        }),
        readSessionPresence: async () =>
          createSessionPresenceSnapshot("external-1", "/tmp/repo/worktree", {
            status: { type: "busy" },
          }),
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    const session = stateHarness.getState()["external-1"];
    expect(session?.status).toBe("running");
    expect(session?.pendingUserMessageStartedAt).toBe(123);
    expect(session?.draftAssistantText).toBe("partial assistant");
    expect(session?.draftAssistantMessageId).toBe("assistant-draft");
    expect(session?.draftReasoningText).toBe("partial reasoning");
    expect(session?.draftReasoningMessageId).toBe("reasoning-draft");
  });

  test("clears stale todos when history hydration returns an empty todo list", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({
        todos: [{ id: "todo-1", content: "Old todo", status: "pending", priority: "medium" }],
      }),
    });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: createLifecycleAdapter({
        loadSessionTodos: async () => [],
      }),
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["external-1"]),
      runtimePlanner: createSuccessfulHydrationRuntimePlanner(),
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(stateHarness.getState()["external-1"]?.todos).toEqual([]);
  });

  test("does not let history hydration settle pending outbound sends from runtime presence", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({
        status: "running",
        pendingUserMessageStartedAt,
        draftAssistantText: "partial assistant",
        draftAssistantMessageId: "assistant-draft",
        draftReasoningText: "partial reasoning",
        draftReasoningMessageId: "reasoning-draft",
      }),
    });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: createLifecycleAdapter({
        loadSessionHistory: async () => createCompletedAssistantHistory(),
      }),
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["external-1"]),
      runtimePlanner: createSuccessfulHydrationRuntimePlanner("idle"),
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
      subagentPendingInputMode: "hydrate",
    });

    const session = stateHarness.getState()["external-1"];
    expect(session?.status).toBe("running");
    expect(session?.pendingUserMessageStartedAt).toBe(pendingUserMessageStartedAt);
    expect(session?.draftAssistantText).toBe("partial assistant");
    expect(session?.draftAssistantMessageId).toBe("assistant-draft");
    expect(session?.draftReasoningText).toBe("partial reasoning");
    expect(session?.draftReasoningMessageId).toBe("reasoning-draft");
    expect(session?.historyHydrationState).toBe("hydrated");
  });

  test("preserves requested-history starting status when history hydration completes", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({
        status: "starting",
      }),
    });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: createLifecycleAdapter({
        loadSessionHistory: async () => createCompletedAssistantHistory(),
      }),
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["external-1"]),
      runtimePlanner: createSuccessfulHydrationRuntimePlanner("idle"),
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    const session = stateHarness.getState()["external-1"];
    expect(session?.status).toBe("starting");
    expect(session?.historyHydrationState).toBe("hydrated");
  });

  test("keeps pending outbound sends when requested-history runtime presence is running", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({
        status: "running",
        pendingUserMessageStartedAt,
      }),
    });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: createLifecycleAdapter({
        loadSessionHistory: async () => createCompletedAssistantHistory(),
      }),
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["external-1"]),
      runtimePlanner: {
        repoPath: "/tmp/repo",
        resolveHydrationRuntime: async () => ({
          ok: true,
          runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
          workingDirectory: "/tmp/repo/worktree",
        }),
        readSessionPresence: async () =>
          createSessionPresenceSnapshot("external-1", "/tmp/repo/worktree", {
            status: { type: "busy" },
          }),
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
      subagentPendingInputMode: "hydrate",
    });

    const session = stateHarness.getState()["external-1"];
    expect(session?.status).toBe("running");
    expect(session?.pendingUserMessageStartedAt).toBe(pendingUserMessageStartedAt);
    expect(session?.historyHydrationState).toBe("hydrated");
  });

  test("keeps pending outbound sends when requested history skips live presence", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({
        status: "running",
        pendingUserMessageStartedAt,
      }),
    });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: createLifecycleAdapter({
        loadSessionHistory: async () => createCompletedAssistantHistory(),
      }),
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["external-1"]),
      runtimePlanner: createSuccessfulHydrationRuntimePlanner(),
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
      subagentPendingInputMode: "skip",
    });

    const session = stateHarness.getState()["external-1"];
    expect(session?.status).toBe("running");
    expect(session?.pendingUserMessageStartedAt).toBe(pendingUserMessageStartedAt);
    expect(session?.historyHydrationState).toBe("hydrated");
  });

  test("keeps pending outbound sends when hydrated history has an error finish", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({
        status: "running",
        pendingUserMessageStartedAt,
      }),
    });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: createLifecycleAdapter({
        loadSessionHistory: async () => createCompletedAssistantHistory("session_error"),
      }),
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["external-1"]),
      runtimePlanner: createSuccessfulHydrationRuntimePlanner("idle"),
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
      subagentPendingInputMode: "hydrate",
    });

    const session = stateHarness.getState()["external-1"];
    expect(session?.status).toBe("running");
    expect(session?.pendingUserMessageStartedAt).toBe(pendingUserMessageStartedAt);
    expect(session?.historyHydrationState).toBe("hydrated");
  });

  test("loads requested-history hydration through the adapter for stdio OpenCode runtimes", async () => {
    const stateHarness = createStateHarness({ "external-1": createSession() });
    let historyLoads = 0;
    const historyInputs: LoadAgentSessionHistoryInput[] = [];

    await expect(
      hydrateSessionRecordsStage({
        repoPath: "/tmp/repo",
        adapter: {
          hasSession: () => false,
          listSessionPresence: async () => [],
          loadSessionHistory: async (input: LoadAgentSessionHistoryInput) => {
            historyLoads += 1;
            historyInputs.push(input);
            throw new Error("Adapter rejected stdio runtime connections.");
          },
          attachSession: async (input: AttachSessionInput) => ({
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: "idle",
            runtimeKind: input.runtimeKind,
          }),
          resumeSession: async (input: ResumeSessionInput) => ({
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: "idle",
            runtimeKind: input.runtimeKind,
          }),
        },
        setSessionsById: stateHarness.setSessionsById,
        updateSession: stateHarness.updateSession,
        isStaleRepoOperation: () => false,
        recordsToHydrate: [createRecord()],
        historyHydrationSessionIds: new Set(["external-1"]),
        runtimePlanner: {
          repoPath: "/tmp/repo",
          resolveHydrationRuntime: async () => ({
            ok: true,
            runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
            workingDirectory: "/tmp/repo/worktree",
          }),
          readSessionPresence: async () => createStalePresence("external-1", "/tmp/repo/worktree"),
        },
        promptAssembler: {
          buildHydrationPreludeMessages: async () => [],
          buildHydrationSystemPrompt: async () => "",
        },
        getRepoPromptOverrides: async () => ({}),
      }),
    ).rejects.toThrow("Adapter rejected stdio runtime connections.");

    expect(historyLoads).toBe(1);
    expect(historyInputs).toEqual([
      {
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        externalSessionId: "external-1",
        limit: 600,
      },
    ]);
    expect(stateHarness.getState()["external-1"]?.historyHydrationState).toBe("failed");
  });

  test("skips requested-history failure updates when the repo becomes stale during runtime resolution", async () => {
    let stale = false;
    const initialSession = createSession({ historyHydrationState: "hydrating" });
    const stateHarness = createStateHarness({ "external-1": initialSession });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: {
        hasSession: () => false,
        listSessionPresence: async () => [],
        loadSessionHistory: async () => [],
        attachSession: async (input: AttachSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input: ResumeSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => stale,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["external-1"]),
      subagentPendingInputMode: "hydrate",
      runtimePlanner: {
        repoPath: "/tmp/repo",
        resolveHydrationRuntime: async () => {
          stale = true;
          return {
            ok: false,
            runtimeKind: "opencode",
            reason: "No live runtime found for working directory /tmp/repo/worktree.",
          };
        },
        readSessionPresence: async () => createStalePresence("external-1", "/tmp/repo/worktree"),
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(stateHarness.getState()["external-1"]).toEqual(initialSession);
  });

  test("skips runtime projection when the repo becomes stale during runtime resolution", async () => {
    let stale = false;
    const initialSession = createSession();
    const stateHarness = createStateHarness({ "external-1": initialSession });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: {
        hasSession: () => false,
        listSessionPresence: async () => [],
        loadSessionHistory: async () => [],
        attachSession: async (input: AttachSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input: ResumeSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => stale,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(),
      runtimePlanner: {
        repoPath: "/tmp/repo",
        resolveHydrationRuntime: async () => {
          stale = true;
          return {
            ok: true,
            runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
            workingDirectory: "/tmp/repo/worktree",
          };
        },
        readSessionPresence: async () => createStalePresence("external-1", "/tmp/repo/worktree"),
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(stateHarness.getState()["external-1"]).toEqual(initialSession);
  });

  test("does not let live presence title projection block history hydration", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({
        title: "Fallback title",
        historyHydrationState: "hydrating",
      }),
    });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: {
        hasSession: () => false,
        listSessionPresence: async () => [],
        loadSessionHistory: async () => [],
        attachSession: async (input: AttachSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input: ResumeSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["external-1"]),
      runtimePlanner: {
        repoPath: "/tmp/repo",
        resolveHydrationRuntime: async () => ({
          ok: true,
          runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
          workingDirectory: "/tmp/repo/worktree",
        }),
        readSessionPresence: async () =>
          createSessionPresenceSnapshot("external-1", "/tmp/repo/worktree", {
            title: undefined,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: { type: "busy" },
            pendingApprovals: [],
            pendingQuestions: [],
          }),
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(stateHarness.getState()["external-1"]?.title).toBe("Fallback title");
    expect(stateHarness.getState()["external-1"]?.historyHydrationState).toBe("hydrated");
  });

  test("hydrates parent subagent pending permission overlay from live child snapshots", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({ historyHydrationState: "hydrating" }),
    });
    const permissionRequest = {
      requestId: "perm-child-1",
      requestType: "permission_grant" as const,
      title: `Approve permission: ${"read"}`,
      summary: `Approval request for ${"read"}.`,
      affectedPaths: ["src/**"],
      action: { name: "read" },
      mutation: "read_only" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
    };
    const loadedSnapshotSessionIds: string[] = [];

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: {
        hasSession: () => false,
        listSessionPresence: async () => [],
        loadSessionHistory: async () => [
          {
            messageId: "assistant-parent",
            role: "assistant",
            timestamp: "2026-03-01T09:00:02.000Z",
            text: "",
            parts: [
              {
                kind: "subagent",
                messageId: "assistant-parent",
                partId: "subtask-1",
                correlationKey: "part:assistant-parent:subtask-1",
                status: "running",
                agent: "explorer",
                description: "Inspect session state",
                externalSessionId: "external-child-session",
              },
            ],
          },
        ],
        attachSession: async (input: AttachSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input: ResumeSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["external-1"]),
      subagentPendingInputMode: "hydrate",
      runtimePlanner: {
        repoPath: "/tmp/repo",
        resolveHydrationRuntime: async () => ({
          ok: true,
          runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
          workingDirectory: "/tmp/repo/worktree",
        }),
        readSessionPresence: async (record: AgentSessionRecord) => {
          const externalSessionId = record.externalSessionId;
          loadedSnapshotSessionIds.push(externalSessionId);
          if (externalSessionId === "external-1") {
            return createSessionPresenceSnapshot("external-1", "/tmp/repo/worktree", {
              title: "Parent",
              startedAt: "2026-03-01T09:00:00.000Z",
              status: { type: "busy" },
              pendingApprovals: [],
              pendingQuestions: [],
            });
          }
          if (externalSessionId === "external-child-session") {
            return createSessionPresenceSnapshot("external-child-session", "/tmp/repo/worktree", {
              title: "Child",
              startedAt: "2026-03-01T09:00:01.000Z",
              status: { type: "busy" },
              pendingApprovals: [permissionRequest],
              pendingQuestions: [],
            });
          }
          return createStalePresence(externalSessionId, "/tmp/repo/worktree");
        },
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(loadedSnapshotSessionIds).toContain("external-child-session");
    expect(
      stateHarness.getState()["external-1"]?.subagentPendingApprovalsByExternalSessionId?.[
        "external-child-session"
      ],
    ).toEqual([permissionRequest]);
  });

  test("preserves live parent subagent pending overlay entries when child snapshot has no pending permissions", async () => {
    const stateHarness = createStateHarness({
      "external-1": createSession({
        historyHydrationState: "hydrating",
        subagentPendingApprovalsByExternalSessionId: {
          "external-child-session": [
            {
              requestId: "stale-perm",
              requestType: "permission_grant" as const,
              title: `Approve permission: ${"read"}`,
              summary: `Approval request for ${"read"}.`,
              affectedPaths: ["src/**"],
              action: { name: "read" },
              mutation: "read_only" as const,
              supportedReplyOutcomes: [
                "approve_once" as const,
                "approve_session" as const,
                "reject" as const,
              ],
            },
          ],
          "unscanned-child-session": [
            {
              requestId: "live-perm",
              requestType: "permission_grant" as const,
              title: `Approve permission: ${"read"}`,
              summary: `Approval request for ${"read"}.`,
              affectedPaths: ["docs/**"],
              action: { name: "read" },
              mutation: "read_only" as const,
              supportedReplyOutcomes: [
                "approve_once" as const,
                "approve_session" as const,
                "reject" as const,
              ],
            },
          ],
        },
      }),
    });

    await hydrateSessionRecordsStage({
      repoPath: "/tmp/repo",
      adapter: {
        hasSession: () => false,
        listSessionPresence: async () => [],
        loadSessionHistory: async () => [
          {
            messageId: "assistant-parent",
            role: "assistant",
            timestamp: "2026-03-01T09:00:02.000Z",
            text: "",
            parts: [
              {
                kind: "subagent",
                messageId: "assistant-parent",
                partId: "subtask-1",
                correlationKey: "part:assistant-parent:subtask-1",
                status: "running",
                agent: "explorer",
                description: "Inspect session state",
                externalSessionId: "external-child-session",
              },
            ],
          },
        ],
        attachSession: async (input: AttachSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input: ResumeSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      setSessionsById: stateHarness.setSessionsById,
      updateSession: stateHarness.updateSession,
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      historyHydrationSessionIds: new Set(["external-1"]),
      runtimePlanner: {
        repoPath: "/tmp/repo",
        resolveHydrationRuntime: async () => ({
          ok: true,
          runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
          workingDirectory: "/tmp/repo/worktree",
        }),
        readSessionPresence: async (record: AgentSessionRecord) => {
          const externalSessionId = record.externalSessionId;
          if (externalSessionId === "external-1") {
            return createSessionPresenceSnapshot("external-1", "/tmp/repo/worktree", {
              title: "Parent",
              startedAt: "2026-03-01T09:00:00.000Z",
              status: { type: "busy" },
              pendingApprovals: [],
              pendingQuestions: [],
            });
          }
          if (externalSessionId === "external-child-session") {
            return createSessionPresenceSnapshot("external-child-session", "/tmp/repo/worktree", {
              title: "Child",
              startedAt: "2026-03-01T09:00:01.000Z",
              status: { type: "busy" },
              pendingApprovals: [],
              pendingQuestions: [],
            });
          }
          return createStalePresence(externalSessionId, "/tmp/repo/worktree");
        },
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(
      stateHarness.getState()["external-1"]?.subagentPendingApprovalsByExternalSessionId,
    ).toEqual({
      "external-child-session": [
        {
          requestId: "stale-perm",
          requestType: "permission_grant" as const,
          title: `Approve permission: ${"read"}`,
          summary: `Approval request for ${"read"}.`,
          affectedPaths: ["src/**"],
          action: { name: "read" },
          mutation: "read_only" as const,
          supportedReplyOutcomes: [
            "approve_once" as const,
            "approve_session" as const,
            "reject" as const,
          ],
        },
      ],
      "unscanned-child-session": [
        {
          requestId: "live-perm",
          requestType: "permission_grant" as const,
          title: `Approve permission: ${"read"}`,
          summary: `Approval request for ${"read"}.`,
          affectedPaths: ["docs/**"],
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
  });

  test("preserves failed child pending input when another child hydration succeeds", async () => {
    const stalePermission = {
      requestId: "stale-perm",
      requestType: "permission_grant" as const,
      title: `Approve permission: ${"read"}`,
      summary: `Approval request for ${"read"}.`,
      affectedPaths: ["src/**"],
      action: { name: "read" },
      mutation: "read_only" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
    };
    const livePermission = {
      ...stalePermission,
      requestId: "live-perm",
      affectedPaths: ["live/**"],
    };
    const stateHarness = createStateHarness({
      "external-1": createSession({
        historyHydrationState: "hydrating",
        subagentPendingApprovalsByExternalSessionId: {
          "external-child-session": [stalePermission],
        },
      }),
    });
    await expect(
      hydrateSessionRecordsStage({
        repoPath: "/tmp/repo",
        adapter: {
          hasSession: () => false,
          listSessionPresence: async () => [],
          loadSessionHistory: async () => [
            {
              messageId: "assistant-parent",
              role: "assistant",
              timestamp: "2026-03-01T09:00:02.000Z",
              text: "",
              parts: [
                {
                  kind: "subagent",
                  messageId: "assistant-parent",
                  partId: "subtask-1",
                  correlationKey: "part:assistant-parent:subtask-1",
                  status: "running",
                  agent: "explorer",
                  description: "Inspect session state",
                  externalSessionId: "external-child-session",
                },
                {
                  kind: "subagent",
                  messageId: "assistant-parent",
                  partId: "subtask-2",
                  correlationKey: "part:assistant-parent:subtask-2",
                  status: "running",
                  agent: "explorer",
                  description: "Inspect second session state",
                  externalSessionId: "external-success-child-session",
                },
              ],
            },
          ],
          attachSession: async (input: AttachSessionInput) => ({
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: "idle",
            runtimeKind: input.runtimeKind,
          }),
          resumeSession: async (input: ResumeSessionInput) => ({
            externalSessionId: input.externalSessionId,
            role: input.role,
            startedAt: "2026-03-01T09:00:00.000Z",
            status: "idle",
            runtimeKind: input.runtimeKind,
          }),
        },
        setSessionsById: stateHarness.setSessionsById,
        updateSession: stateHarness.updateSession,
        isStaleRepoOperation: () => false,
        recordsToHydrate: [createRecord()],
        historyHydrationSessionIds: new Set(["external-1"]),
        subagentPendingInputMode: "hydrate",
        runtimePlanner: {
          repoPath: "/tmp/repo",
          resolveHydrationRuntime: async () => ({
            ok: true,
            runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
            workingDirectory: "/tmp/repo/worktree",
          }),
          readSessionPresence: async (record: AgentSessionRecord) => {
            const externalSessionId = record.externalSessionId;
            if (externalSessionId === "external-child-session") {
              throw new Error("child snapshot unavailable");
            }
            if (externalSessionId === "external-success-child-session") {
              return createSessionPresenceSnapshot(
                "external-success-child-session",
                "/tmp/repo/worktree",
                {
                  title: "Child",
                  startedAt: "2026-03-01T09:00:01.000Z",
                  status: { type: "busy" },
                  pendingApprovals: [livePermission],
                  pendingQuestions: [],
                },
              );
            }
            return createSessionPresenceSnapshot("external-1", "/tmp/repo/worktree", {
              title: "Parent",
              startedAt: "2026-03-01T09:00:00.000Z",
              status: { type: "busy" },
              pendingApprovals: [],
              pendingQuestions: [],
            });
          },
        },
        promptAssembler: {
          buildHydrationPreludeMessages: async () => [],
          buildHydrationSystemPrompt: async () => "",
        },
        getRepoPromptOverrides: async () => ({}),
      }),
    ).rejects.toThrow(
      "Failed to hydrate subagent pending input: subagent session 'external-child-session': child snapshot unavailable",
    );

    expect(stateHarness.getState()["external-1"]?.historyHydrationState).toBe("failed");
    expect(
      stateHarness.getState()["external-1"]?.subagentPendingApprovalsByExternalSessionId,
    ).toEqual({
      "external-child-session": [stalePermission],
      "external-success-child-session": [livePermission],
    });
    expect(
      stateHarness.getState()["external-1"]?.subagentPendingQuestionsByExternalSessionId,
    ).toBeUndefined();
  });
});

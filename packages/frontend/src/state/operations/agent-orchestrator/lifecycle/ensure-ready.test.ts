import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import {
  type AgentSessionRef,
  type AgentSessionRuntimeRef,
  toAgentSessionRuntimeSnapshot,
} from "@openducktor/core";
import { getAgentSession } from "@/state/agent-session-collection";
import { createSessionMessagesFixture } from "@/test-utils/session-message-test-helpers";
import type {
  AgentApprovalRequest,
  AgentChatMessage,
  AgentQuestionRequest,
  AgentSessionState,
  SessionMessagesState,
} from "@/types/agent-orchestrator";
import {
  addSessionObserverFixture,
  createAgentSessionCollectionRefFixture,
  createDeferred,
  createSessionObserversRefFixture,
  findAgentSessionFixture,
  hasSessionObserverFixture,
  updateAgentSessionFixture,
} from "../test-utils";
import { createEnsureSessionReady } from "./ensure-ready";

const workspaceFixture = {
  repoPath: "/tmp/repo",
  workspaceId: "workspace-1",
  workspaceName: "Active Workspace",
};

const taskFixture: TaskCard = {
  id: "task-1",
  title: "Implement feature",
  description: "desc",
  status: "in_progress",
  priority: 1,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-02-22T08:00:00.000Z",
  createdAt: "2026-02-22T08:00:00.000Z",
};

type BuildSessionOverrides = Partial<Omit<AgentSessionState, "messages">> & {
  messages?: AgentChatMessage[] | SessionMessagesState;
};

const buildSession = (overrides: BuildSessionOverrides = {}): AgentSessionState => {
  const { messages, ...sessionOverrides } = overrides;
  const externalSessionId = sessionOverrides.externalSessionId ?? "session-1";

  return {
    runtimeKind: "opencode",
    externalSessionId,
    taskId: "task-1",
    role: "build",
    status: "idle",
    startedAt: "2026-02-22T08:00:00.000Z",
    workingDirectory: "/tmp/repo/worktree",
    messages: createSessionMessagesFixture(externalSessionId, messages),
    draftAssistantText: "",
    draftAssistantMessageId: null,
    draftReasoningText: "",
    draftReasoningMessageId: null,
    pendingApprovals: [],
    pendingQuestions: [],
    selectedModel: null,
    ...sessionOverrides,
    historyLoadState: sessionOverrides.historyLoadState ?? "not_requested",
  };
};

const approvalFixture = (overrides: Partial<AgentApprovalRequest> = {}): AgentApprovalRequest => ({
  requestId: "perm-1",
  requestType: "permission_grant",
  title: "Approve permission: read",
  summary: "Approval request for read.",
  affectedPaths: ["*"],
  action: { name: "read" },
  mutation: "read_only",
  supportedReplyOutcomes: ["approve_once", "approve_session", "reject"],
  ...overrides,
});

const questionFixture = (): AgentQuestionRequest => ({
  requestId: "question-1",
  questions: [
    {
      header: "Confirm",
      question: "Confirm",
      options: [],
      multiple: false,
      custom: false,
    },
  ],
});

const createAdapter = () => {
  const adapter = new OpencodeSdkAdapter();
  adapter.listSessionRuntimeSnapshots = async () => [];
  adapter.readSessionRuntimeSnapshot = async (input) =>
    toAgentSessionRuntimeSnapshot({
      ref: input,
      snapshot: null,
    });
  return adapter;
};

const runtimeSnapshot = (
  ref: AgentSessionRef,
  overrides: Partial<NonNullable<Parameters<typeof toAgentSessionRuntimeSnapshot>[0]["snapshot"]>>,
) =>
  toAgentSessionRuntimeSnapshot({
    ref,
    snapshot: {
      title: "BUILD task-1",
      startedAt: "2026-02-22T08:00:00.000Z",
      runtimeActivity: "idle",
      pendingApprovals: [],
      pendingQuestions: [],
      ...overrides,
    },
  });

const missingRuntimeSnapshot = (ref: AgentSessionRef) =>
  toAgentSessionRuntimeSnapshot({ ref, snapshot: null });

const resumedSummary = (
  input: AgentSessionRuntimeRef,
  externalSessionId = input.externalSessionId,
) => ({
  runtimeKind: input.runtimeKind,
  workingDirectory: input.workingDirectory,
  externalSessionId,
  startedAt: "2026-02-22T08:00:00.000Z",
  role: input.role,
  status: "idle" as const,
});

const withCapturedConsoleError = async (
  run: (calls: unknown[][]) => Promise<void>,
): Promise<void> => {
  const originalError = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    await run(calls);
  } finally {
    console.error = originalError;
  }
};

type EnsureReadyDependencies = Parameters<typeof createEnsureSessionReady>[0];
type EnsureReadyHarnessOptions = {
  adapter?: OpencodeSdkAdapter;
  sessions?: AgentSessionState[];
  observers?: Parameters<typeof createSessionObserversRefFixture>[0];
  workspaceRepoPath?: EnsureReadyDependencies["workspaceRepoPath"];
  workspaceId?: EnsureReadyDependencies["workspaceId"];
  repoEpochRef?: EnsureReadyDependencies["repoEpochRef"];
  currentWorkspaceRepoPathRef?: EnsureReadyDependencies["currentWorkspaceRepoPathRef"];
  taskRef?: EnsureReadyDependencies["taskRef"];
  updateSession?: EnsureReadyDependencies["updateSession"];
  observeAgentSession?: EnsureReadyDependencies["observeAgentSession"];
  ensureRuntime?: EnsureReadyDependencies["ensureRuntime"];
  loadRepoPromptOverrides?: EnsureReadyDependencies["loadRepoPromptOverrides"];
};

const createEnsureReadyHarness = ({
  adapter = createAdapter(),
  sessions = [buildSession()],
  observers = [],
  workspaceRepoPath = workspaceFixture.repoPath,
  workspaceId = workspaceFixture.workspaceId,
  repoEpochRef = { current: 1 },
  currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null },
  taskRef = { current: [taskFixture] },
  updateSession,
  observeAgentSession,
  ensureRuntime,
  loadRepoPromptOverrides = async (): Promise<RepoPromptOverrides> => ({}),
}: EnsureReadyHarnessOptions = {}) => {
  const sessionsRef = createAgentSessionCollectionRefFixture(sessions);
  const sessionObserversRef = createSessionObserversRefFixture(observers);
  const calls = {
    ensureRuntime: 0,
    observe: 0,
  };
  const defaultUpdateSession: EnsureReadyDependencies["updateSession"] = (identity, updater) => {
    updateAgentSessionFixture(sessionsRef, identity, updater);
  };
  const defaultObserveAgentSession: EnsureReadyDependencies["observeAgentSession"] = async (
    session,
  ) => {
    calls.observe += 1;
    addSessionObserverFixture(sessionObserversRef.current, session);
  };
  const defaultEnsureRuntime: EnsureReadyDependencies["ensureRuntime"] = async () => {
    calls.ensureRuntime += 1;
    return {
      kind: "opencode",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
    };
  };

  return {
    adapter,
    calls,
    currentWorkspaceRepoPathRef,
    ensureReady: createEnsureSessionReady({
      workspaceRepoPath,
      workspaceId,
      adapter,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
      readSessionSnapshot: (identity) => getAgentSession(sessionsRef.current, identity),
      taskRef,
      sessionObserversRef,
      updateSession: updateSession ?? defaultUpdateSession,
      observeAgentSession: observeAgentSession ?? defaultObserveAgentSession,
      ensureRuntime: ensureRuntime ?? defaultEnsureRuntime,
      loadRepoPromptOverrides,
    }),
    hasObserver: (externalSessionId = "session-1") =>
      hasSessionObserverFixture(sessionObserversRef.current, { externalSessionId }),
    repoEpochRef,
    sessionObserversRef,
    session: (externalSessionId = "session-1") =>
      findAgentSessionFixture(sessionsRef, externalSessionId),
    sessionsRef,
  };
};

describe("agent-orchestrator-ensure-ready", () => {
  test("throws when the local session is missing", async () => {
    const { ensureReady } = createEnsureReadyHarness({
      sessions: [],
    });

    await expect(ensureReady(buildSession())).rejects.toThrow("Session not found: session-1");
  });

  test("starts observer and skips resume for healthy runtime session", async () => {
    const adapter = createAdapter();
    const readSnapshotCalls: AgentSessionRef[] = [];
    let stopCalls = 0;
    let resumeCalls = 0;

    adapter.listSessionRuntimeSnapshots = async () => {
      throw new Error("ensure-ready must use the single-session snapshot read");
    };
    adapter.readSessionRuntimeSnapshot = async (input) => {
      readSnapshotCalls.push(input);
      return runtimeSnapshot(input, {});
    };
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return resumedSummary(input);
    };

    const { calls, ensureReady, hasObserver } = createEnsureReadyHarness({ adapter });

    await ensureReady(buildSession());

    expect(calls.observe).toBe(1);
    expect(hasObserver()).toBe(true);
    expect(stopCalls).toBe(0);
    expect(resumeCalls).toBe(0);
    expect(readSnapshotCalls).toEqual([
      {
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        externalSessionId: "session-1",
      },
    ]);
  });

  test("keeps existing observer and skips resume for healthy runtime session", async () => {
    let unsubscribeCalls = 0;
    const adapter = createAdapter();
    adapter.readSessionRuntimeSnapshot = async (input) => runtimeSnapshot(input, {});
    adapter.resumeSession = async () => {
      throw new Error("Session resume should not run for a healthy runtime session.");
    };

    const { ensureReady, hasObserver } = createEnsureReadyHarness({
      adapter,
      observers: [
        {
          externalSessionId: "session-1",
          unsubscribe: () => {
            unsubscribeCalls += 1;
          },
        },
      ],
      observeAgentSession: async () => {
        throw new Error("Existing observer should be reused.");
      },
    });

    await ensureReady(buildSession());

    expect(unsubscribeCalls).toBe(0);
    expect(hasObserver()).toBe(true);
  });

  test("keeps the local observer while failing on a missing live runtime session", async () => {
    const adapter = createAdapter();
    let resumeCalls = 0;
    let stopCalls = 0;
    let unsubscribeCalls = 0;
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return resumedSummary(input, "external-1");
    };
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    adapter.readSessionRuntimeSnapshot = async (input) => missingRuntimeSnapshot(input);

    const { ensureReady, hasObserver, session } = createEnsureReadyHarness({
      adapter,
      sessions: [buildSession({ externalSessionId: "external-1", status: "idle" })],
      observers: [
        {
          externalSessionId: "external-1",
          unsubscribe: () => {
            unsubscribeCalls += 1;
          },
        },
      ],
      observeAgentSession: async () => {},
    });

    await expect(ensureReady(buildSession({ externalSessionId: "external-1" }))).rejects.toThrow(
      "Runtime did not report resumed session 'external-1'.",
    );

    expect(resumeCalls).toBe(1);
    expect(stopCalls).toBe(1);
    expect(unsubscribeCalls).toBe(0);
    expect(hasObserver("external-1")).toBe(true);
    expect(session("external-1")?.runtimeKind).toBe("opencode");
  });

  test("leaves local observer intact when stale runtime session stop fails", async () => {
    const adapter = createAdapter();
    let resumeCalls = 0;
    let stopCalls = 0;
    let unsubscribeCalls = 0;
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return resumedSummary(input);
    };
    adapter.stopSession = async () => {
      stopCalls += 1;
      throw new Error("stop boom");
    };
    adapter.readSessionRuntimeSnapshot = async (input) => missingRuntimeSnapshot(input);

    const { ensureReady, hasObserver, session } = createEnsureReadyHarness({
      adapter,
      sessions: [
        buildSession({
          externalSessionId: "external-1",
          status: "idle",
          pendingApprovals: [approvalFixture()],
        }),
      ],
      observers: [
        {
          externalSessionId: "external-1",
          unsubscribe: () => {
            unsubscribeCalls += 1;
          },
        },
      ],
      observeAgentSession: async () => {},
    });

    await withCapturedConsoleError(async (calls) => {
      await expect(ensureReady(buildSession({ externalSessionId: "external-1" }))).rejects.toThrow(
        "stop boom",
      );
      expect(calls).toHaveLength(0);
    });

    expect(resumeCalls).toBe(1);
    expect(stopCalls).toBe(1);
    expect(unsubscribeCalls).toBe(0);
    expect(hasObserver("external-1")).toBe(true);
    expect(session("external-1")?.runtimeKind).toBe("opencode");
    expect(session("external-1")?.pendingApprovals).toHaveLength(1);
  });

  test("keeps runtime session runtime metadata when refreshing a session", async () => {
    const adapter = createAdapter();
    adapter.readSessionRuntimeSnapshot = async (input) =>
      runtimeSnapshot(input, { title: "Builder Session" });

    const { calls, ensureReady, session } = createEnsureReadyHarness({ adapter });

    await ensureReady(buildSession());

    expect(calls.ensureRuntime).toBe(0);
    expect(session()?.runtimeKind).toBe("opencode");
  });

  test("keeps explicit session runtime kind when selected model conflicts", async () => {
    const adapter = createAdapter();
    adapter.readSessionRuntimeSnapshot = async (input) =>
      runtimeSnapshot(input, { title: "Builder Session" });

    const { calls, ensureReady, session } = createEnsureReadyHarness({
      adapter,
      sessions: [
        buildSession({
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5.4",
            variant: "high",
            profileId: "Hephaestus (Deep Agent)",
          },
        }),
      ],
    });

    await ensureReady(buildSession());

    expect(calls.ensureRuntime).toBe(0);
    expect(session()?.runtimeKind).toBe("opencode");
  });

  test("fails when runtime session runtime metadata is missing instead of falling back", async () => {
    const runtimeSession = buildSession({
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5.4",
        variant: "high",
        profileId: "Hephaestus (Deep Agent)",
      },
    });
    delete (runtimeSession as Partial<AgentSessionState>).runtimeKind;

    const { calls, ensureReady } = createEnsureReadyHarness({
      sessions: [runtimeSession],
    });

    await expect(ensureReady(buildSession())).rejects.toThrow("Session not found: session-1");
    expect(calls.ensureRuntime).toBe(0);
  });

  test("blocks readiness when runtime snapshot reports pending input", async () => {
    const adapter = createAdapter();
    let resumeCalls = 0;
    const liveApproval = approvalFixture({ affectedPaths: ["**/.env"] });
    adapter.readSessionRuntimeSnapshot = async (input) =>
      runtimeSnapshot(input, {
        runtimeActivity: "running",
        pendingApprovals: [liveApproval],
      });
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return resumedSummary(input, "session-1");
    };

    const { calls, ensureReady, session } = createEnsureReadyHarness({ adapter });

    await expect(ensureReady(buildSession())).rejects.toThrow(
      "Session is waiting for pending runtime input.",
    );

    expect(calls.observe).toBe(1);
    expect(resumeCalls).toBe(0);
    expect(session()?.status).toBe("idle");
    expect(session()?.pendingApprovals).toEqual([liveApproval]);
  });

  test("fails fast when a runtime session with legacy runtime metadata is missing from the runtime snapshot source", async () => {
    const adapter = createAdapter();
    let resumeCalls = 0;
    let stopCalls = 0;
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return resumedSummary(input);
    };
    adapter.stopSession = async () => {
      stopCalls += 1;
    };

    const { calls, ensureReady, hasObserver, session } = createEnsureReadyHarness({
      adapter,
      sessions: [
        buildSession({
          pendingApprovals: [approvalFixture()],
          pendingQuestions: [questionFixture()],
        }),
      ],
    });

    await expect(ensureReady(buildSession())).rejects.toThrow(
      "Runtime did not report resumed session 'session-1'.",
    );

    expect(calls.observe).toBe(0);
    expect(hasObserver()).toBe(false);
    expect(calls.ensureRuntime).toBe(1);
    expect(resumeCalls).toBe(1);
    expect(stopCalls).toBe(1);
    expect(session()?.pendingApprovals).toEqual([approvalFixture()]);
    expect(session()?.pendingQuestions).toEqual([questionFixture()]);
  });

  test("fails fast when a resumed session is missing from the runtime snapshot source", async () => {
    const adapter = createAdapter();
    let unsubscribeCalls = 0;
    let stopCalls = 0;
    let resumeCalls = 0;
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return resumedSummary(input);
    };

    const { calls, ensureReady, session } = createEnsureReadyHarness({
      adapter,
      sessions: [
        buildSession({
          status: "error",
          pendingApprovals: [approvalFixture()],
          pendingQuestions: [questionFixture()],
        }),
      ],
      observers: [
        {
          externalSessionId: "session-1",
          unsubscribe: () => {
            unsubscribeCalls += 1;
          },
        },
      ],
    });

    await expect(ensureReady(buildSession())).rejects.toThrow(
      "Runtime did not report resumed session 'session-1'.",
    );

    expect(unsubscribeCalls).toBe(0);
    expect(stopCalls).toBe(1);
    expect(resumeCalls).toBe(1);
    expect(calls.observe).toBe(0);
    expect(session()?.status).toBe("error");
  });

  test("keeps exact observer handles after successful resume", async () => {
    const adapter = createAdapter();
    let unsubscribeCalls = 0;
    let resumeCalls = 0;
    let readRuntimeSnapshotCalls = 0;
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return resumedSummary(input);
    };
    adapter.readSessionRuntimeSnapshot = async (input) => {
      readRuntimeSnapshotCalls += 1;
      return readRuntimeSnapshotCalls === 1
        ? missingRuntimeSnapshot(input)
        : runtimeSnapshot(input, {});
    };

    const { calls, ensureReady, hasObserver } = createEnsureReadyHarness({
      adapter,
      observers: [
        {
          externalSessionId: "session-1",
          unsubscribe: () => {
            unsubscribeCalls += 1;
          },
        },
      ],
    });

    await ensureReady(buildSession());

    expect(resumeCalls).toBe(1);
    expect(unsubscribeCalls).toBe(0);
    expect(calls.observe).toBe(0);
    expect(hasObserver()).toBe(true);
  });

  test("fails when stopping a runtime error session fails", async () => {
    const adapter = createAdapter();
    let resumeCalls = 0;
    let unsubscribeCalls = 0;
    adapter.stopSession = async () => {
      throw new Error("stop boom");
    };
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return resumedSummary(input);
    };

    const { ensureReady, hasObserver } = createEnsureReadyHarness({
      adapter,
      sessions: [buildSession({ status: "error" })],
      observers: [
        {
          externalSessionId: "session-1",
          unsubscribe: () => {
            unsubscribeCalls += 1;
          },
        },
      ],
      observeAgentSession: async () => {},
    });

    await withCapturedConsoleError(async (calls) => {
      await expect(ensureReady(buildSession())).rejects.toThrow("stop boom");
      expect(calls).toHaveLength(0);
    });

    expect(resumeCalls).toBe(1);
    expect(unsubscribeCalls).toBe(0);
    expect(hasObserver()).toBe(true);
  });

  test("resumes runtime error sessions through the persisted runtime kind", async () => {
    const adapter = createAdapter();
    let listenCalls = 0;
    let resumeCalls = 0;
    let stopCalls = 0;
    let unsubscribeCalls = 0;
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return resumedSummary(input);
    };
    adapter.readSessionRuntimeSnapshot = async (input) => runtimeSnapshot(input, {});

    const { ensureReady } = createEnsureReadyHarness({
      adapter,
      sessions: [buildSession({ status: "error" })],
      observers: [
        {
          externalSessionId: "session-1",
          unsubscribe: () => {
            unsubscribeCalls += 1;
          },
        },
      ],
      observeAgentSession: async () => {
        listenCalls += 1;
      },
    });

    await ensureReady(buildSession());

    expect(stopCalls).toBe(0);
    expect(resumeCalls).toBe(1);
    expect(unsubscribeCalls).toBe(0);
    expect(listenCalls).toBe(0);
  });

  test("stops resumed session when workspace becomes stale after resume", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    const adapter = createAdapter();
    let stopCalls = 0;
    adapter.stopSession = async () => {
      stopCalls += 1;
    };
    adapter.resumeSession = async (input) => {
      currentWorkspaceRepoPathRef.current = "/tmp/other";
      return resumedSummary(input);
    };

    const { ensureReady } = createEnsureReadyHarness({
      adapter,
      currentWorkspaceRepoPathRef,
    });

    await expect(ensureReady(buildSession())).rejects.toThrow(
      "Workspace changed while preparing session.",
    );
    expect(stopCalls).toBe(1);
  });

  test("surfaces stale-resume cleanup failures instead of masking them", async () => {
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    const adapter = createAdapter();
    adapter.stopSession = async () => {
      throw new Error("stop boom");
    };
    adapter.resumeSession = async (input) => {
      currentWorkspaceRepoPathRef.current = "/tmp/other";
      return resumedSummary(input);
    };

    const { ensureReady } = createEnsureReadyHarness({
      adapter,
      currentWorkspaceRepoPathRef,
    });

    await withCapturedConsoleError(async (calls) => {
      await expect(ensureReady(buildSession())).rejects.toThrow("stop boom");
      expect(calls).toHaveLength(0);
    });
  });

  test("forwards selected model and profile when resuming a session that is not live", async () => {
    const adapter = createAdapter();
    let resumedInput: Parameters<OpencodeSdkAdapter["resumeSession"]>[0] | null = null;
    let readRuntimeSnapshotCalls = 0;
    adapter.readSessionRuntimeSnapshot = async (input) => {
      readRuntimeSnapshotCalls += 1;
      return readRuntimeSnapshotCalls === 1
        ? missingRuntimeSnapshot(input)
        : runtimeSnapshot(input, { title: "Builder Session" });
    };
    adapter.resumeSession = async (input) => {
      resumedInput = input;
      return resumedSummary(input);
    };

    const { ensureReady, session } = createEnsureReadyHarness({
      adapter,
      sessions: [
        buildSession({
          selectedModel: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5.4",
            variant: "high",
            profileId: "Hephaestus (Deep Agent)",
          },
        }),
      ],
      loadRepoPromptOverrides: async () => ({
        "system.role.build.base": {
          template: "Build override for {{task.title}}",
          baseVersion: 1,
        },
      }),
    });

    await ensureReady(buildSession());

    expect(resumedInput).toMatchObject({
      externalSessionId: "session-1",
      model: {
        providerId: "openai",
        modelId: "gpt-5.4",
        variant: "high",
        profileId: "Hephaestus (Deep Agent)",
      },
      systemPrompt: expect.stringContaining("Build override for Implement feature"),
    });
    expect(session()?.title).toBe("Builder Session");
  });

  test("passes top-level session runtime metadata when resuming a session that is not live", async () => {
    const adapter = createAdapter();
    let ensuredRuntimeKind: string | null | undefined = null;
    let resumedInput: Parameters<OpencodeSdkAdapter["resumeSession"]>[0] | null = null;
    let readRuntimeSnapshotCalls = 0;
    adapter.readSessionRuntimeSnapshot = async (input) => {
      readRuntimeSnapshotCalls += 1;
      return readRuntimeSnapshotCalls === 1
        ? missingRuntimeSnapshot(input)
        : runtimeSnapshot(input, { title: "Builder Session" });
    };
    adapter.resumeSession = async (input) => {
      resumedInput = input;
      return resumedSummary(input);
    };

    const { ensureReady, session } = createEnsureReadyHarness({
      adapter,
      ensureRuntime: async (_repoPath, _taskId, _role, options) => {
        ensuredRuntimeKind = options?.runtimeKind;
        return {
          kind: "opencode",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
        };
      },
    });

    await ensureReady(buildSession());

    expect(String(ensuredRuntimeKind)).toBe("opencode");
    expect(resumedInput).toMatchObject({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
      systemPrompt: expect.stringContaining("Task context"),
    });
    expect(resumedInput).not.toHaveProperty("runtimeConnection");
    expect(session()?.runtimeKind).toBe("opencode");
  });

  test("does not start a runtime when prompt override loading fails during resume", async () => {
    const { calls, ensureReady } = createEnsureReadyHarness({
      loadRepoPromptOverrides: async () => {
        throw new Error("prompt override load failed");
      },
    });

    await expect(ensureReady(buildSession())).rejects.toThrow("prompt override load failed");
    expect(calls.ensureRuntime).toBe(0);
  });

  test("does not start a runtime when the workspace becomes stale after prompt loading", async () => {
    const promptOverridesDeferred = createDeferred<Record<string, string>>();
    const repoEpochRef = { current: 1 };
    const currentWorkspaceRepoPathRef = { current: "/tmp/repo" as string | null };
    const { calls, ensureReady } = createEnsureReadyHarness({
      repoEpochRef,
      currentWorkspaceRepoPathRef,
      loadRepoPromptOverrides: async () => promptOverridesDeferred.promise,
    });

    const ensurePromise = ensureReady(buildSession());
    repoEpochRef.current = 2;
    currentWorkspaceRepoPathRef.current = "/tmp/other-repo";
    promptOverridesDeferred.resolve({});

    await expect(ensurePromise).rejects.toThrow("Workspace changed while preparing session.");
    expect(calls.ensureRuntime).toBe(0);
  });
});

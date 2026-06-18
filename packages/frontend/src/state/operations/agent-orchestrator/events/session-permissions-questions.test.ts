import { describe, expect, mock, test } from "bun:test";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  buildSession,
  createSessionsRef,
  createSessionUpdater,
  findSession,
  getSessionMessages,
  listenToAgentSessionEvents,
  type SessionEvent,
  type SessionEventAdapter,
  type SessionUpdateFn,
} from "./session-events-test-harness";

const flushAutoReject = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const startTestSessionObserver = async (input: {
  externalSessionId: string;
  sessionsRef: ReturnType<typeof createSessionsRef>;
  replyApproval?: SessionEventAdapter["replyApproval"];
  isSessionObserved?: (session: AgentSessionIdentity) => boolean;
  updateSession?: SessionUpdateFn;
}): Promise<(event: SessionEvent) => void> => {
  const handlers: Array<(event: SessionEvent) => void> = [];
  const adapter: SessionEventAdapter = {
    subscribeEvents: async (_externalSessionId, handler) => {
      handlers.push(handler);
      return () => {};
    },
    replyApproval: input.replyApproval ?? (async () => {}),
  };
  const updateSession = input.updateSession ?? createSessionUpdater(input.sessionsRef);

  await listenToAgentSessionEvents({
    adapter,
    repoPath: "/tmp/repo",
    externalSessionId: input.externalSessionId,
    sessionsRef: input.sessionsRef,
    updateSession,
    ...(input.isSessionObserved ? { isSessionObserved: input.isSessionObserved } : {}),
    resolveTurnDurationMs: () => undefined,
    clearTurnDuration: () => {},
    refreshTaskData: async () => {},
  });

  const handleEvent = handlers[0];
  if (!handleEvent) {
    throw new Error("Expected session event handler to be registered");
  }
  return handleEvent;
};

const opencodeSessionIdentity = (externalSessionId: string) => ({
  externalSessionId,
  runtimeKind: "opencode" as const,
  workingDirectory: "/tmp/repo",
});

const listensToSessions =
  (...externalSessionIds: string[]) =>
  (session: AgentSessionIdentity): boolean =>
    externalSessionIds.some((externalSessionId) =>
      matchesAgentSessionIdentity(session, opencodeSessionIdentity(externalSessionId)),
    );

const buildParentSubagentMessage = ({
  correlationKey,
  partId,
  prompt,
  agent = "build",
}: {
  correlationKey: string;
  partId: string;
  prompt: string;
  agent?: string;
}) => ({
  id: `subagent:${correlationKey}`,
  role: "system" as const,
  content: `Subagent (${agent}): ${prompt}`,
  timestamp: "2026-02-22T08:00:01.000Z",
  meta: {
    kind: "subagent" as const,
    partId,
    correlationKey,
    status: "running" as const,
    agent,
    prompt,
  },
});

const buildParentSessionWithSubagent = (input: Parameters<typeof buildParentSubagentMessage>[0]) =>
  buildSession({
    externalSessionId: "external-parent-session",
    role: "planner",
    messages: [buildParentSubagentMessage(input)],
  });

describe("agent-orchestrator session permissions and questions", () => {
  test("auto-rejects mutating permissions for read-only roles", async () => {
    const replyApproval = mock((_request: Parameters<SessionEventAdapter["replyApproval"]>[0]) =>
      Promise.resolve(),
    );
    const sessionsRef = createSessionsRef([buildSession({ role: "spec" })]);
    const handleEvent = await startTestSessionObserver({
      externalSessionId: "session-1",
      sessionsRef,
      replyApproval,
    });

    handleEvent({
      type: "approval_required",
      externalSessionId: "session-1",
      requestId: "perm-1",
      requestType: "permission_grant" as const,
      title: `Approve permission: ${"write"}`,
      summary: `Approval request for ${"write"}.`,
      affectedPaths: ["edit file"],
      action: { name: "write" },
      mutation: "mutating" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
      metadata: { tool: "edit" },
      timestamp: "2026-02-22T08:00:05.000Z",
    });

    expect(findSession(sessionsRef, "session-1")?.pendingApprovals).toHaveLength(1);
    await flushAutoReject();

    expect(replyApproval).toHaveBeenCalledTimes(1);
    expect(findSession(sessionsRef, "session-1")?.pendingApprovals).toHaveLength(0);
    expect(
      getSessionMessages(sessionsRef).some((message) =>
        message.content.includes("Auto-rejected mutating approval"),
      ),
    ).toBe(true);
  });

  test("patches the parent subagent row when a child permission event has linkage", async () => {
    const subagentCorrelationKey = "part:assistant-parent:subtask-1";
    const sessionsRef = createSessionsRef([
      buildParentSessionWithSubagent({
        correlationKey: subagentCorrelationKey,
        partId: "subtask-1",
        prompt: "Inspect repo",
      }),
      buildSession({
        externalSessionId: "external-child-session",
        role: "build",
      }),
    ]);
    const handleEvent = await startTestSessionObserver({
      externalSessionId: "external-child-session",
      sessionsRef,
    });

    handleEvent({
      type: "approval_required",
      externalSessionId: "external-child-session",
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
      timestamp: "2026-02-22T08:00:05.000Z",
      parentExternalSessionId: "external-parent-session",
      childExternalSessionId: "external-child-session",
      subagentCorrelationKey,
    });

    expect(findSession(sessionsRef, "external-child-session")?.pendingApprovals).toEqual([
      {
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
      },
    ]);
    const [parentSubagentMessage] = getSessionMessages(sessionsRef, "external-parent-session");
    expect(parentSubagentMessage?.meta).toMatchObject({
      kind: "subagent",
      correlationKey: subagentCorrelationKey,
      externalSessionId: "external-child-session",
      status: "running",
    });
  });

  test("clears child approval when permission is resolved", async () => {
    const pendingApproval = {
      requestId: "perm-child-1",
      requestType: "permission_grant" as const,
      title: "Approve permission: read",
      summary: "Approval request for read.",
      action: { name: "read" },
      mutation: "read_only" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
    };
    const sessionsRef = createSessionsRef([
      buildSession({
        externalSessionId: "external-parent-session",
        role: "planner",
      }),
      buildSession({
        externalSessionId: "external-child-session",
        role: "build",
        pendingApprovals: [pendingApproval],
      }),
    ]);
    const handleEvent = await startTestSessionObserver({
      externalSessionId: "external-parent-session",
      sessionsRef,
    });

    handleEvent({
      type: "approval_resolved",
      externalSessionId: "external-parent-session",
      timestamp: "2026-02-22T08:00:06.000Z",
      requestId: "perm-child-1",
      parentExternalSessionId: "external-parent-session",
      childExternalSessionId: "external-child-session",
      subagentCorrelationKey: "part:assistant-parent:subtask-1",
    });

    expect(findSession(sessionsRef, "external-child-session")?.pendingApprovals).toEqual([]);
  });

  test("clears child question when question is resolved", async () => {
    const pendingQuestion = {
      requestId: "question-child-1",
      questions: [
        {
          header: "Confirm path",
          question: "Which file?",
          options: [{ label: "A", description: "Path A" }],
        },
      ],
    };
    const sessionsRef = createSessionsRef([
      buildSession({
        externalSessionId: "external-parent-session",
        role: "planner",
      }),
      buildSession({
        externalSessionId: "external-child-session",
        role: "build",
        pendingQuestions: [pendingQuestion],
      }),
    ]);
    const handleEvent = await startTestSessionObserver({
      externalSessionId: "external-parent-session",
      sessionsRef,
    });

    handleEvent({
      type: "question_resolved",
      externalSessionId: "external-parent-session",
      timestamp: "2026-02-22T08:00:06.000Z",
      requestId: "question-child-1",
      parentExternalSessionId: "external-parent-session",
      childExternalSessionId: "external-child-session",
      subagentCorrelationKey: "part:assistant-parent:subtask-1",
    });

    expect(findSession(sessionsRef, "external-child-session")?.pendingQuestions).toEqual([]);
  });

  test("deduplicates child permissions when subagent correlation arrives after the prompt", async () => {
    const subagentCorrelationKey = "part:assistant-parent:subtask-delayed-permission";
    const sessionsRef = createSessionsRef([
      buildParentSessionWithSubagent({
        correlationKey: subagentCorrelationKey,
        partId: "subtask-delayed-permission",
        prompt: "Read omp.json file",
      }),
      buildSession({
        externalSessionId: "external-child-session",
        role: "build",
      }),
    ]);
    const handleEvent = await startTestSessionObserver({
      externalSessionId: "external-parent-session",
      sessionsRef,
    });

    const childPermission = {
      type: "approval_required" as const,
      externalSessionId: "external-parent-session",
      requestId: "perm-child-delayed",
      requestType: "permission_grant" as const,
      title: `Approve permission: ${"read"}`,
      summary: `Approval request for ${"read"}.`,
      affectedPaths: ["omp.json"],
      action: { name: "read" },
      mutation: "read_only" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
      timestamp: "2026-02-22T08:00:05.000Z",
      parentExternalSessionId: "external-parent-session",
      childExternalSessionId: "external-child-session",
    };

    handleEvent(childPermission);
    const firstParentSubagentMeta = getSessionMessages(sessionsRef, "external-parent-session")[0]
      ?.meta;
    expect(firstParentSubagentMeta).toMatchObject({
      kind: "subagent",
      correlationKey: subagentCorrelationKey,
      status: "running",
    });
    if (firstParentSubagentMeta?.kind !== "subagent") {
      throw new Error("Expected parent message to remain a subagent");
    }
    expect(firstParentSubagentMeta.externalSessionId).toBeUndefined();
    expect(findSession(sessionsRef, "external-child-session")?.pendingApprovals).toHaveLength(1);
    handleEvent({
      ...childPermission,
      subagentCorrelationKey,
    });

    expect(findSession(sessionsRef, "external-parent-session")?.pendingApprovals).toHaveLength(0);
    expect(
      findSession(sessionsRef, "external-child-session")?.pendingApprovals.map(
        (request) => request.requestId,
      ),
    ).toEqual(["perm-child-delayed"]);
    const [parentSubagentMessage] = getSessionMessages(sessionsRef, "external-parent-session");
    expect(parentSubagentMessage?.meta).toMatchObject({
      kind: "subagent",
      correlationKey: subagentCorrelationKey,
      externalSessionId: "external-child-session",
      status: "running",
    });
  });

  test("does not guess the parent subagent row when child permission lacks correlation and multiple rows are running", async () => {
    const firstCorrelationKey = "part:assistant-parent:subtask-first";
    const secondCorrelationKey = "part:assistant-parent:subtask-second";
    const sessionsRef = createSessionsRef([
      buildSession({
        externalSessionId: "external-parent-session",
        role: "planner",
        messages: [
          buildParentSubagentMessage({
            correlationKey: firstCorrelationKey,
            partId: "subtask-first",
            prompt: "Read omp.json file",
            agent: "explorer",
          }),
          buildParentSubagentMessage({
            correlationKey: secondCorrelationKey,
            partId: "subtask-second",
            prompt: "Inspect repository",
            agent: "explorer",
          }),
        ],
      }),
    ]);
    const handleEvent = await startTestSessionObserver({
      externalSessionId: "external-parent-session",
      sessionsRef,
    });

    handleEvent({
      type: "approval_required",
      externalSessionId: "external-parent-session",
      requestId: "perm-child-ambiguous",
      requestType: "permission_grant" as const,
      title: `Approve permission: ${"read"}`,
      summary: `Approval request for ${"read"}.`,
      affectedPaths: ["omp.json"],
      action: { name: "read" },
      mutation: "read_only" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
      timestamp: "2026-02-22T08:00:05.000Z",
      parentExternalSessionId: "external-parent-session",
      childExternalSessionId: "external-child-session",
    });

    expect(
      getSessionMessages(sessionsRef, "external-parent-session").map((message) =>
        message.meta?.kind === "subagent" ? message.meta.externalSessionId : undefined,
      ),
    ).toEqual([undefined, undefined]);
  });

  test("does not patch a sole parent subagent row without a correlation key", async () => {
    const correlationKey = "part:assistant-parent:subtask-unlinked";
    const sessionsRef = createSessionsRef([
      buildParentSessionWithSubagent({
        correlationKey,
        partId: "subtask-unlinked",
        prompt: "Inspect repo",
      }),
    ]);
    const handleEvent = await startTestSessionObserver({
      externalSessionId: "external-parent-session",
      sessionsRef,
    });

    handleEvent({
      type: "approval_required",
      externalSessionId: "external-parent-session",
      requestId: "perm-child-unlinked",
      requestType: "permission_grant" as const,
      title: "Approve permission: read",
      summary: "Approval request for read.",
      affectedPaths: ["omp.json"],
      action: { name: "read" },
      mutation: "read_only" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
      timestamp: "2026-02-22T08:00:05.000Z",
      parentExternalSessionId: "external-parent-session",
      childExternalSessionId: "external-child-session",
    });

    const [parentSubagentMessage] = getSessionMessages(sessionsRef, "external-parent-session");
    const parentSubagentMeta = parentSubagentMessage?.meta;
    expect(parentSubagentMeta?.kind).toBe("subagent");
    if (parentSubagentMeta?.kind !== "subagent") {
      throw new Error("Expected parent message to remain a subagent");
    }
    expect(parentSubagentMeta.externalSessionId).toBeUndefined();
    expect(findSession(sessionsRef, "external-parent-session")?.pendingApprovals).toHaveLength(0);
  });

  test("patches the parent subagent row with the child external id when handled from parent context", async () => {
    const subagentCorrelationKey = "part:assistant-parent:subtask-parent-context";
    const sessionsRef = createSessionsRef([
      buildParentSessionWithSubagent({
        correlationKey: subagentCorrelationKey,
        partId: "subtask-parent-context",
        prompt: "Inspect repo",
      }),
    ]);
    const updateSessionOptions: Array<Parameters<SessionUpdateFn>[2]> = [];
    const applySessionUpdate = createSessionUpdater(sessionsRef);
    const updateSession: SessionUpdateFn = (identity, updater, options) => {
      updateSessionOptions.push(options);
      return applySessionUpdate(identity, updater);
    };

    const handleEvent = await startTestSessionObserver({
      externalSessionId: "external-parent-session",
      sessionsRef,
      updateSession,
    });

    handleEvent({
      type: "approval_required",
      externalSessionId: "external-parent-session",
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
      timestamp: "2026-02-22T08:00:05.000Z",
      parentExternalSessionId: "external-parent-session",
      childExternalSessionId: "external-child-session",
      subagentCorrelationKey,
    });

    expect(findSession(sessionsRef, "external-parent-session")?.pendingApprovals).toHaveLength(0);
    expect(findSession(sessionsRef, "external-child-session")).toBeUndefined();
    expect(updateSessionOptions).toContain(undefined);
    expect(updateSessionOptions).not.toContainEqual({ persist: true });
    const [parentSubagentMessage] = getSessionMessages(sessionsRef, "external-parent-session");
    expect(parentSubagentMessage?.meta).toMatchObject({
      kind: "subagent",
      correlationKey: subagentCorrelationKey,
      externalSessionId: "external-child-session",
    });
  });

  test("does not duplicate linked child permission when the child observer owns local pending state", async () => {
    const subagentCorrelationKey = "part:assistant-parent:subtask-active-permission";
    const sessionsRef = createSessionsRef([
      buildParentSessionWithSubagent({
        correlationKey: subagentCorrelationKey,
        partId: "subtask-active-permission",
        prompt: "Edit files",
      }),
      buildSession({
        externalSessionId: "external-child-session",
        pendingApprovals: [],
      }),
    ]);
    const handleEvent = await startTestSessionObserver({
      externalSessionId: "external-parent-session",
      sessionsRef,
      isSessionObserved: listensToSessions("external-child-session"),
    });

    handleEvent({
      type: "approval_required",
      externalSessionId: "external-parent-session",
      requestId: "perm-child-active",
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
      timestamp: "2026-02-22T08:00:05.000Z",
      parentExternalSessionId: "external-parent-session",
      childExternalSessionId: "external-child-session",
      subagentCorrelationKey,
    });

    expect(findSession(sessionsRef, "external-parent-session")?.pendingApprovals).toHaveLength(0);
    expect(findSession(sessionsRef, "external-child-session")?.pendingApprovals).toHaveLength(0);
    const [parentSubagentMessage] = getSessionMessages(sessionsRef, "external-parent-session");
    expect(parentSubagentMessage?.meta).toMatchObject({
      kind: "subagent",
      correlationKey: subagentCorrelationKey,
      externalSessionId: "external-child-session",
    });
  });

  test("patches the parent subagent row without staging parent question state", async () => {
    const subagentCorrelationKey = "part:assistant-parent:subtask-question";
    const sessionsRef = createSessionsRef([
      buildParentSessionWithSubagent({
        correlationKey: subagentCorrelationKey,
        partId: "subtask-question",
        prompt: "Ask user",
      }),
    ]);
    const handleEvent = await startTestSessionObserver({
      externalSessionId: "external-parent-session",
      sessionsRef,
    });

    handleEvent({
      type: "question_required",
      externalSessionId: "external-parent-session",
      requestId: "question-child-1",
      questions: [
        {
          header: "Scope",
          question: "Pick target",
          options: [{ label: "A", description: "Option A" }],
        },
      ],
      timestamp: "2026-02-22T08:00:05.000Z",
      parentExternalSessionId: "external-parent-session",
      childExternalSessionId: "external-child-session",
      subagentCorrelationKey,
    });

    expect(findSession(sessionsRef, "external-parent-session")?.pendingQuestions).toHaveLength(0);
    expect(findSession(sessionsRef, "external-child-session")).toBeUndefined();
    const [parentSubagentMessage] = getSessionMessages(sessionsRef, "external-parent-session");
    expect(parentSubagentMessage?.meta).toMatchObject({
      kind: "subagent",
      correlationKey: subagentCorrelationKey,
      externalSessionId: "external-child-session",
    });
  });

  test("does not duplicate linked child question when the child observer owns local pending state", async () => {
    const subagentCorrelationKey = "part:assistant-parent:subtask-active-question";
    const sessionsRef = createSessionsRef([
      buildParentSessionWithSubagent({
        correlationKey: subagentCorrelationKey,
        partId: "subtask-active-question",
        prompt: "Ask user",
      }),
      buildSession({
        externalSessionId: "external-child-session",
        pendingQuestions: [],
      }),
    ]);
    const handleEvent = await startTestSessionObserver({
      externalSessionId: "external-parent-session",
      sessionsRef,
      isSessionObserved: listensToSessions("external-child-session"),
    });

    handleEvent({
      type: "question_required",
      externalSessionId: "external-parent-session",
      requestId: "question-child-active",
      questions: [
        {
          header: "Scope",
          question: "Pick target",
          options: [{ label: "A", description: "Option A" }],
        },
      ],
      timestamp: "2026-02-22T08:00:05.000Z",
      parentExternalSessionId: "external-parent-session",
      childExternalSessionId: "external-child-session",
      subagentCorrelationKey,
    });

    expect(findSession(sessionsRef, "external-parent-session")?.pendingQuestions).toHaveLength(0);
    expect(findSession(sessionsRef, "external-child-session")?.pendingQuestions).toHaveLength(0);
    const [parentSubagentMessage] = getSessionMessages(sessionsRef, "external-parent-session");
    expect(parentSubagentMessage?.meta).toMatchObject({
      kind: "subagent",
      correlationKey: subagentCorrelationKey,
      externalSessionId: "external-child-session",
    });
  });

  test("does not stage parent question state for an unloaded child without a correlation key", async () => {
    const sessionsRef = createSessionsRef([
      buildSession({
        externalSessionId: "external-parent-session",
        pendingQuestions: [],
      }),
    ]);
    const handleEvent = await startTestSessionObserver({
      externalSessionId: "external-parent-session",
      sessionsRef,
    });

    handleEvent({
      type: "question_required",
      externalSessionId: "external-parent-session",
      requestId: "question-child-2",
      questions: [
        {
          header: "Scope",
          question: "Pick target",
          options: [{ label: "A", description: "Option A" }],
        },
      ],
      timestamp: "2026-02-22T08:00:06.000Z",
      parentExternalSessionId: "external-parent-session",
      childExternalSessionId: "external-child-session",
    } as SessionEvent);

    expect(findSession(sessionsRef, "external-parent-session")?.pendingQuestions).toHaveLength(0);
    expect(findSession(sessionsRef, "external-child-session")).toBeUndefined();
  });

  test("auto-rejects mutating child permissions observed from a read-only parent context", async () => {
    const replyApproval = mock(async () => {});
    const subagentCorrelationKey = "part:assistant-parent:subtask-parent-write";
    const sessionsRef = createSessionsRef([
      buildParentSessionWithSubagent({
        correlationKey: subagentCorrelationKey,
        partId: "subtask-parent-write",
        prompt: "Update repo",
      }),
    ]);
    const handleEvent = await startTestSessionObserver({
      externalSessionId: "external-parent-session",
      sessionsRef,
      replyApproval,
    });

    handleEvent({
      type: "approval_required",
      externalSessionId: "external-parent-session",
      requestId: "perm-child-write",
      requestType: "permission_grant" as const,
      title: `Approve permission: ${"write"}`,
      summary: `Approval request for ${"write"}.`,
      affectedPaths: ["src/**"],
      action: { name: "write" },
      mutation: "mutating" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
      timestamp: "2026-02-22T08:00:05.000Z",
      parentExternalSessionId: "external-parent-session",
      childExternalSessionId: "external-child-session",
      subagentCorrelationKey,
    });
    expect(findSession(sessionsRef, "external-child-session")).toBeUndefined();
    await flushAutoReject();

    expect(replyApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        externalSessionId: "external-parent-session",
        requestId: "perm-child-write",
        outcome: "reject",
        message: expect.any(String),
      }),
    );
    expect(findSession(sessionsRef, "external-parent-session")?.pendingApprovals).toHaveLength(0);
    expect(findSession(sessionsRef, "external-child-session")).toBeUndefined();
    const [parentSubagentMessage] = getSessionMessages(sessionsRef, "external-parent-session");
    expect(parentSubagentMessage?.meta).toMatchObject({
      kind: "subagent",
      correlationKey: subagentCorrelationKey,
      externalSessionId: "external-child-session",
    });
  });

  test("auto-rejects mutating child permissions from parent context when local child state has no observer", async () => {
    const replyApproval = mock(async () => {});
    const subagentCorrelationKey = "part:assistant-parent:subtask-detached-child-write";
    const sessionsRef = createSessionsRef([
      buildParentSessionWithSubagent({
        correlationKey: subagentCorrelationKey,
        partId: "subtask-detached-child-write",
        prompt: "Update repo",
      }),
      buildSession({
        externalSessionId: "external-child-session",
        role: "build",
      }),
    ]);
    const handleParentEvent = await startTestSessionObserver({
      externalSessionId: "external-parent-session",
      sessionsRef,
      isSessionObserved: listensToSessions("external-parent-session"),
      replyApproval,
    });

    handleParentEvent({
      type: "approval_required",
      externalSessionId: "external-parent-session",
      requestId: "perm-child-write",
      requestType: "permission_grant" as const,
      title: `Approve permission: ${"write"}`,
      summary: `Approval request for ${"write"}.`,
      affectedPaths: ["src/**"],
      action: { name: "write" },
      mutation: "mutating" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
      timestamp: "2026-02-22T08:00:05.000Z",
      parentExternalSessionId: "external-parent-session",
      childExternalSessionId: "external-child-session",
      subagentCorrelationKey,
    });
    expect(findSession(sessionsRef, "external-child-session")?.pendingApprovals).toHaveLength(1);
    await flushAutoReject();

    expect(replyApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        externalSessionId: "external-parent-session",
        requestId: "perm-child-write",
        outcome: "reject",
        message: expect.any(String),
      }),
    );
    expect(findSession(sessionsRef, "external-child-session")?.pendingApprovals).toHaveLength(0);
  });

  test("lets active child sessions own linked auto-reject replies", async () => {
    const replyApproval = mock(async () => {});
    const subagentCorrelationKey = "part:assistant-parent:subtask-child-write";
    const sessionsRef = createSessionsRef([
      buildParentSessionWithSubagent({
        correlationKey: subagentCorrelationKey,
        partId: "subtask-child-write",
        prompt: "Update repo",
      }),
      buildSession({
        externalSessionId: "external-child-session",
        role: "build",
      }),
    ]);
    const isSessionObserved = listensToSessions(
      "external-parent-session",
      "external-child-session",
    );

    const handleParentEvent = await startTestSessionObserver({
      externalSessionId: "external-parent-session",
      sessionsRef,
      isSessionObserved,
      replyApproval,
    });
    const handleChildEvent = await startTestSessionObserver({
      externalSessionId: "external-child-session",
      sessionsRef,
      isSessionObserved,
      replyApproval,
    });

    const event: SessionEvent = {
      type: "approval_required",
      externalSessionId: "external-parent-session",
      requestId: "perm-child-write",
      requestType: "permission_grant" as const,
      title: `Approve permission: ${"write"}`,
      summary: `Approval request for ${"write"}.`,
      affectedPaths: ["src/**"],
      action: { name: "write" },
      mutation: "mutating" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
      timestamp: "2026-02-22T08:00:05.000Z",
      parentExternalSessionId: "external-parent-session",
      childExternalSessionId: "external-child-session",
      subagentCorrelationKey,
    };

    handleParentEvent(event);
    expect(replyApproval).toHaveBeenCalledTimes(0);

    handleChildEvent({ ...event, externalSessionId: "external-child-session" });
    await Promise.resolve();

    expect(replyApproval).toHaveBeenCalledTimes(1);
    expect(replyApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        externalSessionId: "external-child-session",
        requestId: "perm-child-write",
        outcome: "reject",
        message: expect.any(String),
      }),
    );

    handleParentEvent(event);

    expect(replyApproval).toHaveBeenCalledTimes(1);
    expect(findSession(sessionsRef, "external-parent-session")?.pendingApprovals).toHaveLength(0);
  });

  test("does not patch the parent subagent row when linked permission lacks a child external id", async () => {
    const subagentCorrelationKey = "part:assistant-parent:subtask-missing-child";
    const sessionsRef = createSessionsRef([
      buildParentSessionWithSubagent({
        correlationKey: subagentCorrelationKey,
        partId: "subtask-missing-child",
        prompt: "Inspect repo",
      }),
    ]);
    const handleEvent = await startTestSessionObserver({
      externalSessionId: "external-parent-session",
      sessionsRef,
    });

    handleEvent({
      type: "approval_required",
      externalSessionId: "external-parent-session",
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
      timestamp: "2026-02-22T08:00:05.000Z",
      parentExternalSessionId: "external-parent-session",
      subagentCorrelationKey,
    });

    const [parentSubagentMessage] = getSessionMessages(sessionsRef, "external-parent-session");
    expect(parentSubagentMessage?.meta).toMatchObject({
      kind: "subagent",
      correlationKey: subagentCorrelationKey,
    });
    expect(parentSubagentMessage?.meta).not.toHaveProperty("externalSessionId");
  });
});

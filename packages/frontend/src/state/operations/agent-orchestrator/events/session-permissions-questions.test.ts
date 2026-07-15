import { describe, expect, test } from "bun:test";
import {
  buildSession,
  createSessionsRef,
  createSessionUpdater,
  findSession,
  getSessionMessages,
  type SessionUpdateFn,
} from "./session-events-test-harness";
import {
  approvalRequiredEvent,
  buildParentSessionWithSubagent,
  buildParentSubagentMessage,
  linkedChildApprovalEvent,
  linkedChildQuestionEvent,
  listensToSessions,
  opencodeSessionIdentity,
  startTestSessionObserver,
} from "./session-permissions-questions.test-helpers";

describe("agent-orchestrator session permissions and questions", () => {
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

    handleEvent(
      linkedChildApprovalEvent({
        externalSessionId: "external-child-session",
        requestId: "perm-child-1",
        subagentCorrelationKey,
      }),
    );

    expect(findSession(sessionsRef, "external-child-session")?.pendingApprovals).toMatchObject([
      {
        requestId: "perm-child-1",
        requestType: "permission_grant",
        source: {
          kind: "subagent",
          parentExternalSessionId: "external-parent-session",
          childExternalSessionId: "external-child-session",
          subagentCorrelationKey,
        },
      },
    ]);
    expect(findSession(sessionsRef, "external-parent-session")?.pendingApprovals).toMatchObject([
      {
        requestId: "perm-child-1",
        responseSession: opencodeSessionIdentity("external-child-session"),
        source: {
          kind: "subagent",
          parentExternalSessionId: "external-parent-session",
          childExternalSessionId: "external-child-session",
          subagentCorrelationKey,
        },
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

  test("clears parent-held child approval when the child session is still unloaded", async () => {
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
    });

    expect(findSession(sessionsRef, "external-parent-session")?.pendingApprovals).toEqual([]);
  });

  test("does not clear reused pending input from a late resolved request instance", async () => {
    const pendingApproval = {
      requestId: "reused-request-1",
      requestInstanceId: "runtime-b\u0000reused-request-1",
      requestType: "permission_grant" as const,
      title: "Approve permission: read",
    };
    const pendingQuestion = {
      requestId: "reused-question-1",
      requestInstanceId: "runtime-b\u0000reused-question-1",
      questions: [],
    };
    const sessionsRef = createSessionsRef([
      buildSession({
        externalSessionId: "external-session",
        role: "build",
        pendingApprovals: [pendingApproval],
        pendingQuestions: [pendingQuestion],
      }),
    ]);
    const handleEvent = await startTestSessionObserver({
      externalSessionId: "external-session",
      sessionsRef,
    });

    handleEvent({
      type: "approval_resolved",
      externalSessionId: "external-session",
      timestamp: "2026-02-22T08:00:06.000Z",
      requestId: pendingApproval.requestId,
      requestInstanceId: "runtime-a\u0000reused-request-1",
    });
    handleEvent({
      type: "question_resolved",
      externalSessionId: "external-session",
      timestamp: "2026-02-22T08:00:06.000Z",
      requestId: pendingQuestion.requestId,
      requestInstanceId: "runtime-a\u0000reused-question-1",
    });

    expect(findSession(sessionsRef, "external-session")?.pendingApprovals).toEqual([
      pendingApproval,
    ]);
    expect(findSession(sessionsRef, "external-session")?.pendingQuestions).toEqual([
      pendingQuestion,
    ]);
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

  test("clears parent-held child question when the child session is still unloaded", async () => {
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
    });

    expect(findSession(sessionsRef, "external-parent-session")?.pendingQuestions).toEqual([]);
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

    const childPermission = linkedChildApprovalEvent({
      externalSessionId: "external-parent-session",
      requestId: "perm-child-delayed",
      affectedPaths: ["omp.json"],
    });

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

    expect(findSession(sessionsRef, "external-parent-session")?.pendingApprovals).toHaveLength(1);
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

    handleEvent(
      linkedChildApprovalEvent({
        externalSessionId: "external-parent-session",
        requestId: "perm-child-ambiguous",
        affectedPaths: ["omp.json"],
      }),
    );

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

    handleEvent(
      linkedChildApprovalEvent({
        externalSessionId: "external-parent-session",
        requestId: "perm-child-unlinked",
        affectedPaths: ["omp.json"],
      }),
    );

    const [parentSubagentMessage] = getSessionMessages(sessionsRef, "external-parent-session");
    const parentSubagentMeta = parentSubagentMessage?.meta;
    expect(parentSubagentMeta?.kind).toBe("subagent");
    if (parentSubagentMeta?.kind !== "subagent") {
      throw new Error("Expected parent message to remain a subagent");
    }
    expect(parentSubagentMeta.externalSessionId).toBeUndefined();
    expect(findSession(sessionsRef, "external-parent-session")?.pendingApprovals).toMatchObject([
      {
        requestId: "perm-child-unlinked",
        requestType: "permission_grant",
        source: {
          kind: "subagent",
          parentExternalSessionId: "external-parent-session",
          childExternalSessionId: "external-child-session",
        },
      },
    ]);
  });

  test("patches the parent subagent row without materializing unloaded child state", async () => {
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

    handleEvent(
      linkedChildApprovalEvent({
        externalSessionId: "external-parent-session",
        requestId: "perm-child-1",
        subagentCorrelationKey,
      }),
    );

    expect(findSession(sessionsRef, "external-parent-session")?.pendingApprovals).toMatchObject([
      {
        requestId: "perm-child-1",
        requestType: "permission_grant",
        responseSession: opencodeSessionIdentity("external-child-session"),
        source: {
          kind: "subagent",
          parentExternalSessionId: "external-parent-session",
          childExternalSessionId: "external-child-session",
          subagentCorrelationKey,
        },
      },
    ]);
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

  test("records linked child permission on the child and parent surface even when the child is observed", async () => {
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

    handleEvent(
      linkedChildApprovalEvent({
        externalSessionId: "external-parent-session",
        requestId: "perm-child-active",
        subagentCorrelationKey,
      }),
    );

    expect(
      findSession(sessionsRef, "external-parent-session")?.pendingApprovals.map(
        (request) => request.requestId,
      ),
    ).toEqual(["perm-child-active"]);
    expect(
      findSession(sessionsRef, "external-child-session")?.pendingApprovals.map(
        (request) => request.requestId,
      ),
    ).toEqual(["perm-child-active"]);
    const [parentSubagentMessage] = getSessionMessages(sessionsRef, "external-parent-session");
    expect(parentSubagentMessage?.meta).toMatchObject({
      kind: "subagent",
      correlationKey: subagentCorrelationKey,
      externalSessionId: "external-child-session",
    });
  });

  test("records parent question state for an unloaded linked child question", async () => {
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

    handleEvent(
      linkedChildQuestionEvent({
        externalSessionId: "external-parent-session",
        requestId: "question-child-1",
        subagentCorrelationKey,
      }),
    );

    expect(findSession(sessionsRef, "external-parent-session")?.pendingQuestions).toMatchObject([
      {
        requestId: "question-child-1",
        responseSession: opencodeSessionIdentity("external-child-session"),
        source: {
          kind: "subagent",
          parentExternalSessionId: "external-parent-session",
          childExternalSessionId: "external-child-session",
          subagentCorrelationKey,
        },
      },
    ]);
    expect(findSession(sessionsRef, "external-child-session")).toBeUndefined();
    const [parentSubagentMessage] = getSessionMessages(sessionsRef, "external-parent-session");
    expect(parentSubagentMessage?.meta).toMatchObject({
      kind: "subagent",
      correlationKey: subagentCorrelationKey,
      externalSessionId: "external-child-session",
    });
  });

  test("records linked child question on the child and parent surface even when the child is observed", async () => {
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

    handleEvent(
      linkedChildQuestionEvent({
        externalSessionId: "external-parent-session",
        requestId: "question-child-active",
        subagentCorrelationKey,
      }),
    );

    expect(
      findSession(sessionsRef, "external-parent-session")?.pendingQuestions.map(
        (request) => request.requestId,
      ),
    ).toEqual(["question-child-active"]);
    expect(
      findSession(sessionsRef, "external-child-session")?.pendingQuestions.map(
        (request) => request.requestId,
      ),
    ).toEqual(["question-child-active"]);
    const [parentSubagentMessage] = getSessionMessages(sessionsRef, "external-parent-session");
    expect(parentSubagentMessage?.meta).toMatchObject({
      kind: "subagent",
      correlationKey: subagentCorrelationKey,
      externalSessionId: "external-child-session",
    });
  });

  test("records parent question state for an unloaded child without a correlation key", async () => {
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

    handleEvent(
      linkedChildQuestionEvent({
        externalSessionId: "external-parent-session",
        requestId: "question-child-2",
        timestamp: "2026-02-22T08:00:06.000Z",
      }),
    );

    expect(findSession(sessionsRef, "external-parent-session")?.pendingQuestions).toMatchObject([
      {
        requestId: "question-child-2",
        responseSession: opencodeSessionIdentity("external-child-session"),
        source: {
          kind: "subagent",
          parentExternalSessionId: "external-parent-session",
          childExternalSessionId: "external-child-session",
        },
      },
    ]);
    expect(findSession(sessionsRef, "external-child-session")).toBeUndefined();
  });

  test("records linked child permission for Codex when parent-child evidence is provided", async () => {
    const subagentCorrelationKey = "part:assistant-parent:codex-subtask";
    const sessionsRef = createSessionsRef([
      buildSession({
        externalSessionId: "external-child-session",
        runtimeKind: "codex",
        role: "build",
      }),
      buildSession({
        externalSessionId: "external-parent-session",
        runtimeKind: "codex",
        role: "planner",
        messages: [
          buildParentSubagentMessage({
            correlationKey: subagentCorrelationKey,
            partId: "codex-subtask",
            prompt: "Inspect repo",
          }),
        ],
      }),
    ]);
    const handleEvent = await startTestSessionObserver({
      externalSessionId: "external-parent-session",
      sessionsRef,
      isSessionObserved: listensToSessions("external-parent-session", "external-child-session"),
    });

    handleEvent({
      type: "approval_required",
      externalSessionId: "external-parent-session",
      requestId: "codex-child-permission",
      requestType: "permission_grant" as const,
      title: "Codex exec",
      summary: "Codex requested exec.",
      action: { name: "exec" },
      mutation: "mutating" as const,
      supportedReplyOutcomes: ["approve_once" as const, "reject" as const],
      metadata: { codexMethod: "exec" },
      timestamp: "2026-02-22T08:00:05.000Z",
      parentExternalSessionId: "external-parent-session",
      childExternalSessionId: "external-child-session",
      subagentCorrelationKey,
    });

    expect(
      findSession(sessionsRef, "external-parent-session")?.pendingApprovals.map(
        (request) => request.requestId,
      ),
    ).toEqual(["codex-child-permission"]);
    expect(
      findSession(sessionsRef, "external-child-session")?.pendingApprovals.map(
        (request) => request.requestId,
      ),
    ).toEqual(["codex-child-permission"]);
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

    handleEvent(
      approvalRequiredEvent({
        externalSessionId: "external-parent-session",
        requestId: "perm-child-1",
        parentExternalSessionId: "external-parent-session",
        subagentCorrelationKey,
      }),
    );

    const [parentSubagentMessage] = getSessionMessages(sessionsRef, "external-parent-session");
    expect(parentSubagentMessage?.meta).toMatchObject({
      kind: "subagent",
      correlationKey: subagentCorrelationKey,
    });
    expect(parentSubagentMessage?.meta).not.toHaveProperty("externalSessionId");
  });
});

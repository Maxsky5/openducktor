import { describe, expect, mock, test } from "bun:test";
import {
  buildSession,
  createSessionsRef,
  createSessionUpdater,
  findSession,
  getSessionMessages,
  type SessionEvent,
  type SessionUpdateFn,
} from "./session-events-test-harness";
import {
  approvalRequiredEvent,
  buildParentSessionWithSubagent,
  flushAutoReject,
  linkedChildApprovalEvent,
  listensToSessions,
  startTestSessionObserver,
} from "./session-permissions-questions.test-helpers";

describe("agent-orchestrator permission auto-rejection", () => {
  test("auto-rejects mutating permissions for read-only roles", async () => {
    const replyApproval = mock(async () => {});
    const sessionsRef = createSessionsRef([buildSession({ role: "spec" })]);
    const handleEvent = await startTestSessionObserver({
      externalSessionId: "session-1",
      sessionsRef,
      replyApproval,
    });

    handleEvent(
      approvalRequiredEvent({
        externalSessionId: "session-1",
        requestId: "perm-1",
        affectedPaths: ["edit file"],
        action: { name: "write" },
        mutation: "mutating" as const,
        metadata: { tool: "edit" },
      }),
    );

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

  test("auto-rejects mutating child permissions mirrored on a read-only parent", async () => {
    const replyApproval = mock(async () => {});
    const subagentCorrelationKey = "part:assistant-parent:subtask-parent-write";
    const sessionsRef = createSessionsRef([
      buildParentSessionWithSubagent({
        correlationKey: subagentCorrelationKey,
        partId: "subtask-parent-write",
        prompt: "Update repo",
      }),
    ]);
    const updateSessionCalls: Array<{
      externalSessionId: string;
      options: Parameters<SessionUpdateFn>[2];
    }> = [];
    const applySessionUpdate = createSessionUpdater(sessionsRef);
    const updateSession: SessionUpdateFn = (identity, updater, options) => {
      updateSessionCalls.push({ externalSessionId: identity.externalSessionId, options });
      return applySessionUpdate(identity, updater);
    };
    const handleEvent = await startTestSessionObserver({
      externalSessionId: "external-parent-session",
      sessionsRef,
      replyApproval,
      updateSession,
    });

    handleEvent(
      linkedChildApprovalEvent({
        externalSessionId: "external-parent-session",
        requestId: "perm-child-write",
        action: { name: "write" },
        mutation: "mutating" as const,
        subagentCorrelationKey,
      }),
    );

    expect(findSession(sessionsRef, "external-parent-session")?.pendingApprovals).toHaveLength(1);
    expect(findSession(sessionsRef, "external-child-session")).toBeUndefined();
    await flushAutoReject();

    expect(replyApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        externalSessionId: "external-child-session",
        requestId: "perm-child-write",
        outcome: "reject",
        message: expect.any(String),
      }),
    );
    expect(findSession(sessionsRef, "external-parent-session")?.pendingApprovals).toHaveLength(0);
    expect(findSession(sessionsRef, "external-child-session")).toBeUndefined();
    expect(updateSessionCalls).toContainEqual({
      externalSessionId: "external-parent-session",
      options: { persist: true },
    });
    expect(updateSessionCalls).not.toContainEqual({
      externalSessionId: "external-child-session",
      options: { persist: true },
    });
    const [parentSubagentMessage] = getSessionMessages(sessionsRef, "external-parent-session");
    expect(parentSubagentMessage?.meta).toMatchObject({
      kind: "subagent",
      correlationKey: subagentCorrelationKey,
      externalSessionId: "external-child-session",
    });
  });

  test("keeps child response routing when child auto-rejection needs manual response", async () => {
    const replyApproval = mock(async () => {
      throw new Error("runtime unavailable");
    });
    const subagentCorrelationKey = "part:assistant-parent:subtask-parent-write-failed";
    const sessionsRef = createSessionsRef([
      buildParentSessionWithSubagent({
        correlationKey: subagentCorrelationKey,
        partId: "subtask-parent-write-failed",
        prompt: "Update repo",
      }),
    ]);
    const handleEvent = await startTestSessionObserver({
      externalSessionId: "external-parent-session",
      sessionsRef,
      replyApproval,
    });

    handleEvent(
      linkedChildApprovalEvent({
        externalSessionId: "external-parent-session",
        requestId: "perm-child-write-failed",
        action: { name: "write" },
        mutation: "mutating" as const,
        subagentCorrelationKey,
      }),
    );
    await flushAutoReject();

    expect(findSession(sessionsRef, "external-parent-session")?.pendingApprovals).toMatchObject([
      {
        requestId: "perm-child-write-failed",
        responseSession: {
          externalSessionId: "external-child-session",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo",
        },
        source: {
          kind: "subagent",
          parentExternalSessionId: "external-parent-session",
          childExternalSessionId: "external-child-session",
          subagentCorrelationKey,
        },
      },
    ]);
    expect(
      getSessionMessages(sessionsRef, "external-parent-session").some((message) =>
        message.content.includes("Automatic approval rejection failed"),
      ),
    ).toBe(true);
    expect(findSession(sessionsRef, "external-child-session")).toBeUndefined();
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

    handleParentEvent(
      linkedChildApprovalEvent({
        externalSessionId: "external-parent-session",
        requestId: "perm-child-write",
        action: { name: "write" },
        mutation: "mutating" as const,
        subagentCorrelationKey,
      }),
    );
    expect(findSession(sessionsRef, "external-child-session")?.pendingApprovals).toHaveLength(1);
    await flushAutoReject();

    expect(replyApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        externalSessionId: "external-child-session",
        requestId: "perm-child-write",
        outcome: "reject",
        message: expect.any(String),
      }),
    );
    expect(findSession(sessionsRef, "external-child-session")?.pendingApprovals).toHaveLength(0);
  });

  test("lets active child sessions own linked auto-reject replies", async () => {
    let completeReply!: () => void;
    const replyCompleted = new Promise<void>((resolve) => {
      completeReply = resolve;
    });
    const replyApproval = mock(async () => {
      await replyCompleted;
    });
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

    const event: SessionEvent = linkedChildApprovalEvent({
      externalSessionId: "external-parent-session",
      requestId: "perm-child-write",
      action: { name: "write" },
      mutation: "mutating" as const,
      subagentCorrelationKey,
    });

    handleParentEvent(event);
    await flushAutoReject();

    expect(replyApproval).toHaveBeenCalledTimes(1);
    expect(replyApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        externalSessionId: "external-child-session",
        requestId: "perm-child-write",
        outcome: "reject",
        message: expect.any(String),
      }),
    );

    handleChildEvent({ ...event, externalSessionId: "external-child-session" });
    await flushAutoReject();

    expect(replyApproval).toHaveBeenCalledTimes(1);
    completeReply();
    await flushAutoReject();
    expect(findSession(sessionsRef, "external-parent-session")?.pendingApprovals).toHaveLength(0);
  });
});

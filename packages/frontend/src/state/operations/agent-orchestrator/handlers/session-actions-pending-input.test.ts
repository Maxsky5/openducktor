import { describe, expect, test } from "bun:test";
import type {
  AgentSessionLiveReplyApprovalInput,
  AgentSessionLiveReplyQuestionInput,
} from "@openducktor/contracts";
import type { PolicyBoundSessionRef } from "@openducktor/core";
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";
import {
  buildSession,
  createSessionActions,
  createSessionsRef,
  getSession,
} from "./session-actions.test-helpers";

const readPendingApproval = (session: ReturnType<typeof getSession>, requestId: string) => {
  const request = session.pendingApprovals.find((approval) => approval.requestId === requestId);
  if (!request) {
    throw new Error(`Expected pending approval '${requestId}'`);
  }
  return request;
};

const readPendingQuestion = (session: ReturnType<typeof getSession>, requestId: string) => {
  const request = session.pendingQuestions.find((question) => question.requestId === requestId);
  if (!request) {
    throw new Error(`Expected pending question '${requestId}'`);
  }
  return request;
};

const approvalRequest = (requestId: string): AgentApprovalRequest => ({
  requestId,
  requestType: "permission_grant",
  title: "Approve permission: read",
  summary: "Approval request for read.",
  action: { name: "read" },
  mutation: "read_only",
  supportedReplyOutcomes: ["approve_once", "reject"],
});

const questionRequest = (requestId: string): AgentQuestionRequest => ({
  requestId,
  questions: [
    {
      header: "Confirm",
      question: "Continue?",
      options: [],
      multiple: false,
      custom: false,
    },
  ],
});

const policyBoundSessionRef = (
  externalSessionId: string,
  workingDirectory = "/tmp/repo/worktree",
): PolicyBoundSessionRef => ({
  repoPath: "/tmp/repo",
  externalSessionId,
  runtimeKind: "opencode",
  workingDirectory,
  runtimePolicy: { kind: "opencode" },
});

describe("agent-orchestrator/handlers/session-actions pending input", () => {
  test("routes an approval through the generic host without mutating the live projection locally", async () => {
    const request = approvalRequest("perm-1");
    const sessionsRef = createSessionsRef([buildSession({ pendingApprovals: [request] })]);
    const replies: AgentSessionLiveReplyApprovalInput[] = [];
    const actions = createSessionActions({
      sessionsRef,
      liveSessionHost: {
        agentSessionLiveReplyApproval: async (input) => {
          replies.push(input);
        },
        agentSessionLiveReplyQuestion: async () => {},
      },
    });

    const session = getSession(sessionsRef);
    await actions.replyAgentApproval(
      session,
      readPendingApproval(session, "perm-1"),
      "approve_once",
    );

    expect(replies).toEqual([
      {
        repoPath: "/tmp/repo",
        externalSessionId: "session-1",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        requestId: "perm-1",
        outcome: "approve_once",
      },
    ]);
    expect(getSession(sessionsRef).pendingApprovals).toEqual([request]);
  });

  test("replies to an approval from a transcript-only normalized session ref", async () => {
    const replies: AgentSessionLiveReplyApprovalInput[] = [];
    const actions = createSessionActions({
      sessionsRef: createSessionsRef(),
      liveSessionHost: {
        agentSessionLiveReplyApproval: async (input) => {
          replies.push(input);
        },
        agentSessionLiveReplyQuestion: async () => {},
      },
    });

    await actions.replyAgentApproval(
      policyBoundSessionRef("session-transcript-1", "/tmp/repo"),
      approvalRequest("perm-1"),
      "approve_once",
    );

    expect(replies[0]).toMatchObject({
      repoPath: "/tmp/repo",
      externalSessionId: "session-transcript-1",
      workingDirectory: "/tmp/repo",
      requestId: "perm-1",
    });
  });

  test("routes a mirrored subagent approval to its response session", async () => {
    const childSession = {
      externalSessionId: "session-child",
      runtimeKind: "opencode" as const,
      workingDirectory: "/tmp/repo/worktree",
    };
    const request: AgentApprovalRequest = {
      ...approvalRequest("perm-child"),
      responseSession: childSession,
      source: {
        kind: "subagent",
        parentExternalSessionId: "session-parent",
        childExternalSessionId: childSession.externalSessionId,
      },
    };
    const sessionsRef = createSessionsRef([
      buildSession({ externalSessionId: "session-parent", pendingApprovals: [request] }),
      buildSession({ externalSessionId: "session-child", pendingApprovals: [request] }),
    ]);
    const replies: AgentSessionLiveReplyApprovalInput[] = [];
    const actions = createSessionActions({
      sessionsRef,
      liveSessionHost: {
        agentSessionLiveReplyApproval: async (input) => {
          replies.push(input);
        },
        agentSessionLiveReplyQuestion: async () => {},
      },
    });

    await actions.replyAgentApproval(
      policyBoundSessionRef("session-parent"),
      request,
      "approve_once",
    );

    expect(replies[0]?.externalSessionId).toBe("session-child");
    expect(getSession(sessionsRef, "session-parent").pendingApprovals).toEqual([request]);
    expect(getSession(sessionsRef, "session-child").pendingApprovals).toEqual([request]);
  });

  test("routes a question through the generic host without annotating transcript state locally", async () => {
    const request = questionRequest("question-1");
    const sessionsRef = createSessionsRef([buildSession({ pendingQuestions: [request] })]);
    const replies: AgentSessionLiveReplyQuestionInput[] = [];
    const actions = createSessionActions({
      sessionsRef,
      liveSessionHost: {
        agentSessionLiveReplyApproval: async () => {},
        agentSessionLiveReplyQuestion: async (input) => {
          replies.push(input);
        },
      },
    });

    const session = getSession(sessionsRef);
    await actions.answerAgentQuestion(session, readPendingQuestion(session, "question-1"), [
      ["yes"],
    ]);

    expect(replies).toEqual([
      {
        repoPath: "/tmp/repo",
        externalSessionId: "session-1",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        requestId: "question-1",
        answers: [["yes"]],
      },
    ]);
    expect(getSession(sessionsRef).pendingQuestions).toEqual([request]);
  });

  test("answers a question from a transcript-only normalized session ref", async () => {
    const replies: AgentSessionLiveReplyQuestionInput[] = [];
    const actions = createSessionActions({
      sessionsRef: createSessionsRef(),
      liveSessionHost: {
        agentSessionLiveReplyApproval: async () => {},
        agentSessionLiveReplyQuestion: async (input) => {
          replies.push(input);
        },
      },
    });

    await actions.answerAgentQuestion(
      policyBoundSessionRef("session-transcript-1", "/tmp/repo"),
      questionRequest("question-1"),
      [["yes"]],
    );

    expect(replies[0]).toMatchObject({
      repoPath: "/tmp/repo",
      externalSessionId: "session-transcript-1",
      workingDirectory: "/tmp/repo",
      requestId: "question-1",
      answers: [["yes"]],
    });
  });

  test("routes a mirrored subagent question to its response session", async () => {
    const childSession = {
      externalSessionId: "session-child",
      runtimeKind: "opencode" as const,
      workingDirectory: "/tmp/repo/worktree",
    };
    const request: AgentQuestionRequest = {
      ...questionRequest("question-child"),
      responseSession: childSession,
      source: {
        kind: "subagent",
        parentExternalSessionId: "session-parent",
        childExternalSessionId: childSession.externalSessionId,
      },
    };
    const sessionsRef = createSessionsRef([
      buildSession({ externalSessionId: "session-parent", pendingQuestions: [request] }),
      buildSession({ externalSessionId: "session-child", pendingQuestions: [request] }),
    ]);
    const replies: AgentSessionLiveReplyQuestionInput[] = [];
    const actions = createSessionActions({
      sessionsRef,
      liveSessionHost: {
        agentSessionLiveReplyApproval: async () => {},
        agentSessionLiveReplyQuestion: async (input) => {
          replies.push(input);
        },
      },
    });

    await actions.answerAgentQuestion(policyBoundSessionRef("session-parent"), request, [["yes"]]);

    expect(replies[0]?.externalSessionId).toBe("session-child");
    expect(getSession(sessionsRef, "session-parent").pendingQuestions).toEqual([request]);
    expect(getSession(sessionsRef, "session-child").pendingQuestions).toEqual([request]);
  });

  test("keeps pending input committed when the host reply fails", async () => {
    const request = approvalRequest("perm-1");
    const sessionsRef = createSessionsRef([buildSession({ pendingApprovals: [request] })]);
    const actions = createSessionActions({
      sessionsRef,
      liveSessionHost: {
        agentSessionLiveReplyApproval: async () => {
          throw new Error("native reply failed");
        },
        agentSessionLiveReplyQuestion: async () => {},
      },
    });

    const session = getSession(sessionsRef);
    await expect(
      actions.replyAgentApproval(session, readPendingApproval(session, "perm-1"), "approve_once"),
    ).rejects.toThrow("native reply failed");
    expect(getSession(sessionsRef).pendingApprovals).toEqual([request]);
  });
});

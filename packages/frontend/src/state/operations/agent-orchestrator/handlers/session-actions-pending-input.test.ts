import { describe, expect, test } from "bun:test";
import type {
  AgentSessionLiveReplyApprovalInput,
  AgentSessionLiveReplyQuestionInput,
} from "@openducktor/contracts";
import type { PolicyBoundSessionRef } from "@openducktor/core";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
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

  test("fails closed when an approval target has no recorded repository context", async () => {
    let hostCalls = 0;
    const actions = createSessionActions({
      workspaceRepoPath: "/active/repository",
      sessionsRef: createSessionsRef(),
      liveSessionHost: {
        agentSessionLiveReplyApproval: async () => {
          hostCalls += 1;
        },
        agentSessionLiveReplyQuestion: async () => {},
      },
    });

    await expect(
      actions.replyAgentApproval(
        {
          externalSessionId: "missing-session",
          runtimeKind: "opencode",
          workingDirectory: "/missing/session",
        },
        approvalRequest("perm-missing"),
        "approve_once",
      ),
    ).rejects.toThrow(
      "Cannot reply to pending input for session 'missing-session' because its repository context is unavailable.",
    );
    expect(hostCalls).toBe(0);
  });

  test("routes a UI-shaped repository approval through the session repository", async () => {
    const request = approvalRequest("perm-repository");
    const session = buildSession({
      sessionAssociation: { kind: "repository" },
      repoPath: "/session/repository",
      pendingApprovals: [request],
    });
    const sessionsRef = createSessionsRef([session]);
    const replies: AgentSessionLiveReplyApprovalInput[] = [];
    const actions = createSessionActions({
      workspaceRepoPath: "/active/repository",
      sessionsRef,
      liveSessionHost: {
        agentSessionLiveReplyApproval: async (input) => {
          replies.push(input);
        },
        agentSessionLiveReplyQuestion: async () => {},
      },
    });

    await actions.replyAgentApproval(toAgentSessionIdentity(session), request, "approve_once");

    expect(replies[0]?.repoPath).toBe("/session/repository");
  });

  test("routes a mirrored subagent approval to its response session", async () => {
    const childSession = {
      externalSessionId: "session-child",
      runtimeKind: "opencode" as const,
      workingDirectory: "/tmp/repo/worktree",
      sessionAssociation: { kind: "repository" as const },
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
      buildSession({
        externalSessionId: "session-child",
        sessionAssociation: { kind: "repository" },
        pendingApprovals: [request],
      }),
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

  test("routes a UI-shaped Claude subagent approval through the loaded parent repository", async () => {
    const childSession = buildSession({
      externalSessionId: "claude-child",
      runtimeKind: "claude",
      repoPath: "/claude/session/repository",
      workingDirectory: "/claude/session/repository",
      sessionAssociation: { kind: "repository" },
    });
    const request: AgentApprovalRequest = {
      ...approvalRequest("perm-claude-child"),
      responseSession: {
        externalSessionId: childSession.externalSessionId,
        runtimeKind: childSession.runtimeKind,
        workingDirectory: childSession.workingDirectory,
        sessionAssociation: childSession.sessionAssociation,
      },
      source: {
        kind: "subagent",
        parentExternalSessionId: "claude-parent",
        childExternalSessionId: childSession.externalSessionId,
      },
    };
    const parentSession = buildSession({
      externalSessionId: "claude-parent",
      runtimeKind: "claude",
      repoPath: "/claude/session/repository",
      workingDirectory: "/claude/session/repository",
      sessionAssociation: { kind: "repository" },
      pendingApprovals: [request],
    });
    const sessionsRef = createSessionsRef([parentSession]);
    const replies: AgentSessionLiveReplyApprovalInput[] = [];
    const actions = createSessionActions({
      workspaceRepoPath: "/active/repository",
      sessionsRef,
      liveSessionHost: {
        agentSessionLiveReplyApproval: async (input) => {
          replies.push(input);
        },
        agentSessionLiveReplyQuestion: async () => {},
      },
    });

    await actions.replyAgentApproval(
      toAgentSessionIdentity(parentSession),
      request,
      "approve_once",
    );

    expect(replies[0]).toMatchObject({
      repoPath: "/claude/session/repository",
      externalSessionId: "claude-child",
      runtimeKind: "claude",
      workingDirectory: "/claude/session/repository",
    });
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

  test("routes a UI-shaped repository question through the session repository", async () => {
    const request = questionRequest("question-repository");
    const session = buildSession({
      sessionAssociation: { kind: "repository" },
      repoPath: "/session/repository",
      pendingQuestions: [request],
    });
    const sessionsRef = createSessionsRef([session]);
    const replies: AgentSessionLiveReplyQuestionInput[] = [];
    const actions = createSessionActions({
      workspaceRepoPath: "/active/repository",
      sessionsRef,
      liveSessionHost: {
        agentSessionLiveReplyApproval: async () => {},
        agentSessionLiveReplyQuestion: async (input) => {
          replies.push(input);
        },
      },
    });

    await actions.answerAgentQuestion(toAgentSessionIdentity(session), request, [["yes"]]);

    expect(replies[0]?.repoPath).toBe("/session/repository");
  });

  test("routes a mirrored subagent question to its response session", async () => {
    const childSession = {
      externalSessionId: "session-child",
      runtimeKind: "opencode" as const,
      workingDirectory: "/tmp/repo/worktree",
      sessionAssociation: { kind: "repository" as const },
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
      buildSession({
        externalSessionId: "session-child",
        sessionAssociation: { kind: "repository" },
        pendingQuestions: [request],
      }),
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

  test("routes a UI-shaped Claude subagent question through the child repository", async () => {
    const childSession = buildSession({
      externalSessionId: "claude-child",
      runtimeKind: "claude",
      repoPath: "/claude/session/repository",
      workingDirectory: "/claude/session/repository",
      sessionAssociation: { kind: "repository" },
    });
    const request: AgentQuestionRequest = {
      ...questionRequest("question-claude-child"),
      responseSession: {
        externalSessionId: childSession.externalSessionId,
        runtimeKind: childSession.runtimeKind,
        workingDirectory: childSession.workingDirectory,
        sessionAssociation: childSession.sessionAssociation,
      },
      source: {
        kind: "subagent",
        parentExternalSessionId: "claude-parent",
        childExternalSessionId: childSession.externalSessionId,
      },
    };
    const parentSession = buildSession({
      externalSessionId: "claude-parent",
      runtimeKind: "claude",
      repoPath: "/claude/session/repository",
      workingDirectory: "/claude/session/repository",
      sessionAssociation: { kind: "repository" },
      pendingQuestions: [request],
    });
    const sessionsRef = createSessionsRef([parentSession, childSession]);
    const replies: AgentSessionLiveReplyQuestionInput[] = [];
    const actions = createSessionActions({
      workspaceRepoPath: "/active/repository",
      sessionsRef,
      liveSessionHost: {
        agentSessionLiveReplyApproval: async () => {},
        agentSessionLiveReplyQuestion: async (input) => {
          replies.push(input);
        },
      },
    });

    await actions.answerAgentQuestion(toAgentSessionIdentity(parentSession), request, [["yes"]]);

    expect(replies[0]).toMatchObject({
      repoPath: "/claude/session/repository",
      externalSessionId: "claude-child",
      runtimeKind: "claude",
      workingDirectory: "/claude/session/repository",
    });
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

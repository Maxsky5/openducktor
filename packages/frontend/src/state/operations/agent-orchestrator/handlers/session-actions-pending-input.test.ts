import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { PolicyBoundSessionRef } from "@openducktor/core";
import { getAgentSession, replaceAgentSession } from "@/state/agent-session-collection";
import { sessionMessageAt } from "@/test-utils/session-message-test-helpers";
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import { createAgentSessionRuntimeSnapshotFixture } from "../test-utils";
import {
  buildSession,
  createSessionActions,
  createSessionsRef,
  getSession,
  mockAgentSessionRuntimeSnapshot,
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

const missingApprovalRequest = (requestId: string): AgentApprovalRequest => ({
  requestId,
  requestType: "permission_grant",
  title: "Approve permission: read",
  summary: "Approval request for read.",
  action: { name: "read" },
  mutation: "read_only",
  supportedReplyOutcomes: ["approve_once", "reject"],
});

const missingQuestionRequest = (requestId: string): AgentQuestionRequest => ({
  requestId,
  questions: [],
});

const questionToolMessage = () => ({
  id: "tool-1",
  role: "tool" as const,
  content: "Question requested",
  timestamp: "2026-02-22T08:00:01.000Z",
  meta: {
    kind: "tool" as const,
    partId: "part-1",
    callId: "call-1",
    tool: "question",
    toolType: "question" as const,
    status: "completed" as const,
    metadata: {},
  },
});

describe("agent-orchestrator/handlers/session-actions pending input", () => {
  test("removes resolved permission", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalReplyApproval = adapter.replyApproval;
    let replyCalls = 0;
    adapter.replyApproval = async () => {
      replyCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        pendingApprovals: [
          {
            requestId: "perm-1",
            requestType: "permission_grant" as const,
            title: `Approve permission: ${"read"}`,
            summary: `Approval request for ${"read"}.`,
            affectedPaths: ["*"],
            action: { name: "read" },
            mutation: "read_only" as const,
            supportedReplyOutcomes: [
              "approve_once" as const,
              "approve_session" as const,
              "reject" as const,
            ],
          },
        ],
      }),
    ]);
    const updateSessionOptions: Array<Parameters<UpdateSession>[2]> = [];

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      updateSession: (identity, updater, options) => {
        const current = getAgentSession(sessionsRef.current, identity);
        if (!current) {
          return null;
        }
        updateSessionOptions.push(options);
        const nextSession = updater(current);
        sessionsRef.current = replaceAgentSession(sessionsRef.current, nextSession);
        return nextSession;
      },
    });

    try {
      const session = getSession(sessionsRef);
      await actions.replyAgentApproval(
        session,
        readPendingApproval(session, "perm-1"),
        "approve_once",
      );
      expect(replyCalls).toBe(1);
      expect(getSession(sessionsRef)?.pendingApprovals).toHaveLength(0);
      expect(updateSessionOptions).toEqual([undefined]);
    } finally {
      adapter.replyApproval = originalReplyApproval;
    }
  });

  test("replies to permission after resuming a session with pending live input", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalListAgentSessionRuntimeSnapshots = adapter.listSessionRuntimeSnapshots;
    const originalResumeSession = adapter.resumeSession;
    const originalReplyApproval = adapter.replyApproval;
    let resumeCalls = 0;
    let replyCalls = 0;
    mockAgentSessionRuntimeSnapshot(
      adapter,
      createAgentSessionRuntimeSnapshotFixture({
        ref: {
          externalSessionId: "session-1",
          workingDirectory: "/tmp/repo",
        },
        snapshot: {
          title: "Build",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeActivity: "idle",
          pendingApprovals: [
            {
              requestId: "perm-1",
              requestType: "permission_grant" as const,
              title: `Approve permission: ${"read"}`,
              summary: `Approval request for ${"read"}.`,
              affectedPaths: [".env"],
              action: { name: "read" },
              mutation: "read_only" as const,
              supportedReplyOutcomes: [
                "approve_once" as const,
                "approve_session" as const,
                "reject" as const,
              ],
            },
          ],
          pendingQuestions: [],
        },
      }),
    );
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return {
        externalSessionId: input.externalSessionId,
        workingDirectory: input.workingDirectory,
        role: input.sessionScope?.role ?? null,
        startedAt: "2026-02-22T08:00:00.000Z",
        status: "idle",
        runtimeKind: input.runtimeKind,
      };
    };
    adapter.replyApproval = async () => {
      replyCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "stopped",
        externalSessionId: "session-1",
        pendingApprovals: [
          {
            requestId: "perm-1",
            requestType: "permission_grant" as const,
            title: `Approve permission: ${"read"}`,
            summary: `Approval request for ${"read"}.`,
            affectedPaths: [".env"],
            action: { name: "read" },
            mutation: "read_only" as const,
            supportedReplyOutcomes: [
              "approve_once" as const,
              "approve_session" as const,
              "reject" as const,
            ],
          },
        ],
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
    });

    try {
      const session = getSession(sessionsRef);
      await actions.replyAgentApproval(
        session,
        readPendingApproval(session, "perm-1"),
        "approve_once",
      );
      expect(resumeCalls).toBe(0);
      expect(replyCalls).toBe(1);
      expect(getSession(sessionsRef)?.pendingApprovals).toEqual([]);
    } finally {
      adapter.listSessionRuntimeSnapshots = originalListAgentSessionRuntimeSnapshots;
      adapter.resumeSession = originalResumeSession;
      adapter.replyApproval = originalReplyApproval;
    }
  });

  test("requires a loaded local session before replying to permission", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalReplyApproval = adapter.replyApproval;
    let replyCalls = 0;
    adapter.replyApproval = async () => {
      replyCalls += 1;
    };
    let updateCalls = 0;

    const actions = createSessionActions({
      adapter,
      sessionsRef: createSessionsRef(),
      updateSession: () => {
        updateCalls += 1;
        return null;
      },
    });

    try {
      await expect(
        actions.replyAgentApproval(
          {
            externalSessionId: "session-transcript-1",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo",
          },
          missingApprovalRequest("perm-1"),
          "approve_once",
        ),
      ).rejects.toThrow("Session 'session-transcript-1' is not loaded.");

      expect(replyCalls).toBe(0);
      expect(updateCalls).toBe(0);
    } finally {
      adapter.replyApproval = originalReplyApproval;
    }
  });

  test("replies through a policy-bound transcript-only ref", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalReplyApproval = adapter.replyApproval;
    const replies: Array<{ requestId: string; outcome: string }> = [];
    adapter.replyApproval = async (input) => {
      replies.push({ requestId: input.requestId, outcome: input.outcome });
    };
    const actions = createSessionActions({
      adapter,
      sessionsRef: createSessionsRef(),
    });
    const transcriptSessionRef = {
      repoPath: "/tmp/repo",
      externalSessionId: "session-transcript-1",
      runtimeKind: "opencode" as const,
      workingDirectory: "/tmp/repo",
      runtimePolicy: { kind: "opencode" as const },
    };

    try {
      await actions.replyAgentApproval(
        transcriptSessionRef,
        missingApprovalRequest("perm-1"),
        "approve_once",
      );

      expect(replies).toEqual([{ requestId: "perm-1", outcome: "approve_once" }]);
    } finally {
      adapter.replyApproval = originalReplyApproval;
    }
  });

  test("routes a policy-bound subagent approval to its response session", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalReplyApproval = adapter.replyApproval;
    const childSession = {
      externalSessionId: "session-child",
      runtimeKind: "opencode" as const,
      workingDirectory: "/tmp/repo/worktree",
    };
    const request: AgentApprovalRequest = {
      ...missingApprovalRequest("perm-child"),
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
        externalSessionId: childSession.externalSessionId,
        pendingApprovals: [request],
      }),
    ]);
    const replies: string[] = [];
    adapter.replyApproval = async (input) => {
      replies.push(input.externalSessionId);
    };
    const actions = createSessionActions({ adapter, sessionsRef });
    const parentSessionRef: PolicyBoundSessionRef = {
      repoPath: "/tmp/repo",
      externalSessionId: "session-parent",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
      runtimePolicy: { kind: "opencode" },
    };

    try {
      await actions.replyAgentApproval(parentSessionRef, request, "approve_once");

      expect(replies).toEqual(["session-child"]);
      expect(getSession(sessionsRef, "session-parent").pendingApprovals).toEqual([]);
      expect(getSession(sessionsRef, "session-child").pendingApprovals).toEqual([]);
    } finally {
      adapter.replyApproval = originalReplyApproval;
    }
  });

  test("answers question and annotates matching tool message metadata", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalReplyQuestion = adapter.replyQuestion;
    let replyCalls = 0;
    adapter.replyQuestion = async () => {
      replyCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        messages: [questionToolMessage()],
        pendingQuestions: [
          {
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
          },
        ],
      }),
    ]);
    const updateSessionOptions: Array<Parameters<UpdateSession>[2]> = [];

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      updateSession: (identity, updater, options) => {
        const current = getAgentSession(sessionsRef.current, identity);
        if (!current) {
          return null;
        }
        updateSessionOptions.push(options);
        const nextSession = updater(current);
        sessionsRef.current = replaceAgentSession(sessionsRef.current, nextSession);
        return nextSession;
      },
    });

    try {
      const session = getSession(sessionsRef);
      await actions.answerAgentQuestion(session, readPendingQuestion(session, "question-1"), [
        ["yes"],
      ]);
      expect(replyCalls).toBe(1);
      expect(getSession(sessionsRef)?.pendingQuestions).toHaveLength(0);
      expect(updateSessionOptions).toEqual([undefined]);
      const message = sessionMessageAt(getSession(sessionsRef), 0);
      if (message?.meta?.kind !== "tool") {
        throw new Error("Expected tool message metadata");
      }
      expect(message.meta.metadata?.requestId).toBe("question-1");
      expect(message.meta.metadata?.answers).toEqual([["yes"]]);
    } finally {
      adapter.replyQuestion = originalReplyQuestion;
    }
  });

  test("requires a loaded local session before answering a question", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalReplyQuestion = adapter.replyQuestion;
    let replyCalls = 0;
    adapter.replyQuestion = async () => {
      replyCalls += 1;
    };
    let updateCalls = 0;

    const actions = createSessionActions({
      adapter,
      sessionsRef: createSessionsRef(),
      updateSession: () => {
        updateCalls += 1;
        return null;
      },
    });

    try {
      await expect(
        actions.answerAgentQuestion(
          {
            externalSessionId: "session-transcript-1",
            runtimeKind: "opencode",
            workingDirectory: "/tmp/repo",
          },
          missingQuestionRequest("question-1"),
          [["yes"]],
        ),
      ).rejects.toThrow("Session 'session-transcript-1' is not loaded.");

      expect(replyCalls).toBe(0);
      expect(updateCalls).toBe(0);
    } finally {
      adapter.replyQuestion = originalReplyQuestion;
    }
  });

  test("answers through a policy-bound transcript-only ref", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalReplyQuestion = adapter.replyQuestion;
    const replies: Array<{ requestId: string; answers: string[][] }> = [];
    adapter.replyQuestion = async (input) => {
      replies.push({ requestId: input.requestId, answers: input.answers });
    };
    const actions = createSessionActions({
      adapter,
      sessionsRef: createSessionsRef(),
    });
    const transcriptSessionRef = {
      repoPath: "/tmp/repo",
      externalSessionId: "session-transcript-1",
      runtimeKind: "opencode" as const,
      workingDirectory: "/tmp/repo",
      runtimePolicy: { kind: "opencode" as const },
    };

    try {
      await actions.answerAgentQuestion(
        transcriptSessionRef,
        missingQuestionRequest("question-1"),
        [["yes"]],
      );

      expect(replies).toEqual([{ requestId: "question-1", answers: [["yes"]] }]);
    } finally {
      adapter.replyQuestion = originalReplyQuestion;
    }
  });

  test("routes a policy-bound subagent answer and updates all loaded participants", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalReplyQuestion = adapter.replyQuestion;
    const childSession = {
      externalSessionId: "session-child",
      runtimeKind: "opencode" as const,
      workingDirectory: "/tmp/repo/worktree",
    };
    const request: AgentQuestionRequest = {
      requestId: "question-child",
      questions: [
        {
          header: "Confirm",
          question: "Continue?",
          options: [],
          multiple: false,
          custom: false,
        },
      ],
      responseSession: childSession,
      source: {
        kind: "subagent",
        parentExternalSessionId: "session-parent",
        childExternalSessionId: childSession.externalSessionId,
      },
    };
    const sessionsRef = createSessionsRef([
      buildSession({
        externalSessionId: "session-parent",
        messages: [questionToolMessage()],
        pendingQuestions: [request],
      }),
      buildSession({
        externalSessionId: childSession.externalSessionId,
        messages: [questionToolMessage()],
        pendingQuestions: [request],
      }),
    ]);
    const replies: string[] = [];
    adapter.replyQuestion = async (input) => {
      replies.push(input.externalSessionId);
    };
    const actions = createSessionActions({ adapter, sessionsRef });
    const parentSessionRef: PolicyBoundSessionRef = {
      repoPath: "/tmp/repo",
      externalSessionId: "session-parent",
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
      runtimePolicy: { kind: "opencode" },
    };

    try {
      await actions.answerAgentQuestion(parentSessionRef, request, [["yes"]]);

      expect(replies).toEqual(["session-child"]);
      for (const externalSessionId of ["session-parent", "session-child"]) {
        const session = getSession(sessionsRef, externalSessionId);
        expect(session.pendingQuestions).toEqual([]);
        const message = sessionMessageAt(session, 0);
        if (message?.meta?.kind !== "tool") {
          throw new Error("Expected tool message metadata");
        }
        expect(message.meta.metadata?.requestId).toBe("question-child");
        expect(message.meta.metadata?.answers).toEqual([["yes"]]);
      }
    } finally {
      adapter.replyQuestion = originalReplyQuestion;
    }
  });

  test("answers question after resuming a session with pending live input", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalListAgentSessionRuntimeSnapshots = adapter.listSessionRuntimeSnapshots;
    const originalResumeSession = adapter.resumeSession;
    const originalReplyQuestion = adapter.replyQuestion;
    let resumeCalls = 0;
    let replyCalls = 0;
    mockAgentSessionRuntimeSnapshot(
      adapter,
      createAgentSessionRuntimeSnapshotFixture({
        ref: {
          externalSessionId: "session-1",
          workingDirectory: "/tmp/repo",
        },
        snapshot: {
          title: "Build",
          startedAt: "2026-02-22T08:00:00.000Z",
          runtimeActivity: "idle",
          pendingApprovals: [],
          pendingQuestions: [
            {
              requestId: "question-1",
              questions: [{ header: "Confirm", question: "Confirm", options: [], custom: false }],
            },
          ],
        },
      }),
    );
    adapter.resumeSession = async (input) => {
      resumeCalls += 1;
      return {
        externalSessionId: input.externalSessionId,
        workingDirectory: input.workingDirectory,
        role: input.sessionScope?.role ?? null,
        startedAt: "2026-02-22T08:00:00.000Z",
        status: "idle",
        runtimeKind: input.runtimeKind,
      };
    };
    adapter.replyQuestion = async () => {
      replyCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "stopped",
        externalSessionId: "session-1",
        pendingQuestions: [
          {
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
          },
        ],
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
    });

    try {
      const session = getSession(sessionsRef);
      await actions.answerAgentQuestion(session, readPendingQuestion(session, "question-1"), [
        ["yes"],
      ]);
      expect(resumeCalls).toBe(0);
      expect(replyCalls).toBe(1);
      expect(getSession(sessionsRef)?.pendingQuestions).toEqual([]);
    } finally {
      adapter.listSessionRuntimeSnapshots = originalListAgentSessionRuntimeSnapshots;
      adapter.resumeSession = originalResumeSession;
      adapter.replyQuestion = originalReplyQuestion;
    }
  });
});

import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import { getAgentSession, replaceAgentSession } from "@/state/agent-session-collection";
import { sessionMessageAt } from "@/test-utils/session-message-test-helpers";
import {
  createAgentSessionRuntimeSnapshotFixture,
  createSessionObserversRefFixture,
} from "../test-utils";
import {
  buildSession,
  createSessionActions,
  createSessionsRef,
  getSession,
  mockAgentSessionRuntimeSnapshot,
} from "./session-actions.test-helpers";

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
    const updateSessionOptions: Array<{ persist?: boolean } | undefined> = [];

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
      await actions.replyAgentApproval(getSession(sessionsRef), "perm-1", "approve_once");
      expect(replyCalls).toBe(1);
      expect(getSession(sessionsRef)?.pendingApprovals).toHaveLength(0);
      expect(updateSessionOptions).toEqual([{ persist: false }]);
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
        role: input.role,
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
      sessionObserversRef: createSessionObserversRefFixture([{ externalSessionId: "session-1" }]),
    });

    try {
      await actions.replyAgentApproval(getSession(sessionsRef), "perm-1", "approve_once");
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
          buildSession({ externalSessionId: "session-transcript-1" }),
          "perm-1",
          "approve_once",
        ),
      ).rejects.toThrow("Session 'session-transcript-1' is not loaded.");

      expect(replyCalls).toBe(0);
      expect(updateCalls).toBe(0);
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
        messages: [
          {
            id: "tool-1",
            role: "tool",
            content: "Question requested",
            timestamp: "2026-02-22T08:00:01.000Z",
            meta: {
              kind: "tool",
              partId: "part-1",
              callId: "call-1",
              tool: "question",
              toolType: "question" as const,
              status: "completed",
              metadata: {},
            },
          },
        ],
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
    const updateSessionOptions: unknown[] = [];

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
      await actions.answerAgentQuestion(getSession(sessionsRef), "question-1", [["yes"]]);
      expect(replyCalls).toBe(1);
      expect(getSession(sessionsRef)?.pendingQuestions).toHaveLength(0);
      expect(updateSessionOptions).toEqual([{ persist: false }]);
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
          buildSession({ externalSessionId: "session-transcript-1" }),
          "question-1",
          [["yes"]],
        ),
      ).rejects.toThrow("Session 'session-transcript-1' is not loaded.");

      expect(replyCalls).toBe(0);
      expect(updateCalls).toBe(0);
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
        role: input.role,
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
      await actions.answerAgentQuestion(getSession(sessionsRef), "question-1", [["yes"]]);
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

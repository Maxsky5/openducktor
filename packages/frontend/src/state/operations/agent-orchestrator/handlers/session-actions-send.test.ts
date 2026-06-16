import { describe, expect, test } from "bun:test";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { getAgentSession, replaceAgentSession } from "@/state/agent-session-collection";
import {
  findSessionMessageForTest,
  sessionMessagesToArray,
} from "@/test-utils/session-message-test-helpers";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  createAgentSessionRuntimeSnapshotFixture,
  createSessionObserversRefFixture,
  createTaskCardFixture,
} from "../test-utils";
import {
  buildSession,
  createSessionActions,
  createSessionsRef,
  createSessionTransientStateFixture,
  getSession,
  mockAgentSessionRuntimeSnapshot,
} from "./session-actions.test-helpers";

describe("agent-orchestrator/handlers/session-actions send", () => {
  test("delegates sent user messages to the runtime transcript stream", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalListAgentSessionRuntimeSnapshots = adapter.listSessionRuntimeSnapshots;
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    mockAgentSessionRuntimeSnapshot(adapter);
    adapter.sendUserMessage = async () => {
      sendCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "idle",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5.3-codex",
          variant: "high",
          profileId: "Hephaestus (Deep Agent)",
        },
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionObserversRef: createSessionObserversRefFixture([{ externalSessionId: "session-1" }]),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);
      expect(sendCalls).toBe(1);
      expect(getSession(sessionsRef)?.status).toBe("running");
      expect(sessionMessagesToArray(getSession(sessionsRef))).toHaveLength(0);
    } finally {
      adapter.listSessionRuntimeSnapshots = originalListAgentSessionRuntimeSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("releases held starting sessions to running when sending starts", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalListAgentSessionRuntimeSnapshots = adapter.listSessionRuntimeSnapshots;
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    const committedStatuses: AgentSessionState["status"][] = [];
    mockAgentSessionRuntimeSnapshot(
      adapter,
      createAgentSessionRuntimeSnapshotFixture({
        ref: { externalSessionId: "session-1" },
        snapshot: { runtimeActivity: "idle" },
      }),
    );
    adapter.sendUserMessage = async () => {
      sendCalls += 1;
    };

    const sessionsRef = createSessionsRef([buildSession({ status: "starting" })]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionObserversRef: createSessionObserversRefFixture([{ externalSessionId: "session-1" }]),
      updateSession: (identity, updater) => {
        const current = getAgentSession(sessionsRef.current, identity);
        if (!current) {
          return null;
        }
        const next = updater(current);
        if (current.status === "starting") {
          expect(next.status).not.toBe("idle");
        }
        committedStatuses.push(next.status);
        sessionsRef.current = replaceAgentSession(sessionsRef.current, next);
        return next;
      },
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);

      expect(sendCalls).toBe(1);
      expect(committedStatuses).not.toContain("idle");
      expect(getSession(sessionsRef)?.status).toBe("running");
    } finally {
      adapter.listSessionRuntimeSnapshots = originalListAgentSessionRuntimeSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("releases held starting sessions to idle when pending input prevents sending", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    adapter.sendUserMessage = async () => {
      sendCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "starting",
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [{ header: "Confirm", question: "Confirm", options: [] }],
          },
        ],
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionObserversRef: createSessionObserversRefFixture([{ externalSessionId: "session-1" }]),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);

      expect(sendCalls).toBe(0);
      expect(getSession(sessionsRef)?.status).toBe("idle");
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("marks held starting sessions as failed when resume preparation fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    adapter.readSessionRuntimeSnapshot = async () => ({
      availability: "missing",
      classification: "missing",
      ref: {
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo/worktree",
        externalSessionId: "session-1",
      },
      pendingApprovals: [],
      pendingQuestions: [],
    });
    adapter.sendUserMessage = async () => {
      sendCalls += 1;
    };

    const sessionsRef = createSessionsRef([buildSession({ status: "starting" })]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionObserversRef: createSessionObserversRefFixture([{ externalSessionId: "session-1" }]),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await expect(
        actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]),
      ).rejects.toThrow("Task not found: task-1");

      expect(sendCalls).toBe(0);
      expect(getSession(sessionsRef)?.status).toBe("error");
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("does not load requested history before sending to a runtime session", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalListAgentSessionRuntimeSnapshots = adapter.listSessionRuntimeSnapshots;
    const originalSendUserMessage = adapter.sendUserMessage;
    const callOrder: string[] = [];
    mockAgentSessionRuntimeSnapshot(adapter);
    adapter.sendUserMessage = async () => {
      callOrder.push("send");
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "idle",
        historyLoadState: "not_requested",
        messages: [],
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionObserversRef: createSessionObserversRefFixture([{ externalSessionId: "session-1" }]),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
      loadAgentSessions: async () => {
        callOrder.push("load");
      },
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);

      expect(callOrder).toEqual(["send"]);
      expect(sessionMessagesToArray(getSession(sessionsRef))).toHaveLength(0);
      expect(getSession(sessionsRef)?.historyLoadState).toBe("not_requested");
    } finally {
      adapter.listSessionRuntimeSnapshots = originalListAgentSessionRuntimeSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("does not send a free-form message if ensure-ready reveals pending input", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalListAgentSessionRuntimeSnapshots = adapter.listSessionRuntimeSnapshots;
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    mockAgentSessionRuntimeSnapshot(
      adapter,
      createAgentSessionRuntimeSnapshotFixture({
        ref: { externalSessionId: "session-1", workingDirectory: "/tmp/repo/worktree" },
        snapshot: {
          runtimeActivity: "idle",
          title: "Session 1",
          startedAt: "2026-02-22T08:00:00.000Z",
          pendingApprovals: [],
          pendingQuestions: [
            {
              requestId: "question-1",
              questions: [{ header: "Confirm", question: "Confirm", options: [] }],
            },
          ],
        },
      }),
    );
    adapter.sendUserMessage = async () => {
      sendCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "idle",
        historyLoadState: "not_requested",
        messages: [],
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionObserversRef: createSessionObserversRefFixture([{ externalSessionId: "session-1" }]),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await expect(
        actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]),
      ).rejects.toThrow("Session is waiting for pending runtime input.");

      expect(sendCalls).toBe(0);
      expect(getSession(sessionsRef)?.status).toBe("idle");
      expect(getSession(sessionsRef)?.pendingQuestions).toHaveLength(1);
    } finally {
      adapter.listSessionRuntimeSnapshots = originalListAgentSessionRuntimeSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("does not send free-form messages while waiting for pending input", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    adapter.sendUserMessage = async () => {
      sendCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "idle",
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [{ header: "Confirm", question: "Confirm", options: [] }],
          },
        ],
      }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionObserversRef: createSessionObserversRefFixture([{ externalSessionId: "session-1" }]),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: " hello " }]);
      expect(sendCalls).toBe(0);
      expect(sessionMessagesToArray(getSession(sessionsRef))).toHaveLength(0);
      expect(getSession(sessionsRef)?.pendingQuestions).toHaveLength(1);
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("rejects send when role is unavailable for the current task", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalSendUserMessage = adapter.sendUserMessage;
    let sendCalls = 0;
    adapter.sendUserMessage = async () => {
      sendCalls += 1;
    };

    const sessionsRef = createSessionsRef([
      buildSession({ status: "idle", role: "build", taskId: "task-1" }),
    ]);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: {
        current: [
          createTaskCardFixture({
            id: "task-1",
            status: "open",
            agentWorkflows: {
              spec: { required: true, canSkip: false, available: true, completed: false },
              planner: { required: true, canSkip: false, available: false, completed: false },
              builder: { required: true, canSkip: false, available: false, completed: false },
              qa: { required: true, canSkip: false, available: false, completed: false },
            },
          }),
        ],
      },
      sessionObserversRef: createSessionObserversRefFixture([{ externalSessionId: "session-1" }]),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await expect(
        actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]),
      ).rejects.toThrow("Role 'build' is unavailable for task 'task-1' in status 'open'.");
      expect(sendCalls).toBe(0);
    } finally {
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("marks session as error when send fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalListAgentSessionRuntimeSnapshots = adapter.listSessionRuntimeSnapshots;
    const originalSendUserMessage = adapter.sendUserMessage;
    mockAgentSessionRuntimeSnapshot(adapter);
    adapter.sendUserMessage = async () => {
      throw new Error("send failed");
    };

    const sessionsRef = createSessionsRef([buildSession({ status: "idle" })]);
    const sessionKey = agentSessionIdentityKey(getSession(sessionsRef));
    const sessionTransientState = createSessionTransientStateFixture();
    sessionTransientState.draftBuffers.writeChannel(sessionKey, "reasoning", {
      raw: "draft",
      source: "delta",
    });
    sessionTransientState.assistantTurnTiming.recordTurnUserMessageTimestamp(sessionKey, 1);

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionObserversRef: createSessionObserversRefFixture([{ externalSessionId: "session-1" }]),
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
      sessionTransientState,
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [{ kind: "text", text: "hello" }]);
      expect(getSession(sessionsRef)?.status).toBe("error");
      const failureMessage = findSessionMessageForTest(getSession(sessionsRef), (message) =>
        message.content.includes("Failed to send message:"),
      );
      expect(failureMessage?.content).toContain("Failed to send message:");
      expect(failureMessage?.meta).toEqual({
        kind: "session_notice",
        tone: "error",
        reason: "session_error",
        title: "Error",
      });
      expect(sessionTransientState.draftBuffers.readChannel(sessionKey, "reasoning").raw).toBe("");
      expect(
        sessionTransientState.assistantTurnTiming.readTurnUserMessageStartedAtMs(sessionKey),
      ).toBeUndefined();
      expect(sessionTransientState.turnMetadata.readModel(sessionKey)).toBeUndefined();
    } finally {
      adapter.listSessionRuntimeSnapshots = originalListAgentSessionRuntimeSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("preserves active turn drafts and timing for busy queued sends", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalListAgentSessionRuntimeSnapshots = adapter.listSessionRuntimeSnapshots;
    const originalSendUserMessage = adapter.sendUserMessage;
    const sendCalls: Array<{
      externalSessionId: string;
      parts: { kind: string; text?: string }[];
    }> = [];
    mockAgentSessionRuntimeSnapshot(
      adapter,
      createAgentSessionRuntimeSnapshotFixture({
        ref: { externalSessionId: "session-1" },
        snapshot: { runtimeActivity: "running" },
      }),
    );
    adapter.sendUserMessage = async (input) => {
      sendCalls.push({
        externalSessionId: input.externalSessionId,
        parts: input.parts.map((part) =>
          part.kind === "text" ? { kind: part.kind, text: part.text } : { kind: part.kind },
        ),
      });
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "running",
        draftAssistantText: "Still working",
        draftAssistantMessageId: "assistant-live-1",
        draftReasoningText: "Thinking",
        draftReasoningMessageId: "reasoning-live-1",
      }),
    ]);
    let recordUserAnchorCalls = 0;
    const sessionKey = agentSessionIdentityKey(getSession(sessionsRef));
    const sessionTransientState = createSessionTransientStateFixture();
    sessionTransientState.turnMetadata.recordModel(sessionKey, {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
    });

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionObserversRef: createSessionObserversRefFixture([{ externalSessionId: "session-1" }]),
      sessionTransientState,
      recordTurnUserMessageTimestamp: () => {
        recordUserAnchorCalls += 1;
        return 1234;
      },
      readTurnUserMessageStartedAtMs: () => 1234,
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [
        { kind: "text", text: "queued follow-up" },
      ]);

      expect(sendCalls).toEqual([
        { externalSessionId: "session-1", parts: [{ kind: "text", text: "queued follow-up" }] },
      ]);
      expect(getSession(sessionsRef)?.draftAssistantText).toBe("Still working");
      expect(getSession(sessionsRef)?.draftAssistantMessageId).toBe("assistant-live-1");
      expect(getSession(sessionsRef)?.draftReasoningText).toBe("Thinking");
      expect(getSession(sessionsRef)?.draftReasoningMessageId).toBe("reasoning-live-1");
      expect(recordUserAnchorCalls).toBe(0);
      expect(sessionTransientState.turnMetadata.readModel(sessionKey)?.modelId).toBe("gpt-5");
    } finally {
      adapter.listSessionRuntimeSnapshots = originalListAgentSessionRuntimeSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });

  test("keeps the active turn running when a busy queued send fails", async () => {
    const adapter = new OpencodeSdkAdapter();
    const originalListAgentSessionRuntimeSnapshots = adapter.listSessionRuntimeSnapshots;
    const originalSendUserMessage = adapter.sendUserMessage;
    mockAgentSessionRuntimeSnapshot(
      adapter,
      createAgentSessionRuntimeSnapshotFixture({
        ref: { externalSessionId: "session-1" },
        snapshot: { runtimeActivity: "running" },
      }),
    );
    adapter.sendUserMessage = async () => {
      throw new Error("queued send failed");
    };

    const sessionsRef = createSessionsRef([
      buildSession({
        status: "running",
        draftAssistantText: "Still working",
        draftAssistantMessageId: "assistant-live-1",
        draftReasoningText: "Thinking",
        draftReasoningMessageId: "reasoning-live-1",
      }),
    ]);
    let recordUserAnchorCalls = 0;
    const sessionKey = agentSessionIdentityKey(getSession(sessionsRef));
    const sessionTransientState = createSessionTransientStateFixture();
    sessionTransientState.turnMetadata.recordModel(sessionKey, {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
    });

    const actions = createSessionActions({
      adapter,
      sessionsRef,
      taskRef: { current: [] },
      sessionObserversRef: createSessionObserversRefFixture([{ externalSessionId: "session-1" }]),
      sessionTransientState,
      recordTurnUserMessageTimestamp: () => {
        recordUserAnchorCalls += 1;
        return 1234;
      },
      readTurnUserMessageStartedAtMs: () => 1234,
      ensureRuntime: async () => ({
        kind: "opencode",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/repo",
      }),
    });

    try {
      await actions.sendAgentMessage(getSession(sessionsRef), [
        { kind: "text", text: "queued follow-up" },
      ]);

      expect(getSession(sessionsRef)?.status).toBe("running");
      expect(getSession(sessionsRef)?.draftAssistantText).toBe("Still working");
      expect(getSession(sessionsRef)?.draftReasoningText).toBe("Thinking");
      const failureMessage = findSessionMessageForTest(getSession(sessionsRef), (message) =>
        message.content.includes("Failed to send message:"),
      );
      expect(failureMessage?.content).toContain("Failed to send message:");
      expect(failureMessage?.meta).toEqual({
        kind: "session_notice",
        tone: "error",
        reason: "session_error",
        title: "Error",
      });
      expect(recordUserAnchorCalls).toBe(0);
      expect(sessionTransientState.turnMetadata.readModel(sessionKey)?.modelId).toBe("gpt-5");
    } finally {
      adapter.listSessionRuntimeSnapshots = originalListAgentSessionRuntimeSnapshots;
      adapter.sendUserMessage = originalSendUserMessage;
    }
  });
});

import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  fromPersistedSessionRecord,
  historyToChatMessages,
  recoverPendingQuestionsFromHistory,
  toPersistedSessionRecord,
} from "./persistence";

const recordFixture: AgentSessionRecord = {
  runtimeKind: "opencode",
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "build",
  scenario: "build_implementation_start",
  status: "running",
  startedAt: "2026-02-22T08:00:00.000Z",
  updatedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory: "/tmp/repo/worktree",
  pendingPermissions: [],
  pendingQuestions: [],
  selectedModel: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
  },
};

describe("agent-orchestrator/support/persistence", () => {
  test("normalizes persisted running status to stopped", () => {
    const hydrated = fromPersistedSessionRecord(recordFixture, "task-1");
    expect(hydrated.status).toBe("stopped");
    expect(hydrated.runtimeKind).toBe("opencode");
    expect(hydrated.runtimeId).toBeNull();
    expect(hydrated.runId).toBeNull();
    expect(hydrated.selectedModel?.modelId).toBe("gpt-5");
  });

  test("preserves pending input requests across persistence hydration", () => {
    const hydrated = fromPersistedSessionRecord(
      {
        ...recordFixture,
        pendingPermissions: [
          {
            requestId: "permission-1",
            permission: "read",
            patterns: ["**/*"],
            metadata: { source: "tool" },
          },
        ],
        pendingQuestions: [
          {
            requestId: "question-1",
            questions: [
              {
                header: "Confirm",
                question: "Need input",
                options: [{ label: "Yes", description: "Confirm" }],
                custom: true,
              },
            ],
          },
        ],
      },
      "task-1",
    );

    expect(hydrated.pendingPermissions).toEqual([
      {
        requestId: "permission-1",
        permission: "read",
        patterns: ["**/*"],
        metadata: { source: "tool" },
      },
    ]);
    expect(hydrated.pendingQuestions).toEqual([
      {
        requestId: "question-1",
        questions: [
          {
            header: "Confirm",
            question: "Need input",
            options: [{ label: "Yes", description: "Confirm" }],
            custom: true,
          },
        ],
      },
    ]);

    const persisted = toPersistedSessionRecord(hydrated);
    expect(persisted.pendingPermissions).toEqual(hydrated.pendingPermissions);
    expect(persisted.pendingQuestions).toEqual(hydrated.pendingQuestions);
  });

  test("persists compact session fields and keeps scenario", () => {
    const session: AgentSessionState = {
      ...fromPersistedSessionRecord(recordFixture, "task-1"),
      status: "error",
    };
    const persisted = toPersistedSessionRecord(session);
    expect(persisted.scenario).toBe("build_implementation_start");
    expect(persisted.runtimeKind).toBe("opencode");
    expect(persisted.endedAt).toBeUndefined();
    expect(persisted.pendingPermissions).toEqual([]);
    expect(persisted.pendingQuestions).toEqual([]);
    expect("runtimeId" in persisted).toBe(false);
    expect("runId" in persisted).toBe(false);
    expect("runtimeEndpoint" in persisted).toBe(false);
    expect("runtimeTransport" in persisted).toBe(false);
  });

  test("preserves non-default runtime kind across persistence", () => {
    const customRuntimeRecord: AgentSessionRecord = {
      ...recordFixture,
      runtimeKind: "claude-code",
      selectedModel: {
        runtimeKind: "claude-code",
        providerId: "anthropic",
        modelId: "claude-3-7-sonnet",
      },
    };

    const hydrated = fromPersistedSessionRecord(customRuntimeRecord, "task-1");
    expect(hydrated.runtimeKind).toBe("claude-code");
    expect(hydrated.selectedModel?.runtimeKind).toBe("claude-code");

    const persisted = toPersistedSessionRecord(hydrated);
    expect(persisted.runtimeKind).toBe("claude-code");
    expect(persisted.selectedModel?.runtimeKind).toBe("claude-code");
  });

  test("maps empty history to empty chat messages", () => {
    const messages = historyToChatMessages([], {
      role: "build",
      selectedModel: null,
    });
    expect(messages).toEqual([]);
  });

  test("recovers unanswered pending questions from history tool metadata", () => {
    const recovered = recoverPendingQuestionsFromHistory([
      {
        messageId: "m-assistant-question",
        role: "assistant",
        timestamp: "2026-02-22T08:00:00.000Z",
        text: "Need input",
        parts: [
          {
            kind: "tool",
            messageId: "m-assistant-question",
            partId: "p-question",
            callId: "call-question",
            tool: "question",
            status: "completed",
            metadata: {
              requestId: "question-1",
              questions: [
                {
                  header: "Confirm",
                  question: "Which runtime should we use?",
                  options: [{ label: "OpenCode", description: "Use OpenCode" }],
                  custom: true,
                },
              ],
            },
          },
        ],
      },
    ]);

    expect(recovered).toEqual([
      {
        requestId: "question-1",
        questions: [
          {
            header: "Confirm",
            question: "Which runtime should we use?",
            options: [{ label: "OpenCode", description: "Use OpenCode" }],
            custom: true,
          },
        ],
      },
    ]);
  });

  test("clears recovered pending question after a synthetic answer message", () => {
    const recovered = recoverPendingQuestionsFromHistory([
      {
        messageId: "m-assistant-question",
        role: "assistant",
        timestamp: "2026-02-22T08:00:00.000Z",
        text: "Need input",
        parts: [
          {
            kind: "tool",
            messageId: "m-assistant-question",
            partId: "p-question",
            callId: "call-question",
            tool: "question",
            status: "completed",
            input: {
              requestID: "question-1",
              questions: [{ header: "Confirm", question: "Which runtime should we use?" }],
            },
          },
        ],
      },
      {
        messageId: "m-user-answer",
        role: "user",
        timestamp: "2026-02-22T08:00:05.000Z",
        text: "Use OpenCode",
        parts: [
          {
            kind: "text",
            messageId: "m-user-answer",
            partId: "p-answer",
            text: "Use OpenCode",
            synthetic: true,
            completed: true,
          },
        ],
      },
    ]);

    expect(recovered).toEqual([]);
  });

  test("recovers pending questions from tool output when prompts have no separate header", () => {
    const recovered = recoverPendingQuestionsFromHistory([
      {
        messageId: "m-assistant-question",
        role: "assistant",
        timestamp: "2026-02-22T08:00:00.000Z",
        text: "Need input",
        parts: [
          {
            kind: "tool",
            messageId: "m-assistant-question",
            partId: "p-question",
            callId: "call-question",
            tool: "question",
            status: "completed",
            output: JSON.stringify({
              requestId: "question-2",
              questions: [
                {
                  title: "What would you like me to do with this test task?",
                  options: [{ label: "Write a spec" }],
                },
              ],
            }),
          },
        ],
      },
    ]);

    expect(recovered).toEqual([
      {
        requestId: "question-2",
        questions: [
          {
            header: "What would you like me to do with this test task?",
            question: "What would you like me to do with this test task?",
            options: [{ label: "Write a spec", description: "Write a spec" }],
          },
        ],
      },
    ]);
  });

  test("recovers pending questions from running tool input when request id is absent", () => {
    const recovered = recoverPendingQuestionsFromHistory([
      {
        messageId: "m-assistant-question",
        role: "assistant",
        timestamp: "2026-02-22T08:00:00.000Z",
        text: "Need input",
        parts: [
          {
            kind: "tool",
            messageId: "m-assistant-question",
            partId: "p-question",
            callId: "call-question",
            tool: "question",
            status: "running",
            input: {
              questions: [
                {
                  header: "Task Action",
                  question: "What should I do next?",
                  options: [{ label: "Continue", description: "Keep going" }],
                },
              ],
            },
          },
        ],
      },
    ]);

    expect(recovered).toEqual([
      {
        requestId: "call-question",
        questions: [
          {
            header: "Task Action",
            question: "What should I do next?",
            options: [{ label: "Continue", description: "Keep going" }],
          },
        ],
      },
    ]);
  });

  test("removes recovered questions when a later tool update carries answers for the same request", () => {
    const recovered = recoverPendingQuestionsFromHistory([
      {
        messageId: "m-assistant-question",
        role: "assistant",
        timestamp: "2026-02-22T08:00:00.000Z",
        text: "Need input",
        parts: [
          {
            kind: "tool",
            messageId: "m-assistant-question",
            partId: "p-question",
            callId: "call-question",
            tool: "question",
            status: "running",
            metadata: {
              requestId: "question-1",
              questions: [{ header: "Confirm", question: "Ship it?" }],
            },
          },
        ],
      },
      {
        messageId: "m-assistant-answered",
        role: "assistant",
        timestamp: "2026-02-22T08:00:05.000Z",
        text: "Answered",
        parts: [
          {
            kind: "tool",
            messageId: "m-assistant-answered",
            partId: "p-question-answered",
            callId: "call-question",
            tool: "question",
            status: "completed",
            metadata: {
              requestId: "question-1",
              questions: [{ header: "Confirm", question: "Ship it?" }],
              answers: [["Yes"]],
            },
          },
        ],
      },
    ]);

    expect(recovered).toEqual([]);
  });

  test("treats output response payloads as answered question state", () => {
    const recovered = recoverPendingQuestionsFromHistory([
      {
        messageId: "m-assistant-question",
        role: "assistant",
        timestamp: "2026-02-22T08:00:00.000Z",
        text: "Need input",
        parts: [
          {
            kind: "tool",
            messageId: "m-assistant-question",
            partId: "p-question",
            callId: "call-question",
            tool: "question",
            status: "completed",
            output: JSON.stringify({
              requestId: "question-1",
              questions: [{ header: "Confirm", question: "Ship it?" }],
              response: [["Yes"]],
            }),
          },
        ],
      },
    ]);

    expect(recovered).toEqual([]);
  });

  test("matches synthetic answers to the correct recovered request when the answer text is unique", () => {
    const recovered = recoverPendingQuestionsFromHistory([
      {
        messageId: "m-assistant-question-1",
        role: "assistant",
        timestamp: "2026-02-22T08:00:00.000Z",
        text: "Need first input",
        parts: [
          {
            kind: "tool",
            messageId: "m-assistant-question-1",
            partId: "p-question-1",
            callId: "call-question-1",
            tool: "question",
            status: "completed",
            metadata: {
              requestId: "question-1",
              questions: [
                {
                  header: "First",
                  question: "Choose first",
                  options: [{ label: "Alpha", description: "Pick alpha" }],
                },
              ],
            },
          },
        ],
      },
      {
        messageId: "m-assistant-question-2",
        role: "assistant",
        timestamp: "2026-02-22T08:00:01.000Z",
        text: "Need second input",
        parts: [
          {
            kind: "tool",
            messageId: "m-assistant-question-2",
            partId: "p-question-2",
            callId: "call-question-2",
            tool: "question",
            status: "completed",
            metadata: {
              requestId: "question-2",
              questions: [
                {
                  header: "Second",
                  question: "Choose second",
                  options: [{ label: "Beta", description: "Pick beta" }],
                },
              ],
            },
          },
        ],
      },
      {
        messageId: "m-user-answer",
        role: "user",
        timestamp: "2026-02-22T08:00:05.000Z",
        text: "Beta",
        parts: [
          {
            kind: "text",
            messageId: "m-user-answer",
            partId: "p-answer",
            text: "Beta",
            synthetic: true,
            completed: true,
          },
        ],
      },
    ]);

    expect(recovered).toEqual([
      {
        requestId: "question-1",
        questions: [
          {
            header: "First",
            question: "Choose first",
            options: [{ label: "Alpha", description: "Pick alpha" }],
          },
        ],
      },
    ]);
  });

  test("maps history parts into chat timeline entries", () => {
    const messages = historyToChatMessages(
      [
        {
          messageId: "m-user",
          role: "user",
          timestamp: "2026-02-22T08:00:00.000Z",
          text: "Please implement this",
          model: {
            providerId: "openai",
            modelId: "gpt-5",
            profileId: "Ares",
            variant: "high",
          },
          parts: [
            {
              kind: "text",
              messageId: "m-user",
              partId: "p-user",
              text: "Please implement this",
              synthetic: false,
              completed: true,
            },
          ],
        },
        {
          messageId: "m-assistant",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "Done",
          totalTokens: 123,
          model: {
            providerId: "anthropic",
            modelId: "claude-3-7-sonnet",
            profileId: "Hephaestus",
            variant: "max",
          },
          parts: [
            {
              kind: "reasoning",
              messageId: "m-assistant",
              partId: "p-thinking",
              text: "Thinking",
              completed: true,
            },
            {
              kind: "tool",
              messageId: "m-assistant",
              partId: "p-tool",
              callId: "call-1",
              tool: "todowrite",
              status: "completed",
              input: { key: "value" },
              output: '{"ok":true}',
              startedAtMs: 100,
              endedAtMs: 200,
            },
            {
              kind: "subtask",
              messageId: "m-assistant",
              partId: "p-subtask",
              agent: "build",
              prompt: "Implement",
              description: "Did work",
            },
            {
              kind: "step",
              messageId: "m-assistant",
              partId: "p-step-finish",
              phase: "finish",
              reason: "stop",
            },
          ],
        },
      ],
      {
        role: "build",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
        },
      },
    );

    expect(messages.some((entry) => entry.role === "thinking")).toBe(true);
    expect(messages.some((entry) => entry.role === "tool")).toBe(true);
    expect(
      messages.some(
        (entry) => entry.role === "system" && entry.content.includes("Subtask (build)"),
      ),
    ).toBe(true);

    const assistant = messages.find(
      (entry) => entry.role === "assistant" && entry.content === "Done",
    );
    if (!assistant || assistant.meta?.kind !== "assistant") {
      throw new Error("Expected assistant message with assistant meta");
    }
    expect(assistant.meta.agentRole).toBe("build");
    expect(assistant.meta.isFinal).toBe(true);
    expect(assistant.meta.totalTokens).toBe(123);
    expect(assistant.meta.providerId).toBe("anthropic");
    expect(assistant.meta.modelId).toBe("claude-3-7-sonnet");
    expect(assistant.meta.profileId).toBe("Hephaestus");
    expect(assistant.meta.variant).toBe("max");

    const user = messages.find((entry) => entry.role === "user");
    if (!user || user.meta?.kind !== "user") {
      throw new Error("Expected user message with user meta");
    }
    expect(user.meta.providerId).toBe("openai");
    expect(user.meta.modelId).toBe("gpt-5");
    expect(user.meta.profileId).toBe("Ares");
    expect(user.meta.variant).toBe("high");
  });

  test("preserves session-selected agent when history model metadata is partial", () => {
    const messages = historyToChatMessages(
      [
        {
          messageId: "m-assistant",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "Done",
          model: {
            providerId: "anthropic",
            modelId: "claude-3-7-sonnet",
          },
          parts: [],
        },
      ],
      {
        role: "build",
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "Hephaestus",
        },
      },
    );

    const assistant = messages.find((entry) => entry.role === "assistant");
    if (!assistant || assistant.meta?.kind !== "assistant") {
      throw new Error("Expected assistant message with assistant meta");
    }
    expect(assistant.meta.isFinal).toBe(false);
    expect(assistant.meta.providerId).toBe("anthropic");
    expect(assistant.meta.modelId).toBe("claude-3-7-sonnet");
    expect(assistant.meta.profileId).toBe("Hephaestus");
    expect(assistant.meta.variant).toBe("high");
    expect(assistant.meta.totalTokens).toBeUndefined();
    expect(assistant.meta.durationMs).toBeUndefined();
  });

  test("keeps intermediate assistant history text non-final until a step-finish exists", () => {
    const messages = historyToChatMessages(
      [
        {
          messageId: "m-user",
          role: "user",
          timestamp: "2026-02-22T08:00:00.000Z",
          text: "Please implement this",
          parts: [
            {
              kind: "text",
              messageId: "m-user",
              partId: "p-user",
              text: "Please implement this",
              synthetic: false,
              completed: true,
            },
          ],
        },
        {
          messageId: "m-assistant",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "Let me inspect the current code.",
          totalTokens: 321,
          model: {
            providerId: "openai",
            modelId: "gpt-5.3-codex",
            profileId: "Hephaestus",
            variant: "high",
          },
          parts: [
            {
              kind: "tool",
              messageId: "m-assistant",
              partId: "p-tool",
              callId: "call-1",
              tool: "read",
              status: "completed",
              startedAtMs: 100,
              endedAtMs: 200,
            },
            {
              kind: "step",
              messageId: "m-assistant",
              partId: "p-step-finish",
              phase: "finish",
              reason: "tool-calls",
            },
          ],
        },
      ],
      {
        role: "build",
        selectedModel: null,
      },
    );

    const assistant = messages.find(
      (entry) => entry.role === "assistant" && entry.content === "Let me inspect the current code.",
    );
    if (!assistant || assistant.meta?.kind !== "assistant") {
      throw new Error("Expected assistant message with assistant meta");
    }

    expect(assistant.meta.isFinal).toBe(false);
    expect(assistant.meta.totalTokens).toBeUndefined();
    expect(assistant.meta.durationMs).toBeUndefined();
  });

  test("marks only stop step-finish assistant history text as final", () => {
    const messages = historyToChatMessages(
      [
        {
          messageId: "m-assistant-final",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "Final answer",
          totalTokens: 999,
          model: {
            providerId: "openai",
            modelId: "gpt-5.3-codex",
            profileId: "Hephaestus",
            variant: "high",
          },
          parts: [
            {
              kind: "step",
              messageId: "m-assistant-final",
              partId: "p-step-finish",
              phase: "finish",
              reason: "stop",
            },
          ],
        },
      ],
      {
        role: "build",
        selectedModel: null,
      },
    );

    const assistant = messages[0];
    if (!assistant || assistant.meta?.kind !== "assistant") {
      throw new Error("Expected assistant message with assistant meta");
    }

    expect(assistant.meta.isFinal).toBe(true);
    expect(assistant.meta.totalTokens).toBe(999);
  });
});

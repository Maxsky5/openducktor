import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  fromPersistedSessionRecord,
  historyToChatMessages,
  historyToSessionContextUsage,
  toPersistedSessionRecord,
} from "./persistence";

const recordFixture: AgentSessionRecord = {
  runtimeKind: "opencode",
  sessionId: "session-1",
  externalSessionId: "external-1",
  role: "build",
  scenario: "build_implementation_start",
  startedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory: "/tmp/repo/worktree",
  selectedModel: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
  },
};

describe("agent-orchestrator/support/persistence", () => {
  test("hydrates persisted sessions as stopped until runtime reconciliation", () => {
    const hydrated = fromPersistedSessionRecord(recordFixture, "task-1");
    expect(hydrated.status).toBe("stopped");
    expect(hydrated.runtimeKind).toBe("opencode");
    expect(hydrated.runtimeId).toBeNull();
    expect(hydrated.runId).toBeNull();
    expect(hydrated.pendingPermissions).toEqual([]);
    expect(hydrated.pendingQuestions).toEqual([]);
    expect(hydrated.selectedModel?.modelId).toBe("gpt-5");
    expect(hydrated.isLoadingModelCatalog).toBe(false);
  });

  test("does not persist pending input requests in session snapshots", () => {
    const hydrated = fromPersistedSessionRecord(recordFixture, "task-1");
    const withPendingInput: AgentSessionState = {
      ...hydrated,
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
    };

    const persisted = toPersistedSessionRecord(withPendingInput);
    expect("pendingPermissions" in persisted).toBe(false);
    expect("pendingQuestions" in persisted).toBe(false);
  });

  test("persists compact session fields and keeps scenario", () => {
    const session: AgentSessionState = {
      ...fromPersistedSessionRecord(recordFixture, "task-1"),
      status: "error",
    };
    const persisted = toPersistedSessionRecord(session);
    expect(persisted.scenario).toBe("build_implementation_start");
    expect(persisted.runtimeKind).toBe("opencode");
    expect(persisted.selectedModel).toEqual(recordFixture.selectedModel);
    expect("taskId" in persisted).toBe(false);
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

  test("extracts latest final assistant context usage from hydrated history", () => {
    const contextUsage = historyToSessionContextUsage(
      [
        {
          messageId: "m-assistant-1",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "Working",
          totalTokens: 50,
          model: {
            providerId: "openai",
            modelId: "gpt-5",
            profileId: "Ares",
            variant: "high",
          },
          parts: [
            {
              kind: "step",
              messageId: "m-assistant-1",
              partId: "p-step-intermediate",
              phase: "finish",
              reason: "length",
            },
          ],
        },
        {
          messageId: "m-assistant-2",
          role: "assistant",
          timestamp: "2026-02-22T08:00:05.000Z",
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
              kind: "step",
              messageId: "m-assistant-2",
              partId: "p-step-finish",
              phase: "finish",
              reason: "stop",
            },
          ],
        },
      ],
      {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      },
    );

    expect(contextUsage).toEqual({
      totalTokens: 123,
      providerId: "anthropic",
      modelId: "claude-3-7-sonnet",
      profileId: "Hephaestus",
      variant: "max",
    });
  });

  test("maps history parts into chat timeline entries", () => {
    const messages = historyToChatMessages(
      [
        {
          messageId: "m-user",
          role: "user",
          state: "read",
          timestamp: "2026-02-22T08:00:00.000Z",
          text: "Please implement this",
          displayParts: [
            {
              kind: "text",
              text: "Please implement this",
            },
          ],
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
    expect(user.meta.state).toBe("read");
    expect(user.meta.parts).toEqual([
      {
        kind: "text",
        text: "Please implement this",
      },
    ]);
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
          state: "read",
          timestamp: "2026-02-22T08:00:00.000Z",
          text: "Please implement this",
          displayParts: [
            {
              kind: "text",
              text: "Please implement this",
            },
          ],
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
    const user = messages.find((entry) => entry.role === "user");
    if (!user || user.meta?.kind !== "user") {
      throw new Error("Expected user message with user meta");
    }

    expect(user.meta.state).toBe("read");
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

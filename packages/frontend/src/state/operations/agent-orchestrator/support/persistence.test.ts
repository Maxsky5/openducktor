import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { sessionMessageAt } from "@/test-utils/session-message-test-helpers";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  fromPersistedSessionRecord,
  historyToChatMessages,
  historyToSessionContextUsage,
  toPersistedSessionRecord,
} from "./persistence";

const recordFixture: AgentSessionRecord = {
  runtimeKind: "opencode",
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

const repoPathFixture = "/tmp/repo";

describe("agent-orchestrator/support/persistence", () => {
  test("hydrates persisted sessions as stopped until runtime reconciliation", () => {
    const hydrated = fromPersistedSessionRecord(recordFixture, "task-1", repoPathFixture);
    expect(hydrated.status).toBe("stopped");
    expect(hydrated.runtimeKind).toBe("opencode");
    expect(hydrated.runtimeId).toBeNull();
    expect(hydrated.pendingPermissions).toEqual([]);
    expect(hydrated.pendingQuestions).toEqual([]);
    expect(hydrated.selectedModel?.modelId).toBe("gpt-5");
    expect(hydrated.isLoadingModelCatalog).toBe(false);
  });

  test("does not persist pending input requests in session snapshots", () => {
    const hydrated = fromPersistedSessionRecord(recordFixture, "task-1", repoPathFixture);
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
      ...fromPersistedSessionRecord(recordFixture, "task-1", repoPathFixture),
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

    const hydrated = fromPersistedSessionRecord(customRuntimeRecord, "task-1", repoPathFixture);
    expect(hydrated.runtimeKind).toBe("claude-code");
    expect(hydrated.selectedModel?.runtimeKind).toBe("claude-code");

    const persisted = toPersistedSessionRecord(hydrated);
    expect(persisted.runtimeKind).toBe("claude-code");
    expect(persisted.selectedModel?.runtimeKind).toBe("claude-code");
  });

  test("rejects persisted session records without a top-level runtime kind", () => {
    const invalidRecord = { ...recordFixture } as Record<string, unknown>;
    delete invalidRecord.runtimeKind;

    expect(() =>
      fromPersistedSessionRecord(
        invalidRecord as unknown as AgentSessionRecord,
        "task-1",
        repoPathFixture,
      ),
    ).toThrow("Persisted session 'external-1' is missing runtime kind metadata.");
  });

  test("rejects persisted session records with blank top-level runtime kind", () => {
    const invalidRecord: AgentSessionRecord = {
      ...recordFixture,
      runtimeKind: "  ",
    };

    expect(() => fromPersistedSessionRecord(invalidRecord, "task-1", repoPathFixture)).toThrow(
      "Persisted session 'external-1' is missing runtime kind metadata.",
    );
  });

  test("rejects persisted selected models without a runtime kind", () => {
    const invalidRecord = {
      ...recordFixture,
      selectedModel: {
        providerId: "openai",
        modelId: "gpt-5",
      } as unknown as NonNullable<AgentSessionRecord["selectedModel"]>,
    };

    expect(() => fromPersistedSessionRecord(invalidRecord, "task-1", repoPathFixture)).toThrow(
      "Persisted session 'external-1' selected model is missing runtime kind metadata.",
    );
  });

  test("rejects persisted selected models with blank runtime kind", () => {
    const invalidRecord: AgentSessionRecord = {
      ...recordFixture,
      selectedModel: {
        runtimeKind: "\t ",
        providerId: "openai",
        modelId: "gpt-5",
      },
    };

    expect(() => fromPersistedSessionRecord(invalidRecord, "task-1", repoPathFixture)).toThrow(
      "Persisted session 'external-1' selected model is missing runtime kind metadata.",
    );
  });

  test("rejects persisted selected models whose runtime kind disagrees with the session", () => {
    expect(() =>
      fromPersistedSessionRecord(
        {
          ...recordFixture,
          selectedModel: {
            runtimeKind: "claude-code",
            providerId: "openai",
            modelId: "gpt-5",
          },
        },
        "task-1",
        repoPathFixture,
      ),
    ).toThrow(
      "Persisted session 'external-1' selected model runtime kind does not match session runtime kind.",
    );
  });

  test("rejects persisting sessions without a top-level runtime kind", () => {
    const session = {
      ...fromPersistedSessionRecord(recordFixture, "task-1", repoPathFixture),
    } as Record<string, unknown>;
    delete session.runtimeKind;

    expect(() => toPersistedSessionRecord(session as unknown as AgentSessionState)).toThrow(
      "Session 'external-1' is missing runtime kind metadata.",
    );
  });

  test("rejects persisting sessions with blank top-level runtime kind", () => {
    const session: AgentSessionState = {
      ...fromPersistedSessionRecord(recordFixture, "task-1", repoPathFixture),
      runtimeKind: "\n  ",
    };

    expect(() => toPersistedSessionRecord(session)).toThrow(
      "Session 'external-1' is missing runtime kind metadata.",
    );
  });

  test("rejects persisting selected models without a runtime kind", () => {
    const session: AgentSessionState = {
      ...fromPersistedSessionRecord(recordFixture, "task-1", repoPathFixture),
      selectedModel: {
        providerId: "openai",
        modelId: "gpt-5",
      } as unknown as NonNullable<AgentSessionState["selectedModel"]>,
    };

    expect(() => toPersistedSessionRecord(session)).toThrow(
      "Session 'external-1' selected model is missing runtime kind metadata.",
    );
  });

  test("rejects persisting selected models with blank runtime kind", () => {
    const session: AgentSessionState = {
      ...fromPersistedSessionRecord(recordFixture, "task-1", repoPathFixture),
      selectedModel: {
        runtimeKind: "  ",
        providerId: "openai",
        modelId: "gpt-5",
      },
    };

    expect(() => toPersistedSessionRecord(session)).toThrow(
      "Session 'external-1' selected model is missing runtime kind metadata.",
    );
  });

  test("rejects persisting selected models whose runtime kind disagrees with the session", () => {
    const session: AgentSessionState = {
      ...fromPersistedSessionRecord(recordFixture, "task-1", repoPathFixture),
      selectedModel: {
        runtimeKind: "claude-code",
        providerId: "openai",
        modelId: "gpt-5",
      },
    } as NonNullable<AgentSessionState>;

    expect(() => toPersistedSessionRecord(session)).toThrow(
      "Session 'external-1' selected model runtime kind does not match session runtime kind.",
    );
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
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subtask",
              correlationKey: "spawn:m-assistant:build:Implement:Did work",
              status: "completed",
              agent: "build",
              prompt: "Implement",
              description: "Did work",
              externalSessionId: "session-child-1",
              startedAtMs: 300,
              endedAtMs: 450,
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

    const thinking = messages.find((entry) => entry.role === "thinking");
    const tool = messages.find((entry) => entry.role === "tool");
    expect(thinking?.id).toBe("thinking:m-assistant:p-thinking");
    expect(tool?.id).toBe("tool:m-assistant:call-1");
    expect(
      messages.some(
        (entry) => entry.role === "system" && entry.content.includes("Subagent (build)"),
      ),
    ).toBe(true);

    const subagent = messages.find(
      (entry) => entry.role === "system" && entry.meta?.kind === "subagent",
    );
    if (!subagent || subagent.meta?.kind !== "subagent") {
      throw new Error("Expected subagent message with subagent meta");
    }
    expect(subagent.meta.status).toBe("completed");
    expect(subagent.meta.externalSessionId).toBe("session-child-1");
    expect(subagent.meta.correlationKey).toBe("spawn:m-assistant:build:Implement:Did work");

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

  test("uses part ids for hydrated tool messages without call ids", () => {
    const messages = historyToChatMessages(
      [
        {
          messageId: "m-assistant",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "",
          parts: [
            {
              kind: "tool",
              messageId: "m-assistant",
              partId: "p-tool",
              callId: "",
              tool: "bash",
              status: "completed",
            },
          ],
        },
      ],
      {
        role: "build",
        selectedModel: null,
      },
    );

    expect(messages.find((entry) => entry.role === "tool")?.id).toBe("tool:m-assistant:p-tool");
  });

  test("merges hydrated subagent history parts that share a correlation key", () => {
    const messages = historyToChatMessages(
      [
        {
          messageId: "m-assistant",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "",
          parts: [
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-running",
              correlationKey: "spawn:m-assistant:build:Do work",
              status: "running",
              agent: "build",
              prompt: "Do work",
              description: "Starting work",
              startedAtMs: 100,
            },
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-completed",
              correlationKey: "spawn:m-assistant:build:Do work",
              status: "completed",
              agent: "build",
              prompt: "Do work",
              description: "Finished work",
              externalSessionId: "session-child-1",
              startedAtMs: 120,
              endedAtMs: 300,
            },
          ],
        },
      ],
      {
        role: "build",
        selectedModel: null,
      },
    );

    const subagentMessages = messages.filter(
      (entry) => entry.role === "system" && entry.meta?.kind === "subagent",
    );
    expect(subagentMessages).toHaveLength(1);

    const subagent = subagentMessages[0];
    if (!subagent || subagent.meta?.kind !== "subagent") {
      throw new Error("Expected merged subagent message with subagent meta");
    }

    expect(subagent.id).toBe("subagent:spawn:m-assistant:build:Do work");
    expect(subagent.meta.correlationKey).toBe("spawn:m-assistant:build:Do work");
    expect(subagent.meta.status).toBe("completed");
    expect(subagent.meta.externalSessionId).toBe("session-child-1");
    expect(subagent.meta.startedAtMs).toBe(100);
    expect(subagent.meta.endedAtMs).toBe(300);
    expect(subagent.content).toContain("Finished work");
  });

  test("preserves cancelled hydrated subagent history parts", () => {
    const messages = historyToChatMessages(
      [
        {
          messageId: "m-assistant",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "",
          parts: [
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-running",
              correlationKey: "spawn:m-assistant:build:Do work",
              status: "running",
              agent: "build",
              prompt: "Do work",
              description: "Starting work",
              startedAtMs: 100,
            },
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-cancelled",
              correlationKey: "spawn:m-assistant:build:Do work",
              status: "cancelled",
              agent: "build",
              prompt: "Do work",
              description: "Cancelled by user",
              externalSessionId: "session-child-1",
              startedAtMs: 120,
              endedAtMs: 300,
            },
          ],
        },
      ],
      {
        role: "build",
        selectedModel: null,
      },
    );

    const subagentMessages = messages.filter(
      (entry) => entry.role === "system" && entry.meta?.kind === "subagent",
    );
    expect(subagentMessages).toHaveLength(1);

    const subagent = subagentMessages[0];
    if (!subagent || subagent.meta?.kind !== "subagent") {
      throw new Error("Expected merged subagent message with subagent meta");
    }

    expect(subagent.id).toBe("subagent:spawn:m-assistant:build:Do work");
    expect(subagent.meta.status).toBe("cancelled");
    expect(subagent.meta.externalSessionId).toBe("session-child-1");
    expect(subagent.meta.startedAtMs).toBe(100);
    expect(subagent.meta.endedAtMs).toBe(300);
    expect(subagent.content).toContain("Cancelled by user");
  });

  test("surfaces only the identified hydrated subagent history part when part and session correlation keys differ", () => {
    const messages = historyToChatMessages(
      [
        {
          messageId: "m-assistant",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "",
          parts: [
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-running",
              correlationKey: "part:m-assistant:p-subagent-running",
              status: "running",
              agent: "build",
              prompt: "Review changes",
              description: "Review changes [commit|branch|pr]",
              startedAtMs: 100,
            },
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-completed",
              correlationKey: "session:m-assistant:session-child-1",
              status: "completed",
              agent: "build",
              prompt: "Review changes",
              description: "Review completed",
              externalSessionId: "session-child-1",
              startedAtMs: 120,
              endedAtMs: 300,
            },
          ],
        },
      ],
      {
        role: "build",
        selectedModel: null,
      },
    );

    const subagentMessages = messages.filter(
      (entry) => entry.role === "system" && entry.meta?.kind === "subagent",
    );
    expect(subagentMessages).toHaveLength(1);
    expect(subagentMessages[0]).toMatchObject({
      id: "subagent:session:m-assistant:session-child-1",
      meta: {
        kind: "subagent",
        correlationKey: "session:m-assistant:session-child-1",
        status: "completed",
        externalSessionId: "session-child-1",
      },
    });
  });

  test("ignores later unidentified hydrated subagent history rows when an identified row already exists", () => {
    const messages = historyToChatMessages(
      [
        {
          messageId: "m-assistant",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "",
          parts: [
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-completed",
              correlationKey: "session:m-assistant:session-child-1",
              status: "completed",
              agent: "build",
              prompt: "Review changes",
              description: "Review completed",
              externalSessionId: "session-child-1",
              startedAtMs: 120,
              endedAtMs: 300,
            },
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-running",
              correlationKey: "part:m-assistant:p-subagent-running",
              status: "running",
              agent: "build",
              prompt: "Review changes",
              description: "Review changes [commit|branch|pr]",
              startedAtMs: 100,
            },
          ],
        },
      ],
      {
        role: "build",
        selectedModel: null,
      },
    );

    const subagentMessages = messages.filter(
      (entry) => entry.role === "system" && entry.meta?.kind === "subagent",
    );
    expect(subagentMessages).toHaveLength(1);
    expect(subagentMessages[0]).toMatchObject({
      id: "subagent:session:m-assistant:session-child-1",
      meta: {
        kind: "subagent",
        correlationKey: "session:m-assistant:session-child-1",
        status: "completed",
        externalSessionId: "session-child-1",
      },
    });
  });

  test("ignores ambiguous same-prompt hydrated subagent history rows without session ids", () => {
    const messages = historyToChatMessages(
      [
        {
          messageId: "m-assistant",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "",
          parts: [
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-running",
              correlationKey: "part:m-assistant:p-subagent-running",
              status: "running",
              agent: "build",
              prompt: "Review changes",
              description: "Review changes [commit|branch|pr]",
              startedAtMs: 100,
            },
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-completed",
              correlationKey: "session:m-assistant:session-child-1",
              status: "completed",
              agent: "build",
              prompt: "Review changes",
              description: "Review completed",
              externalSessionId: "session-child-1",
              startedAtMs: 120,
              endedAtMs: 300,
            },
          ],
        },
      ],
      {
        role: "build",
        selectedModel: null,
      },
    );

    const subagentMessages = messages.filter(
      (entry) => entry.role === "system" && entry.meta?.kind === "subagent",
    );
    expect(subagentMessages).toHaveLength(1);
    expect(subagentMessages[0]).toMatchObject({
      id: "subagent:session:m-assistant:session-child-1",
      meta: {
        kind: "subagent",
        correlationKey: "session:m-assistant:session-child-1",
        status: "completed",
        externalSessionId: "session-child-1",
      },
    });
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

    const assistant = sessionMessageAt({ externalSessionId: "external-1", messages }, 0);
    if (!assistant || assistant.meta?.kind !== "assistant") {
      throw new Error("Expected assistant message with assistant meta");
    }

    expect(assistant.meta.isFinal).toBe(true);
    expect(assistant.meta.totalTokens).toBe(999);
  });

  test("uses assistant-owned activity timing for final history turns without a user anchor", () => {
    const startedAtMs = Date.parse("2026-02-22T08:00:01.000Z");
    const completedAt = "2026-02-22T08:00:28.000Z";
    const messages = historyToChatMessages(
      [
        {
          messageId: "m-assistant-final",
          role: "assistant",
          timestamp: completedAt,
          text: "Reviewed the changes",
          parts: [
            {
              kind: "subagent",
              messageId: "m-assistant-final",
              partId: "p-subagent",
              correlationKey: "spawn:m-assistant-final:build:review",
              status: "completed",
              agent: "build",
              prompt: "review changes",
              description: "review changes [commit|branch|pr]",
              startedAtMs,
              endedAtMs: Date.parse(completedAt),
            },
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

    const assistant = sessionMessageAt({ externalSessionId: "external-1", messages }, 0);
    if (!assistant || assistant.meta?.kind !== "assistant") {
      throw new Error("Expected assistant message with assistant meta");
    }

    expect(assistant.meta.isFinal).toBe(true);
    expect(assistant.meta.durationMs).toBe(27_000);
  });

  test("uses earlier same-turn tool rows when the final assistant message has no timed parts", () => {
    const startedAt = Date.parse("2026-02-22T08:00:01.000Z");
    const toolCompletedAt = "2026-02-22T08:00:27.000Z";
    const finalCompletedAt = "2026-02-22T08:00:28.000Z";
    const messages = historyToChatMessages(
      [
        {
          messageId: "m-tool",
          role: "assistant",
          timestamp: toolCompletedAt,
          text: "",
          parts: [
            {
              kind: "tool",
              messageId: "m-tool",
              partId: "p-tool",
              callId: "call-1",
              tool: "bash",
              status: "completed",
              input: { command: "pwd" },
              output: "/tmp/repo",
              startedAtMs: startedAt,
              endedAtMs: Date.parse(toolCompletedAt),
            },
          ],
        },
        {
          messageId: "m-assistant-final",
          role: "assistant",
          timestamp: finalCompletedAt,
          text: "Reviewed the changes",
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

    const assistant = messages.find(
      (entry) => entry.role === "assistant" && entry.content === "Reviewed the changes",
    );
    if (!assistant || assistant.meta?.kind !== "assistant") {
      throw new Error("Expected assistant message with assistant meta");
    }

    expect(assistant.meta.isFinal).toBe(true);
    expect(assistant.meta.durationMs).toBe(27_000);
  });

  test("does not reuse a previous-turn user anchor for a later assistant completion", () => {
    const messages = historyToChatMessages(
      [
        {
          messageId: "m-user-1",
          role: "user",
          state: "read",
          timestamp: "2026-02-22T08:00:00.000Z",
          text: "Run the review",
          displayParts: [],
          parts: [],
        },
        {
          messageId: "m-assistant-1",
          role: "assistant",
          timestamp: "2026-02-22T08:00:10.000Z",
          text: "First review complete",
          parts: [
            {
              kind: "step",
              messageId: "m-assistant-1",
              partId: "p-step-finish-1",
              phase: "finish",
              reason: "stop",
            },
          ],
        },
        {
          messageId: "m-assistant-2",
          role: "assistant",
          timestamp: "2026-02-22T08:00:20.000Z",
          text: "Second review complete",
          parts: [
            {
              kind: "step",
              messageId: "m-assistant-2",
              partId: "p-step-finish-2",
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

    const firstAssistant = sessionMessageAt({ externalSessionId: "external-1", messages }, 1);
    const secondAssistant = sessionMessageAt({ externalSessionId: "external-1", messages }, 2);
    if (!firstAssistant || firstAssistant.meta?.kind !== "assistant") {
      throw new Error("Expected first assistant message with assistant meta");
    }
    if (!secondAssistant || secondAssistant.meta?.kind !== "assistant") {
      throw new Error("Expected second assistant message with assistant meta");
    }

    expect(firstAssistant.meta.durationMs).toBe(10_000);
    expect(secondAssistant.meta.durationMs).toBeUndefined();
  });
});

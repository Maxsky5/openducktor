import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { sessionMessagesToArray } from "@/test-utils/session-message-test-helpers";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  fromPersistedSessionRecord,
  toPersistedSessionIdentity,
  toPersistedSessionRecord,
} from "./persistence";

const recordFixture: AgentSessionRecord = {
  runtimeKind: "opencode",
  externalSessionId: "external-1",
  role: "build",
  startedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory: "/tmp/repo/worktree",
  selectedModel: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
  },
};

const loadRecordFixture = (record: AgentSessionRecord = recordFixture): AgentSessionState =>
  fromPersistedSessionRecord({ taskId: "task-1", record });

describe("agent-orchestrator/support/persistence", () => {
  test("loads persisted sessions as idle until runtime state is read", () => {
    const loadedSession = loadRecordFixture();
    expect(loadedSession.status).toBe("idle");
    expect(loadedSession.title).toBe("BUILD task-1");
    expect(loadedSession.runtimeKind).toBe("opencode");
    expect(loadedSession.pendingApprovals).toEqual([]);
    expect(loadedSession.pendingQuestions).toEqual([]);
    expect(sessionMessagesToArray(loadedSession)).toEqual([]);
    expect(loadedSession.selectedModel?.modelId).toBe("gpt-5");
  });

  test("does not persist pending input requests in session snapshots", () => {
    const loadedSession = loadRecordFixture();
    const withPendingInput: AgentSessionState = {
      ...loadedSession,
      pendingApprovals: [
        {
          requestId: "permission-1",
          requestType: "permission_grant" as const,
          title: `Approve permission: ${"read"}`,
          summary: `Approval request for ${"read"}.`,
          affectedPaths: ["**/*"],
          action: { name: "read" },
          mutation: "read_only" as const,
          supportedReplyOutcomes: [
            "approve_once" as const,
            "approve_session" as const,
            "reject" as const,
          ],
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
    expect("pendingApprovals" in persisted).toBe(false);
    expect("pendingQuestions" in persisted).toBe(false);
  });

  test("persists compact session fields", () => {
    const session: AgentSessionState = {
      ...loadRecordFixture(),
      status: "error",
    };
    const persisted = toPersistedSessionRecord(session);
    expect(persisted.runtimeKind).toBe("opencode");
    expect(persisted.selectedModel).toEqual(recordFixture.selectedModel);
    expect("taskId" in persisted).toBe(false);
    expect("title" in persisted).toBe(false);
  });

  test("preserves non-default runtime kind across persistence", () => {
    const customRuntimeRecord: AgentSessionRecord = {
      ...recordFixture,
      runtimeKind: "opencode",
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-3-7-sonnet",
      },
    };

    const loadedSession = loadRecordFixture(customRuntimeRecord);
    expect(loadedSession.runtimeKind).toBe("opencode");
    expect(loadedSession.selectedModel?.runtimeKind).toBe("opencode");

    const persisted = toPersistedSessionRecord(loadedSession);
    expect(persisted.runtimeKind).toBe("opencode");
    expect(persisted.selectedModel?.runtimeKind).toBe("opencode");
  });

  test("derives persisted session identity from mandatory durable runtime fields", () => {
    expect(
      toPersistedSessionIdentity({
        ...recordFixture,
        runtimeKind: "codex",
        workingDirectory: " /tmp/repo/worktree ",
        selectedModel: null,
      }),
    ).toEqual({
      externalSessionId: "external-1",
      runtimeKind: "codex",
      workingDirectory: "/tmp/repo/worktree",
    });
  });

  test("rejects persisted session records without a top-level runtime kind", () => {
    const invalidRecord = { ...recordFixture } as Record<string, unknown>;
    delete invalidRecord.runtimeKind;

    expect(() =>
      fromPersistedSessionRecord({
        taskId: "task-1",
        record: invalidRecord as unknown as AgentSessionRecord,
      }),
    ).toThrow("Persisted session 'external-1' is missing runtime kind.");
  });

  test("rejects persisted selected models without a runtime kind", () => {
    const invalidRecord = {
      ...recordFixture,
      selectedModel: {
        providerId: "openai",
        modelId: "gpt-5",
      } as unknown as NonNullable<AgentSessionRecord["selectedModel"]>,
    };

    expect(() => fromPersistedSessionRecord({ taskId: "task-1", record: invalidRecord })).toThrow(
      "Persisted session 'external-1' selected model is missing runtime kind.",
    );
  });

  test("rejects persisted selected models whose runtime kind disagrees with the session", () => {
    const invalidRecord = {
      ...recordFixture,
      selectedModel: {
        runtimeKind: "claude-code",
        providerId: "openai",
        modelId: "gpt-5",
      },
    } as unknown as AgentSessionRecord;

    expect(() => fromPersistedSessionRecord({ taskId: "task-1", record: invalidRecord })).toThrow(
      "Unsupported runtime kind 'claude-code'.",
    );
  });

  test("rejects persisting selected models without a runtime kind", () => {
    const session: AgentSessionState = {
      ...loadRecordFixture(),
      selectedModel: {
        providerId: "openai",
        modelId: "gpt-5",
      } as unknown as NonNullable<AgentSessionState["selectedModel"]>,
    };

    expect(() => toPersistedSessionRecord(session)).toThrow(
      "Session 'external-1' selected model is missing runtime kind.",
    );
  });

  test("rejects persisting selected models whose runtime kind disagrees with the session", () => {
    const session = {
      ...loadRecordFixture(),
      selectedModel: {
        runtimeKind: "claude-code",
        providerId: "openai",
        modelId: "gpt-5",
      },
    } as unknown as AgentSessionState;

    expect(() => toPersistedSessionRecord(session)).toThrow(
      "Unsupported runtime kind 'claude-code'.",
    );
  });
});

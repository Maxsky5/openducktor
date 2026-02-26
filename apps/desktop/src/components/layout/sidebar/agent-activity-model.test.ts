import { describe, expect, test } from "bun:test";
import { summarizeAgentActivity } from "./agent-activity-model";

const buildSession = (
  overrides: {
    status?: "starting" | "running" | "idle" | "error" | "stopped";
    pendingPermissions?: number;
    pendingQuestions?: number;
  } = {},
) => ({
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "spec" as const,
  scenario: "spec_initial" as const,
  status: overrides.status ?? "idle",
  startedAt: "2026-02-26T09:00:00.000Z",
  runtimeId: null,
  runId: null,
  baseUrl: "http://localhost:4096",
  workingDirectory: "/repo",
  messages: [],
  draftAssistantText: "",
  pendingPermissions: Array.from({ length: overrides.pendingPermissions ?? 0 }, (_, index) => ({
    requestId: `perm-${index}`,
    permission: "read",
    patterns: ["*"],
  })),
  pendingQuestions: Array.from({ length: overrides.pendingQuestions ?? 0 }, (_, index) => ({
    requestId: `question-${index}`,
    questions: [],
  })),
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
});

describe("summarizeAgentActivity", () => {
  test("counts active sessions from starting/running statuses", () => {
    const summary = summarizeAgentActivity([
      buildSession({ status: "starting" }),
      buildSession({ status: "running" }),
      buildSession({ status: "idle" }),
      buildSession({ status: "error" }),
    ]);

    expect(summary.activeSessionCount).toBe(2);
    expect(summary.waitingForInputCount).toBe(0);
  });

  test("counts waiting sessions from permissions or questions", () => {
    const summary = summarizeAgentActivity([
      buildSession({ status: "running", pendingPermissions: 1 }),
      buildSession({ status: "idle", pendingQuestions: 1 }),
      buildSession({ status: "stopped" }),
    ]);

    expect(summary.activeSessionCount).toBe(1);
    expect(summary.waitingForInputCount).toBe(2);
  });
});

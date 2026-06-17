import { describe, expect, test } from "bun:test";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import {
  resolveSelectedSessionActivityState,
  resolveSelectedSessionModel,
} from "./selected-session-facts";

const identity: AgentSessionIdentity = {
  externalSessionId: "session-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
};

const selectedModel = {
  runtimeKind: "opencode" as const,
  providerId: "anthropic",
  modelId: "claude-sonnet-4",
  profileId: "builder",
};

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  ...identity,
  taskId: "task-1",
  role: "build",
  status: "running",
  startedAt: "2026-06-17T08:00:00.000Z",
  historyLoadState: "loaded",
  messages: createSessionMessagesState(identity.externalSessionId),
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel,
  ...overrides,
});

const createSummary = (overrides: Partial<AgentSessionSummary> = {}): AgentSessionSummary => ({
  ...identity,
  taskId: "task-1",
  role: "build",
  title: "Build session",
  startedAt: "2026-06-17T08:00:00.000Z",
  activityState: "running",
  pendingApprovalCount: 0,
  pendingQuestionCount: 0,
  selectedModel,
  ...overrides,
});

describe("selected session facts", () => {
  test("uses the loaded session before the summary snapshot", () => {
    const summaryModel = {
      runtimeKind: "codex" as const,
      providerId: "openai",
      modelId: "gpt-5",
    };
    const loadedSession = createSession({
      pendingQuestions: [{ requestId: "question-1", questions: [] }],
    });

    const source = {
      selectedSessionSummary: createSummary({
        activityState: "idle",
        selectedModel: summaryModel,
      }),
      loadedSession,
    };

    expect(resolveSelectedSessionModel(source)).toEqual(selectedModel);
    expect(resolveSelectedSessionActivityState(source)).toBe("waiting_input");
  });

  test("uses the selected session summary while the full session is loading", () => {
    const source = {
      selectedSessionSummary: createSummary({ role: "planner" }),
      loadedSession: null,
    };

    expect(resolveSelectedSessionModel(source)).toEqual(selectedModel);
    expect(resolveSelectedSessionActivityState(source)).toBe("running");
  });

  test("returns no display facts before any session evidence arrives", () => {
    const source = {
      selectedSessionSummary: null,
      loadedSession: null,
    };

    expect(resolveSelectedSessionModel(source)).toBeNull();
    expect(resolveSelectedSessionActivityState(source)).toBeNull();
  });
});

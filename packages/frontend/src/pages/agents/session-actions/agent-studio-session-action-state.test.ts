import { describe, expect, test } from "bun:test";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { EMPTY_SELECTED_SESSION_RUNTIME_DATA } from "@/types/selected-session-runtime-data";
import { deriveAgentStudioSessionActionState } from "./agent-studio-session-action-state";

const selectedSession = {
  externalSessionId: "session-1",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo/worktree",
};

const createSummary = (overrides: Partial<AgentSessionSummary> = {}): AgentSessionSummary => ({
  ...selectedSession,
  taskId: "task-1",
  role: "build",
  title: "Build session",
  startedAt: "2026-06-17T08:00:00.000Z",
  activityState: "running",
  pendingApprovalCount: 0,
  pendingQuestionCount: 0,
  selectedModel: null,
  ...overrides,
});

describe("deriveAgentStudioSessionActionState", () => {
  test("uses the selected session summary while the full session is loading", () => {
    const selectedSessionSummary = createSummary();
    const state = deriveAgentStudioSessionActionState({
      selectedSessionIdentity: selectedSession,
      selectedSessionActivityState: selectedSessionSummary.activityState,
      sessionRuntimeData: EMPTY_SELECTED_SESSION_RUNTIME_DATA,
      runtimeDefinitions: [RUNTIME_DESCRIPTORS_BY_KIND.opencode],
    });

    expect(state).toMatchObject({
      isSessionBusy: true,
      isWaitingInput: false,
      canQueueBusyFollowups: true,
      busySendBlockedReason: null,
    });
  });

  test("treats a selected session without activity evidence as not busy", () => {
    const state = deriveAgentStudioSessionActionState({
      selectedSessionIdentity: selectedSession,
      selectedSessionActivityState: null,
      sessionRuntimeData: EMPTY_SELECTED_SESSION_RUNTIME_DATA,
      runtimeDefinitions: [RUNTIME_DESCRIPTORS_BY_KIND.opencode],
    });

    expect(state).toMatchObject({
      isSessionBusy: false,
      isWaitingInput: false,
    });
  });
});

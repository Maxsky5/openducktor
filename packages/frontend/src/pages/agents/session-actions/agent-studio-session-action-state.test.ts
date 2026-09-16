import { describe, expect, test } from "bun:test";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { EMPTY_SELECTED_SESSION_RUNTIME_DATA } from "@/types/selected-session-runtime-data";
import type { AgentStudioSelectedSessionState } from "../selected-session/selected-session-state";
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

const createSelectedSession = (
  overrides: Partial<AgentStudioSelectedSessionState> = {},
): AgentStudioSelectedSessionState => ({
  identity: selectedSession,
  activityState: null,
  selectedModel: null,
  loadedSession: null,
  runtimeData: EMPTY_SELECTED_SESSION_RUNTIME_DATA,
  runtimeReadiness: {
    state: "ready",
    message: null,
    isLoadingChecks: false,
    refreshChecks: async () => {},
  },
  transcriptState: { kind: "visible" },
  sessionAuxiliaryError: null,
  ...overrides,
});

describe("deriveAgentStudioSessionActionState", () => {
  test("uses the selected session summary while the full session is loading", () => {
    const selectedSessionSummary = createSummary();
    const state = deriveAgentStudioSessionActionState({
      selectedSession: createSelectedSession({
        activityState: selectedSessionSummary.activityState,
      }),
      runtimeDefinitions: [RUNTIME_DESCRIPTORS_BY_KIND.opencode],
    });

    expect(state).toMatchObject({
      isSessionWorking: true,
      isWaitingInput: false,
      canQueueBusyFollowups: true,
      busySendBlockedReason: null,
    });
  });

  test("prefers current runtime definitions over stale loaded session descriptors", () => {
    const staleOpenCodeDescriptor = {
      ...RUNTIME_DESCRIPTORS_BY_KIND.opencode,
      capabilities: {
        ...RUNTIME_DESCRIPTORS_BY_KIND.opencode.capabilities,
        sessionLifecycle: {
          ...RUNTIME_DESCRIPTORS_BY_KIND.opencode.capabilities.sessionLifecycle,
          supportsQueuedUserMessages: false,
        },
      },
    };

    const state = deriveAgentStudioSessionActionState({
      selectedSession: createSelectedSession({
        identity: {
          externalSessionId: "session-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
        activityState: "running",
        runtimeData: {
          ...EMPTY_SELECTED_SESSION_RUNTIME_DATA,
          modelCatalog: {
            runtime: staleOpenCodeDescriptor,
            models: [],
            defaultModelsByProvider: {},
          },
        },
      }),
      runtimeDefinitions: [RUNTIME_DESCRIPTORS_BY_KIND.opencode],
    });

    expect(state.canQueueBusyFollowups).toBe(true);
    expect(state.busySendBlockedReason).toBeNull();
  });

  test("treats a selected session without activity evidence as not working", () => {
    const state = deriveAgentStudioSessionActionState({
      selectedSession: createSelectedSession(),
      runtimeDefinitions: [RUNTIME_DESCRIPTORS_BY_KIND.opencode],
    });

    expect(state).toMatchObject({
      isSessionWorking: false,
      isWaitingInput: false,
    });
  });

  test("keeps waiting-input sessions out of busy follow-up policy", () => {
    const state = deriveAgentStudioSessionActionState({
      selectedSession: createSelectedSession({ activityState: "waiting_input" }),
      runtimeDefinitions: [RUNTIME_DESCRIPTORS_BY_KIND.opencode],
    });

    expect(state).toMatchObject({
      isSessionWorking: false,
      isWaitingInput: true,
      canQueueBusyFollowups: false,
      busySendBlockedReason: null,
    });
  });

  test("offers resume only from the effective runtime definitions", () => {
    const unfinishedUserTurn: AgentChatMessage = {
      id: "user-1",
      role: "user",
      content: "Continue the build.",
      timestamp: "2026-06-17T08:00:00.000Z",
    };
    const selectedSessionState = createSelectedSession({
      identity: {
        externalSessionId: "session-1",
        runtimeKind: "claude",
        workingDirectory: "/repo/worktree",
      },
      activityState: "idle",
      loadedSession: createAgentSessionFixture({ messages: [unfinishedUserTurn] }),
      runtimeData: {
        ...EMPTY_SELECTED_SESSION_RUNTIME_DATA,
        modelCatalog: {
          runtime: RUNTIME_DESCRIPTORS_BY_KIND.claude,
          models: [],
          defaultModelsByProvider: {},
        },
      },
    });

    const withoutDefinitions = deriveAgentStudioSessionActionState({
      selectedSession: selectedSessionState,
      runtimeDefinitions: [],
    });
    expect(withoutDefinitions.canResumeSession).toBe(false);

    const withDefinitions = deriveAgentStudioSessionActionState({
      selectedSession: selectedSessionState,
      runtimeDefinitions: [RUNTIME_DESCRIPTORS_BY_KIND.claude],
    });
    expect(withDefinitions.canResumeSession).toBe(true);
  });
});

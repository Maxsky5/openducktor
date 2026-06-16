import { describe, expect, mock, test } from "bun:test";
import { deriveAgentStudioChatSurfaceState } from "./agent-studio-chat-surface-state";
import type { AgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";

const startLaunchKickoff = mock(async () => {});

const baseSelectedSession = {
  taskId: "task-1",
  activeSession: null,
  workflow: {
    selectedRoleAvailable: true,
    selectedRoleReadOnlyReason: null,
  },
};

const baseSessionActions = {
  isStarting: false,
  canKickoffNewSession: false,
  kickoffLabel: "Start Spec",
  startLaunchKickoff,
};

const transcriptState = (kind: "empty" | "runtime_waiting" | "visible") => ({ kind });

describe("deriveAgentStudioChatSurfaceState", () => {
  test("prompts for a task before Agent Studio has a task context", () => {
    expect(
      deriveAgentStudioChatSurfaceState({
        selectedSession: {
          ...baseSelectedSession,
          taskId: "",
        },
        transcriptState: transcriptState("empty"),
        sessionActions: baseSessionActions,
      }).emptyState,
    ).toEqual({
      title: "Select a task to begin.",
    });
  });

  test("hides the kickoff empty state while transcript state is not empty", () => {
    expect(
      deriveAgentStudioChatSurfaceState({
        selectedSession: baseSelectedSession,
        transcriptState: transcriptState("runtime_waiting"),
        sessionActions: {
          ...baseSessionActions,
          canKickoffNewSession: true,
        },
      }).emptyState,
    ).toBeNull();
  });

  test("shows the starting empty state before kickoff resolves to a session", () => {
    expect(
      deriveAgentStudioChatSurfaceState({
        selectedSession: baseSelectedSession,
        transcriptState: transcriptState("empty"),
        sessionActions: {
          ...baseSessionActions,
          isStarting: true,
          canKickoffNewSession: true,
        },
      }).emptyState,
    ).toEqual({
      title: "Initializing session...",
    });
  });

  test("exposes the kickoff action only when kickoff is available", () => {
    startLaunchKickoff.mockClear();
    const state = deriveAgentStudioChatSurfaceState({
      selectedSession: baseSelectedSession,
      transcriptState: transcriptState("empty"),
      sessionActions: {
        ...baseSessionActions,
        canKickoffNewSession: true,
      },
    });

    state.emptyState?.onAction?.();

    expect(state.emptyState?.actionLabel).toBe("Start Spec");
    expect(startLaunchKickoff).toHaveBeenCalledTimes(1);
  });

  test("keeps composer editable when an active session exists even if the role is unavailable", () => {
    expect(
      deriveAgentStudioChatSurfaceState({
        selectedSession: {
          ...baseSelectedSession,
          activeSession: {} as AgentStudioSelectedSessionContext["activeSession"],
          workflow: {
            selectedRoleAvailable: false,
            selectedRoleReadOnlyReason: "Planner is unavailable.",
          },
        },
        transcriptState: transcriptState("visible"),
        sessionActions: baseSessionActions,
      }),
    ).toMatchObject({
      composerReadOnly: false,
      composerReadOnlyReason: null,
    });
  });

  test("makes composer read-only when no session exists for an unavailable role", () => {
    expect(
      deriveAgentStudioChatSurfaceState({
        selectedSession: {
          ...baseSelectedSession,
          workflow: {
            selectedRoleAvailable: false,
            selectedRoleReadOnlyReason: "Planner is unavailable.",
          },
        },
        transcriptState: transcriptState("empty"),
        sessionActions: baseSessionActions,
      }),
    ).toMatchObject({
      composerReadOnly: true,
      composerReadOnlyReason: "Planner is unavailable.",
    });
  });
});

import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import { deriveAgentStudioChatSurfaceState } from "./agent-studio-chat-surface-state";

const startLaunchKickoff = mock(async () => {});

const baseSurfaceInput = {
  taskId: "task-1",
  selectedSessionKey: null,
  workflow: {
    selectedRoleAvailable: true,
    selectedRoleReadOnlyReason: null,
  },
  isStarting: false,
  canUseKickoffPrompt: false,
  kickoffLabel: "Start Spec",
  startLaunchKickoff,
};

const transcriptState = (
  kind: "empty" | "runtime_waiting" | "visible",
): AgentSessionTranscriptState => (kind === "empty" ? { kind, reason: "sessionless" } : { kind });

describe("deriveAgentStudioChatSurfaceState", () => {
  test("prompts for a task before Agent Studio has a task context", () => {
    expect(
      deriveAgentStudioChatSurfaceState({
        ...baseSurfaceInput,
        taskId: "",
        transcriptState: transcriptState("empty"),
      }).emptyState,
    ).toEqual({
      title: "Select a task to begin.",
    });
  });

  test("hides the kickoff empty state while transcript state is not empty", () => {
    expect(
      deriveAgentStudioChatSurfaceState({
        ...baseSurfaceInput,
        transcriptState: transcriptState("runtime_waiting"),
        canUseKickoffPrompt: true,
      }).emptyState,
    ).toBeNull();
  });

  test("shows the starting empty state before kickoff resolves to a session", () => {
    expect(
      deriveAgentStudioChatSurfaceState({
        ...baseSurfaceInput,
        transcriptState: transcriptState("empty"),
        isStarting: true,
        canUseKickoffPrompt: true,
      }).emptyState,
    ).toEqual({
      title: "Initializing session...",
    });
  });

  test("exposes the kickoff action only when kickoff is available", () => {
    startLaunchKickoff.mockClear();
    const state = deriveAgentStudioChatSurfaceState({
      ...baseSurfaceInput,
      transcriptState: transcriptState("empty"),
      canUseKickoffPrompt: true,
    });

    state.emptyState?.onAction?.();

    expect(state.emptyState?.actionLabel).toBe("Start Spec");
    expect(startLaunchKickoff).toHaveBeenCalledTimes(1);
  });

  test("does not expose kickoff outside the transcript-owned sessionless state", () => {
    expect(
      deriveAgentStudioChatSurfaceState({
        ...baseSurfaceInput,
        transcriptState: { kind: "empty", reason: "inactive" },
        canUseKickoffPrompt: true,
      }).emptyState,
    ).toBeNull();
  });

  test("keeps composer editable when a selected session exists even if the role is unavailable", () => {
    expect(
      deriveAgentStudioChatSurfaceState({
        ...baseSurfaceInput,
        selectedSessionKey: "opencode:session-1:/repo/worktree",
        workflow: {
          selectedRoleAvailable: false,
          selectedRoleReadOnlyReason: "Planner is unavailable.",
        },
        transcriptState: transcriptState("visible"),
      }),
    ).toMatchObject({
      composerReadOnly: false,
      composerReadOnlyReason: null,
    });
  });

  test("keeps composer editable while a selected session is loading", () => {
    expect(
      deriveAgentStudioChatSurfaceState({
        ...baseSurfaceInput,
        selectedSessionKey: "opencode:session-1:/repo/worktree",
        workflow: {
          selectedRoleAvailable: false,
          selectedRoleReadOnlyReason: "Planner is unavailable.",
        },
        transcriptState: { kind: "session_loading", reason: "preparing" },
      }),
    ).toMatchObject({
      emptyState: null,
      composerReadOnly: false,
      composerReadOnlyReason: null,
    });
  });

  test("makes composer read-only when no session exists for an unavailable role", () => {
    expect(
      deriveAgentStudioChatSurfaceState({
        ...baseSurfaceInput,
        workflow: {
          selectedRoleAvailable: false,
          selectedRoleReadOnlyReason: "Planner is unavailable.",
        },
        transcriptState: transcriptState("empty"),
      }),
    ).toMatchObject({
      composerReadOnly: true,
      composerReadOnlyReason: "Planner is unavailable.",
    });
  });
});

import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "../../test-support/shared-test-fixtures";
import { workspaceSessionRecord } from "../../test-support/workspace-session-fixtures";
import {
  failedAgentSessionReadModelLoadState,
  loadingAgentSessionReadModelLoadState,
  readyAgentSessionReadModelLoadState,
} from "../../types/agent-session-read-model";
import { projectWorkspaceSessionChatState } from "./workspace-session-chat-state";

const identity = {
  runtimeKind: "claude" as const,
  externalSessionId: "session-1",
  workingDirectory: "/repo",
};

const record = workspaceSessionRecord("workspace-session", {
  runtimeKind: identity.runtimeKind,
  externalSessionId: identity.externalSessionId,
  executionTarget: { kind: "local_repo_root", workingDirectory: identity.workingDirectory },
});

const project = (
  livePresence: "present" | "unobserved",
  readModelLoadState = loadingAgentSessionReadModelLoadState("/repo"),
) =>
  projectWorkspaceSessionChatState({
    workspaceId: "workspace-1",
    record,
    identity,
    session: createAgentSessionFixture({
      ...identity,
      sessionAssociation: { kind: "repository", workspaceId: "workspace-1" },
      status: "running",
      livePresence,
    }),
    readModelLoadState,
    runtimeReadinessState: "ready",
    fault: null,
  });

describe("projectWorkspaceSessionChatState", () => {
  test("shows the activity of a live session while task records still load", () => {
    const state = project("present");
    expect(state.observationReady).toBe(false);
    expect(state.activityState).toBe("running");
    expect(state.canStopSession).toBe(true);
  });

  test("keeps the activity of a live session when task records fail", () => {
    const state = project(
      "present",
      failedAgentSessionReadModelLoadState("/repo", "Task records failed.", "task-records"),
    );
    expect(state.activityState).toBe("running");
    expect(state.canStopSession).toBe(true);
  });

  test("hides the reported activity when the live stream fails", () => {
    const state = project(
      "present",
      failedAgentSessionReadModelLoadState("/repo", "Stream failed.", "live-stream"),
    );
    expect(state.activityState).toBeNull();
    expect(state.canStopSession).toBe(false);
  });

  test("shows no activity before a snapshot reports the session", () => {
    expect(project("unobserved").activityState).toBeNull();
    expect(project("unobserved", readyAgentSessionReadModelLoadState("/repo")).activityState).toBe(
      "running",
    );
  });
});

import { describe, expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import { createAgentSessionFixture } from "../../test-support/shared-test-fixtures";
import {
  loadingAgentSessionReadModelLoadState,
  readyAgentSessionReadModelLoadState,
} from "../../types/agent-session-read-model";
import { projectWorkspaceSessionChatState } from "./workspace-session-chat-state";

const identity = {
  runtimeKind: "claude" as const,
  externalSessionId: "session-1",
  workingDirectory: "/repo",
};

const record: WorkspaceSession = {
  id: "workspace-session",
  runtimeKind: identity.runtimeKind,
  externalSessionId: identity.externalSessionId,
  executionTarget: { kind: "local_repo_root", workingDirectory: identity.workingDirectory },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: null,
  targetBranch: null,
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
};

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

  test("shows no activity before a snapshot reports the session", () => {
    expect(project("unobserved").activityState).toBeNull();
    expect(project("unobserved", readyAgentSessionReadModelLoadState("/repo")).activityState).toBe(
      "running",
    );
  });
});

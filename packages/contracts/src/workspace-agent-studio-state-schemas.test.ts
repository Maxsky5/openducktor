import { describe, expect, test } from "bun:test";
import {
  repoConfigSchema,
  settingsSnapshotSaveInputSchema,
  settingsSnapshotSchema,
} from "./config-schemas";
import { workspaceAgentStudioStateSchema } from "./workspace-agent-studio-state-schemas";

const baseRepoConfigInput = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
};

describe("workspace Agent Studio state schemas", () => {
  test("defaults state for older repository configs", () => {
    const parsed = repoConfigSchema.parse(baseRepoConfigInput);

    expect(parsed.agentStudioState).toEqual({ openTaskIds: [] });
  });

  test("accepts structural state without cross-field rules", () => {
    const state = workspaceAgentStudioStateSchema.parse({
      openTaskIds: ["task-1", "task-1", "stale-task"],
      activeTask: {
        taskId: "another-task",
        role: "build",
        externalSessionId: "session-1",
      },
    });

    expect(state).toEqual({
      openTaskIds: ["task-1", "task-1", "stale-task"],
      activeTask: {
        taskId: "another-task",
        role: "build",
        externalSessionId: "session-1",
      },
    });
  });

  test("rejects invalid field types", () => {
    expect(workspaceAgentStudioStateSchema.safeParse({ openTaskIds: ["task-1", 2] }).success).toBe(
      false,
    );
    expect(
      workspaceAgentStudioStateSchema.safeParse({
        openTaskIds: [],
        activeTask: { taskId: "task-1", role: "operator" },
      }).success,
    ).toBe(false);
  });

  test("stays outside settings snapshots and save inputs", () => {
    const repoConfig = repoConfigSchema.parse({
      ...baseRepoConfigInput,
      agentStudioState: {
        openTaskIds: ["task-1"],
        activeTask: { taskId: "task-1", role: "build", externalSessionId: "session-1" },
      },
    });
    const snapshot = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      workspaces: { repo: repoConfig },
      globalPromptOverrides: {},
    });
    const saveInput = settingsSnapshotSaveInputSchema.parse({
      system: snapshot.system,
      git: snapshot.git,
      general: snapshot.general,
      appearance: snapshot.appearance,
      chat: snapshot.chat,
      reusablePrompts: snapshot.reusablePrompts,
      kanban: snapshot.kanban,
      autopilot: snapshot.autopilot,
      notifications: snapshot.notifications,
      agentRuntimes: snapshot.agentRuntimes,
      agentModelFavorites: snapshot.agentModelFavorites,
      workspaces: { repo: repoConfig },
      globalPromptOverrides: snapshot.globalPromptOverrides,
    });

    expect(snapshot.workspaces.repo).not.toHaveProperty("agentStudioState");
    expect(saveInput.workspaces.repo).not.toHaveProperty("agentStudioState");
  });
});

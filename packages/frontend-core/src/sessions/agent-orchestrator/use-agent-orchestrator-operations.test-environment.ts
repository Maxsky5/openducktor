import { AgentRuntimeTestAdapter } from "../../test-support/agent-runtime-test-adapter";
import { spyOn } from "bun:test";
import type { HostClient } from "@openducktor/host-client";
import { createSettingsSnapshotFixture } from "../../test-support/shared-test-fixtures";
import { createTestHostConnection } from "../../test-support/test-client-connection";

export type OrchestratorOperationsTestEnvironment = {
  /** The host client of this test. Tests replace its commands before they create dependencies. */
  host: HostClient;
  restore: () => void;
};

export const setupOrchestratorOperationsTestEnvironment =
  (): OrchestratorOperationsTestEnvironment => {
    const repoConfig: Awaited<ReturnType<HostClient["workspaceGetRepoConfig"]>> = {
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/tmp/repo",
      branchPrefix: "odt",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: {},
      hooks: { postComplete: [] },
      actions: { items: [], defaultActionId: null },
      worktreeCopyPaths: [],
      promptOverrides: {},
      agentStudioState: { openTaskIds: [] },
      agentDefaults: {},
    };
    const { client: host } = createTestHostConnection({
      client: {
        workspaceSessionListActive: async () => [],
        taskWorktreeGet: async () => ({ workingDirectory: "/tmp/repo/worktree" }),
        workspaceGetRepoConfig: async () => repoConfig,
        workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
      },
    });
    const spies = [
      spyOn(AgentRuntimeTestAdapter.prototype, "loadSessionHistory").mockResolvedValue([]),
      spyOn(AgentRuntimeTestAdapter.prototype, "loadSessionTodos").mockResolvedValue([]),
    ];

    return {
      host,
      restore: () => {
        for (const spy of spies) spy.mockRestore();
      },
    };
  };

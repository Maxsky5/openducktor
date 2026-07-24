import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { clearAppQueryClient } from "@/lib/query-client";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { host } from "../shared/host";
import { useDelegationOperations } from "./use-delegation-operations";

const activeWorkspace = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
};

const original = {
  buildStart: host.buildStart,
  workspaceGetRepoConfig: host.workspaceGetRepoConfig,
};

describe("useDelegationOperations", () => {
  beforeEach(async () => {
    await clearAppQueryClient();
    host.workspaceGetRepoConfig = mock(async () => ({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      defaultRuntimeKind: "opencode",
      branchPrefix: "obp",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: { providers: {} },
      hooks: { preStart: [], postComplete: [] },
      devServers: [],
      worktreeCopyPaths: [],
      promptOverrides: {},
      agentDefaults: {},
    })) as typeof host.workspaceGetRepoConfig;
  });

  afterEach(async () => {
    host.buildStart = original.buildStart;
    host.workspaceGetRepoConfig = original.workspaceGetRepoConfig;
    await clearAppQueryClient();
  });

  test("refreshes the delegated task scope after a successful build start", async () => {
    const buildStart = mock(async () => ({
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
    }));
    const refreshTaskData = mock(async () => undefined);
    host.buildStart = buildStart;
    const harness = createHookHarness(
      () => useDelegationOperations({ activeWorkspace, refreshTaskData }),
      undefined,
    );

    try {
      await harness.mount();
      await expect(
        harness.run((operations) => operations.delegateTask("task-1")),
      ).resolves.toBeUndefined();

      expect(buildStart).toHaveBeenCalledWith("/repo", "task-1", "opencode");
      expect(refreshTaskData).toHaveBeenCalledWith("/repo", "task-1");
    } finally {
      await harness.unmount();
    }
  });
});

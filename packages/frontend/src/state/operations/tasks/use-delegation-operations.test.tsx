import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { HostClient } from "@openducktor/host-client";
import { clearAppQueryClient } from "@/lib/query-client";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { useDelegationOperations } from "./use-delegation-operations";

const activeWorkspace = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
};

describe("useDelegationOperations", () => {
  beforeEach(async () => {
    await clearAppQueryClient();
  });

  afterEach(async () => {
    await clearAppQueryClient();
  });

  test("refreshes the delegated task scope after a successful build start", async () => {
    const buildStart = mock(async () => ({
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
    }));
    const refreshTaskData = mock(async () => undefined);
    const repoConfig: Awaited<ReturnType<HostClient["workspaceGetRepoConfig"]>> = {
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      defaultRuntimeKind: "opencode",
      branchPrefix: "obp",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: {},
      hooks: { preStart: [], postComplete: [] },
      devServers: [],
      worktreeCopyPaths: [],
      promptOverrides: {},
      agentStudioState: { openTaskIds: [] },
      agentDefaults: {},
    };
    const workspaceGetRepoConfig = mock(async () => repoConfig);
    configureShellBridge(
      createShellBridgeFixture({ client: { buildStart, workspaceGetRepoConfig } }),
    );
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
      configureShellBridge(createUnavailableShellBridge());
    }
  });
});

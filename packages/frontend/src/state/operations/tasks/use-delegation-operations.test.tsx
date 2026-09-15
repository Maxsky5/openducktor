import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { HostClient } from "@openducktor/host-client";
import { clearAppQueryClient } from "@/lib/query-client";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { useDelegationOperations } from "./use-delegation-operations";

const activeWorkspace = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
};

type RepoConfig = Awaited<ReturnType<HostClient["workspaceGetRepoConfig"]>>;

const CATALOG: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["default"],
    },
  ],
  defaultModelsByProvider: { openai: "gpt-5" },
};

const createRepoConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  branchPrefix: "obp",
  defaultModel: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
  },
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentStudioState: { openTaskIds: [] },
  agentDefaults: {},
  ...overrides,
});

const withoutDefaultModel = (config: RepoConfig): RepoConfig => {
  const { defaultModel: _defaultModel, ...rest } = config;
  return rest;
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
    const workspaceGetRepoConfig = mock(async () => createRepoConfig());
    configureShellBridge(
      createShellBridgeFixture({ client: { buildStart, workspaceGetRepoConfig } }),
    );
    const loadRepoRuntimeCatalog = mock(async () => CATALOG);
    const harness = createHookHarness(
      () =>
        useDelegationOperations({
          activeWorkspace,
          refreshTaskData,
          loadRepoRuntimeCatalog,
        }),
      undefined,
    );

    try {
      await harness.mount();
      await expect(
        harness.run((operations) => operations.delegateTask("task-1")),
      ).resolves.toBeUndefined();

      expect(loadRepoRuntimeCatalog).toHaveBeenCalledWith({
        repoPath: "/repo",
        runtimeKind: "opencode",
      });
      expect(buildStart).toHaveBeenCalledWith("/repo", "task-1", "opencode");
      expect(refreshTaskData).toHaveBeenCalledWith("/repo", "task-1");
    } finally {
      await harness.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  });

  test("rejects a delegated build when no Builder default exists", async () => {
    const buildStart = mock(async () => ({
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
    }));
    const refreshTaskData = mock(async () => undefined);
    const workspaceGetRepoConfig = mock(async () => withoutDefaultModel(createRepoConfig()));
    configureShellBridge(
      createShellBridgeFixture({ client: { buildStart, workspaceGetRepoConfig } }),
    );
    const loadRepoRuntimeCatalog = mock(async () => CATALOG);
    const harness = createHookHarness(
      () =>
        useDelegationOperations({
          activeWorkspace,
          refreshTaskData,
          loadRepoRuntimeCatalog,
        }),
      undefined,
    );

    try {
      await harness.mount();
      await expect(harness.run((operations) => operations.delegateTask("task-1"))).rejects.toThrow(
        "No model is configured for the Builder session. Set a Builder default or the repository Default Model in Settings > Repositories > Agents.",
      );

      expect(loadRepoRuntimeCatalog).not.toHaveBeenCalled();
      expect(buildStart).not.toHaveBeenCalled();
      expect(refreshTaskData).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  });

  test("rejects a delegated build when the catalog lacks the Builder default", async () => {
    const buildStart = mock(async () => ({
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
    }));
    const refreshTaskData = mock(async () => undefined);
    const workspaceGetRepoConfig = mock(async () =>
      createRepoConfig({
        defaultModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "removed-model",
        },
      }),
    );
    configureShellBridge(
      createShellBridgeFixture({ client: { buildStart, workspaceGetRepoConfig } }),
    );
    const loadRepoRuntimeCatalog = mock(async () => CATALOG);
    const harness = createHookHarness(
      () =>
        useDelegationOperations({
          activeWorkspace,
          refreshTaskData,
          loadRepoRuntimeCatalog,
        }),
      undefined,
    );

    try {
      await harness.mount();
      await expect(harness.run((operations) => operations.delegateTask("task-1"))).rejects.toThrow(
        "The saved Builder default or repository Default Model is not available for runtime opencode. Update it in Settings > Repositories > Agents.",
      );

      expect(buildStart).not.toHaveBeenCalled();
      expect(refreshTaskData).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  });

  test("rejects a delegated build when the Builder default runtime catalog fails", async () => {
    const buildStart = mock(async () => ({
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
    }));
    const refreshTaskData = mock(async () => undefined);
    const workspaceGetRepoConfig = mock(async () => createRepoConfig());
    configureShellBridge(
      createShellBridgeFixture({ client: { buildStart, workspaceGetRepoConfig } }),
    );
    const loadRepoRuntimeCatalog = mock(async (): Promise<AgentModelCatalog> => {
      throw new Error("Cannot resolve the selected runtime. Start it from the runtime controls.");
    });
    const harness = createHookHarness(
      () =>
        useDelegationOperations({
          activeWorkspace,
          refreshTaskData,
          loadRepoRuntimeCatalog,
        }),
      undefined,
    );

    try {
      await harness.mount();
      await expect(harness.run((operations) => operations.delegateTask("task-1"))).rejects.toThrow(
        "The saved Builder default or repository Default Model for runtime opencode could not load. Cannot resolve the selected runtime. Start it from the runtime controls. Update the default in Settings > Repositories > Agents.",
      );

      expect(buildStart).not.toHaveBeenCalled();
      expect(refreshTaskData).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  });
});

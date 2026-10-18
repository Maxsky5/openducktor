import { describe, expect, mock, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentRuntimeCatalog } from "@openducktor/core";
import type { HostClient } from "@openducktor/host-client";
import type { PropsWithChildren, ReactElement } from "react";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { runtimeCatalogQueryKeys } from "@openducktor/frontend-core/queries/runtime-catalog";
import { createHookHarness } from "@openducktor/frontend-core/test-support/react-hook-harness";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { createRuntimeCatalogFixture } from "@/test-utils/shared-test-fixtures";
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

const runtimeCatalogFixture = createRuntimeCatalogFixture({ models: CATALOG });

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
  hooks: { postComplete: [] },
  actions: { items: [], defaultActionId: null },
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

const createDelegationHarness = ({
  client,
  refreshTaskData,
  loadRepoRuntimeCatalog,
}: { client: Partial<HostClient> } & Pick<
  Parameters<typeof useDelegationOperations>[0],
  "refreshTaskData" | "loadRepoRuntimeCatalog"
>) => {
  const connection = createTestClientConnection({ client });
  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>
  );
  const harness = createHookHarness(
    () =>
      useDelegationOperations({
        activeWorkspace,
        refreshTaskData,
        loadRepoRuntimeCatalog,
      }),
    undefined,
    { wrapper },
  );
  return {
    connection,
    harness,
    unmount: async () => {
      await harness.unmount();
      await connection.dispose();
    },
  };
};

describe("useDelegationOperations", () => {
  test("refreshes the delegated task scope after a successful build start", async () => {
    const buildStart = mock(async () => ({
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
    }));
    const refreshTaskData = mock(async () => undefined);
    const workspaceGetRepoConfig = mock(async () => createRepoConfig());
    const loadRepoRuntimeCatalog = mock(async () => runtimeCatalogFixture);
    const { harness, unmount } = createDelegationHarness({
      client: { buildStart, workspaceGetRepoConfig },
      refreshTaskData,
      loadRepoRuntimeCatalog,
    });

    try {
      await harness.mount();
      await harness.run((operations) => operations.delegateTask("task-1"));

      expect(loadRepoRuntimeCatalog).toHaveBeenCalledWith({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
      });
      expect(buildStart).toHaveBeenCalledWith("/repo", "task-1", "opencode");
      expect(refreshTaskData).toHaveBeenCalledWith("/repo", "task-1");
    } finally {
      await unmount();
    }
  });

  test("reuses the fresh catalog from the query cache without another read", async () => {
    const buildStart = mock(async () => ({
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
    }));
    const refreshTaskData = mock(async () => undefined);
    const workspaceGetRepoConfig = mock(async () => createRepoConfig());
    const loadRepoRuntimeCatalog = mock(async (): Promise<AgentRuntimeCatalog> => {
      throw new Error("The catalog reader must not run for a fresh cached catalog.");
    });
    const { connection, harness, unmount } = createDelegationHarness({
      client: { buildStart, workspaceGetRepoConfig },
      refreshTaskData,
      loadRepoRuntimeCatalog,
    });
    connection.queryClient.setQueryData(
      runtimeCatalogQueryKeys.catalog({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
      }),
      runtimeCatalogFixture,
    );

    try {
      await harness.mount();
      await harness.run((operations) => operations.delegateTask("task-1"));

      expect(loadRepoRuntimeCatalog).not.toHaveBeenCalled();
      expect(buildStart).toHaveBeenCalledWith("/repo", "task-1", "opencode");
    } finally {
      await unmount();
    }
  });

  test("rejects a delegated build when no Builder default exists", async () => {
    const buildStart = mock(async () => ({
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
    }));
    const refreshTaskData = mock(async () => undefined);
    const workspaceGetRepoConfig = mock(async () => withoutDefaultModel(createRepoConfig()));
    const loadRepoRuntimeCatalog = mock(async () => runtimeCatalogFixture);
    const { harness, unmount } = createDelegationHarness({
      client: { buildStart, workspaceGetRepoConfig },
      refreshTaskData,
      loadRepoRuntimeCatalog,
    });

    try {
      await harness.mount();
      await expect(harness.run((operations) => operations.delegateTask("task-1"))).rejects.toThrow(
        "No model is configured for the Builder session. Set a Builder default or the repository Default Model in Settings > Repositories > Agents.",
      );

      expect(loadRepoRuntimeCatalog).not.toHaveBeenCalled();
      expect(buildStart).not.toHaveBeenCalled();
      expect(refreshTaskData).not.toHaveBeenCalled();
    } finally {
      await unmount();
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
    const loadRepoRuntimeCatalog = mock(async () => runtimeCatalogFixture);
    const { harness, unmount } = createDelegationHarness({
      client: { buildStart, workspaceGetRepoConfig },
      refreshTaskData,
      loadRepoRuntimeCatalog,
    });

    try {
      await harness.mount();
      await expect(harness.run((operations) => operations.delegateTask("task-1"))).rejects.toThrow(
        "The saved Builder default or repository Default Model is not available for runtime opencode. Update it in Settings > Repositories > Agents.",
      );

      expect(buildStart).not.toHaveBeenCalled();
      expect(refreshTaskData).not.toHaveBeenCalled();
    } finally {
      await unmount();
    }
  });

  test("rejects a delegated build when the Builder default runtime catalog fails", async () => {
    const buildStart = mock(async () => ({
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo",
    }));
    const refreshTaskData = mock(async () => undefined);
    const workspaceGetRepoConfig = mock(async () => createRepoConfig());
    const loadRepoRuntimeCatalog = mock(async (): Promise<AgentRuntimeCatalog> => {
      throw new Error("Cannot resolve the selected runtime. Start it from the runtime controls.");
    });
    const { harness, unmount } = createDelegationHarness({
      client: { buildStart, workspaceGetRepoConfig },
      refreshTaskData,
      loadRepoRuntimeCatalog,
    });

    try {
      await harness.mount();
      await expect(harness.run((operations) => operations.delegateTask("task-1"))).rejects.toThrow(
        "The saved Builder default or repository Default Model for runtime opencode could not load. Cannot resolve the selected runtime. Start it from the runtime controls. Update the default in Settings > Repositories > Agents.",
      );

      expect(buildStart).not.toHaveBeenCalled();
      expect(refreshTaskData).not.toHaveBeenCalled();
    } finally {
      await unmount();
    }
  });
});

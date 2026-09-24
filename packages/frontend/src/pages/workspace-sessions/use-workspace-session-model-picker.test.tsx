import { expect, mock, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentRuntimeCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import {
  RuntimeDefinitionsContext,
  type RuntimeDefinitionsContextValue,
} from "@/state/app-state-contexts";
import {
  runtimeCatalogQueryKeys,
  runtimeCatalogQueryOptions,
} from "@/state/queries/runtime-catalog";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import {
  createDeferred,
  createRuntimeCatalogFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import { useWorkspaceSessionModelPicker } from "./use-workspace-session-model-picker";

test("allows a new workspace session model choice while a stale catalog refreshes", async () => {
  const catalog: AgentModelCatalog = {
    models: [
      {
        id: "openai/gpt-5",
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "gpt-5",
        modelName: "GPT 5",
        variants: ["low"],
      },
    ],
    defaultModelsByProvider: {},
  };
  const runtimeCatalog = createRuntimeCatalogFixture({ models: catalog });
  const runtimeRef = {
    repoPath: "/repo",
    runtimeKind: "opencode" as const,
    workingDirectory: "/repo",
  };
  const client = new QueryClient();
  client.setQueryData(runtimeCatalogQueryKeys.catalog(runtimeRef), runtimeCatalog, {
    updatedAt: 0,
  });
  const refresh = createDeferred<AgentRuntimeCatalog>();
  const loadRuntimeCatalog = mock(async () => refresh.promise);
  const definitions: RuntimeDefinitionsContextValue = {
    runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
    isLoadingRuntimeSettings: false,
    runtimeSettingsError: null,
    hasRuntimeSettingsSnapshot: true,
    refreshRuntimeSettings: async () => {},
    loadRepoRuntimeCatalog: loadRuntimeCatalog,
    loadRepoRuntimeFileSearch: async () => [],
  };
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <RuntimeDefinitionsContext value={definitions}>{children}</RuntimeDefinitionsContext>
    </QueryClientProvider>
  );
  configureShellBridge(
    createShellBridgeFixture({
      client: { workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture() },
    }),
  );
  const harness = createHookHarness(() => useWorkspaceSessionModelPicker("/repo"), undefined, {
    wrapper,
  });

  try {
    await harness.mount();
    await harness.waitFor(
      (state) => state.modelPicker.runtimes[0]?.resource.status === "refreshing",
      2000,
    );
    expect(loadRuntimeCatalog).toHaveBeenCalledWith(runtimeRef);
    expect(harness.getLatest().isLoading).toBe(false);
    await harness.run((state) =>
      state.modelPicker.onValueChange({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      }),
    );
    expect(harness.getLatest().selection?.modelId).toBe("gpt-5");
  } finally {
    refresh.resolve(runtimeCatalog);
    await harness.unmount();
    client.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("live model picker keeps stable props and refreshes when catalog or selection changes", async () => {
  const catalog: AgentModelCatalog = {
    models: [
      {
        id: "openai/gpt-5",
        providerId: "openai",
        modelId: "gpt-5",
        modelName: "GPT 5",
        providerName: "OpenAI",
        variants: ["low", "high"],
      },
    ],
    defaultModelsByProvider: {},
  };
  const runtimeCatalog: AgentRuntimeCatalog = createRuntimeCatalogFixture({ models: catalog });
  const definitions: RuntimeDefinitionsContextValue = {
    runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
    isLoadingRuntimeSettings: false,
    runtimeSettingsError: null,
    hasRuntimeSettingsSnapshot: true,
    refreshRuntimeSettings: async () => {},
    loadRepoRuntimeCatalog: async () => runtimeCatalog,
    loadRepoRuntimeFileSearch: async () => [],
  };
  const update = mock(() => {});
  const target = {
    identity: {
      runtimeKind: "opencode" as const,
      externalSessionId: "native-1",
      workingDirectory: "/repo",
    },
    selection: {
      runtimeKind: "opencode" as const,
      providerId: "openai",
      modelId: "gpt-5",
      variant: "low",
    },
    catalog,
    isLoading: false,
    error: null,
    retry: async () => {},
    update,
  };
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryProvider useIsolatedClient>
      <RuntimeDefinitionsContext value={definitions}>{children}</RuntimeDefinitionsContext>
    </QueryProvider>
  );
  configureShellBridge(
    createShellBridgeFixture({
      client: { workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture() },
    }),
  );
  const harness = createHookHarness(
    (session: typeof target) => useWorkspaceSessionModelPicker("/repo", session),
    target,
    { wrapper },
  );
  try {
    await harness.mount();
    await harness.waitFor((state) => state.modelPicker.favoriteState.favorites !== null, 2000);
    const initial = harness.getLatest();
    await harness.update(target);
    expect(harness.getLatest().modelPicker).toBe(initial.modelPicker);
    expect(harness.getLatest().variantOptions).toBe(initial.variantOptions);
    expect(harness.getLatest().agentProfileOptions).toBe(initial.agentProfileOptions);

    const changed = { ...target, selection: { ...target.selection, variant: "high" } };
    await harness.update(changed);
    expect(harness.getLatest().selection?.variant).toBe("high");
    expect(harness.getLatest().modelPicker).not.toBe(initial.modelPicker);
    const nextCatalog = {
      ...catalog,
      models: catalog.models.map((model) => ({ ...model, variants: ["medium"] })),
    };
    await harness.update({ ...changed, catalog: nextCatalog });
    expect(harness.getLatest().variantOptions.map((option) => option.value)).toEqual(["medium"]);
    await harness.run((state) =>
      state.modelPicker.onValueChange({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      }),
    );
    expect(update).toHaveBeenCalledWith(
      target.identity,
      expect.objectContaining({ variant: "medium" }),
    );
  } finally {
    await harness.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
}, 5000);

test.each([CLAUDE_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR])(
  "$kind picker applies live restrictions only after native startup",
  async (descriptor) => {
    const catalog: AgentModelCatalog = {
      models: [
        {
          id: "provider/model",
          providerId: "provider",
          providerName: "Provider",
          modelId: "model",
          modelName: "Model",
          variants: ["high", "max"],
          liveSessionUpdates: { profile: false, variants: ["high"] },
        },
      ],
      defaultModelsByProvider: {},
      profiles: [
        { name: "build", mode: "primary" },
        { name: "review", mode: "primary" },
      ],
    };
    const runtimeCatalog: AgentRuntimeCatalog = createRuntimeCatalogFixture({ models: catalog });
    const definitions: RuntimeDefinitionsContextValue = {
      runtimeDefinitions: [descriptor],
      availableRuntimeDefinitions: [descriptor],
      agentRuntimes: DEFAULT_AGENT_RUNTIMES,
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      refreshRuntimeDefinitions: async () => [descriptor],
      isLoadingRuntimeSettings: false,
      runtimeSettingsError: null,
      hasRuntimeSettingsSnapshot: true,
      refreshRuntimeSettings: async () => {},
      loadRepoRuntimeCatalog: async () => runtimeCatalog,
      loadRepoRuntimeFileSearch: async () => [],
    };
    const update = mock(() => {});
    const updateDraft = mock(() => {});
    const target: NonNullable<Parameters<typeof useWorkspaceSessionModelPicker>[1]> = {
      identity: null,
      runtimeKind: descriptor.kind,
      selection: {
        runtimeKind: descriptor.kind,
        providerId: "provider",
        modelId: "model",
        variant: "high",
        profileId: "build",
      },
      catalog,
      isLoading: false,
      error: null,
      retry: async () => {},
      update,
      updateDraft,
    };
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryProvider useIsolatedClient>
        <RuntimeDefinitionsContext value={definitions}>{children}</RuntimeDefinitionsContext>
      </QueryProvider>
    );
    configureShellBridge(
      createShellBridgeFixture({
        client: { workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture() },
      }),
    );
    const harness = createHookHarness(
      (session: typeof target) => useWorkspaceSessionModelPicker("/repo", session),
      target,
      { wrapper },
    );
    try {
      await harness.mount();
      expect(harness.getLatest().variantOptions.map((option) => option.value)).toEqual([
        "high",
        "max",
      ]);
      expect(harness.getLatest().agentProfileOptions.every((option) => !option.disabled)).toBe(
        true,
      );
      await harness.run((state) => state.handleSelectVariant("max"));
      expect(updateDraft).toHaveBeenCalledWith(expect.objectContaining({ variant: "max" }));
      expect(update).not.toHaveBeenCalled();
      const identity = {
        runtimeKind: descriptor.kind,
        workingDirectory: "/repo",
        externalSessionId: "native-1",
      };
      await harness.update({ ...target, identity });
      expect(harness.getLatest().variantOptions.map((option) => option.value)).toEqual(["high"]);
      expect(harness.getLatest().agentProfileOptions).toEqual([
        expect.objectContaining({
          value: "build",
          disabled: true,
          description: "Start a new session to change the agent profile.",
        }),
        expect.objectContaining({
          value: "review",
          disabled: true,
          description: "Start a new session to change the agent profile.",
        }),
      ]);
      await harness.run((state) => {
        state.handleSelectVariant("max");
        state.handleSelectAgentProfile("review");
      });
      expect(update).not.toHaveBeenCalled();
      await harness.run((state) => state.handleSelectVariant("high"));
      expect(update).toHaveBeenCalledWith(identity, expect.objectContaining({ variant: "high" }));
    } finally {
      await harness.unmount();
      configureShellBridge(createUnavailableShellBridge());
    }
  },
);

test("prefills the creation picker from the repository Default Model when its catalog is ready", async () => {
  const catalog: AgentModelCatalog = {
    models: [
      {
        id: "openai/gpt-5",
        providerId: "openai",
        modelId: "gpt-5",
        modelName: "GPT 5",
        providerName: "OpenAI",
        variants: ["low"],
      },
    ],
    defaultModelsByProvider: {},
  };
  const runtimeCatalog: AgentRuntimeCatalog = createRuntimeCatalogFixture({ models: catalog });
  const definitions: RuntimeDefinitionsContextValue = {
    runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
    isLoadingRuntimeSettings: false,
    runtimeSettingsError: null,
    hasRuntimeSettingsSnapshot: true,
    refreshRuntimeSettings: async () => {},
    loadRepoRuntimeCatalog: async () => runtimeCatalog,
    loadRepoRuntimeFileSearch: async () => [],
  };
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryProvider useIsolatedClient>
      <RuntimeDefinitionsContext value={definitions}>{children}</RuntimeDefinitionsContext>
    </QueryProvider>
  );
  configureShellBridge(
    createShellBridgeFixture({
      client: { workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture() },
    }),
  );
  const harness = createHookHarness(
    () =>
      useWorkspaceSessionModelPicker("/repo", undefined, {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
      }),
    undefined,
    { wrapper },
  );
  try {
    await harness.mount();
    await harness.waitFor((state) => state.selection?.modelId === "gpt-5", 2000);

    expect(harness.getLatest().selection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "low",
    });
  } finally {
    await harness.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("refreshes a stale session catalog when the model picker opens", async () => {
  const catalog: AgentModelCatalog = {
    models: [
      {
        id: "openai/gpt-5",
        providerId: "openai",
        modelId: "gpt-5",
        modelName: "GPT 5",
        providerName: "OpenAI",
        variants: ["low"],
      },
    ],
    defaultModelsByProvider: {},
  };
  const runtimeCatalogFixture: AgentRuntimeCatalog = createRuntimeCatalogFixture({
    models: catalog,
  });
  const runtimeRef = {
    repoPath: "/repo",
    runtimeKind: "opencode" as const,
    workingDirectory: "/repo/worktree",
  };
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  const loadRuntimeCatalog = mock(
    async (_runtimeRef: RuntimeWorkingDirectoryRef) => runtimeCatalogFixture,
  );
  await client.fetchQuery(runtimeCatalogQueryOptions(runtimeRef, loadRuntimeCatalog));
  client.setQueryData(runtimeCatalogQueryKeys.catalog(runtimeRef), runtimeCatalogFixture, {
    updatedAt: 0,
  });
  const definitions: RuntimeDefinitionsContextValue = {
    runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
    isLoadingRuntimeSettings: false,
    runtimeSettingsError: null,
    hasRuntimeSettingsSnapshot: true,
    refreshRuntimeSettings: async () => {},
    loadRepoRuntimeCatalog: loadRuntimeCatalog,
    loadRepoRuntimeFileSearch: async () => [],
  };
  const target = {
    identity: {
      runtimeKind: "opencode" as const,
      externalSessionId: "native-1",
      workingDirectory: "/repo/worktree",
    },
    runtimeKind: "opencode" as const,
    runtimeRef,
    selection: {
      runtimeKind: "opencode" as const,
      providerId: "openai",
      modelId: "gpt-5",
      variant: "low",
    },
    catalog,
    isLoading: false,
    error: null,
    retry: async () => {},
    update: mock(() => {}),
  };
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <RuntimeDefinitionsContext value={definitions}>{children}</RuntimeDefinitionsContext>
    </QueryClientProvider>
  );
  configureShellBridge(
    createShellBridgeFixture({
      client: { workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture() },
    }),
  );
  const harness = createHookHarness(
    (session: typeof target) => useWorkspaceSessionModelPicker("/repo", session),
    target,
    { wrapper },
  );
  try {
    await harness.mount();
    await harness.waitFor((state) => state.selection?.modelId === "gpt-5");
    expect(loadRuntimeCatalog).toHaveBeenCalledTimes(1);

    await harness.run((state) => state.modelPicker.onOpenChange?.());
    await waitFor(() => expect(loadRuntimeCatalog).toHaveBeenCalledTimes(2));
    expect(loadRuntimeCatalog.mock.calls[1]).toEqual([runtimeRef]);
  } finally {
    await harness.unmount();
    client.clear();
    configureShellBridge(createUnavailableShellBridge());
  }
});

test("does not prefill the creation picker when the Default Model runtime is unavailable", async () => {
  const definitions: RuntimeDefinitionsContextValue = {
    runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    refreshRuntimeDefinitions: async () => [OPENCODE_RUNTIME_DESCRIPTOR],
    isLoadingRuntimeSettings: false,
    runtimeSettingsError: null,
    hasRuntimeSettingsSnapshot: true,
    refreshRuntimeSettings: async () => {},
    loadRepoRuntimeCatalog: async () => {
      throw new Error("Catalog load must not run for an unavailable runtime.");
    },
    loadRepoRuntimeFileSearch: async () => [],
  };
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryProvider useIsolatedClient>
      <RuntimeDefinitionsContext value={definitions}>{children}</RuntimeDefinitionsContext>
    </QueryProvider>
  );
  configureShellBridge(
    createShellBridgeFixture({
      client: { workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture() },
    }),
  );
  const harness = createHookHarness(
    () =>
      useWorkspaceSessionModelPicker("/repo", undefined, {
        runtimeKind: "claude",
        providerId: "openai",
        modelId: "gpt-5",
      }),
    undefined,
    { wrapper },
  );
  try {
    await harness.mount();
    await harness.waitFor((state) => state.isLoading === false, 2000);

    expect(harness.getLatest().selection).toBeNull();
  } finally {
    await harness.unmount();
    configureShellBridge(createUnavailableShellBridge());
  }
});

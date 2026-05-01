import { describe, expect, mock, test } from "bun:test";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
  type RuntimeKind,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { RuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import { createDeferred } from "@/test-utils/shared-test-fixtures";
import { useSettingsModalCatalogState } from "./use-settings-modal-catalog-state";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useSettingsModalCatalogState>[0];

const OPENCODE_DESCRIPTOR = {
  ...OPENCODE_RUNTIME_DESCRIPTOR,
} satisfies RuntimeDescriptor;

const OPENCODE_CATALOG: AgentModelCatalog = {
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
  profiles: [{ name: "spec-agent", mode: "primary" }],
};

const createHookHarness = (
  initialProps: HookArgs,
  loadRepoRuntimeCatalog: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentModelCatalog>,
) => {
  const runtimeDefinitionsContext = {
    runtimeDefinitions: [OPENCODE_DESCRIPTOR],
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    refreshRuntimeDefinitions: async () => [OPENCODE_DESCRIPTOR],
    loadRepoRuntimeCatalog,
    loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
    loadRepoRuntimeFileSearch: async () => [],
  } satisfies React.ComponentProps<typeof RuntimeDefinitionsContext.Provider>["value"];

  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      QueryProvider,
      { useIsolatedClient: true },
      createElement(RuntimeDefinitionsContext.Provider, {
        value: runtimeDefinitionsContext,
        children,
      }),
    );

  return createSharedHookHarness(useSettingsModalCatalogState, initialProps, { wrapper });
};

describe("useSettingsModalCatalogState", () => {
  test("does not fetch catalogs when disabled or missing a repo path", async () => {
    const loadRepoRuntimeCatalog = mock(async () => OPENCODE_CATALOG);

    const disabledHarness = createHookHarness(
      {
        enabled: false,
        selectedRepoPath: "/repo",
        runtimeKinds: ["opencode"],
      },
      loadRepoRuntimeCatalog,
    );
    await disabledHarness.mount();

    expect(loadRepoRuntimeCatalog).toHaveBeenCalledTimes(0);

    await disabledHarness.unmount();

    const missingRepoHarness = createHookHarness(
      {
        enabled: true,
        selectedRepoPath: null,
        runtimeKinds: ["opencode"],
      },
      loadRepoRuntimeCatalog,
    );
    await missingRepoHarness.mount();

    expect(loadRepoRuntimeCatalog).toHaveBeenCalledTimes(0);

    await missingRepoHarness.unmount();
  });

  test("fetches the requested runtime kind and exposes runtime getters", async () => {
    const loadRepoRuntimeCatalog = mock(async () => OPENCODE_CATALOG);

    const harness = createHookHarness(
      {
        enabled: true,
        selectedRepoPath: "/repo",
        runtimeKinds: ["opencode"],
      },
      loadRepoRuntimeCatalog,
    );
    await harness.mount();
    await harness.waitFor((state) => state.getCatalogForRuntime("opencode") !== null);

    expect(loadRepoRuntimeCatalog).toHaveBeenCalledTimes(1);
    expect(loadRepoRuntimeCatalog).toHaveBeenCalledWith("/repo", "opencode");
    expect(harness.getLatest().getCatalogForRuntime("opencode")).toEqual(OPENCODE_CATALOG);
    expect(harness.getLatest().isCatalogLoadingForRuntime("opencode")).toBe(false);

    await harness.unmount();
  });

  test("deduplicates repeated runtime kinds", async () => {
    const loadRepoRuntimeCatalog = mock(async () => OPENCODE_CATALOG);

    const harness = createHookHarness(
      {
        enabled: true,
        selectedRepoPath: "/repo",
        runtimeKinds: ["opencode", "opencode"],
      },
      loadRepoRuntimeCatalog,
    );
    await harness.mount();
    await harness.waitFor((state) => state.getCatalogForRuntime("opencode") !== null);

    expect(loadRepoRuntimeCatalog).toHaveBeenCalledTimes(1);
    expect(loadRepoRuntimeCatalog).toHaveBeenCalledWith("/repo", "opencode");

    await harness.unmount();
  });

  test("exposes loading and errors for the requested runtime", async () => {
    const catalogDeferred = createDeferred<AgentModelCatalog>();
    const loadRepoRuntimeCatalog = mock(async () => catalogDeferred.promise);

    const loadingHarness = createHookHarness(
      {
        enabled: true,
        selectedRepoPath: "/repo",
        runtimeKinds: ["opencode"],
      },
      loadRepoRuntimeCatalog,
    );
    await loadingHarness.mount();
    await loadingHarness.waitFor((state) => state.isCatalogLoadingForRuntime("opencode"));

    expect(loadingHarness.getLatest().isLoadingCatalog).toBe(true);
    expect(loadingHarness.getLatest().getCatalogForRuntime("opencode")).toBeNull();

    catalogDeferred.resolve(OPENCODE_CATALOG);
    await loadingHarness.waitFor((state) => state.isCatalogLoadingForRuntime("opencode") === false);

    expect(loadingHarness.getLatest().getCatalogForRuntime("opencode")).toEqual(OPENCODE_CATALOG);

    await loadingHarness.unmount();

    const failingLoadRepoRuntimeCatalog = mock(async () => {
      throw new Error("catalog failed");
    });

    const errorHarness = createHookHarness(
      {
        enabled: true,
        selectedRepoPath: "/repo",
        runtimeKinds: ["opencode"],
      },
      failingLoadRepoRuntimeCatalog,
    );
    await errorHarness.mount();
    await errorHarness.waitFor(
      (state) => state.getCatalogErrorForRuntime("opencode") === "catalog failed",
    );

    expect(errorHarness.getLatest().getCatalogForRuntime("opencode")).toBeNull();
    expect(errorHarness.getLatest().getCatalogErrorForRuntime("opencode")).toBe("catalog failed");

    await errorHarness.unmount();
  });
});

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

const CODEX_DESCRIPTOR = {
  ...OPENCODE_RUNTIME_DESCRIPTOR,
  kind: "codex",
  label: "Codex",
  description: "Codex runtime",
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

const CODEX_CATALOG: AgentModelCatalog = {
  models: [
    {
      id: "anthropic/claude-opus",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-opus",
      modelName: "Claude Opus",
      variants: ["extended"],
    },
  ],
  defaultModelsByProvider: { anthropic: "claude-opus" },
  profiles: [{ name: "planner-agent", mode: "primary" }],
};

const createHookHarness = (
  initialProps: HookArgs,
  loadRepoRuntimeCatalog: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentModelCatalog>,
) => {
  const runtimeDefinitionsContext = {
    runtimeDefinitions: [OPENCODE_DESCRIPTOR, CODEX_DESCRIPTOR],
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    refreshRuntimeDefinitions: async () => [OPENCODE_DESCRIPTOR, CODEX_DESCRIPTOR],
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

  test("fetches only the requested runtime kinds and exposes per-runtime getters", async () => {
    const loadRepoRuntimeCatalog = mock(async (_repoPath: string, runtimeKind: RuntimeKind) => {
      if (runtimeKind === "opencode") {
        return OPENCODE_CATALOG;
      }
      return CODEX_CATALOG;
    });

    const harness = createHookHarness(
      {
        enabled: true,
        selectedRepoPath: "/repo",
        runtimeKinds: ["opencode"],
      },
      loadRepoRuntimeCatalog,
    );
    await harness.mount();
    await harness.waitFor((state) => state.getCatalogForRuntime("opencode") !== null, 1000);

    expect(loadRepoRuntimeCatalog).toHaveBeenCalledTimes(1);
    expect(loadRepoRuntimeCatalog).toHaveBeenCalledWith("/repo", "opencode");
    expect(harness.getLatest().getCatalogForRuntime("opencode")).toEqual(OPENCODE_CATALOG);
    expect(harness.getLatest().getCatalogForRuntime("codex")).toBeNull();
    expect(harness.getLatest().isCatalogLoadingForRuntime("opencode")).toBe(false);
    expect(harness.getLatest().isCatalogLoadingForRuntime("codex")).toBe(false);

    await harness.unmount();
  });

  test("fetches a newly referenced runtime on demand when the target list grows", async () => {
    const loadRepoRuntimeCatalog = mock(async (_repoPath: string, runtimeKind: RuntimeKind) => {
      if (runtimeKind === "opencode") {
        return OPENCODE_CATALOG;
      }
      return CODEX_CATALOG;
    });

    const harness = createHookHarness(
      {
        enabled: true,
        selectedRepoPath: "/repo",
        runtimeKinds: ["opencode"],
      },
      loadRepoRuntimeCatalog,
    );
    await harness.mount();
    await harness.waitFor((state) => state.getCatalogForRuntime("opencode") !== null, 1000);

    loadRepoRuntimeCatalog.mockClear();

    await harness.update({
      enabled: true,
      selectedRepoPath: "/repo",
      runtimeKinds: ["opencode", "codex"],
    });
    await harness.waitFor((state) => state.getCatalogForRuntime("codex") !== null, 1000);

    expect(loadRepoRuntimeCatalog).toHaveBeenCalledTimes(1);
    expect(loadRepoRuntimeCatalog).toHaveBeenCalledWith("/repo", "codex");

    await harness.unmount();
  });

  test("keeps loading and errors scoped to the runtime that is pending or failed", async () => {
    const codexDeferred = createDeferred<AgentModelCatalog>();
    const loadRepoRuntimeCatalog = mock(async (_repoPath: string, runtimeKind: RuntimeKind) => {
      if (runtimeKind === "opencode") {
        return OPENCODE_CATALOG;
      }
      if (runtimeKind === "codex") {
        return codexDeferred.promise;
      }
      throw new Error(`Unexpected runtime kind: ${runtimeKind}`);
    });

    const loadingHarness = createHookHarness(
      {
        enabled: true,
        selectedRepoPath: "/repo",
        runtimeKinds: ["opencode", "codex"],
      },
      loadRepoRuntimeCatalog,
    );
    await loadingHarness.mount();
    await loadingHarness.waitFor(
      (state) =>
        state.getCatalogForRuntime("opencode") !== null &&
        state.isCatalogLoadingForRuntime("codex"),
      1000,
    );

    expect(loadingHarness.getLatest().isLoadingCatalog).toBe(true);
    expect(loadingHarness.getLatest().isCatalogLoadingForRuntime("opencode")).toBe(false);

    codexDeferred.resolve(CODEX_CATALOG);
    await loadingHarness.waitFor(
      (state) => state.isCatalogLoadingForRuntime("codex") === false,
      1000,
    );

    expect(loadingHarness.getLatest().getCatalogForRuntime("codex")).toEqual(CODEX_CATALOG);

    await loadingHarness.unmount();

    const failingLoadRepoRuntimeCatalog = mock(
      async (_repoPath: string, runtimeKind: RuntimeKind) => {
        if (runtimeKind === "opencode") {
          return OPENCODE_CATALOG;
        }
        throw new Error("codex failed");
      },
    );

    const errorHarness = createHookHarness(
      {
        enabled: true,
        selectedRepoPath: "/repo",
        runtimeKinds: ["opencode", "codex"],
      },
      failingLoadRepoRuntimeCatalog,
    );
    await errorHarness.mount();
    await errorHarness.waitFor(
      (state) => state.getCatalogErrorForRuntime("codex") === "codex failed",
      1000,
    );

    expect(errorHarness.getLatest().getCatalogForRuntime("opencode")).toEqual(OPENCODE_CATALOG);
    expect(errorHarness.getLatest().getCatalogErrorForRuntime("opencode")).toBeNull();
    expect(errorHarness.getLatest().getCatalogForRuntime("codex")).toBeNull();
    expect(errorHarness.getLatest().getCatalogErrorForRuntime("codex")).toBe("codex failed");

    await errorHarness.unmount();
  });
});

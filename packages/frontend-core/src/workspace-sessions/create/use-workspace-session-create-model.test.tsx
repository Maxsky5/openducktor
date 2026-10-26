import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import { DEFAULT_AGENT_RUNTIMES, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentRuntimeCatalog } from "@openducktor/core";
import type { PropsWithChildren, ReactElement } from "react";
import {
  RuntimeDefinitionsContext,
  type RuntimeDefinitionsContextValue,
} from "../../app-state/app-state-contexts";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { runtimeCatalogQueryKeys } from "../../queries/runtime-catalog";
import { HostRuntimeStatusContext } from "../../sessions/session-contexts";
import { createHookHarness } from "../../test-support/react-hook-harness";
import {
  createDeferred,
  createHostRuntimeStatusContextValue,
  createRuntimeCatalogFixture,
} from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { useWorkspaceSessionCreateModel } from "./use-workspace-session-create-model";

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

const runtimeRef = {
  repoPath: "/repo",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo",
};

const definitionsWith = (
  loadRepoRuntimeCatalog: RuntimeDefinitionsContextValue["loadRepoRuntimeCatalog"],
): RuntimeDefinitionsContextValue => ({
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
  loadRepoRuntimeCatalog,
  loadRepoRuntimeFileSearch: async () => [],
});

const renderCreateModel = (
  definitions: RuntimeDefinitionsContextValue,
  defaultSelection: Parameters<typeof useWorkspaceSessionCreateModel>[1],
  connection = createTestClientConnection(),
) => {
  const Wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <ClientConnectionProvider connection={connection}>
      <RuntimeDefinitionsContext value={definitions}>
        <HostRuntimeStatusContext value={createHostRuntimeStatusContextValue()}>
          {children}
        </HostRuntimeStatusContext>
      </RuntimeDefinitionsContext>
    </ClientConnectionProvider>
  );
  return createHookHarness(
    () => useWorkspaceSessionCreateModel("/repo", defaultSelection),
    undefined,
    {
      wrapper: Wrapper,
    },
  );
};

describe("useWorkspaceSessionCreateModel", () => {
  test("allows a model choice while a stale catalog refreshes", async () => {
    const runtimeCatalog = createRuntimeCatalogFixture({ models: catalog });
    const connection = createTestClientConnection();
    connection.queryClient.setQueryData(
      runtimeCatalogQueryKeys.catalog(runtimeRef),
      runtimeCatalog,
      {
        updatedAt: 0,
      },
    );
    const refresh = createDeferred<AgentRuntimeCatalog>();
    const loadRuntimeCatalog = mock(async () => refresh.promise);
    const harness = renderCreateModel(definitionsWith(loadRuntimeCatalog), null, connection);
    try {
      await harness.mount();
      await harness.waitFor(
        (state) =>
          loadRuntimeCatalog.mock.calls.length > 0 &&
          state.runtimes[0]?.resource.status === "ready",
      );
      expect(loadRuntimeCatalog).toHaveBeenCalledWith(runtimeRef);
      expect(harness.getLatest().isLoading).toBe(false);
      expect(harness.getLatest().changed).toBe(false);
      await harness.run((state) =>
        state.selectModel({ runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" }),
      );
      expect(harness.getLatest().selection?.modelId).toBe("gpt-5");
      expect(harness.getLatest().changed).toBe(true);
    } finally {
      refresh.resolve(runtimeCatalog);
      await harness.unmount();
    }
  });

  test("starts from the repository Default Model when its catalog is ready", async () => {
    const runtimeCatalog = createRuntimeCatalogFixture({ models: catalog });
    const harness = renderCreateModel(
      definitionsWith(async () => runtimeCatalog),
      { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
    );
    try {
      await harness.mount();
      await harness.waitFor((state) => state.selection?.modelId === "gpt-5");
      expect(harness.getLatest().selection).toEqual({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "low",
      });
      expect(harness.getLatest().changed).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("has no model when the Default Model runtime is unavailable", async () => {
    const harness = renderCreateModel(
      definitionsWith(async () => {
        throw new Error("Catalog load must not run for an unavailable runtime.");
      }),
      { runtimeKind: "claude", providerId: "openai", modelId: "gpt-5" },
    );
    try {
      await harness.mount();
      await harness.waitFor((state) => state.isLoading === false);
      expect(harness.getLatest().selection).toBeNull();
      expect(harness.getLatest().runtimeKind).toBeNull();
    } finally {
      await harness.unmount();
    }
  });
});

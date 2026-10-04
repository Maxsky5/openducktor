import { describe, expect, mock, test } from "bun:test";
import {
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import {
  HostRuntimeStatusContext,
  RuntimeDefinitionsContext,
  type RuntimeDefinitionsContextValue,
} from "@/state/app-state-contexts";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createHostRuntimeStatusContextValue,
  createHostRuntimeStatusFixture,
} from "@/test-utils/shared-test-fixtures";
import type { HostRuntimeStatusContextValue } from "@/types/state-slices";
import { useRuntimeReadiness } from "./use-runtime-readiness";

const createRuntimeDefinitionsValue = (
  runtimeDefinitions: RuntimeDescriptor[],
): RuntimeDefinitionsContextValue => ({
  runtimeDefinitions,
  availableRuntimeDefinitions: runtimeDefinitions,
  agentRuntimes: DEFAULT_AGENT_RUNTIMES,
  isLoadingRuntimeDefinitions: false,
  runtimeDefinitionsError: null,
  isLoadingRuntimeSettings: false,
  runtimeSettingsError: null,
  hasRuntimeSettingsSnapshot: true,
  refreshRuntimeSettings: async () => {},
  refreshRuntimeDefinitions: async () => runtimeDefinitions,
  loadRepoRuntimeCatalog: async () => {
    throw new Error("Catalog reads are not used in this test.");
  },
  loadRepoRuntimeFileSearch: async () => [],
});

const mountReadinessHook = async (runtimeStatus: HostRuntimeStatusContextValue) => {
  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      RuntimeDefinitionsContext.Provider,
      { value: createRuntimeDefinitionsValue([OPENCODE_RUNTIME_DESCRIPTOR]) },
      createElement(HostRuntimeStatusContext.Provider, { value: runtimeStatus }, children),
    );
  const harness = createSharedHookHarness(
    () => useRuntimeReadiness({ hasWorkspace: true }),
    undefined,
    { wrapper },
  );
  await harness.mount();
  return harness;
};

describe("useRuntimeReadiness", () => {
  test("derives readiness from the host runtime status owner", async () => {
    const harness = await mountReadinessHook(
      createHostRuntimeStatusContextValue({
        statusByKind: {
          opencode: createHostRuntimeStatusFixture({ kind: "opencode", state: "starting" }),
        },
        isRefreshing: true,
      }),
    );

    try {
      expect(harness.getLatest()).toMatchObject({
        state: "checking",
        message: "OpenCode runtime is starting. Wait until it is ready.",
        isLoadingChecks: true,
      });
    } finally {
      await harness.unmount();
    }
  });

  test("rechecks by reading host runtime status again", async () => {
    const refresh = mock(async () => {});
    const harness = await mountReadinessHook(createHostRuntimeStatusContextValue({ refresh }));

    try {
      await harness.getLatest().refreshChecks();
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });
});

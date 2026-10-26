import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import {
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type SettingsSnapshot,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import type { HostClient } from "@openducktor/host-client";
import { createHookHarness } from "../../test-support/react-hook-harness";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { createSettingsSnapshotFixture } from "../../test-support/shared-test-fixtures";
import { useRuntimeDefinitionsContext } from "../app-state-contexts";
import { settingsSnapshotQueryOptions } from "../../queries/workspace";
import { AppRuntimeProvider } from "./app-runtime-provider";

const createSettingsSnapshot = (): SettingsSnapshot =>
  createSettingsSnapshotFixture({
    agentRuntimes: {
      ...DEFAULT_AGENT_RUNTIMES,
      opencode: {
        defaults: { rules: [] },
        roleOverrides: {},
        enabled: true,
        executablePath: "/tools/opencode",
      },
    },
  });

const createWrapper = (client: Partial<HostClient>) => {
  const connection = createTestClientConnection({ client });
  return ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      ClientConnectionProvider,
      { connection },
      createElement(
        AppRuntimeProvider,
        {
          loadRepoRuntimeCatalog: async () => {
            throw new Error("catalog loader not configured");
          },
          loadRepoRuntimeFileSearch: async () => [],
        },
        children,
      ),
    );
};

describe("AppRuntimeProvider", () => {
  test("keeps settings snapshot failures separate from runtime definition errors", async () => {
    const runtimeDefinitionsList = mock(async () => [OPENCODE_RUNTIME_DESCRIPTOR]);
    const workspaceGetSettingsSnapshot = mock(async () => {
      throw new Error("settings unavailable");
    });
    const harness = createHookHarness(() => useRuntimeDefinitionsContext(), undefined, {
      wrapper: createWrapper({ runtimeDefinitionsList, workspaceGetSettingsSnapshot }),
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.runtimeSettingsError === "settings unavailable");

      const state = harness.getLatest();
      expect(state.runtimeDefinitionsError).toBeNull();
      expect(state.runtimeDefinitions).toEqual([OPENCODE_RUNTIME_DESCRIPTOR]);
      expect(state.availableRuntimeDefinitions).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });

  test("publishes available runtime definitions from runtime settings", async () => {
    const runtimeDefinitionsList = mock(async () => [OPENCODE_RUNTIME_DESCRIPTOR]);
    const workspaceGetSettingsSnapshot = mock(async () => createSettingsSnapshot());
    const harness = createHookHarness(() => useRuntimeDefinitionsContext(), undefined, {
      wrapper: createWrapper({ runtimeDefinitionsList, workspaceGetSettingsSnapshot }),
    });

    try {
      await harness.mount();
      await harness.waitFor((state) => state.availableRuntimeDefinitions.length === 1);

      expect(harness.getLatest().runtimeDefinitionsError).toBeNull();
      expect(harness.getLatest().availableRuntimeDefinitions).toEqual([
        OPENCODE_RUNTIME_DESCRIPTOR,
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps runtime availability stable when only the theme setting changes", async () => {
    const runtimeDefinitionsList = mock(async () => [OPENCODE_RUNTIME_DESCRIPTOR]);
    const workspaceGetSettingsSnapshot = mock(async () => createSettingsSnapshot());
    const harness = createHookHarness(
      () => ({
        queryClient: useQueryClient(),
        runtimeDefinitions: useRuntimeDefinitionsContext(),
      }),
      undefined,
      { wrapper: createWrapper({ runtimeDefinitionsList, workspaceGetSettingsSnapshot }) },
    );

    try {
      await harness.mount();
      await harness.waitFor(
        (state) => state.runtimeDefinitions.availableRuntimeDefinitions.length === 1,
      );

      const firstContext = harness.getLatest().runtimeDefinitions;
      const firstAvailableRuntimeDefinitions = firstContext.availableRuntimeDefinitions;

      await harness.run(({ queryClient }) => {
        queryClient.setQueryData(
          settingsSnapshotQueryOptions().queryKey,
          (current: SettingsSnapshot | undefined) => {
            if (!current) {
              throw new Error("Expected settings snapshot to be cached");
            }

            return {
              ...current,
              theme: "dark" as const,
            };
          },
        );
      });

      const nextContext = harness.getLatest().runtimeDefinitions;
      expect(nextContext).toBe(firstContext);
      expect(nextContext.availableRuntimeDefinitions).toBe(firstAvailableRuntimeDefinitions);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the runtime context while loaded settings refresh", async () => {
    const runtimeDefinitionsList = mock(async () => [OPENCODE_RUNTIME_DESCRIPTOR]);
    let finishRefresh: (snapshot: SettingsSnapshot) => void = () => {};
    const workspaceGetSettingsSnapshot = mock(async () => createSettingsSnapshot());
    const harness = createHookHarness(
      () => ({
        queryClient: useQueryClient(),
        runtimeDefinitions: useRuntimeDefinitionsContext(),
      }),
      undefined,
      { wrapper: createWrapper({ runtimeDefinitionsList, workspaceGetSettingsSnapshot }) },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.runtimeDefinitions.hasRuntimeSettingsSnapshot);
      const loaded = harness.getLatest().runtimeDefinitions;
      workspaceGetSettingsSnapshot.mockImplementationOnce(
        () =>
          new Promise<SettingsSnapshot>((resolve) => {
            finishRefresh = resolve;
          }),
      );

      // Query observers hear of the fetch in a later task.
      const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
      await harness.run(async ({ queryClient }) => {
        void queryClient.invalidateQueries({ queryKey: settingsSnapshotQueryOptions().queryKey });
        await nextTask();
      });
      expect(workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(2);
      expect(harness.getLatest().runtimeDefinitions).toBe(loaded);
      expect(loaded.isLoadingRuntimeSettings).toBe(false);

      await harness.run(async () => {
        finishRefresh(createSettingsSnapshot());
        await nextTask();
      });
      expect(harness.getLatest().runtimeDefinitions).toBe(loaded);
    } finally {
      await harness.unmount();
    }
  });
});

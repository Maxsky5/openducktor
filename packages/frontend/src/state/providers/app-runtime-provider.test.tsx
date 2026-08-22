import { describe, expect, mock, test } from "bun:test";
import {
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type SettingsSnapshot,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { useRuntimeDefinitionsContext } from "../app-state-contexts";
import { host } from "../operations/host";
import { settingsSnapshotQueryOptions } from "../queries/workspace";
import { AppRuntimeProvider } from "./app-runtime-provider";

const createSettingsSnapshot = (): SettingsSnapshot =>
  createSettingsSnapshotFixture({
    agentRuntimes: {
      ...DEFAULT_AGENT_RUNTIMES,
      opencode: { enabled: true, executablePath: "/tools/opencode" },
    },
  });

const createWrapper = ({ children }: PropsWithChildren): ReactElement =>
  createElement(
    QueryProvider,
    { useIsolatedClient: true },
    createElement(
      AppRuntimeProvider,
      {
        loadRepoRuntimeCatalog: async () => {
          throw new Error("catalog loader not configured");
        },
        loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
        loadRepoRuntimeSkills: async () => ({ skills: [] }),
        loadRepoRuntimeSubagents: async () => ({ subagents: [] }),
        loadRepoRuntimeFileSearch: async () => [],
      },
      children,
    ),
  );

describe("AppRuntimeProvider", () => {
  test("keeps settings snapshot failures separate from runtime definition errors", async () => {
    const originalRuntimeDefinitionsList = host.runtimeDefinitionsList;
    const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;
    // SAFETY: This test controls the fixture and supplies `never` used by this case.
    host.runtimeDefinitionsList = mock(async () => [OPENCODE_RUNTIME_DESCRIPTOR]) as never;
    // SAFETY: This test drives the failure path that supplies `never` before this assertion.
    host.workspaceGetSettingsSnapshot = mock(async () => {
      throw new Error("settings unavailable");
    }) as never;

    const harness = createHookHarness(() => useRuntimeDefinitionsContext(), undefined, {
      wrapper: createWrapper,
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
      host.runtimeDefinitionsList = originalRuntimeDefinitionsList;
      host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
    }
  });

  test("publishes available runtime definitions from runtime settings", async () => {
    const originalRuntimeDefinitionsList = host.runtimeDefinitionsList;
    const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;
    // SAFETY: This test controls the fixture and supplies `never` used by this case.
    host.runtimeDefinitionsList = mock(async () => [OPENCODE_RUNTIME_DESCRIPTOR]) as never;
    // SAFETY: This test controls the fixture and supplies `never` used by this case.
    host.workspaceGetSettingsSnapshot = mock(async () => createSettingsSnapshot()) as never;

    const harness = createHookHarness(() => useRuntimeDefinitionsContext(), undefined, {
      wrapper: createWrapper,
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
      host.runtimeDefinitionsList = originalRuntimeDefinitionsList;
      host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
    }
  });

  test("keeps runtime availability stable when only the theme setting changes", async () => {
    const originalRuntimeDefinitionsList = host.runtimeDefinitionsList;
    const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;
    // SAFETY: This test controls the fixture and supplies `never` used by this case.
    host.runtimeDefinitionsList = mock(async () => [OPENCODE_RUNTIME_DESCRIPTOR]) as never;
    // SAFETY: This test controls the fixture and supplies `never` used by this case.
    host.workspaceGetSettingsSnapshot = mock(async () => createSettingsSnapshot()) as never;

    const harness = createHookHarness(
      () => ({
        queryClient: useQueryClient(),
        runtimeDefinitions: useRuntimeDefinitionsContext(),
      }),
      undefined,
      { wrapper: createWrapper },
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
      host.runtimeDefinitionsList = originalRuntimeDefinitionsList;
      host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
    }
  });
});

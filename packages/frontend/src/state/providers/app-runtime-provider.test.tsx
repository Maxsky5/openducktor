import { describe, expect, mock, test } from "bun:test";
import {
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type SettingsSnapshot,
} from "@openducktor/contracts";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { useRuntimeDefinitionsContext } from "../app-state-contexts";
import { host } from "../operations/host";
import { AppRuntimeProvider } from "./app-runtime-provider";

const createSettingsSnapshot = (): SettingsSnapshot => ({
  theme: "light",
  git: {
    defaultMergeMethod: "merge_commit",
  },
  general: {
    openAgentStudioTabOnBackgroundSessionStart: true,
  },
  chat: {
    showThinkingMessages: false,
  },
  reusablePrompts: [],
  kanban: {
    doneVisibleDays: 1,
    emptyColumnDisplay: "show",
  },
  autopilot: {
    rules: [],
  },
  agentRuntimes: DEFAULT_AGENT_RUNTIMES,
  workspaces: {},
  globalPromptOverrides: {},
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
        loadRepoRuntimeFileSearch: async () => [],
      },
      children,
    ),
  );

describe("AppRuntimeProvider", () => {
  test("surfaces settings snapshot failures as runtime availability errors", async () => {
    const originalRuntimeDefinitionsList = host.runtimeDefinitionsList;
    const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;
    host.runtimeDefinitionsList = mock(async () => [OPENCODE_RUNTIME_DESCRIPTOR]) as never;
    host.workspaceGetSettingsSnapshot = mock(async () => {
      throw new Error("settings unavailable");
    }) as never;

    const harness = createHookHarness(() => useRuntimeDefinitionsContext(), undefined, {
      wrapper: createWrapper,
    });

    try {
      await harness.mount();
      await harness.waitFor(
        (state) =>
          state.runtimeDefinitionsError === "Failed to load runtime settings: settings unavailable",
      );

      const state = harness.getLatest();
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
    host.runtimeDefinitionsList = mock(async () => [OPENCODE_RUNTIME_DESCRIPTOR]) as never;
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
});

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import { createElement, type PropsWithChildren, type ReactElement } from "react";
import {
  ChecksStateContext,
  RuntimeDefinitionsContext,
  type RuntimeDefinitionsContextValue,
} from "@/state/app-state-contexts";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createRepoRuntimeHealthFixture,
  type RepoRuntimeHealthFixtureOverrides,
} from "@/test-utils/shared-test-fixtures";
import type { RepoRuntimeHealthCheck, RepoRuntimeHealthMap } from "@/types/diagnostics";
import type { ChecksStateContextValue } from "@/types/state-slices";
import { useRepoRuntimeReadiness } from "./use-repo-runtime-readiness";

const makeRepoHealth = (
  overrides: RepoRuntimeHealthFixtureOverrides = {},
): RepoRuntimeHealthCheck =>
  createRepoRuntimeHealthFixture({ checkedAt: "2026-02-20T12:01:00.000Z" }, overrides);

const createRuntimeDefinitionsValue = (
  runtimeDefinitions: RuntimeDescriptor[],
): RuntimeDefinitionsContextValue => ({
  runtimeDefinitions,
  availableRuntimeDefinitions: runtimeDefinitions,
  agentRuntimes: DEFAULT_AGENT_RUNTIMES,
  isLoadingRuntimeDefinitions: false,
  runtimeDefinitionsError: null,
  refreshRuntimeDefinitions: async () => runtimeDefinitions,
  loadRepoRuntimeCatalog: async () => ({
    runtime: runtimeDefinitions[0] ?? OPENCODE_RUNTIME_DESCRIPTOR,
    agents: [],
    models: [],
    defaultModelsByProvider: {},
  }),
  loadRepoRuntimeSlashCommands: async () => ({ commands: [] }),
  loadRepoRuntimeSkills: async () => ({ skills: [] }),
  loadRepoRuntimeFileSearch: async () => [],
});

const createChecksStateValue = (
  runtimeHealthByRuntime: RepoRuntimeHealthMap,
): ChecksStateContextValue => ({
  runtimeCheck: null,
  taskStoreCheck: null,
  runtimeCheckFailureKind: null,
  taskStoreCheckFailureKind: null,
  runtimeHealthByRuntime,
  isLoadingChecks: false,
  refreshChecks: async () => {},
});

type HookArgs = Parameters<typeof useRepoRuntimeReadiness>[0];

const mountReadinessHook = async ({
  args,
  runtimeDefinitions = [OPENCODE_RUNTIME_DESCRIPTOR],
  runtimeHealthByRuntime,
}: {
  args: HookArgs;
  runtimeDefinitions?: RuntimeDescriptor[];
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
}) => {
  const wrapper = ({ children }: PropsWithChildren): ReactElement =>
    createElement(
      RuntimeDefinitionsContext.Provider,
      { value: createRuntimeDefinitionsValue(runtimeDefinitions) },
      createElement(
        ChecksStateContext.Provider,
        { value: createChecksStateValue(runtimeHealthByRuntime) },
        children,
      ),
    );

  const harness = createSharedHookHarness(() => useRepoRuntimeReadiness(args), undefined, {
    wrapper,
  });
  await harness.mount();

  return {
    latest: () => harness.getLatest(),
    unmount: harness.unmount,
  };
};

describe("useRepoRuntimeReadiness", () => {
  test("derives readiness from runtime definitions and checks contexts", async () => {
    const harness = await mountReadinessHook({
      args: { hasWorkspace: true },
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "checking",
          runtime: {
            status: "ready",
            stage: "runtime_ready",
            observation: "observed_existing_runtime",
          },
          mcp: {
            supported: true,
            status: "checking",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: "Checking OpenDucktor MCP",
            failureKind: null,
          },
        }),
      },
    });

    try {
      expect(harness.latest().state).toBe("checking");
      expect(harness.latest().message).toContain("Checking OpenDucktor MCP");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps refresh action owned by checks context", async () => {
    let refreshCount = 0;
    const checksValue = {
      ...createChecksStateValue({
        opencode: makeRepoHealth(),
      }),
      refreshChecks: async () => {
        refreshCount += 1;
      },
    };
    const wrapper = ({ children }: PropsWithChildren): ReactElement =>
      createElement(
        RuntimeDefinitionsContext.Provider,
        { value: createRuntimeDefinitionsValue([OPENCODE_RUNTIME_DESCRIPTOR]) },
        createElement(ChecksStateContext.Provider, { value: checksValue }, children),
      );

    const harness = createSharedHookHarness(
      () => useRepoRuntimeReadiness({ hasWorkspace: true }),
      undefined,
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.getLatest().refreshChecks();
      expect(refreshCount).toBe(1);
    } finally {
      await harness.unmount();
    }
  });
});

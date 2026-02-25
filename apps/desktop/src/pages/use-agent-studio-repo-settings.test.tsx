import { describe, expect, mock, test } from "bun:test";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioRepoSettings } from "./use-agent-studio-repo-settings";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioRepoSettings>[0];

const createSettings = (): RepoSettingsInput => ({
  worktreeBasePath: "/worktrees",
  branchPrefix: "codex/",
  trustedHooks: false,
  preStartHooks: [],
  postCompleteHooks: [],
  agentDefaults: {
    spec: null,
    planner: null,
    build: null,
    qa: null,
  },
});

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioRepoSettings, initialProps);

describe("useAgentStudioRepoSettings", () => {
  test("loads repo settings when repository is active", async () => {
    const settings = createSettings();
    const loadRepoSettings = mock(async (): Promise<RepoSettingsInput> => settings);

    const harness = createHookHarness({
      activeRepo: "/repo",
      loadRepoSettings,
    });

    await harness.mount();

    expect(loadRepoSettings).toHaveBeenCalledTimes(1);
    expect(harness.getLatest().repoSettings).toEqual(settings);

    await harness.unmount();
  });

  test("resets settings when active repo becomes null", async () => {
    const settings = createSettings();
    const loadRepoSettings = mock(async (): Promise<RepoSettingsInput> => settings);

    const harness = createHookHarness({
      activeRepo: "/repo",
      loadRepoSettings,
    });

    await harness.mount();
    expect(harness.getLatest().repoSettings).toEqual(settings);

    await harness.update({ activeRepo: null, loadRepoSettings });
    expect(harness.getLatest().repoSettings).toBeNull();

    await harness.unmount();
  });
});

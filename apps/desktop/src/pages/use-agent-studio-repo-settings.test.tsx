import { describe, expect, mock, test } from "bun:test";
import type { RepoSettingsInput } from "@/types/state-slices";
import { type ReactElement, createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { useAgentStudioRepoSettings } from "./use-agent-studio-repo-settings";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

type HookArgs = Parameters<typeof useAgentStudioRepoSettings>[0];
type HookState = ReturnType<typeof useAgentStudioRepoSettings>;

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

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const createHookHarness = (initialProps: HookArgs) => {
  let latest: HookState | null = null;
  let currentProps = initialProps;

  const Harness = (props: HookArgs): ReactElement | null => {
    latest = useAgentStudioRepoSettings(props);
    return null;
  };

  let renderer: TestRenderer.ReactTestRenderer | null = null;

  const mount = async (): Promise<void> => {
    await act(async () => {
      renderer = TestRenderer.create(createElement(Harness, currentProps));
      await flush();
    });
  };

  const update = async (next: HookArgs): Promise<void> => {
    currentProps = next;
    await act(async () => {
      renderer?.update(createElement(Harness, currentProps));
      await flush();
    });
  };

  const getLatest = (): HookState => {
    if (!latest) {
      throw new Error("Hook state unavailable");
    }
    return latest;
  };

  const unmount = async (): Promise<void> => {
    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  };

  return { mount, update, getLatest, unmount };
};

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

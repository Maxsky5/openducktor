import { describe, expect, mock, test } from "bun:test";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  createDeferred,
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import {
  REPO_SETTINGS_UPDATED_EVENT,
  useAgentStudioRepoSettings,
} from "./use-agent-studio-repo-settings";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioRepoSettings>[0];

const createSettings = (): RepoSettingsInput => ({
  worktreeBasePath: "/worktrees",
  branchPrefix: "codex/",
  defaultTargetBranch: "main",
  trustedHooks: false,
  preStartHooks: [],
  postCompleteHooks: [],
  worktreeFileCopies: [],
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

  test("reloads settings when repo settings update event is dispatched", async () => {
    const globalWithWindow = globalThis as typeof globalThis & {
      window?: EventTarget;
    };
    const originalWindow = globalWithWindow.window;
    const eventWindow = new EventTarget();
    Object.defineProperty(globalWithWindow, "window", {
      configurable: true,
      value: eventWindow,
    });

    const firstSettings = createSettings();
    const secondSettings: RepoSettingsInput = {
      ...createSettings(),
      branchPrefix: "feature/",
    };

    let loadCount = 0;
    const loadRepoSettings = mock(async (): Promise<RepoSettingsInput> => {
      loadCount += 1;
      return loadCount === 1 ? firstSettings : secondSettings;
    });

    const harness = createHookHarness({
      activeRepo: "/repo",
      loadRepoSettings,
    });

    await harness.mount();
    expect(harness.getLatest().repoSettings).toEqual(firstSettings);

    await harness.run(() => {
      eventWindow.dispatchEvent(
        new CustomEvent(REPO_SETTINGS_UPDATED_EVENT, {
          detail: { repoPath: "/repo" },
        }),
      );
    });

    await harness.waitFor((state) => state.repoSettings?.branchPrefix === "feature/");
    expect(loadRepoSettings).toHaveBeenCalledTimes(2);
    expect(harness.getLatest().repoSettings).toEqual(secondSettings);

    await harness.unmount();

    if (typeof originalWindow === "undefined") {
      Reflect.deleteProperty(globalWithWindow, "window");
    } else {
      Object.defineProperty(globalWithWindow, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  test("keeps the latest event reload result when concurrent loads resolve out of order", async () => {
    const globalWithWindow = globalThis as typeof globalThis & {
      window?: EventTarget;
    };
    const originalWindow = globalWithWindow.window;
    const eventWindow = new EventTarget();
    Object.defineProperty(globalWithWindow, "window", {
      configurable: true,
      value: eventWindow,
    });

    const firstSettings = createSettings();
    const secondSettings: RepoSettingsInput = {
      ...createSettings(),
      branchPrefix: "feature/latest",
    };
    const firstLoad = createDeferred<RepoSettingsInput>();
    const secondLoad = createDeferred<RepoSettingsInput>();
    let loadCount = 0;
    const loadRepoSettings = mock((): Promise<RepoSettingsInput> => {
      loadCount += 1;
      return loadCount === 1 ? firstLoad.promise : secondLoad.promise;
    });

    const harness = createHookHarness({
      activeRepo: "/repo",
      loadRepoSettings,
    });

    try {
      await harness.mount();

      await harness.run(() => {
        eventWindow.dispatchEvent(
          new CustomEvent(REPO_SETTINGS_UPDATED_EVENT, {
            detail: { repoPath: "/repo" },
          }),
        );
      });

      await harness.run(async () => {
        secondLoad.resolve(secondSettings);
        await secondLoad.promise;
      });
      await harness.waitFor((state) => state.repoSettings?.branchPrefix === "feature/latest");

      await harness.run(async () => {
        firstLoad.resolve(firstSettings);
        await firstLoad.promise;
      });

      expect(loadRepoSettings).toHaveBeenCalledTimes(2);
      expect(harness.getLatest().repoSettings).toEqual(secondSettings);
    } finally {
      firstLoad.resolve(firstSettings);
      secondLoad.resolve(secondSettings);
      await harness.unmount();

      if (typeof originalWindow === "undefined") {
        Reflect.deleteProperty(globalWithWindow, "window");
      } else {
        Object.defineProperty(globalWithWindow, "window", {
          configurable: true,
          value: originalWindow,
        });
      }
    }
  });
});

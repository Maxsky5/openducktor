import { describe, expect, mock, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import {
  createDeferred,
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import {
  SETTINGS_SNAPSHOT_UPDATED_EVENT,
  useAgentStudioChatSettings,
} from "./use-agent-studio-chat-settings";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioChatSettings>[0];

const createSettingsSnapshot = (
  showThinkingMessages = false,
  includeChat = true,
): SettingsSnapshot =>
  ({
    git: {
      defaultMergeMethod: "merge_commit",
    },
    ...(includeChat ? { chat: { showThinkingMessages } } : {}),
    repos: {},
    globalPromptOverrides: {},
  }) as SettingsSnapshot;

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioChatSettings, initialProps);

describe("useAgentStudioChatSettings", () => {
  test("loads chat settings when a repository is active", async () => {
    const loadSettingsSnapshot = mock(
      async (): Promise<SettingsSnapshot> => createSettingsSnapshot(true),
    );
    const harness = createHookHarness({
      activeRepo: "/repo",
      loadSettingsSnapshot,
    });

    await harness.mount();

    expect(loadSettingsSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.getLatest().showThinkingMessages).toBe(true);

    await harness.unmount();
  });

  test("defaults to false when the loaded snapshot omits chat settings", async () => {
    const loadSettingsSnapshot = mock(
      async (): Promise<SettingsSnapshot> => createSettingsSnapshot(false, false),
    );
    const harness = createHookHarness({
      activeRepo: "/repo",
      loadSettingsSnapshot,
    });

    await harness.mount();

    expect(harness.getLatest().showThinkingMessages).toBe(false);
    expect(harness.getLatest().chatSettingsLoadError).toBeNull();

    await harness.unmount();
  });

  test("surfaces settings load failures instead of silently resetting chat visibility", async () => {
    const loadSettingsSnapshot = mock(async (): Promise<SettingsSnapshot> => {
      throw new Error("settings read failed");
    });
    const harness = createHookHarness({
      activeRepo: "/repo",
      loadSettingsSnapshot,
    });

    await harness.mount();

    await harness.waitFor((state) => state.chatSettingsLoadError !== null);
    expect(harness.getLatest().showThinkingMessages).toBe(false);
    expect(harness.getLatest().chatSettingsLoadError?.message).toContain("settings read failed");

    await harness.unmount();
  });

  test("resets to false when the active repo becomes unavailable", async () => {
    const loadSettingsSnapshot = mock(
      async (): Promise<SettingsSnapshot> => createSettingsSnapshot(true),
    );
    const harness = createHookHarness({
      activeRepo: "/repo",
      loadSettingsSnapshot,
    });

    await harness.mount();
    expect(harness.getLatest().showThinkingMessages).toBe(true);

    await harness.update({ activeRepo: null, loadSettingsSnapshot });

    expect(harness.getLatest().showThinkingMessages).toBe(false);

    await harness.unmount();
  });

  test("reloads chat settings when the settings snapshot update event is dispatched", async () => {
    const globalWithWindow = globalThis as typeof globalThis & {
      window?: EventTarget;
    };
    const originalWindow = globalWithWindow.window;
    const eventWindow = new EventTarget();
    Object.defineProperty(globalWithWindow, "window", {
      configurable: true,
      value: eventWindow,
    });

    let loadCount = 0;
    const loadSettingsSnapshot = mock(async (): Promise<SettingsSnapshot> => {
      loadCount += 1;
      return loadCount === 1 ? createSettingsSnapshot(false) : createSettingsSnapshot(true);
    });
    const harness = createHookHarness({
      activeRepo: "/repo",
      loadSettingsSnapshot,
    });

    try {
      await harness.mount();
      expect(harness.getLatest().showThinkingMessages).toBe(false);
      expect(harness.getLatest().chatSettingsLoadError).toBeNull();

      await harness.run(() => {
        eventWindow.dispatchEvent(new CustomEvent(SETTINGS_SNAPSHOT_UPDATED_EVENT));
      });

      await harness.waitFor((state) => state.showThinkingMessages === true);
      expect(loadSettingsSnapshot).toHaveBeenCalledTimes(2);
      expect(harness.getLatest().showThinkingMessages).toBe(true);
      expect(harness.getLatest().chatSettingsLoadError).toBeNull();
    } finally {
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

  test("keeps the latest reload result when concurrent loads resolve out of order", async () => {
    const globalWithWindow = globalThis as typeof globalThis & {
      window?: EventTarget;
    };
    const originalWindow = globalWithWindow.window;
    const eventWindow = new EventTarget();
    Object.defineProperty(globalWithWindow, "window", {
      configurable: true,
      value: eventWindow,
    });

    const firstLoad = createDeferred<SettingsSnapshot>();
    const secondLoad = createDeferred<SettingsSnapshot>();
    let loadCount = 0;
    const loadSettingsSnapshot = mock((): Promise<SettingsSnapshot> => {
      loadCount += 1;
      return loadCount === 1 ? firstLoad.promise : secondLoad.promise;
    });
    const harness = createHookHarness({
      activeRepo: "/repo",
      loadSettingsSnapshot,
    });

    try {
      await harness.mount();

      await harness.run(() => {
        eventWindow.dispatchEvent(new CustomEvent(SETTINGS_SNAPSHOT_UPDATED_EVENT));
      });

      await harness.run(async () => {
        secondLoad.resolve(createSettingsSnapshot(true));
        await secondLoad.promise;
      });
      await harness.waitFor((state) => state.showThinkingMessages === true);

      await harness.run(async () => {
        firstLoad.resolve(createSettingsSnapshot(false));
        await firstLoad.promise;
      });

      expect(loadSettingsSnapshot).toHaveBeenCalledTimes(2);
      expect(harness.getLatest().showThinkingMessages).toBe(true);
    } finally {
      firstLoad.resolve(createSettingsSnapshot(false));
      secondLoad.resolve(createSettingsSnapshot(true));
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

  test("keeps the previous visibility setting when a reload fails and clears the error after retry", async () => {
    const firstLoad = createDeferred<SettingsSnapshot>();
    const secondLoad = createDeferred<SettingsSnapshot>();
    let loadCount = 0;
    const loadSettingsSnapshot = mock((): Promise<SettingsSnapshot> => {
      loadCount += 1;
      if (loadCount === 1) {
        return firstLoad.promise;
      }
      if (loadCount === 2) {
        return Promise.reject(new Error("refresh failed"));
      }
      return secondLoad.promise;
    });
    const harness = createHookHarness({
      activeRepo: "/repo",
      loadSettingsSnapshot,
    });

    try {
      await harness.mount();
      await harness.run(async () => {
        firstLoad.resolve(createSettingsSnapshot(true));
        await firstLoad.promise;
      });
      expect(harness.getLatest().showThinkingMessages).toBe(true);

      await harness.run(() => {
        harness.getLatest().retryChatSettingsLoad();
      });

      await harness.waitFor((state) => state.chatSettingsLoadError !== null);
      expect(harness.getLatest().showThinkingMessages).toBe(true);
      expect(harness.getLatest().chatSettingsLoadError?.message).toContain("refresh failed");

      await harness.run(async () => {
        harness.getLatest().retryChatSettingsLoad();
        secondLoad.resolve(createSettingsSnapshot(false));
        await secondLoad.promise;
      });

      await harness.waitFor(
        (state) => state.showThinkingMessages === false && state.chatSettingsLoadError === null,
      );
      expect(loadSettingsSnapshot).toHaveBeenCalledTimes(3);
    } finally {
      firstLoad.resolve(createSettingsSnapshot(true));
      secondLoad.resolve(createSettingsSnapshot(false));
      await harness.unmount();
    }
  });
});

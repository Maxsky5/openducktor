import { describe, expect, mock, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

const hostMock = {
  workspaceGetSettingsSnapshot: mock(
    async (): Promise<SettingsSnapshot> => ({
      theme: "light",
      git: {
        defaultMergeMethod: "merge_commit",
      },
      chat: {
        showThinkingMessages: false,
      },
      kanban: {
        doneVisibleDays: 1,
      },
      autopilot: {
        rules: [],
      },
      repos: {},
      globalPromptOverrides: {},
    }),
  ),
};

mock.module("@/state/operations/host", () => ({
  host: hostMock,
}));

const { useAgentStudioChatSettings } = await import("./use-agent-studio-chat-settings");

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioChatSettings>[0];

const createSettingsSnapshot = (
  showThinkingMessages = false,
  includeChat = true,
): SettingsSnapshot =>
  ({
    theme: "light",
    git: {
      defaultMergeMethod: "merge_commit",
    },
    kanban: {
      doneVisibleDays: 1,
    },
    ...(includeChat ? { chat: { showThinkingMessages } } : {}),
    repos: {},
    globalPromptOverrides: {},
  }) as SettingsSnapshot;

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioChatSettings, initialProps);

describe("useAgentStudioChatSettings", () => {
  test("loads chat settings when a repository is active", async () => {
    hostMock.workspaceGetSettingsSnapshot.mockClear();
    hostMock.workspaceGetSettingsSnapshot.mockImplementation(
      async (): Promise<SettingsSnapshot> => createSettingsSnapshot(true),
    );

    const harness = createHookHarness({
      activeRepo: "/repo",
    });

    await harness.mount();
    await harness.waitFor((state) => state.showThinkingMessages === true);

    expect(hostMock.workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.getLatest().showThinkingMessages).toBe(true);

    await harness.unmount();
  });

  test("surfaces malformed snapshots that omit chat settings", async () => {
    hostMock.workspaceGetSettingsSnapshot.mockClear();
    hostMock.workspaceGetSettingsSnapshot.mockImplementation(
      async (): Promise<SettingsSnapshot> => createSettingsSnapshot(false, false),
    );

    const harness = createHookHarness({
      activeRepo: "/repo",
    });

    await harness.mount();

    await harness.waitFor((state) => state.chatSettingsLoadError !== null);
    expect(harness.getLatest().showThinkingMessages).toBe(false);
    expect(harness.getLatest().chatSettingsLoadError?.message).toMatch(
      /snapshot\.chat\.showThinkingMessages|undefined/,
    );

    await harness.unmount();
  });

  test("surfaces settings load failures and retries through the canonical query", async () => {
    hostMock.workspaceGetSettingsSnapshot.mockClear();
    let loadCount = 0;
    hostMock.workspaceGetSettingsSnapshot.mockImplementation(
      async (): Promise<SettingsSnapshot> => {
        loadCount += 1;
        if (loadCount === 1) {
          throw new Error("settings read failed");
        }

        return createSettingsSnapshot(true);
      },
    );

    const harness = createHookHarness({
      activeRepo: "/repo",
    });

    await harness.mount();
    await harness.waitFor((state) => state.chatSettingsLoadError !== null);
    expect(harness.getLatest().showThinkingMessages).toBe(false);
    expect(harness.getLatest().chatSettingsLoadError?.message).toContain("settings read failed");

    await harness.run((state) => {
      state.retryChatSettingsLoad();
    });

    await harness.waitFor((state) => state.showThinkingMessages === true);
    expect(hostMock.workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(2);
    expect(harness.getLatest().chatSettingsLoadError).toBeNull();

    await harness.unmount();
  });

  test("resets to false when the active repo becomes unavailable", async () => {
    hostMock.workspaceGetSettingsSnapshot.mockClear();
    hostMock.workspaceGetSettingsSnapshot.mockImplementation(
      async (): Promise<SettingsSnapshot> => createSettingsSnapshot(true),
    );

    const harness = createHookHarness({
      activeRepo: "/repo",
    });

    await harness.mount();
    await harness.waitFor((state) => state.showThinkingMessages === true);
    expect(harness.getLatest().showThinkingMessages).toBe(true);

    await harness.update({ activeRepo: null });

    expect(harness.getLatest().showThinkingMessages).toBe(false);

    await harness.unmount();
  });
});

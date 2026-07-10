import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { DEFAULT_CHAT_SETTINGS, type SettingsSnapshot } from "@openducktor/contracts";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

const actualHostOperationsModule = await import("@/state/operations/host");

const hostMock = {
  workspaceGetSettingsSnapshot: mock(
    async (): Promise<SettingsSnapshot> => createSettingsSnapshotFixture(),
  ),
};

let useAgentStudioChatSettings: typeof import("./use-agent-studio-chat-settings").useAgentStudioChatSettings;

beforeEach(async () => {
  mock.module("@/state/operations/host", () => ({
    host: hostMock,
  }));
  ({ useAgentStudioChatSettings } = await import("./use-agent-studio-chat-settings"));
});

afterEach(async () => {
  await restoreMockedModules([["@/state/operations/host", async () => actualHostOperationsModule]]);
});

enableReactActEnvironment();

type HookArgs = {
  workspaceRepoPath?: string | null;
};

const useChatSettingsHarness = (props: HookArgs) =>
  useAgentStudioChatSettings({
    workspaceRepoPath: props.workspaceRepoPath ?? null,
  });

const createSettingsSnapshot = ({
  showThinkingMessages = false,
  expandFileDiffsByDefault = true,
  includeExpandFileDiffsByDefault = true,
  includeChat = true,
  chatOverrides = {},
}: {
  showThinkingMessages?: boolean;
  expandFileDiffsByDefault?: boolean;
  includeExpandFileDiffsByDefault?: boolean;
  includeChat?: boolean;
  chatOverrides?: Record<string, unknown>;
} = {}): SettingsSnapshot => {
  const snapshot = createSettingsSnapshotFixture({
    reusablePrompts: [
      {
        id: "prompt-1",
        name: "review",
        description: "Review context",
        content: "Review this.",
      },
    ],
  }) as Omit<SettingsSnapshot, "chat"> & { chat?: unknown };

  if (includeChat) {
    snapshot.chat = {
      showThinkingMessages,
      ...(includeExpandFileDiffsByDefault ? { expandFileDiffsByDefault } : {}),
      ...chatOverrides,
    };
  } else {
    delete snapshot.chat;
  }

  return snapshot as SettingsSnapshot;
};

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useChatSettingsHarness, initialProps, {
    seedSettingsSnapshot: false,
  });

describe("useAgentStudioChatSettings", () => {
  test("loads chat settings when a repository is active", async () => {
    hostMock.workspaceGetSettingsSnapshot.mockClear();
    hostMock.workspaceGetSettingsSnapshot.mockImplementation(
      async (): Promise<SettingsSnapshot> => createSettingsSnapshot({ showThinkingMessages: true }),
    );

    const harness = createHookHarness({
      workspaceRepoPath: "/repo",
    });

    await harness.mount();
    await harness.waitFor((state) => state.chatSettings.showThinkingMessages === true);

    expect(hostMock.workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.getLatest().chatSettings.showThinkingMessages).toBe(true);
    expect(harness.getLatest().chatSettings.expandFileDiffsByDefault).toBe(true);
    expect(harness.getLatest().chatSettings.diffStyle).toBe("split");
    expect(harness.getLatest().chatSettings.diffIndicators).toBe("bars");
    expect(harness.getLatest().chatSettings.diffHeight).toBe("full");
    expect(harness.getLatest().chatSettings.lineOverflow).toBe("wrap");
    expect(harness.getLatest().chatSettings.hunkSeparators).toBe("line-info");
    expect(harness.getLatest().reusablePrompts).toEqual([
      {
        id: "prompt-1",
        name: "review",
        description: "Review context",
        content: "Review this.",
      },
    ]);

    await harness.unmount();
  });

  test("defaults file diff expansion for older chat snapshots", async () => {
    hostMock.workspaceGetSettingsSnapshot.mockClear();
    hostMock.workspaceGetSettingsSnapshot.mockImplementation(
      async (): Promise<SettingsSnapshot> =>
        createSettingsSnapshot({ includeExpandFileDiffsByDefault: false }),
    );

    const harness = createHookHarness({
      workspaceRepoPath: "/repo",
    });

    await harness.mount();
    await harness.waitFor((state) => state.reusablePrompts.length === 1);

    expect(harness.getLatest().chatSettings.showThinkingMessages).toBe(false);
    expect(harness.getLatest().chatSettings.expandFileDiffsByDefault).toBe(true);
    expect(harness.getLatest().chatSettings.diffStyle).toBe("split");
    expect(harness.getLatest().chatSettings.diffIndicators).toBe("bars");
    expect(harness.getLatest().chatSettings.diffHeight).toBe("full");
    expect(harness.getLatest().chatSettings.lineOverflow).toBe("wrap");
    expect(harness.getLatest().chatSettings.hunkSeparators).toBe("line-info");

    await harness.unmount();
  });

  test("loads explicit collapsed file diff setting", async () => {
    hostMock.workspaceGetSettingsSnapshot.mockClear();
    hostMock.workspaceGetSettingsSnapshot.mockImplementation(
      async (): Promise<SettingsSnapshot> =>
        createSettingsSnapshot({ expandFileDiffsByDefault: false }),
    );

    const harness = createHookHarness({
      workspaceRepoPath: "/repo",
    });

    await harness.mount();
    await harness.waitFor((state) => state.reusablePrompts.length === 1);

    expect(harness.getLatest().chatSettings.expandFileDiffsByDefault).toBe(false);

    await harness.unmount();
  });

  test("loads explicit transcript diff display settings", async () => {
    hostMock.workspaceGetSettingsSnapshot.mockClear();
    hostMock.workspaceGetSettingsSnapshot.mockImplementation(
      async (): Promise<SettingsSnapshot> =>
        createSettingsSnapshot({
          chatOverrides: {
            diffStyle: "unified",
            diffIndicators: "none",
            diffHeight: "scroll",
            lineOverflow: "scroll",
            hunkSeparators: "simple",
          },
        }),
    );

    const harness = createHookHarness({
      workspaceRepoPath: "/repo",
    });

    await harness.mount();
    await harness.waitFor((state) => state.reusablePrompts.length === 1);

    expect(harness.getLatest().chatSettings).toMatchObject({
      diffStyle: "unified",
      diffIndicators: "none",
      diffHeight: "scroll",
      lineOverflow: "scroll",
      hunkSeparators: "simple",
    });

    await harness.unmount();
  });

  test("surfaces malformed snapshots that omit chat settings", async () => {
    hostMock.workspaceGetSettingsSnapshot.mockClear();
    hostMock.workspaceGetSettingsSnapshot.mockImplementation(
      async (): Promise<SettingsSnapshot> => createSettingsSnapshot({ includeChat: false }),
    );

    const harness = createHookHarness({
      workspaceRepoPath: "/repo",
    });

    await harness.mount();

    await harness.waitFor((state) => state.chatSettingsLoadError !== null);
    expect(harness.getLatest().chatSettings.showThinkingMessages).toBe(false);
    expect(harness.getLatest().chatSettings.expandFileDiffsByDefault).toBe(true);
    expect(harness.getLatest().chatSettings.diffHeight).toBe("full");
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

        return createSettingsSnapshot({ showThinkingMessages: true });
      },
    );

    const harness = createHookHarness({
      workspaceRepoPath: "/repo",
    });

    await harness.mount();
    await harness.waitFor((state) => state.chatSettingsLoadError !== null);
    expect(harness.getLatest().chatSettings.showThinkingMessages).toBe(false);
    expect(harness.getLatest().chatSettings.expandFileDiffsByDefault).toBe(true);
    expect(harness.getLatest().chatSettingsLoadError?.message).toContain("settings read failed");

    await harness.run((state) => {
      state.retryChatSettingsLoad();
    });

    await harness.waitFor((state) => state.chatSettings.showThinkingMessages === true);
    expect(hostMock.workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(2);
    expect(harness.getLatest().chatSettingsLoadError).toBeNull();

    await harness.unmount();
  });

  test("resets to false when the active repo becomes unavailable", async () => {
    hostMock.workspaceGetSettingsSnapshot.mockClear();
    hostMock.workspaceGetSettingsSnapshot.mockImplementation(
      async (): Promise<SettingsSnapshot> => createSettingsSnapshot({ showThinkingMessages: true }),
    );

    const harness = createHookHarness({
      workspaceRepoPath: "/repo",
    });

    await harness.mount();
    await harness.waitFor((state) => state.chatSettings.showThinkingMessages === true);
    expect(harness.getLatest().chatSettings).toEqual({
      ...DEFAULT_CHAT_SETTINGS,
      showThinkingMessages: true,
    });

    await harness.update({ workspaceRepoPath: null });

    expect(harness.getLatest().chatSettings).toEqual(DEFAULT_CHAT_SETTINGS);
    expect(harness.getLatest().reusablePrompts).toEqual([]);

    await harness.unmount();
  });
});

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type { ActiveWorkspace } from "@/types/state-slices";
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

type LegacyHookArgs = {
  activeWorkspace?: ActiveWorkspace | null;
  workspaceRepoPath?: string | null;
};

const createActiveWorkspace = (repoPath: string): ActiveWorkspace => ({
  workspaceId: repoPath.replace(/^\//, "").replaceAll("/", "-"),
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
});

const resolveActiveWorkspace = (props: LegacyHookArgs): ActiveWorkspace | null => {
  if ("workspaceRepoPath" in props) {
    return props.workspaceRepoPath ? createActiveWorkspace(props.workspaceRepoPath) : null;
  }

  return props.activeWorkspace ?? null;
};

const useChatSettingsHarness = (props: LegacyHookArgs) =>
  useAgentStudioChatSettings({
    activeWorkspace: resolveActiveWorkspace(props),
  });

const createSettingsSnapshot = (
  showThinkingMessages = false,
  expandFileDiffsByDefault: boolean | undefined = true,
  includeChat = true,
): SettingsSnapshot => {
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
      ...(typeof expandFileDiffsByDefault === "boolean" ? { expandFileDiffsByDefault } : {}),
    };
  } else {
    delete snapshot.chat;
  }

  return snapshot as SettingsSnapshot;
};

const createHookHarness = (initialProps: LegacyHookArgs) =>
  createSharedHookHarness(useChatSettingsHarness, initialProps);

describe("useAgentStudioChatSettings", () => {
  test("loads chat settings when a repository is active", async () => {
    hostMock.workspaceGetSettingsSnapshot.mockClear();
    hostMock.workspaceGetSettingsSnapshot.mockImplementation(
      async (): Promise<SettingsSnapshot> => createSettingsSnapshot(true),
    );

    const harness = createHookHarness({
      workspaceRepoPath: "/repo",
    });

    await harness.mount();
    await harness.waitFor((state) => state.chatSettings.showThinkingMessages === true);

    expect(hostMock.workspaceGetSettingsSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.getLatest().chatSettings.showThinkingMessages).toBe(true);
    expect(harness.getLatest().chatSettings.expandFileDiffsByDefault).toBe(true);
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
      async (): Promise<SettingsSnapshot> => createSettingsSnapshot(false, undefined),
    );

    const harness = createHookHarness({
      workspaceRepoPath: "/repo",
    });

    await harness.mount();
    await harness.waitFor((state) => state.reusablePrompts.length === 1);

    expect(harness.getLatest().chatSettings.showThinkingMessages).toBe(false);
    expect(harness.getLatest().chatSettings.expandFileDiffsByDefault).toBe(true);

    await harness.unmount();
  });

  test("loads explicit collapsed file diff setting", async () => {
    hostMock.workspaceGetSettingsSnapshot.mockClear();
    hostMock.workspaceGetSettingsSnapshot.mockImplementation(
      async (): Promise<SettingsSnapshot> => createSettingsSnapshot(false, false),
    );

    const harness = createHookHarness({
      workspaceRepoPath: "/repo",
    });

    await harness.mount();
    await harness.waitFor((state) => state.reusablePrompts.length === 1);

    expect(harness.getLatest().chatSettings.expandFileDiffsByDefault).toBe(false);

    await harness.unmount();
  });

  test("surfaces malformed snapshots that omit chat settings", async () => {
    hostMock.workspaceGetSettingsSnapshot.mockClear();
    hostMock.workspaceGetSettingsSnapshot.mockImplementation(
      async (): Promise<SettingsSnapshot> => createSettingsSnapshot(false, true, false),
    );

    const harness = createHookHarness({
      workspaceRepoPath: "/repo",
    });

    await harness.mount();

    await harness.waitFor((state) => state.chatSettingsLoadError !== null);
    expect(harness.getLatest().chatSettings.showThinkingMessages).toBe(false);
    expect(harness.getLatest().chatSettings.expandFileDiffsByDefault).toBe(true);
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
      async (): Promise<SettingsSnapshot> => createSettingsSnapshot(true),
    );

    const harness = createHookHarness({
      workspaceRepoPath: "/repo",
    });

    await harness.mount();
    await harness.waitFor((state) => state.chatSettings.showThinkingMessages === true);
    expect(harness.getLatest().chatSettings.showThinkingMessages).toBe(true);
    expect(harness.getLatest().chatSettings.expandFileDiffsByDefault).toBe(true);

    await harness.update({ workspaceRepoPath: null });

    expect(harness.getLatest().chatSettings.showThinkingMessages).toBe(false);
    expect(harness.getLatest().chatSettings.expandFileDiffsByDefault).toBe(true);
    expect(harness.getLatest().reusablePrompts).toEqual([]);

    await harness.unmount();
  });
});

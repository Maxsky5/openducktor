import { describe, expect, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { useSettingsModalDirtyState } from "./use-settings-modal-dirty-state";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useSettingsModalDirtyState>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useSettingsModalDirtyState, initialProps);

const createSnapshot = (): SettingsSnapshot => ({
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
  globalPromptOverrides: {},
  workspaces: {},
});

describe("useSettingsModalDirtyState", () => {
  test("marks sections dirty and resets when the modal closes", async () => {
    const harness = createHookHarness({
      open: true,
      loadedSnapshot: createSnapshot(),
    });

    await harness.mount();

    await harness.run((state) => {
      state.markDirty("repoSettings");
      state.markDirty("repoSettings");
      state.markDirty("chat");
    });

    expect(harness.getLatest().dirtySections).toEqual({
      chat: true,
      globalGit: false,
      kanban: false,
      autopilot: false,
      globalPromptOverrides: false,
      repoSettings: true,
    });

    await harness.update({
      open: false,
      loadedSnapshot: createSnapshot(),
    });

    expect(harness.getLatest().dirtySections).toEqual({
      chat: false,
      globalGit: false,
      kanban: false,
      autopilot: false,
      globalPromptOverrides: false,
      repoSettings: false,
    });

    await harness.unmount();
  });

  test("resets dirty sections when a fresh snapshot loads while open", async () => {
    const harness = createHookHarness({
      open: true,
      loadedSnapshot: createSnapshot(),
    });

    await harness.mount();

    await harness.run((state) => {
      state.markDirty("globalGit");
    });

    expect(harness.getLatest().dirtySections.globalGit).toBe(true);

    await harness.update({
      open: true,
      loadedSnapshot: {
        ...createSnapshot(),
        chat: {
          showThinkingMessages: true,
        },
      },
    });

    expect(harness.getLatest().dirtySections.globalGit).toBe(false);

    await harness.unmount();
  });
});

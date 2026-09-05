import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  DEFAULT_AGENT_RUNTIMES,
  NOTIFICATION_KIND_VALUES,
  type SettingsSnapshotSaveInput,
} from "@openducktor/contracts";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { host } from "@/state/operations/host";
import { createDeferred } from "@/test-utils/shared-test-fixtures";
import {
  createCheck,
  createOnboardingTestHarness,
  enterRuntimeStage,
} from "./onboarding-page.test-support";

const { cleanup, renderOnboarding } = createOnboardingTestHarness();
afterEach(cleanup);

const runtimes = {
  ...DEFAULT_AGENT_RUNTIMES,
  opencode: { enabled: true, executablePath: "/valid/opencode" },
};

const enterNotificationsStage = async (): Promise<void> => {
  await enterRuntimeStage();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Continue to notifications" }));
  });
  await screen.findByRole("heading", { name: "Configure notifications" });
};

describe("onboarding notifications", () => {
  test("shows the complete notification settings without a duplicate Skip action", async () => {
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async () => createCheck(runtimes, true));

    try {
      renderOnboarding({ runtimes });
      await enterNotificationsStage();

      expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
      expect(screen.getAllByRole("switch", { name: /^Enable / })).toHaveLength(
        NOTIFICATION_KIND_VALUES.length,
      );
      expect(screen.getByRole("slider", { name: "Volume" })).toBeTruthy();
      expect(
        screen.getByRole("radiogroup", { name: "Delivery for Permission Prompt" }),
      ).toBeTruthy();
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("saves notification changes before opening the workspace step", async () => {
    const saveSettingsSnapshot = mock(async (_snapshot: SettingsSnapshotSaveInput) => {});
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async () => createCheck(runtimes, true));

    try {
      renderOnboarding({ runtimes, saveSettingsSnapshot });
      await enterNotificationsStage();
      await waitFor(() => expect(saveSettingsSnapshot).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByRole("switch", { name: "Enable Agent Session Idle" }));
      fireEvent.click(screen.getByRole("button", { name: "Continue to workspace" }));

      await screen.findByRole("heading", { name: "Open your first workspace" });
      expect(saveSettingsSnapshot).toHaveBeenCalledTimes(2);
      const savedSnapshot = saveSettingsSnapshot.mock.calls[1]?.[0];
      expect(savedSnapshot?.notifications.kinds["agent.session_idle"].enabled).toBe(true);
      expect(savedSnapshot?.agentRuntimes).toEqual(runtimes);
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("keeps notification settings open after a save failure and supports retry", async () => {
    let saveCalls = 0;
    const saveSettingsSnapshot = mock(async () => {
      saveCalls += 1;
      if (saveCalls === 2) throw new Error("Notification settings write failed");
    });
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async () => createCheck(runtimes, true));

    try {
      renderOnboarding({ runtimes, saveSettingsSnapshot });
      await enterNotificationsStage();
      fireEvent.click(screen.getByRole("switch", { name: "Enable Agent Session Idle" }));
      fireEvent.click(screen.getByRole("button", { name: "Continue to workspace" }));

      const saveError = await screen.findByText("Notification settings write failed");
      expect(screen.getByRole("heading", { name: "Configure notifications" })).toBeTruthy();
      expect(document.activeElement).toBe(saveError);

      fireEvent.click(screen.getByRole("button", { name: "Continue to workspace" }));
      await screen.findByRole("heading", { name: "Open your first workspace" });
      expect(saveSettingsSnapshot).toHaveBeenCalledTimes(3);
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });

  test("blocks duplicate notification saves while the first save is pending", async () => {
    const pendingSave = createDeferred<void>();
    let saveCalls = 0;
    const saveSettingsSnapshot = mock(async (_snapshot: SettingsSnapshotSaveInput) => {
      saveCalls += 1;
      if (saveCalls === 2) await pendingSave.promise;
    });
    const originalCheck = host.runtimeExecutablesCheck;
    host.runtimeExecutablesCheck = mock(async () => createCheck(runtimes, true));

    try {
      renderOnboarding({ runtimes, saveSettingsSnapshot });
      await enterNotificationsStage();
      fireEvent.click(screen.getByRole("switch", { name: "Enable Agent Session Idle" }));

      const continueButton = screen.getByRole("button", { name: "Continue to workspace" });
      fireEvent.click(continueButton);
      fireEvent.click(continueButton);
      await waitFor(() => expect(saveSettingsSnapshot).toHaveBeenCalledTimes(2));

      expect(screen.getByText("Saving notifications...", { selector: "span" })).toBeTruthy();
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Saving notifications..." }).disabled,
      ).toBe(true);
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Back" }).disabled).toBe(true);

      await act(async () => pendingSave.resolve());
      await screen.findByRole("heading", { name: "Open your first workspace" });
      expect(saveSettingsSnapshot).toHaveBeenCalledTimes(2);
    } finally {
      host.runtimeExecutablesCheck = originalCheck;
    }
  });
});

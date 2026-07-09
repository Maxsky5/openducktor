import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createFakeAppUpdateBridge, createTestShellBridge } from "./app-update-test-utils";
import { SettingsAppUpdatesSection } from "./settings-app-updates-section";

afterEach(() => {
  configureShellBridge(createUnavailableShellBridge());
});

describe("SettingsAppUpdatesSection", () => {
  test("runs manual checks through the shell bridge and shows up-to-date feedback", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "idle",
      currentVersion: "0.4.2",
    });
    appUpdates.check.mockResolvedValue({
      accepted: true,
      state: {
        status: "upToDate",
        currentVersion: "0.4.2",
        checkInitiator: "settings",
        checkedAt: "2026-07-08T22:00:00.000Z",
      },
    });
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<SettingsAppUpdatesSection disabled={false} />);

    fireEvent.click(await screen.findByRole("button", { name: "Check for Updates" }));

    await waitFor(() => expect(appUpdates.check).toHaveBeenCalledWith({ initiator: "settings" }));
    expect(await screen.findByText("OpenDucktor is up to date")).toBeTruthy();
  });

  test("shows disabled state with an actionable reason", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "disabled",
      currentVersion: "0.4.2",
      disabledCode: "not_packaged",
      disabledReason: "Updates are available only in packaged desktop builds.",
    });
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<SettingsAppUpdatesSection disabled={false} />);

    expect(await screen.findByText("Updates unavailable")).toBeTruthy();
    expect(screen.getByText("Updates are available only in packaged desktop builds.")).toBeTruthy();
  });

  test("shows download progress and restart action states", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "downloading",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      progressPercent: 67,
    });
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<SettingsAppUpdatesSection disabled={false} />);

    expect(await screen.findByText("67% downloaded")).toBeTruthy();
    expect(
      screen
        .getByRole("progressbar", { name: "Update download progress" })
        .getAttribute("aria-valuetext"),
    ).toBe("67% downloaded");

    act(() => {
      appUpdates.emit({
        status: "downloaded",
        currentVersion: "0.4.2",
        availableVersion: "0.4.3",
        progressPercent: 100,
      });
    });

    expect(await screen.findByRole("button", { name: "Restart to Install" })).toBeTruthy();
  });

  test("shows installer handoff and suppresses update actions", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "downloaded",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      progressPercent: 100,
      installRequested: true,
    });
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<SettingsAppUpdatesSection disabled={false} />);

    expect(await screen.findByText("Installing update")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restart to Install" })).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Check for Updates" }).disabled,
    ).toBe(true);
  });
});

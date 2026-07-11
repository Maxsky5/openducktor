import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createFakeAppUpdateBridge, createTestShellBridge } from "./app-update-test-utils";
import { SettingsAppUpdatesSection } from "./settings-app-updates-section";

afterEach(() => {
  configureShellBridge(createUnavailableShellBridge());
});

const longUpdateError =
  "OpenDucktor could not read latest-mac.yml for release v0.4.3. Make sure the GitHub release is published and includes the Electron updater metadata asset, then try again. https://github.com/Maxsky5/openducktor/releases/download/v0.4.3/latest-mac.yml x-github-request-id-4BDD-2F6204-154326FB-1101F3BB-6A501D61";

describe("SettingsAppUpdatesSection", () => {
  test("shows an explicit loading status before the initial shell state resolves", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "idle",
      currentVersion: "0.4.2",
    });
    let resolveInitialState: (state: Awaited<ReturnType<typeof appUpdates.getState>>) => void =
      () => {};
    appUpdates.getState.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInitialState = resolve;
        }),
    );
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<SettingsAppUpdatesSection disabled={false} />);

    expect(await screen.findByText("Loading update status")).toBeTruthy();
    expect(screen.getByText("Reading desktop update status from the shell.")).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Check for Updates" }).disabled,
    ).toBe(true);
    expect(screen.queryByText("Current version")).toBeNull();

    act(() => {
      resolveInitialState({
        status: "idle",
        currentVersion: "0.4.2",
      });
    });

    expect(await screen.findByText("Updates ready")).toBeTruthy();
    expect(screen.getByText("Current version")).toBeTruthy();
  });

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

  test("keeps long update errors in a single bounded panel", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "error",
      currentVersion: "0.4.2",
      checkInitiator: "settings",
      checkedAt: "2026-07-08T22:00:00.000Z",
      error: {
        code: "check_failed",
        message: longUpdateError,
        operation: "check",
      },
    });
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<SettingsAppUpdatesSection disabled={false} />);

    expect(await screen.findByText("Update error")).toBeTruthy();
    expect(screen.getByText("OpenDucktor could not complete the update check.")).toBeTruthy();
    const errorMessages = screen.getAllByText(longUpdateError);
    expect(errorMessages).toHaveLength(1);
    const [errorMessage] = errorMessages;
    expect(errorMessage).toBeTruthy();
    if (!errorMessage) return;
    expect(errorMessage.className).toContain("max-h-40");
    expect(errorMessage.className).toContain("overflow-y-auto");
    expect(errorMessage.className).toContain("break-words");
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

  test("shows terminal install failures without offering restart again", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "downloaded",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      progressPercent: 100,
      installRetryDisabled: true,
      error: {
        code: "install_failed",
        message: "Quit and reopen OpenDucktor before trying again.",
        operation: "install",
      },
    });
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<SettingsAppUpdatesSection disabled={false} />);

    expect(await screen.findByText("Relaunch required")).toBeTruthy();
    expect(screen.getByText("Quit and reopen OpenDucktor before trying again.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restart to Install" })).toBeNull();
  });
});

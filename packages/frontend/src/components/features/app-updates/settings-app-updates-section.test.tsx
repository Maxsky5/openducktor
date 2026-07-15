import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { AppUpdatePrompt } from "./app-update-prompt";
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
    expect(screen.getByText("Reading update status.")).toBeTruthy();
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

  test("shows manual check transport failures", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "idle",
      currentVersion: "0.4.2",
    });
    appUpdates.check.mockImplementation(async () => {
      throw new Error("bridge check failed");
    });
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<SettingsAppUpdatesSection disabled={false} />);

    fireEvent.click(await screen.findByRole("button", { name: "Check for Updates" }));

    const error = await screen.findByRole("alert");
    expect(error.textContent).toBe("bridge check failed");
    expect(error.className).toContain("border-destructive/30");
  });

  test("shows development mode without offering an update check", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "disabled",
      currentVersion: "0.4.2",
      disabledCode: "not_packaged",
      disabledReason: "Updates are available only in packaged desktop builds.",
    });
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<SettingsAppUpdatesSection disabled={false} />);

    expect(await screen.findByText("Development build")).toBeTruthy();
    expect(
      screen.getByText("Automatic updates are disabled while running OpenDucktor in development."),
    ).toBeTruthy();
    expect(screen.getByText("0.4.2")).toBeTruthy();
    expect(screen.queryByText("Available version")).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Check for Updates" }).disabled,
    ).toBe(true);
  });

  test("keeps detailed update errors in the notification", async () => {
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
    expect(screen.queryByText(longUpdateError)).toBeNull();
  });

  test("keeps download and install workflow controls in the notification", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "downloading",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      progressPercent: 67,
    });
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<SettingsAppUpdatesSection disabled={false} />);

    expect(await screen.findByText("Downloading update")).toBeTruthy();
    expect(screen.queryByRole("progressbar", { name: "Update download progress" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download Update" })).toBeNull();

    act(() => {
      appUpdates.emit({
        status: "downloaded",
        currentVersion: "0.4.2",
        availableVersion: "0.4.3",
        progressPercent: 100,
      });
    });

    await screen.findByText("Ready to install");
    expect(screen.queryByRole("button", { name: "Restart to Install" })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Check for Updates" }).disabled,
    ).toBe(false);
  });

  test("resurfaces a dismissed downloaded update through the Settings check", async () => {
    const downloadedState = {
      status: "downloaded" as const,
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      progressPercent: 100,
    };
    const availableState = {
      status: "available" as const,
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      checkInitiator: "settings" as const,
      checkedAt: "2026-07-08T22:00:00.000Z",
    };
    const appUpdates = createFakeAppUpdateBridge(downloadedState);
    appUpdates.check.mockImplementation(async () => {
      appUpdates.emit({
        status: "checking",
        currentVersion: "0.4.2",
        checkInitiator: "settings",
      });
      appUpdates.emit(availableState);
      return { accepted: true, state: availableState };
    });
    configureShellBridge(createTestShellBridge(appUpdates));
    render(
      <>
        <AppUpdatePrompt />
        <SettingsAppUpdatesSection disabled={false} />
      </>,
    );

    expect(await screen.findByRole("button", { name: "Restart to Install" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Dismiss update prompt"));
    expect(screen.queryByRole("button", { name: "Restart to Install" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Check for Updates" }));

    await waitFor(() => expect(appUpdates.check).toHaveBeenCalledWith({ initiator: "settings" }));
    expect(await screen.findByRole("button", { name: "Download Update" })).toBeTruthy();
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

    expect(await screen.findByText("Install needs attention")).toBeTruthy();
    expect(screen.queryByText("Quit and reopen OpenDucktor before trying again.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Restart to Install" })).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Check for Updates" }).disabled,
    ).toBe(true);
  });

  test("shows manual signed-release guidance for incompatible app signatures", async () => {
    const recoveryMessage =
      "This installation cannot verify the signed update because it was installed without a compatible macOS signature. Download and install the latest signed release manually. Automatic updates will work after that.";
    const appUpdates = createFakeAppUpdateBridge({
      status: "downloaded",
      currentVersion: "0.4.4",
      availableVersion: "0.5.0",
      progressPercent: 100,
      installRetryDisabled: true,
      error: {
        code: "incompatible_app_signature",
        message: recoveryMessage,
        operation: "install",
      },
    });
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<SettingsAppUpdatesSection disabled={false} />);

    expect(await screen.findByText("Manual update required")).toBeTruthy();
    expect(screen.queryByText(recoveryMessage)).toBeNull();
    expect(screen.queryByRole("button", { name: "Restart to Install" })).toBeNull();
  });

  test("identifies browser runner update behavior", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "disabled",
      currentVersion: "0.4.4",
      disabledCode: "unsupported_web_runner",
      disabledReason: "The browser runner does not install updates in OpenDucktor.",
    });
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<SettingsAppUpdatesSection disabled={false} />);

    expect(await screen.findByText("Browser runner")).toBeTruthy();
    expect(
      screen.getByText("The browser runner does not install updates in OpenDucktor."),
    ).toBeTruthy();
    expect(screen.getByText("0.4.4")).toBeTruthy();
    expect(screen.queryByText("Desktop Updates")).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Check for Updates" }).disabled,
    ).toBe(true);
  });
});

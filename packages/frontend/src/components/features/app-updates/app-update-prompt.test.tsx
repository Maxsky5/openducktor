import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { AppUpdatePrompt } from "./app-update-prompt";
import { createFakeAppUpdateBridge, createTestShellBridge } from "./app-update-test-utils";

afterEach(() => {
  configureShellBridge(createUnavailableShellBridge());
});

const longUpdateError =
  "OpenDucktor could not read latest-mac.yml for release v0.4.3. Make sure the GitHub release is published and includes the Electron updater metadata asset, then try again. https://github.com/Maxsky5/openducktor/releases/download/v0.4.3/latest-mac.yml x-github-request-id-4BDD-2F6204-154326FB-1101F3BB-6A501D61";

describe("AppUpdatePrompt", () => {
  test("stays hidden for background up-to-date checks", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "upToDate",
      currentVersion: "0.4.2",
      checkInitiator: "background",
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    configureShellBridge(createTestShellBridge(appUpdates));

    render(<AppUpdatePrompt />);
    await waitFor(() => expect(appUpdates.getState).toHaveBeenCalled());

    expect(screen.queryByText("OpenDucktor is up to date")).toBeNull();
  });

  test("shows disabled feedback for manual menu checks", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "disabled",
      currentVersion: "0.4.2",
      disabledCode: "missing_update_config",
      disabledReason: "Electron update feed configuration is missing.",
      checkInitiator: "menu",
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    configureShellBridge(createTestShellBridge(appUpdates));

    render(<AppUpdatePrompt />);

    expect(await screen.findByText("Updates unavailable")).toBeTruthy();
    expect(screen.getByText("Electron update feed configuration is missing.")).toBeTruthy();
  });

  test("keeps long manual check errors in a single bounded panel", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "error",
      currentVersion: "0.4.2",
      checkInitiator: "menu",
      checkedAt: "2026-07-08T22:00:00.000Z",
      error: {
        code: "check_failed",
        message: longUpdateError,
        operation: "check",
      },
    });
    configureShellBridge(createTestShellBridge(appUpdates));

    render(<AppUpdatePrompt />);

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

  test("shows available updates and allows dismissal for the live cycle", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "available",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      checkInitiator: "background",
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    configureShellBridge(createTestShellBridge(appUpdates));

    render(<AppUpdatePrompt />);

    expect(await screen.findByText("Update available")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Update available");
    expect(screen.getByText(/Current 0.4.2/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download Update" })).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Dismiss update prompt"));

    expect(screen.queryByText("Update available")).toBeNull();
  });

  test("starts download only when the user clicks the action", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "available",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    appUpdates.download.mockResolvedValue({
      accepted: true,
      state: {
        status: "downloading",
        currentVersion: "0.4.2",
        availableVersion: "0.4.3",
        progressPercent: 40,
      },
    });
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<AppUpdatePrompt />);

    fireEvent.click(await screen.findByRole("button", { name: "Download Update" }));

    await waitFor(() => expect(appUpdates.download).toHaveBeenCalled());
    expect(await screen.findByText("40% downloaded")).toBeTruthy();
    expect(
      screen
        .getByRole("progressbar", { name: "Update download progress" })
        .getAttribute("aria-valuetext"),
    ).toBe("40% downloaded");
  });

  test("keeps an available update visible when download command transport fails", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "available",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    appUpdates.download.mockRejectedValue(new Error("bridge download failed"));
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<AppUpdatePrompt />);

    fireEvent.click(await screen.findByRole("button", { name: "Download Update" }));

    expect((await screen.findAllByText("bridge download failed")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Current 0.4.2/)).toBeTruthy();
    expect(screen.getByText(/New 0.4.3/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download Update" })).toBeTruthy();
  });

  test("offers explicit restart after download", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "downloaded",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      progressPercent: 100,
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<AppUpdatePrompt />);

    fireEvent.click(await screen.findByRole("button", { name: "Restart to Install" }));

    await waitFor(() => expect(appUpdates.install).toHaveBeenCalled());
  });

  test("keeps a downloaded update visible when install command transport fails", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "downloaded",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      progressPercent: 100,
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    appUpdates.install.mockRejectedValue(new Error("bridge install failed"));
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<AppUpdatePrompt />);

    fireEvent.click(await screen.findByRole("button", { name: "Restart to Install" }));

    expect(await screen.findByText("bridge install failed")).toBeTruthy();
    expect(screen.getByText("Ready to install")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restart to Install" })).toBeTruthy();
  });

  test("shows installer handoff without offering another restart action", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "downloaded",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      progressPercent: 100,
      installRequested: true,
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<AppUpdatePrompt />);

    expect(await screen.findByText("Installing update")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Installing update");
    expect(screen.queryByRole("button", { name: "Restart to Install" })).toBeNull();
  });

  test("surfaces rejected install commands with the returned shared state", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "downloaded",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      progressPercent: 100,
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    appUpdates.install.mockResolvedValue({
      accepted: false,
      rejection: {
        code: "busy",
        message: "Cannot install updates while another update action is active.",
        operation: "install",
      },
      state: {
        status: "downloaded",
        currentVersion: "0.4.2",
        availableVersion: "0.4.3",
        progressPercent: 100,
        installRequested: true,
      },
    });
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<AppUpdatePrompt />);

    fireEvent.click(await screen.findByRole("button", { name: "Restart to Install" }));

    expect(
      await screen.findByText("Cannot install updates while another update action is active."),
    ).toBeTruthy();
    expect(screen.getByText("Installing update")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restart to Install" })).toBeNull();

    act(() => {
      appUpdates.emit({
        status: "downloaded",
        currentVersion: "0.4.2",
        availableVersion: "0.4.3",
        progressPercent: 100,
        installRequested: true,
      });
    });

    expect(
      screen.getByText("Cannot install updates while another update action is active."),
    ).toBeTruthy();
  });

  test("shows terminal install failures without offering another restart action", async () => {
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
    render(<AppUpdatePrompt />);

    expect(await screen.findByText("Relaunch required")).toBeTruthy();
    expect(screen.getByText("Quit and reopen OpenDucktor before trying again.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restart to Install" })).toBeNull();
  });

  test("resurfaces a dismissed downloaded prompt when install fails", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "downloaded",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      progressPercent: 100,
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<AppUpdatePrompt />);

    expect(await screen.findByText("Ready to install")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Dismiss update prompt"));
    expect(screen.queryByText("Ready to install")).toBeNull();

    act(() => {
      appUpdates.emit({
        status: "downloaded",
        currentVersion: "0.4.2",
        availableVersion: "0.4.3",
        progressPercent: 100,
        checkedAt: "2026-07-08T22:00:00.000Z",
        error: {
          code: "install_failed",
          message: "shutdown failed",
          operation: "install",
        },
      });
    });

    expect(await screen.findByText("shutdown failed")).toBeTruthy();
  });
});

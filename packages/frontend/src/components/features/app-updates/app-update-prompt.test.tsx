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

  test("shows concise development feedback for menu checks", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "disabled",
      currentVersion: "0.4.2",
      disabledCode: "not_packaged",
      disabledReason: "Updates are available only in packaged desktop builds.",
      checkInitiator: "menu",
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    configureShellBridge(createTestShellBridge(appUpdates));

    render(<AppUpdatePrompt />);

    expect(await screen.findByText("Development build")).toBeTruthy();
    expect(
      screen.getByText("Automatic updates are disabled while running OpenDucktor in development."),
    ).toBeTruthy();
    expect(screen.queryByText("Updates unavailable")).toBeNull();
  });

  test("stays hidden when a renderer remount reads a disabled settings check", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "disabled",
      currentVersion: "0.4.2",
      disabledCode: "not_packaged",
      disabledReason: "Updates are available only in packaged desktop builds.",
      checkInitiator: "settings",
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    configureShellBridge(createTestShellBridge(appUpdates));

    render(<AppUpdatePrompt />);
    await waitFor(() => expect(appUpdates.getState).toHaveBeenCalled());

    expect(screen.queryByText("Development build")).toBeNull();
    expect(screen.queryByText("Updates unavailable")).toBeNull();
  });

  test("shows feedback from a live settings check", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "idle",
      currentVersion: "0.4.2",
    });
    configureShellBridge(createTestShellBridge(appUpdates));

    render(<AppUpdatePrompt />);
    await waitFor(() => expect(appUpdates.getState).toHaveBeenCalled());

    act(() => {
      appUpdates.emit({
        status: "upToDate",
        currentVersion: "0.4.2",
        checkInitiator: "settings",
        checkedAt: "2026-07-08T22:00:00.000Z",
      });
    });

    expect(await screen.findByText("OpenDucktor is up to date")).toBeTruthy();
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
    expect(screen.getByRole("status").textContent).toContain("Current 0.4.2");
    expect(screen.getByRole("status").textContent).toContain(longUpdateError);
    const errorMessages = screen.getAllByText(longUpdateError);
    expect(errorMessages).toHaveLength(1);
    const [errorMessage] = errorMessages;
    expect(errorMessage).toBeTruthy();
    if (!errorMessage) return;
    expect(errorMessage.className).toContain("max-h-32");
    expect(errorMessage.className).toContain("overflow-y-auto");
    expect(errorMessage.className).toContain("break-words");
    expect(errorMessage.parentElement?.className).toContain("border-destructive/30");
  });

  test("resurfaces dismissed manual check errors from later checks", async () => {
    const repeatedError = {
      code: "check_failed" as const,
      message: "OpenDucktor could not refresh the update feed.",
      operation: "check" as const,
    };
    const appUpdates = createFakeAppUpdateBridge({
      status: "error",
      currentVersion: "0.4.2",
      checkInitiator: "menu",
      checkedAt: "2026-07-08T22:00:00.000Z",
      error: repeatedError,
    });
    configureShellBridge(createTestShellBridge(appUpdates));

    render(<AppUpdatePrompt />);

    expect(await screen.findByText("Update error")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Dismiss update prompt"));
    expect(screen.queryByText("Update error")).toBeNull();

    act(() => {
      appUpdates.emit({
        status: "error",
        currentVersion: "0.4.2",
        checkInitiator: "menu",
        checkedAt: "2026-07-08T23:00:00.000Z",
        error: repeatedError,
      });
    });
    expect(await screen.findByText("Update error")).toBeTruthy();
    expect(screen.getByText(repeatedError.message)).toBeTruthy();
  });

  test("keeps live startup update state when the initial snapshot resolves stale", async () => {
    const staleInitialState = {
      status: "idle" as const,
      currentVersion: "0.4.2",
    };
    const liveState = {
      status: "available" as const,
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      checkInitiator: "background" as const,
      checkedAt: "2026-07-08T22:00:00.000Z",
    };
    const appUpdates = createFakeAppUpdateBridge(staleInitialState);
    let resolveInitialSnapshot: ((state: typeof staleInitialState) => void) | null = null;
    appUpdates.getState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInitialSnapshot = resolve;
        }),
    );
    configureShellBridge(createTestShellBridge(appUpdates));

    render(<AppUpdatePrompt />);
    await waitFor(() => expect(appUpdates.getState).toHaveBeenCalled());

    act(() => {
      appUpdates.emit(liveState);
    });
    expect(await screen.findByText("Update available")).toBeTruthy();

    await act(async () => {
      if (!resolveInitialSnapshot) {
        throw new Error("Initial app update snapshot was not requested.");
      }
      resolveInitialSnapshot(staleInitialState);
      await Promise.resolve();
    });

    expect(screen.getByText("Update available")).toBeTruthy();
    expect(screen.getByText("0.4.2 → 0.4.3")).toBeTruthy();
  });

  test("keeps downloadable background check errors visible", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "error",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      checkInitiator: "background",
      checkedAt: "2026-07-08T22:00:00.000Z",
      error: {
        code: "check_failed",
        message: "OpenDucktor could not refresh the update feed.",
        operation: "check",
      },
    });
    configureShellBridge(createTestShellBridge(appUpdates));

    render(<AppUpdatePrompt />);

    expect(await screen.findByText("Update error")).toBeTruthy();
    expect(screen.getByText("OpenDucktor could not complete the update check.")).toBeTruthy();
    expect(screen.getByText("0.4.2 → 0.4.3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download Update" })).toBeTruthy();
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
    expect(screen.getByRole("status").textContent).toContain("Current 0.4.2");
    expect(screen.getByText("0.4.2 → 0.4.3")).toBeTruthy();
    expect(screen.queryByText("Download starts only when you choose it.")).toBeNull();
    const downloadButton = screen.getByRole("button", { name: "Download Update" });
    expect(downloadButton.className).toContain("w-full");
    expect(downloadButton.className).toContain("bg-sidebar-accent");
    expect(screen.getByText("Update available").closest("[data-slot='card']")?.className).toContain(
      "light",
    );
    const releaseNoteLink = screen.getByRole("link", { name: "Release note" });
    expect(releaseNoteLink.getAttribute("href")).toBe(
      "https://github.com/Maxsky5/openducktor/releases/tag/v0.4.3",
    );
    expect(fireEvent.click(releaseNoteLink)).toBe(false);
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
    const progressbar = screen.getByRole("progressbar", { name: "Update download progress" });
    expect(progressbar.getAttribute("aria-valuetext")).toBe("40% downloaded");
    expect(progressbar.firstElementChild?.className).toContain("bg-sidebar-accent");
    expect(progressbar.firstElementChild?.className).toContain("transition-[width]");
    expect(progressbar.firstElementChild?.className).toContain("duration-150");
    expect(progressbar.firstElementChild?.className).toContain("motion-reduce:transition-none");
    expect(screen.getByRole("link", { name: "Release note" }).getAttribute("href")).toBe(
      "https://github.com/Maxsky5/openducktor/releases/tag/v0.4.3",
    );
  });

  test("keeps an available update visible when download command transport fails", async () => {
    const appUpdates = createFakeAppUpdateBridge({
      status: "available",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    appUpdates.download.mockImplementation(async () => {
      throw new Error("bridge download failed");
    });
    configureShellBridge(createTestShellBridge(appUpdates));
    render(<AppUpdatePrompt />);

    fireEvent.click(await screen.findByRole("button", { name: "Download Update" }));

    expect(await screen.findAllByText("bridge download failed")).toHaveLength(1);
    expect(screen.getByText("0.4.2 → 0.4.3")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("bridge download failed");
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

    expect((await screen.findByRole("link", { name: "Release note" })).getAttribute("href")).toBe(
      "https://github.com/Maxsky5/openducktor/releases/tag/v0.4.3",
    );
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
    appUpdates.install.mockImplementation(async () => {
      throw new Error("bridge install failed");
    });
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

    expect(await screen.findByText("Install needs attention")).toBeTruthy();
    expect(screen.getByText("Quit and reopen OpenDucktor before trying again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download Latest Release" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restart to Install" })).toBeNull();
  });

  test("explains signature mismatches without exposing native updater details", async () => {
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
    render(<AppUpdatePrompt />);

    expect(await screen.findByText("Manual update required")).toBeTruthy();
    expect(screen.getByText(recoveryMessage)).toBeTruthy();
    expect(
      screen.queryByText(
        "This installation cannot verify the signed update because it was installed without a compatible macOS signature.",
      ),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Download Signed Release" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download Latest Release" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Restart to Install" })).toBeNull();
    expect(screen.queryByText(/Code signature at URL/)).toBeNull();
    expect(screen.queryByText(/file:\/\/\/Users\//)).toBeNull();
    expect(screen.getByText(recoveryMessage).parentElement?.className).toContain(
      "border-warning-border",
    );
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
    expect(screen.getByText("Ready to install")).toBeTruthy();
  });
});

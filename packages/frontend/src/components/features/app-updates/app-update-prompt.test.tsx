import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { AppUpdatePrompt } from "./app-update-prompt";
import { createFakeAppUpdateBridge, createTestShellBridge } from "./app-update-test-utils";

afterEach(() => {
  configureShellBridge(createUnavailableShellBridge());
});

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

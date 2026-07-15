import { describe, expect, mock, test } from "bun:test";
import {
  type AppUpdateState,
  canDownloadAppUpdate,
  canInstallAppUpdate,
} from "@openducktor/contracts";
import { ElectronLifecycleError } from "../../effect/electron-errors";
import { createService, FakeUpdaterAdapter } from "./electron-app-update-service.test-support";

describe("electron app update install handoff", () => {
  test("install coordinates shutdown before invoking the updater install path", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    const order: string[] = [];
    adapter.onPrepareInstall = () => {
      order.push("prepare");
    };
    const { service } = createService({
      adapter,
      installDownloadedUpdate: async (installHandoff) => {
        order.push("shutdown");
        await installHandoff();
        order.push("after-install-call");
      },
    });
    await service.check({ initiator: "settings" });
    await service.download();

    const result = await service.install();

    expect(result.accepted).toBe(true);
    expect(order).toEqual(["prepare", "shutdown", "after-install-call"]);
    expect(adapter.prepareInstallCalls).toBe(1);
    expect(adapter.installCalls).toEqual([{ isSilent: false, isForceRunAfter: true }]);
  });

  test("does not shut down when the updater cannot prepare the install", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    adapter.onPrepareInstall = () => {
      throw new Error("updater preparation failed");
    };
    const installDownloadedUpdate = mock(async () => {});
    const { service } = createService({ adapter, installDownloadedUpdate });
    await service.check({ initiator: "settings" });
    await service.download();

    const result = await service.install();

    expect(installDownloadedUpdate).not.toHaveBeenCalled();
    expect(result.state).toMatchObject({
      status: "downloaded",
      error: {
        operation: "install",
        message: expect.stringContaining("updater preparation failed"),
      },
    });
    expect(canInstallAppUpdate(result.state)).toBe(true);
  });

  test("publishes install requested before shutdown completes and rejects duplicate surfaces", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    let finishShutdown: () => void = () => {};
    const { service } = createService({
      adapter,
      installDownloadedUpdate: async (installHandoff) => {
        await new Promise<void>((resolve) => {
          finishShutdown = resolve;
        });
        await installHandoff();
      },
    });
    await service.check({ initiator: "settings" });
    await service.download();
    const promptStates: AppUpdateState[] = [];
    const settingsStates: AppUpdateState[] = [];
    service.subscribe((state) => promptStates.push(state));
    service.subscribe((state) => settingsStates.push(state));

    const installResultPromise = service.install();
    await Promise.resolve();
    const duplicateResult = await service.install();

    expect(service.getState()).toMatchObject({
      status: "downloaded",
      availableVersion: "0.4.3",
      installRequested: true,
    });
    expect(canInstallAppUpdate(service.getState())).toBe(false);
    expect(promptStates.at(-1)).toMatchObject({ installRequested: true });
    expect(settingsStates.at(-1)).toMatchObject({ installRequested: true });
    expect(duplicateResult).toMatchObject({
      accepted: false,
      rejection: {
        code: "busy",
        operation: "install",
      },
      state: {
        status: "downloaded",
        installRequested: true,
      },
    });

    finishShutdown();
    await installResultPromise;

    expect(adapter.installCalls).toHaveLength(1);
  });

  test("blocks checks after install handoff starts while the app remains running", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    const { service } = createService({ adapter });
    await service.check({ initiator: "settings" });
    await service.download();
    await service.install();

    expect(service.getState()).toMatchObject({
      status: "downloaded",
      availableVersion: "0.4.3",
      installRequested: true,
    });

    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.4" },
    };

    const checkResult = await service.check({ initiator: "settings" });

    expect(checkResult).toMatchObject({
      accepted: false,
      rejection: {
        code: "busy",
        operation: "check",
      },
      state: {
        status: "downloaded",
        availableVersion: "0.4.3",
        installRequested: true,
      },
    });
    expect(adapter.checkCalls).toBe(1);

    adapter.emit("error", new Error("native install failed"));

    expect(service.getState()).toMatchObject({
      status: "downloaded",
      availableVersion: "0.4.3",
      installRetryDisabled: true,
      error: {
        code: "install_failed",
        operation: "install",
      },
    });

    const backgroundCheckResult = await service.check({ initiator: "background" });

    expect(backgroundCheckResult).toMatchObject({
      accepted: false,
      rejection: {
        code: "busy",
        operation: "check",
      },
      state: {
        status: "downloaded",
        availableVersion: "0.4.3",
        installRetryDisabled: true,
      },
    });
    expect(adapter.checkCalls).toBe(1);

    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.4" },
    };

    const terminalCheckResult = await service.check({ initiator: "settings" });

    expect(terminalCheckResult).toMatchObject({
      accepted: false,
      rejection: {
        code: "busy",
        operation: "check",
      },
      state: {
        status: "downloaded",
        availableVersion: "0.4.3",
        installRetryDisabled: true,
      },
    });
    expect(adapter.checkCalls).toBe(1);

    adapter.emit("error", new Error("native install still failed"));

    expect(service.getState()).toMatchObject({
      status: "downloaded",
      availableVersion: "0.4.3",
      installRetryDisabled: true,
      error: {
        code: "install_failed",
        message: "native install failed Quit and reopen OpenDucktor before trying again.",
        operation: "install",
      },
    });
  });

  test("treats delayed updater handoff errors as terminal for the process", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    const { service } = createService({ adapter });
    await service.check({ initiator: "settings" });
    await service.download();

    const firstResult = await service.install();
    const duplicateResult = await service.install();

    expect(firstResult).toMatchObject({
      accepted: true,
      state: {
        status: "downloaded",
        availableVersion: "0.4.3",
        installRequested: true,
      },
    });
    expect(duplicateResult).toMatchObject({
      accepted: false,
      rejection: {
        code: "invalid_state",
        operation: "install",
      },
    });
    expect(adapter.installCalls).toHaveLength(1);

    adapter.emit("error", new Error("native install failed"));

    expect(service.getState()).toMatchObject({
      status: "downloaded",
      availableVersion: "0.4.3",
      installRetryDisabled: true,
      error: {
        code: "install_failed",
        message: "native install failed Quit and reopen OpenDucktor before trying again.",
        operation: "install",
      },
    });
    expect(canInstallAppUpdate(service.getState())).toBe(false);

    const retryResult = await service.install();

    expect(retryResult).toMatchObject({
      accepted: false,
      rejection: {
        code: "invalid_state",
        operation: "install",
      },
    });
    expect(adapter.installCalls).toHaveLength(1);
    expect(adapter.nativeInstallListeners).toBe(1);

    adapter.emitNativeUpdateDownloaded();

    expect(adapter.nativeQuitAndInstallCalls).toBe(1);
  });

  test("turns macOS signature mismatches into manual update guidance", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.5.0" },
    };
    adapter.nextDownloadResult = Promise.resolve({ version: "0.5.0" });
    const { service } = createService({ adapter, platform: "darwin" });
    await service.check({ initiator: "settings" });
    await service.download();
    await service.install();

    adapter.emit(
      "error",
      new Error(
        "Code signature at URL file:///Users/example/Library/Caches/com.openducktor.app.ShipIt/update/OpenDucktor.app/ did not pass validation: code failed to satisfy specified code requirement(s)",
      ),
    );

    const state = service.getState();
    expect(state).toMatchObject({
      status: "downloaded",
      availableVersion: "0.5.0",
      installRetryDisabled: true,
      error: {
        code: "incompatible_app_signature",
        message:
          "This installation cannot verify the signed update because it was installed without a compatible macOS signature. Download and install the latest signed release manually. Automatic updates will work after that.",
        operation: "install",
      },
    });
    expect(state.status === "downloaded" ? state.error?.message : undefined).not.toContain(
      "file:///Users/",
    );
    expect(canInstallAppUpdate(state)).toBe(false);
  });

  test("does not classify macOS signature messages on other platforms", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.5.0" },
    };
    const { service } = createService({ adapter, platform: "win32" });
    await service.check({ initiator: "settings" });
    await service.download();
    await service.install();

    adapter.emit(
      "error",
      new Error(
        "Code signature at URL C:/OpenDucktor did not pass validation: code failed to satisfy specified code requirement(s)",
      ),
    );

    expect(service.getState()).toMatchObject({
      status: "downloaded",
      installRetryDisabled: true,
      error: {
        code: "install_failed",
        operation: "install",
      },
    });
  });

  test("keeps terminal install failure stable after later updater errors", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    const { service } = createService({ adapter });
    await service.check({ initiator: "settings" });
    await service.download();
    await service.install();

    adapter.emit("error", new Error("native install failed"));
    adapter.emit("error", new Error("native install still failed"));

    expect(service.getState()).toMatchObject({
      status: "downloaded",
      availableVersion: "0.4.3",
      installRetryDisabled: true,
      error: {
        code: "install_failed",
        message: "native install failed Quit and reopen OpenDucktor before trying again.",
        operation: "install",
      },
    });
    expect(canInstallAppUpdate(service.getState())).toBe(false);
    expect(canDownloadAppUpdate(service.getState())).toBe(false);
  });

  test("host shutdown failures disable same-process install retry", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    const { service } = createService({
      adapter,
      installDownloadedUpdate: async () => {
        throw new ElectronLifecycleError({
          operation: "electron.main.shutdown-host-before-run",
          message: "OpenDucktor host shutdown failed before the requested shutdown action.",
          reason: "app-update-install",
        });
      },
    });
    await service.check({ initiator: "settings" });
    await service.download();

    const result = await service.install();

    expect(result).toMatchObject({
      accepted: true,
      state: {
        status: "downloaded",
        availableVersion: "0.4.3",
        installRetryDisabled: true,
        error: {
          code: "install_failed",
          message:
            "OpenDucktor host shutdown failed before the requested shutdown action. Quit and reopen OpenDucktor before trying again.",
          operation: "install",
        },
      },
    });
    expect(canInstallAppUpdate(result.state)).toBe(false);

    const retryResult = await service.install();

    expect(retryResult).toMatchObject({
      accepted: false,
      rejection: {
        code: "invalid_state",
        operation: "install",
      },
      state: {
        status: "downloaded",
        installRetryDisabled: true,
      },
    });
    expect(adapter.installCalls).toEqual([]);
  });

  test("post-shutdown install failures are terminal on every platform", async () => {
    for (const platform of ["darwin", "win32", "linux"] as const) {
      const adapter = new FakeUpdaterAdapter();
      adapter.nextCheckResult = {
        isUpdateAvailable: true,
        updateInfo: { version: "0.4.3" },
      };
      const { service } = createService({
        adapter,
        ...(platform === "linux" ? { appImagePath: "/opt/OpenDucktor.AppImage" } : {}),
        platform,
        installDownloadedUpdate: async () => {
          throw new ElectronLifecycleError({
            operation: "electron.main.run-after-shutdown",
            message: "The native updater handoff failed after host shutdown.",
            reason: "update-install",
          });
        },
      });
      await service.check({ initiator: "settings" });
      await service.download();

      const result = await service.install();

      expect(result.state).toMatchObject({
        status: "downloaded",
        installRetryDisabled: true,
        error: { operation: "install" },
      });
      expect(canInstallAppUpdate(result.state)).toBe(false);
    }
  });

  test("delayed Windows updater handoff errors are terminal for the process", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    const { service } = createService({ adapter, platform: "win32" });
    await service.check({ initiator: "settings" });
    await service.download();

    await service.install();
    adapter.emit("error", new Error("native install failed"));

    expect(service.getState()).toMatchObject({
      status: "downloaded",
      availableVersion: "0.4.3",
      installRetryDisabled: true,
      error: {
        code: "install_failed",
        message: "native install failed Quit and reopen OpenDucktor before trying again.",
        operation: "install",
      },
    });
    expect(canInstallAppUpdate(service.getState())).toBe(false);

    const retryResult = await service.install();

    expect(retryResult).toMatchObject({
      accepted: false,
      rejection: { code: "invalid_state", operation: "install" },
    });
    expect(adapter.installCalls).toHaveLength(1);
  });

  test("synchronous Linux updater handoff errors are terminal for the process", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    const { service } = createService({
      adapter,
      appImagePath: "/opt/OpenDucktor.AppImage",
      platform: "linux",
      installDownloadedUpdate: async (installHandoff) => {
        await installHandoff();
        adapter.emit("error", new Error("AppImage install handoff failed"));
      },
    });
    await service.check({ initiator: "settings" });
    await service.download();

    const result = await service.install();

    expect(result.state).toMatchObject({
      status: "downloaded",
      availableVersion: "0.4.3",
      installRetryDisabled: true,
      error: {
        code: "install_failed",
        message: "AppImage install handoff failed Quit and reopen OpenDucktor before trying again.",
        operation: "install",
      },
    });
    expect(canInstallAppUpdate(result.state)).toBe(false);
  });

  test("allows manual checks after retryable install failures while keeping background blocked", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    adapter.onPrepareInstall = () => {
      throw new Error("updater preparation failed");
    };
    const { service } = createService({ adapter, platform: "win32" });
    await service.check({ initiator: "settings" });
    await service.download();

    await service.install();

    expect(service.getState()).toMatchObject({
      status: "downloaded",
      availableVersion: "0.4.3",
      error: {
        code: "install_failed",
        message: "updater preparation failed",
        operation: "install",
      },
    });
    expect(canInstallAppUpdate(service.getState())).toBe(true);

    const backgroundCheckResult = await service.check({ initiator: "background" });

    expect(backgroundCheckResult).toMatchObject({
      accepted: false,
      rejection: {
        code: "busy",
        operation: "check",
      },
      state: {
        status: "downloaded",
        availableVersion: "0.4.3",
      },
    });
    expect(adapter.checkCalls).toBe(1);

    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.4" },
    };

    const recoveryCheckResult = await service.check({ initiator: "settings" });

    expect(recoveryCheckResult).toMatchObject({
      accepted: true,
      state: {
        status: "available",
        availableVersion: "0.4.4",
        checkInitiator: "settings",
      },
    });
    expect(adapter.checkCalls).toBe(2);
  });
});

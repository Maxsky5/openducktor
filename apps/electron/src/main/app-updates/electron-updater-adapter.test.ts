import { describe, expect, mock, test } from "bun:test";
import type { autoUpdater } from "electron-updater";
import type { ElectronUpdaterConfigureOptions } from "./electron-app-update-service";
import { createElectronUpdaterAdapter } from "./electron-updater-adapter";

class FakeNativeUpdater {
  allowPrerelease = false;
  autoDownload = true;
  autoInstallOnAppQuit = true;
  channel: string | undefined;
  logger: unknown = null;

  async checkForUpdates() {
    return null;
  }

  async downloadUpdate(): Promise<string[]> {
    return [];
  }

  on = mock(() => this);
  quitAndInstall = mock(() => {});
  removeListener = mock(() => this);
}

describe("electron updater adapter", () => {
  test("forwards explicit prerelease update channel configuration", () => {
    const nativeUpdater = new FakeNativeUpdater();
    const adapter = createElectronUpdaterAdapter({
      updater: nativeUpdater as unknown as typeof autoUpdater,
    });
    const logger = {
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    };

    adapter.configure({
      allowPrerelease: true,
      autoDownload: false,
      autoInstallOnAppQuit: false,
      channel: "beta",
      logger,
    } satisfies ElectronUpdaterConfigureOptions);

    expect(nativeUpdater.allowPrerelease).toBe(true);
    expect(nativeUpdater.autoDownload).toBe(false);
    expect(nativeUpdater.autoInstallOnAppQuit).toBe(false);
    expect(nativeUpdater.channel).toBe("beta");
    expect(nativeUpdater.logger).toBe(logger);
  });
});

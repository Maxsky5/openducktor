import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import { ElectronOperationError } from "../../effect/electron-errors";
import type {
  ElectronAppUpdaterAdapter,
  ElectronUpdaterCheckResult,
  ElectronUpdaterConfigureOptions,
  ElectronUpdaterDownloadProgress,
  ElectronUpdaterEventMap,
  ElectronUpdaterUpdateInfo,
} from "./electron-app-update-service";

const toUpdateInfo = (info: UpdateInfo): ElectronUpdaterUpdateInfo => ({
  version: info.version,
});

const toDownloadProgress = (progress: ProgressInfo): ElectronUpdaterDownloadProgress => ({
  percent: progress.percent,
});

type ElectronUpdaterAdapterOptions = {
  platform?: NodeJS.Platform;
};

export const createElectronUpdaterAdapter = ({
  platform = process.platform,
}: ElectronUpdaterAdapterOptions = {}): ElectronAppUpdaterAdapter => {
  let macInstallHandoffStarted = false;

  return {
    checkForUpdates: async () => {
      const result = await autoUpdater.checkForUpdates();
      if (result === null) {
        return null;
      }
      return {
        isUpdateAvailable: result.isUpdateAvailable,
        updateInfo: toUpdateInfo(result.updateInfo),
        versionInfo: toUpdateInfo(result.versionInfo),
      } satisfies ElectronUpdaterCheckResult;
    },
    configure: ({
      autoDownload,
      autoInstallOnAppQuit,
      logger,
    }: ElectronUpdaterConfigureOptions) => {
      autoUpdater.autoDownload = autoDownload;
      autoUpdater.autoInstallOnAppQuit = autoInstallOnAppQuit;
      autoUpdater.logger = logger;
    },
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    on: (eventName, listener) => {
      const untypedListener = (payload: ElectronUpdaterEventMap[typeof eventName]) => {
        if (eventName === "download-progress") {
          listener(toDownloadProgress(payload as ProgressInfo) as never);
          return;
        }
        if (
          eventName === "update-available" ||
          eventName === "update-not-available" ||
          eventName === "update-downloaded"
        ) {
          listener(toUpdateInfo(payload as UpdateInfo) as never);
          return;
        }
        listener(payload as never);
      };
      autoUpdater.on(eventName, untypedListener as never);
      return () => {
        autoUpdater.removeListener(eventName, untypedListener as never);
      };
    },
    quitAndInstall: (isSilent, isForceRunAfter) => {
      if (platform === "darwin") {
        if (macInstallHandoffStarted) {
          throw new ElectronOperationError({
            operation: "electron.updater.quit-and-install",
            message:
              "Electron updater install handoff already started. Quit and reopen OpenDucktor before trying again.",
            platform,
          });
        }
        macInstallHandoffStarted = true;
      }
      autoUpdater.quitAndInstall(isSilent, isForceRunAfter);
    },
  };
};

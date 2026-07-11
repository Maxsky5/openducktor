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
  updater?: typeof autoUpdater;
};

const updateInfoEventNames = new Set<keyof ElectronUpdaterEventMap>([
  "update-available",
  "update-not-available",
  "update-downloaded",
]);

export const createElectronUpdaterAdapter = ({
  platform = process.platform,
  updater = autoUpdater,
}: ElectronUpdaterAdapterOptions = {}): ElectronAppUpdaterAdapter => {
  let macInstallHandoffStarted = false;

  return {
    checkForUpdates: async () => {
      const result = await updater.checkForUpdates();
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
      allowPrerelease,
      channel,
      logger,
    }: ElectronUpdaterConfigureOptions) => {
      updater.allowPrerelease = allowPrerelease;
      updater.autoDownload = autoDownload;
      updater.autoInstallOnAppQuit = autoInstallOnAppQuit;
      if (channel) {
        updater.channel = channel;
      }
      updater.logger = logger;
    },
    downloadUpdate: () => updater.downloadUpdate(),
    on: (eventName, listener) => {
      const untypedListener = (payload: unknown) => {
        if (eventName === "download-progress") {
          listener(toDownloadProgress(payload as ProgressInfo));
          return;
        }
        if (updateInfoEventNames.has(eventName)) {
          listener(toUpdateInfo(payload as UpdateInfo));
          return;
        }
        listener(payload as ElectronUpdaterEventMap[typeof eventName]);
      };
      updater.on(eventName, untypedListener);
      return () => {
        updater.removeListener(eventName, untypedListener);
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
      updater.quitAndInstall(isSilent, isForceRunAfter);
    },
  };
};

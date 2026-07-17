type ElectronAppUpdateLogger = {
  error(message: string, error?: unknown): void | Promise<void>;
  info(message: string): void | Promise<void>;
  warn(message: string, details?: unknown): void | Promise<void>;
};

export type ElectronUpdaterConfigureOptions = {
  allowPrerelease: boolean;
  autoDownload: false;
  autoInstallOnAppQuit: false;
  channel: string | null;
  logger: ElectronAppUpdateLogger;
  onLogFailure(cause: unknown): void;
};

export type ElectronUpdaterUpdateInfo = {
  version: string;
};

export type ElectronUpdaterCheckResult = {
  isUpdateAvailable: boolean;
  updateInfo: ElectronUpdaterUpdateInfo;
};

export type ElectronUpdaterDownloadProgress = {
  percent: number;
};

export type ElectronUpdaterEventMap = {
  error: unknown;
  "download-progress": ElectronUpdaterDownloadProgress;
};

export type ElectronInstallHandoff = () => Promise<void>;

export type ElectronAppUpdaterAdapter = {
  checkForUpdates(): Promise<ElectronUpdaterCheckResult>;
  configure(options: ElectronUpdaterConfigureOptions): void;
  dispose(): Promise<void>;
  downloadUpdate(): Promise<ElectronUpdaterUpdateInfo>;
  on<EventName extends keyof ElectronUpdaterEventMap>(
    eventName: EventName,
    listener: (payload: ElectronUpdaterEventMap[EventName]) => void,
  ): () => void;
  prepareInstall(): Promise<ElectronInstallHandoff>;
};

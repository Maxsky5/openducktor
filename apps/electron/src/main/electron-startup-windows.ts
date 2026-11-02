import { OPEN_DUCKTOR_STARTUP_BACKGROUND } from "@openducktor/frontend/startup-splash/theme";
import { findHostStorageStartupError, formatHostStorageStartupError } from "@openducktor/host";
import { Effect } from "effect";
import type { BrowserWindowConstructorOptions } from "electron";

/** Light and dark colors of the startup pages. Windows use them as background before the page loads. */
export const STARTUP_WINDOW_BACKGROUND = {
  light: OPEN_DUCKTOR_STARTUP_BACKGROUND,
  dark: "#202124",
} as const;

const STARTUP_PAGE_STYLE = `
    body { box-sizing: border-box; margin: 0; padding: 32px; color: #202124; background: ${STARTUP_WINDOW_BACKGROUND.light}; font: 16px/1.5 system-ui, sans-serif; }
    h1 { margin: 0 0 20px; font-size: 24px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
    code { overflow-wrap: anywhere; }
    p { margin-top: 24px; }
    @media (prefers-color-scheme: dark) { body { color: #f4f4f4; background: ${STARTUP_WINDOW_BACKGROUND.dark}; } }`;

const renderStartupPage = (title: string, body: string, extraStyle = ""): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${STARTUP_PAGE_STYLE}${extraStyle}
  </style>
</head>
<body>
${body}
</body>
</html>`;

export const STARTUP_ERROR_TITLE = "OpenDucktor could not start";

export const renderStartupErrorHtml = (message: string, logDirectory: string): string =>
  renderStartupPage(
    STARTUP_ERROR_TITLE,
    `  <h1>${STARTUP_ERROR_TITLE}</h1>
  <pre>${escapeHtml(message)}</pre>
  <p>The log files in <code>${escapeHtml(logDirectory)}</code> contain the details.</p>
  <p>Close OpenDucktor and restart it after you correct the problem.</p>`,
  );

export const DATA_UPGRADE_TITLE = "Upgrading OpenDucktor data";

export const renderDataUpgradeHtml = (): string =>
  renderStartupPage(
    DATA_UPGRADE_TITLE,
    `  <div class="spinner" aria-hidden="true"></div>
  <main>
    <h1>${DATA_UPGRADE_TITLE}</h1>
    <p>This can take a few minutes for large workspaces. Do not quit OpenDucktor.</p>
  </main>`,
    `
    body { display: flex; gap: 20px; align-items: flex-start; }
    h1 { font-size: 20px; margin-bottom: 8px; }
    p { margin: 0; }
    .spinner { flex: none; width: 24px; height: 24px; border: 3px solid currentColor; border-right-color: transparent; border-radius: 50%; opacity: 0.6; animation: spin 900ms linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }`,
  );

export const startupWindowUrl = (html: string): string =>
  `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`;

type DataUpgradeWindow = {
  destroy(): void;
  isDestroyed(): boolean;
  loadURL(url: string): Promise<void>;
};

type DataUpgradeWindowHookInput = {
  /** Opens the window. The window must stay open when the user clicks its close button. */
  openWindow(): DataUpgradeWindow;
  reportFailure(message: string, cause: unknown): void;
  whenReady(): Promise<void>;
};

/**
 * Shows a window while the host imports legacy data, and closes it when the import ends.
 * The window opens in the background, so the import does not wait for Electron or the page.
 * A window failure does not stop startup. The hook reports it and continues.
 */
export const createDataUpgradeWindowHook = ({
  openWindow,
  reportFailure,
  whenReady,
}: DataUpgradeWindowHookInput) => {
  let window: DataUpgradeWindow | null = null;
  let importRunning = false;
  const closeWindow = () => {
    const opened = window;
    window = null;
    if (opened !== null && !opened.isDestroyed()) opened.destroy();
  };
  const show = async () => {
    await whenReady();
    // The import can finish before Electron is ready.
    if (!importRunning) return;
    const opened = openWindow();
    window = opened;
    await opened.loadURL(startupWindowUrl(renderDataUpgradeHtml()));
  };
  const start = Effect.sync(() => {
    importRunning = true;
    show().catch((cause: unknown) => {
      // A close during the page load aborts the load. That is not a failure.
      if (importRunning)
        reportFailure("OpenDucktor could not show the data upgrade window.", cause);
    });
  });
  const finish = Effect.sync(() => {
    importRunning = false;
    try {
      closeWindow();
    } catch (cause) {
      reportFailure("OpenDucktor could not close the data upgrade window.", cause);
    }
  });
  return (phase: "started" | "finished"): Effect.Effect<void> =>
    phase === "started" ? start : finish;
};

/** The message of the startup error view for a host storage failure, or null for another failure. */
export const startupErrorMessage = (cause: unknown): string | null => {
  const storageError = findHostStorageStartupError(cause);
  return storageError === null ? null : formatHostStorageStartupError(storageError);
};

type PreventableEvent = { preventDefault(): void };

/** The part of an Electron `BrowserWindow` that startup windows use. */
export type StartupWindow = DataUpgradeWindow & {
  focus(): void;
  on(event: "close", listener: (event: PreventableEvent) => void): void;
  on(event: "closed", listener: () => void): void;
  webContents: {
    setWindowOpenHandler(handler: () => { action: "deny" }): void;
    on(event: "will-navigate", listener: (event: PreventableEvent) => void): void;
  };
};

type StartupWindowOptions = Required<
  Pick<BrowserWindowConstructorOptions, "width" | "height" | "title">
> &
  Omit<BrowserWindowConstructorOptions, "autoHideMenuBar" | "backgroundColor" | "webPreferences">;

type ElectronStartupWindowsInput<Window extends StartupWindow> = {
  createWindow(options: BrowserWindowConstructorOptions): Window;
  exitApp(exitCode: number): void;
  isHostShutdownComplete(): boolean;
  resolveLogDirectory(): string;
  shouldUseDarkColors(): boolean;
  whenReady(): Promise<void>;
};

/** Creates the windows that startup shows before the main window exists. */
export const createElectronStartupWindows = <Window extends StartupWindow>({
  createWindow,
  exitApp,
  isHostShutdownComplete,
  resolveLogDirectory,
  shouldUseDarkColors,
  whenReady,
}: ElectronStartupWindowsInput<Window>) => {
  /** A startup page window runs no Node code, and it opens and navigates to nothing. */
  const createStartupWindow = (options: StartupWindowOptions): Window => {
    const window = createWindow({
      ...options,
      autoHideMenuBar: true,
      backgroundColor: shouldUseDarkColors()
        ? STARTUP_WINDOW_BACKGROUND.dark
        : STARTUP_WINDOW_BACKGROUND.light,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    return window;
  };

  const openDataUpgradeWindow = (): Window => {
    const window = createStartupWindow({
      width: 520,
      height: 200,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: DATA_UPGRADE_TITLE,
    });
    // The close button must not stop the import. A quit closes the window after the host stops.
    window.on("close", (event) => {
      if (!isHostShutdownComplete()) event.preventDefault();
    });
    return window;
  };

  let startupFailureWindow: Window | null = null;
  const showStartupError = async (message: string): Promise<void> => {
    if (startupFailureWindow !== null) {
      startupFailureWindow.focus();
      return;
    }
    await whenReady();
    const window = createStartupWindow({
      width: 760,
      height: 520,
      minWidth: 560,
      minHeight: 360,
      title: STARTUP_ERROR_TITLE,
    });
    startupFailureWindow = window;
    window.on("closed", () => {
      startupFailureWindow = null;
      exitApp(1);
    });
    await window.loadURL(startupWindowUrl(renderStartupErrorHtml(message, resolveLogDirectory())));
  };

  return { openDataUpgradeWindow, showStartupError };
};

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

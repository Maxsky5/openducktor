import type { BaseWindow, MenuItemConstructorOptions } from "electron";

export type MainMenuInput = {
  isDevelopment: boolean;
  appName?: string;
  onCheckForUpdates?: () => void;
  /** Reloads the page of the focused window itself. */
  onReloadWindow: (window: BaseWindow | undefined, ignoreCache: boolean) => void;
};

const checkForUpdatesMenuItem = (
  onCheckForUpdates: (() => void) | undefined,
): MenuItemConstructorOptions => ({
  label: "Check for Updates...",
  enabled: Boolean(onCheckForUpdates),
  click: () => {
    onCheckForUpdates?.();
  },
});

/**
 * The `reload` and `forceReload` roles reload the focused page, and Electron names a `<webview>`
 * as focused whenever its window has the focus. These items reload the window page instead.
 */
const reloadMenuItems = (
  onReloadWindow: MainMenuInput["onReloadWindow"],
): MenuItemConstructorOptions[] => [
  {
    label: "Reload",
    accelerator: "CmdOrCtrl+R",
    click: (_item, window) => onReloadWindow(window, false),
  },
  {
    label: "Force Reload",
    accelerator: "Shift+CmdOrCtrl+R",
    click: (_item, window) => onReloadWindow(window, true),
  },
];

const mainMenu = (
  appName: string,
  onCheckForUpdates: (() => void) | undefined,
  onReloadWindow: MainMenuInput["onReloadWindow"],
): MenuItemConstructorOptions => ({
  label: appName,
  submenu: [
    ...reloadMenuItems(onReloadWindow),
    { type: "separator" },
    ...(process.platform === "darwin"
      ? ([
          { role: "about" },
          checkForUpdatesMenuItem(onCheckForUpdates),
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
        ] as const)
      : []),
    { type: "separator" },
    { role: "quit" },
  ],
});

const createHelpMenu = (
  onCheckForUpdates: (() => void) | undefined,
): MenuItemConstructorOptions => ({
  role: "help",
  submenu: [checkForUpdatesMenuItem(onCheckForUpdates)],
});

const editMenu: MenuItemConstructorOptions = {
  label: "Edit",
  submenu: [
    { role: "undo" },
    { role: "redo" },
    { type: "separator" },
    { role: "cut" },
    { role: "copy" },
    { role: "paste" },
    { role: "selectAll" },
  ],
};

export const createViewMenu = (isDevelopment: boolean): MenuItemConstructorOptions => ({
  label: "View",
  submenu: [
    ...(isDevelopment ? ([{ role: "toggleDevTools" }, { type: "separator" }] as const) : []),
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ],
});

export const createApplicationMenuTemplate = ({
  isDevelopment,
  appName = "OpenDucktor",
  onCheckForUpdates,
  onReloadWindow,
}: MainMenuInput): MenuItemConstructorOptions[] => {
  return [
    mainMenu(appName, onCheckForUpdates, onReloadWindow),
    editMenu,
    createViewMenu(isDevelopment),
    { role: "windowMenu" },
    ...(process.platform === "darwin" ? [] : [createHelpMenu(onCheckForUpdates)]),
  ];
};

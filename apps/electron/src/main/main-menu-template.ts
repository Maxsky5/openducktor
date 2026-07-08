import type { MenuItemConstructorOptions } from "electron";

export type MainMenuInput = {
  isDevelopment: boolean;
  appName?: string;
  onCheckForUpdates?: () => void;
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

const mainMenu = (
  appName: string,
  onCheckForUpdates: (() => void) | undefined,
): MenuItemConstructorOptions => ({
  label: appName,
  submenu: [
    { role: "reload" },
    { role: "forceReload" },
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

export const createContextMenuTemplate = (isDevelopment: boolean): MenuItemConstructorOptions[] => [
  { role: "reload" },
  { role: "forceReload" },
  ...(isDevelopment ? ([{ type: "separator" }, { role: "toggleDevTools" }] as const) : []),
];

export const createApplicationMenuTemplate = ({
  isDevelopment,
  appName = "OpenDucktor",
  onCheckForUpdates,
}: MainMenuInput): MenuItemConstructorOptions[] => {
  return [
    mainMenu(appName, onCheckForUpdates),
    editMenu,
    createViewMenu(isDevelopment),
    { role: "windowMenu" },
    ...(process.platform === "darwin" ? [] : [createHelpMenu(onCheckForUpdates)]),
  ];
};

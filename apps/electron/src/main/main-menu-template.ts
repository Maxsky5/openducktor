import type { MenuItemConstructorOptions } from "electron";

export type MainMenuInput = {
  isDevelopment: boolean;
  appName?: string;
};

const mainMenu = (appName: string): MenuItemConstructorOptions => ({
  label: appName,
  submenu: [
    { role: "reload" },
    { role: "forceReload" },
    { type: "separator" },
    ...(process.platform === "darwin"
      ? ([
          { role: "about" },
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
}: MainMenuInput): MenuItemConstructorOptions[] => {
  return [mainMenu(appName), editMenu, createViewMenu(isDevelopment), { role: "windowMenu" }];
};

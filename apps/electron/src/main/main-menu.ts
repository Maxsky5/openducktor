import electron, { type BaseWindow } from "electron";
import { createApplicationMenuTemplate, type MainMenuInput } from "./main-menu-template";

const { BrowserWindow, Menu } = electron;

export const installApplicationMenu = (input: Omit<MainMenuInput, "onReloadWindow">): void => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      createApplicationMenuTemplate({ ...input, onReloadWindow: reloadWindow }),
    ),
  );
};

const reloadWindow = (window: BaseWindow | undefined, ignoreCache: boolean): void => {
  if (!(window instanceof BrowserWindow)) return;
  if (ignoreCache) window.webContents.reloadIgnoringCache();
  else window.webContents.reload();
};

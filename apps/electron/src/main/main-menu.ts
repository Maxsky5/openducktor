import type { BrowserWindow } from "electron";
import electron from "electron";
import {
  createApplicationMenuTemplate,
  createContextMenuTemplate,
  type MainMenuInput,
} from "./main-menu-template";

const { Menu } = electron;

export const installApplicationMenu = (input: MainMenuInput): void => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate(input)));
};

export const registerWindowContextMenu = (
  window: BrowserWindow,
  { isDevelopment }: MainMenuInput,
): void => {
  window.webContents.on("context-menu", () => {
    Menu.buildFromTemplate(createContextMenuTemplate(isDevelopment)).popup({ window });
  });
};

import type { BrowserWindow } from "electron";
import electron from "electron";
import {
  createApplicationMenuTemplate,
  createContextMenuTemplate,
  type MainMenuInput,
} from "./main-menu-template";

const { Menu } = electron;

const CONTEXT_MENU_CLAIM_WINDOW_MS = 250;

let lastContextMenuClaimedAt = 0;

export const markContextMenuClaimed = (): void => {
  lastContextMenuClaimedAt = Date.now();
};

const wasContextMenuClaimed = (): boolean =>
  Date.now() - lastContextMenuClaimedAt < CONTEXT_MENU_CLAIM_WINDOW_MS;

export const installApplicationMenu = (input: MainMenuInput): void => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate(input)));
};

export const registerWindowContextMenu = (
  window: BrowserWindow,
  { isDevelopment }: MainMenuInput,
): void => {
  window.webContents.on("context-menu", () => {
    if (wasContextMenuClaimed()) {
      return;
    }
    setTimeout(() => {
      if (window.isDestroyed() || wasContextMenuClaimed()) {
        return;
      }
      Menu.buildFromTemplate(createContextMenuTemplate(isDevelopment)).popup({ window });
    }, 50);
  });
};

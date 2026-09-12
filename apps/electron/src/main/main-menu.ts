import type { BrowserWindow } from "electron";
import electron from "electron";
import { createContextMenuClaimTracker } from "./context-menu-claim";
import {
  createApplicationMenuTemplate,
  createContextMenuTemplate,
  type MainMenuInput,
} from "./main-menu-template";

const { Menu } = electron;

const contextMenuClaims = createContextMenuClaimTracker();

export const markContextMenuClaimed = (): void => {
  contextMenuClaims.claim();
};

export const installApplicationMenu = (input: MainMenuInput): void => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate(input)));
};

export const registerWindowContextMenu = (
  window: BrowserWindow,
  { isDevelopment }: MainMenuInput,
): void => {
  window.webContents.on("context-menu", () => {
    const eventAt = Date.now();
    if (contextMenuClaims.shouldSuppressEvent(eventAt)) {
      return;
    }
    setTimeout(() => {
      if (window.isDestroyed() || contextMenuClaims.claimArrivedAfter(eventAt)) {
        return;
      }
      Menu.buildFromTemplate(createContextMenuTemplate(isDevelopment)).popup({ window });
    }, 50);
  });
};

import type { BrowserWindow } from "electron";
import electron from "electron";
import {
  type ContextMenuClaimTarget,
  CONTEXT_MENU_CLAIM_WINDOW_MS,
  createContextMenuClaimTracker,
} from "./context-menu-claim";
import {
  createApplicationMenuTemplate,
  createContextMenuTemplate,
  type MainMenuInput,
} from "./main-menu-template";

const { Menu } = electron;

const contextMenuClaims = createContextMenuClaimTracker();

export const markContextMenuClaimed = (target: ContextMenuClaimTarget): void => {
  contextMenuClaims.claim(target);
};

export const installApplicationMenu = (input: MainMenuInput): void => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate(input)));
};

export const registerWindowContextMenu = (
  window: BrowserWindow,
  { isDevelopment }: MainMenuInput,
): void => {
  window.webContents.on("context-menu", (_event, params) => {
    const eventId = contextMenuClaims.trackEvent({
      webContentsId: window.webContents.id,
      x: params.x,
      y: params.y,
    });
    setTimeout(() => {
      const claimed = contextMenuClaims.takeClaim(eventId);
      if (window.isDestroyed() || claimed) {
        return;
      }
      Menu.buildFromTemplate(createContextMenuTemplate(isDevelopment)).popup({ window });
    }, CONTEXT_MENU_CLAIM_WINDOW_MS);
  });
};

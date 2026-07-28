import { bootstrapOpenDucktorShell } from "@openducktor/frontend";
import "@openducktor/frontend/styles.css";
import { ELECTRON_WINDOW_TITLE_BAR_HEIGHT } from "../shared/electron-bridge-contract";
import { createElectronShellBridge, getElectronApi } from "./electron-shell-bridge";

const initializeElectronWindowChrome = (): void => {
  const { platform } = getElectronApi();
  const root = document.documentElement;
  root.classList.add("electron-shell", `electron-platform-${platform}`);
  root.style.setProperty("--electron-titlebar-height", `${ELECTRON_WINDOW_TITLE_BAR_HEIGHT}px`);
};

bootstrapOpenDucktorShell({
  createShellBridge: createElectronShellBridge,
  prepare: initializeElectronWindowChrome,
  routerMode: "hash",
}).catch((error: unknown) => {
  console.error("Critical Electron bootstrap failure", error);
});

import { bootstrapOpenDucktorShell, showOpenDucktorStartupFailure } from "@openducktor/frontend";
import "@openducktor/frontend/styles.css";
import { ELECTRON_WINDOW_TITLE_BAR_HEIGHT } from "../shared/electron-bridge-contract";
import {
  createElectronShellBridge,
  getElectronApi,
  withElectronDesktopShell,
} from "./electron-shell-bridge";
import {
  createRemoteShellBridge,
  confirmBrowserRemoteAccess,
} from "@openducktor/frontend/lib/remote/shell-bridge";
import { createBrowserRemoteTransport } from "@openducktor/frontend/lib/remote/transport";
import { getAppVersion } from "@openducktor/frontend/lib/app-version";

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
  hosts: {
    localHost: "electron",
    createRemoteBridge: (endpoint, local, queryClient) => {
      const version = getAppVersion();
      if (!version || !local) throw new Error("The desktop shell is not ready.");
      return withElectronDesktopShell(
        createRemoteShellBridge({
          clientKind: "desktop",
          endpoint,
          version,
          transport: createBrowserRemoteTransport(),
          notifications: local.notifications,
          queryClient,
        }),
      );
    },
    confirmRemoteAccess: (endpoint, pairingCode) => {
      const version = getAppVersion();
      if (!version) throw new Error("The desktop shell is not ready.");
      return confirmBrowserRemoteAccess({
        clientKind: "desktop",
        endpoint,
        version,
        pairingCode,
        transport: createBrowserRemoteTransport(),
      });
    },
    navigate: () => getElectronApi().selectHost(),
  },
}).catch((cause: unknown) => {
  showOpenDucktorStartupFailure();
  console.error("Critical Electron bootstrap failure", cause);
});

import { bootstrapOpenDucktorShell, showOpenDucktorStartupFailure } from "@openducktor/frontend";
import "@openducktor/frontend/styles.css";
import { ELECTRON_WINDOW_TITLE_BAR_HEIGHT } from "../shared/electron-bridge-contract";
import {
  createElectronShellBridge,
  getElectronApi,
  withElectronNativeTheme,
} from "./electron-shell-bridge";
import { createRemoteShellBridge } from "@openducktor/frontend/lib/remote/shell-bridge";
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
    createRemoteBridge: (endpoint, local) => {
      const version = getAppVersion();
      if (!version || !local) throw new Error("The desktop shell is not ready.");
      const bridge = createRemoteShellBridge({
        endpoint,
        version,
        transport: createBrowserRemoteTransport(),
        notifications: local.notifications,
      });
      return {
        ...bridge,
        client: withElectronNativeTheme(bridge.client, (theme) =>
          getElectronApi().setNativeTheme(theme),
        ),
      };
    },
    navigate: () => getElectronApi().selectHost(),
  },
}).catch((cause: unknown) => {
  showOpenDucktorStartupFailure();
  console.error("Critical Electron bootstrap failure", cause);
});

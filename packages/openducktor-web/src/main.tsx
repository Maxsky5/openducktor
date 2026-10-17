import { bootstrapOpenDucktorShell, showOpenDucktorStartupFailure } from "@openducktor/frontend";
import "@openducktor/frontend/styles.css";
import { createBrowserShellBridge } from "./browser-shell-bridge";
import { loadBrowserRuntimeConfig } from "./runtime-config";
import { getBrowserBackendUrl, isRemoteBrowserMode } from "./browser-config";
import { createRemoteShellBridge } from "@openducktor/frontend/lib/remote/shell-bridge";
import { createBrowserRemoteTransport } from "@openducktor/frontend/lib/remote/transport";
import { getAppVersion } from "@openducktor/frontend/lib/app-version";
import { createBrowserNotificationBridge } from "./browser-notification-bridge";

async function startClient(): Promise<void> {
  const standalone = import.meta.env.VITE_ODT_STANDALONE === "true";
  if (!standalone) await loadBrowserRuntimeConfig();
  await bootstrapOpenDucktorShell({
    createShellBridge: createBrowserShellBridge,
    hosts: {
      localHost: !standalone && !isRemoteBrowserMode() ? "web" : null,
      defaultEndpoint: !standalone && isRemoteBrowserMode() ? getBrowserBackendUrl() : undefined,
      createRemoteBridge: (endpoint) => {
        const version = getAppVersion();
        if (!version) throw new Error("The client app version is missing. Rebuild the web client.");
        return createRemoteShellBridge({
          endpoint,
          version,
          transport: createBrowserRemoteTransport(),
          notifications: createBrowserNotificationBridge({ scope: endpoint }),
        });
      },
    },
  });
}

void startClient().catch((cause: unknown) => {
  showOpenDucktorStartupFailure();
  console.error("Critical browser bootstrap failure", cause);
});

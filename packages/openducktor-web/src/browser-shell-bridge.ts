import type { ShellBridge } from "@openducktor/frontend";
import { getBrowserAuthToken, getBrowserBackendUrl } from "./browser-config";
import {
  buildLocalAttachmentPreviewUrl,
  createLocalHostClient,
  subscribeLocalHostDevServerEvents,
  subscribeLocalHostRunEvents,
  subscribeLocalHostTaskEvents,
} from "./local-host-transport";

export const createBrowserShellBridge = (): ShellBridge => {
  const client = createLocalHostClient();

  return {
    client,
    capabilities: {
      canOpenExternalUrls: true,
      canPreviewLocalAttachments: true,
    },
    subscribeRunEvents: subscribeLocalHostRunEvents,
    subscribeDevServerEvents: subscribeLocalHostDevServerEvents,
    subscribeTaskEvents: subscribeLocalHostTaskEvents,
    openExternalUrl: async (url) => {
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        throw new Error(
          "Browser blocked the external URL window. Allow popups for OpenDucktor web.",
        );
      }
    },
    resolveLocalAttachmentPreviewSrc: async (path) => {
      const resolvedPath = (await client.workspaceResolveLocalAttachmentPath({ path })).path;
      return buildLocalAttachmentPreviewUrl(
        getBrowserBackendUrl(),
        getBrowserAuthToken(),
        resolvedPath,
      );
    },
  };
};

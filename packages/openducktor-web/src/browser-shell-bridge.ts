import type { ShellBridge } from "@openducktor/frontend";
import { getBrowserBackendUrl } from "./browser-config";
import { validateExternalBrowserUrl } from "./browser-url-validation";
import {
  buildLocalAttachmentPreviewUrl,
  createLocalHostClient,
  ensureLocalHostSession,
  subscribeLocalHostCodexAppServerEvents,
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
    subscribeCodexAppServerEvents: subscribeLocalHostCodexAppServerEvents,
    openExternalUrl: async (url) => {
      const opened = window.open(validateExternalBrowserUrl(url), "_blank", "noopener,noreferrer");
      if (!opened) {
        throw new Error(
          "Browser blocked the external URL window. Allow popups for OpenDucktor web.",
        );
      }
    },
    resolveLocalAttachmentPreviewSrc: async (path) => {
      const resolvedPath = (await client.workspaceResolveLocalAttachmentPath({ path })).path;
      await ensureLocalHostSession();
      return buildLocalAttachmentPreviewUrl(getBrowserBackendUrl(), resolvedPath);
    },
  };
};

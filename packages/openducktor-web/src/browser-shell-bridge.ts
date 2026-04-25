import type { ShellBridge } from "@openducktor/frontend";
import { getBrowserBackendUrl } from "./browser-config";
import {
  buildLocalAttachmentPreviewUrl,
  createLocalHostClient,
  ensureLocalHostSession,
  subscribeLocalHostDevServerEvents,
  subscribeLocalHostRunEvents,
  subscribeLocalHostTaskEvents,
} from "./local-host-transport";

export const validateExternalBrowserUrl = (url: string): string => {
  const trimmedUrl = url.trim();
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new Error("OpenDucktor web can only open absolute http or https URLs.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("OpenDucktor web can only open http or https URLs.");
  }

  return parsedUrl.href;
};

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

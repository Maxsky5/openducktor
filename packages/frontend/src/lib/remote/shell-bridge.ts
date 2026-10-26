import { createRemoteHostConnection } from "@openducktor/frontend-core/recovery/remote-host-connection";
import { createRemoteTerminalBridge } from "@openducktor/frontend-core/terminals/remote-terminal-bridge";
import {
  remoteError,
  type RemoteHostClient,
  type RemoteTransport,
} from "@openducktor/host-client/remote";
import type { QueryClient } from "@tanstack/react-query";
import { createDisabledAppUpdateBridge, type ShellBridge } from "../shell-bridge";
import { browserArtifactPreviewEnvironment } from "../artifact-preview-environment";

/** Creates the browser shell of a remote host. The frontend core owns the connection recovery. */
export const createRemoteShellBridge = ({
  endpoint,
  version,
  transport,
  notifications,
  queryClient,
}: {
  endpoint: string;
  version: string;
  transport: RemoteTransport;
  notifications: ShellBridge["notifications"];
  queryClient: QueryClient;
}): ShellBridge => {
  const connection = createRemoteHostConnection({ endpoint, version, transport, queryClient });
  const { remote, waitForAdmission, subscribeRecovery: _subscribeRecovery, ...host } = connection;
  return {
    ...host,
    getArtifactPreviewEnvironment: async () => browserArtifactPreviewEnvironment(endpoint),
    remoteConnection: remote,
    dispose: () => remote.disconnect(),
    setActive: (active) => remote.setActive(active),
    capabilities: { canOpenExternalUrls: true, canPreviewLocalAttachments: true },
    notifications,
    appUpdates: createDisabledAppUpdateBridge({
      status: "disabled",
      currentVersion: version,
      disabledCode: "unsupported_web_runner",
      disabledReason: "Use the local shell to install app updates.",
    }),
    openExternalUrl: async (url) => {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol))
        throw new Error("Use an http or https external URL.");
      window.open(parsed.href, "_blank", "noopener,noreferrer");
    },
    resolveTaskAssetSource: async (context, signal) => {
      await waitForAdmission(signal);
      return { kind: "blob", blob: resourceBlob(await remote.readTaskAsset(context, signal)) };
    },
    resolveLocalAttachmentPreview: async (path, signal) => {
      await waitForAdmission(signal);
      return {
        kind: "blob",
        blob: resourceBlob(await remote.readStagedPreview(path, signal)),
      };
    },
    // The pages of browser tabs load on the host machine, so a remote client cannot show them.
    browser: { surface: "frame", frames: null },
    terminals: createRemoteTerminalBridge(connection),
  };
};

const resourceBlob = (
  resource: Awaited<ReturnType<RemoteHostClient["readStagedPreview"]>>,
): Blob => {
  const type = resource.headers["content-type"];
  if (!type)
    throw remoteError(
      "invalid_protocol",
      "The resource response has no media type.",
      "Check the host and proxy response headers, then retry.",
    );
  return new Blob([resource.bytes], { type });
};

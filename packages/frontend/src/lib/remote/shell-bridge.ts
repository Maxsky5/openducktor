import { createRemoteHostConnection } from "@openducktor/frontend-core/recovery/remote-host-connection";
import {
  remoteError,
  type RemoteHostClient,
  type RemoteTransport,
} from "@openducktor/host-client/remote";
import type { QueryClient } from "@tanstack/react-query";
import { createDisabledAppUpdateBridge, type ShellBridge } from "../shell-bridge";

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
  const { remote, waitForAdmission, subscribeRecovery, ...host } = createRemoteHostConnection({
    endpoint,
    version,
    transport,
    queryClient,
  });
  return {
    ...host,
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
    terminals: {
      subscribeRecovery,
      connect: async (onFrame, onState, onFailure) => {
        const abort = new AbortController();
        await waitForAdmission();
        const socket = await remote.connectTerminal(abort.signal, onFrame, (failure) => {
          onState("disconnected");
          if (failure)
            onFailure({
              code: "protocol_error",
              message: failure.message,
            });
        });
        onState("connected");
        return {
          send: socket.send,
          close: () => {
            abort.abort();
            socket.close();
          },
        };
      },
    },
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

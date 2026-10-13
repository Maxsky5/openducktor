import { createBrowserRemoteTaskSubscriptions, waitForRemoteAdmission } from "./task-subscriptions";
import { createNotificationFrameRelay } from "./notification-frame-relay";
import { synchronizeBrowserState } from "./state-recovery";
import {
  REMOTE_BASELINE_CAPABILITIES,
  type AgentSessionLiveAttachInput,
  type AgentSessionLiveEnvelope,
} from "@openducktor/contracts";
import { createAgentSessionLiveAttachment } from "@openducktor/host-client";
import {
  createRemoteHostClient,
  remoteError,
  type RemoteHostClient,
  type RemoteSynchronizationContext,
} from "@openducktor/host-client/remote";
import {
  createDisabledAppUpdateBridge,
  observeShellEventResult,
  type BrowserLiveControlListener,
  type ShellBridge,
} from "../shell-bridge";
import { appQueryClient } from "../query-client";
import { browserLiveStreamWarningEvent } from "../browser-live-control-events";
import type { RemoteTransport } from "@openducktor/host-client/remote";

type LiveOwner = {
  input: AgentSessionLiveAttachInput;
  attachment: ReturnType<typeof createAgentSessionLiveAttachment>;
  restoring: Promise<void> | null;
};
/** Shares one host connection across views and waits for their recovery before work unlocks. */
export const createRemoteShellBridge = ({
  endpoint,
  version,
  transport,
  notifications: notificationBridge,
}: {
  endpoint: string;
  version: string;
  transport: RemoteTransport;
  notifications: ShellBridge["notifications"];
}): ShellBridge => {
  const notifications = createNotificationFrameRelay();
  const live = new Set<LiveOwner>();
  const terminalRecoveries = new Set<(signal: AbortSignal) => Promise<void>>();
  const controls = new Set<BrowserLiveControlListener>();
  const waitForAdmission = (signal?: AbortSignal) => waitForRemoteAdmission(remote, signal);
  const restoreLive = (owner: LiveOwner): Promise<void> => {
    if (owner.restoring) return owner.restoring;
    owner.attachment.restart();
    const restoring = waitForAdmission()
      .then(() => remote.client.agentSessionLiveAttach(owner.input))
      .then((snapshot) => {
        if (live.has(owner)) owner.attachment.install(snapshot);
      });
    owner.restoring = restoring;
    void restoring
      .finally(() => {
        if (owner.restoring === restoring) owner.restoring = null;
      })
      .catch(() => {});
    return restoring;
  };
  const synchronize = async (context: RemoteSynchronizationContext) => {
    // State owners must apply stream snapshots before current-state reads.
    await taskOwners.synchronize();
    await Promise.all([...live].map(restoreLive));
    await Promise.all([...terminalRecoveries].map((recover) => recover(context.signal)));
    context.signal.throwIfAborted();
    // Fresh bootstrap reads can await connect; later attempts must recover owners that failed.
    if (context.generation > 1 || context.previousHostInstanceId !== null) {
      const missed =
        context.previousHostInstanceId === null ||
        context.previousHostInstanceId !== context.host.hostInstanceId ||
        context.hostReplay.hostChanged ||
        context.hostReplay.gaps.length > 0;
      await synchronizeBrowserState(appQueryClient, controls, missed);
      context.signal.throwIfAborted();
    }
  };
  const remote = createRemoteHostClient(
    endpoint,
    {
      appVersion: version,
      supportedProtocolVersions: [1],
      requiredCapabilities: [...REMOTE_BASELINE_CAPABILITIES],
      optionalCapabilities: [],
    },
    transport,
    synchronize,
  );
  const taskOwners = createBrowserRemoteTaskSubscriptions(remote);
  remote.subscribeState((state) => {
    if (state.status === "disconnected" || state.status === "failed" || state.status === "idle") {
      notifications.fail(new Error(state.failure?.message ?? "The remote connection was lost."));
      taskOwners.invalidate();
      for (const owner of live) owner.attachment.restart();
      for (const listener of controls)
        observeShellEventResult(listener(browserLiveStreamWarningEvent(state.failure?.message)));
    }
  });
  remote.subscribeNotifications((frame) => notifications.accept(frame));
  remote.subscribeHostEvents((event) => {
    if (event.channel === "openducktor://agent-session-live-event")
      for (const owner of live) owner.attachment.accept(event.payload);
  });
  const subscribe = async (
    listener: (event: import("@openducktor/contracts").HostEventEnvelope) => void,
    controlListener?: BrowserLiveControlListener,
  ) => {
    const stop = remote.subscribeHostEvents(listener);
    if (controlListener) controls.add(controlListener);
    return () => {
      stop();
      if (controlListener) controls.delete(controlListener);
    };
  };
  // Admission starts before mounting. View owners add their synchronization work as they mount.
  void remote.connect().catch((cause) => console.error("Remote browser connection failed", cause));
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) remote.setActive(false);
    else void remote.disconnect();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) remote.setActive(!document.hidden);
  });
  document.addEventListener("visibilitychange", () => {
    // Resume cached pages on return. Hidden tabs keep their live connection.
    if (!document.hidden && remote.readState().status === "idle") remote.setActive(true);
  });
  return {
    client: remote.client,
    remoteConnection: remote,
    dispose: () => remote.disconnect(),
    capabilities: { canOpenExternalUrls: true, canPreviewLocalAttachments: true },
    notifications: notificationBridge,
    appUpdates: createDisabledAppUpdateBridge({
      status: "disabled",
      currentVersion: version,
      disabledCode: "unsupported_web_runner",
      disabledReason: "Use the local shell to install app updates.",
    }),
    subscribeRuntimeChanges: (listener) =>
      subscribe((event) => {
        if (event.channel === "openducktor://runtime-changed")
          observeShellEventResult(listener(event.payload));
      }, listener),
    subscribeRunEvents: (listener) =>
      subscribe((event) => {
        if (event.channel === "openducktor://run-event")
          observeShellEventResult(listener(event.payload));
      }, listener),
    subscribeWorkspaceSessionUpdates: (listener) =>
      subscribe((event) => {
        if (event.channel === "openducktor://workspace-session-updated")
          observeShellEventResult(listener(event.payload));
      }, listener),
    subscribeAzureDevOpsConnectionUpdates: (listener) =>
      subscribe((event) => {
        if (event.channel === "openducktor://azure-devops-connection-updated")
          listener(event.payload);
      }),
    subscribeWorkspaceProviderSetupUpdates: (listener) =>
      subscribe((event) => {
        if (event.channel === "openducktor://workspace-provider-setup-updated")
          listener(event.payload);
      }),
    observeAgentSessionLive: async (
      input,
      listener: (envelope: AgentSessionLiveEnvelope) => void,
    ) => {
      const owner: LiveOwner = {
        input,
        attachment: createAgentSessionLiveAttachment(input.repoPath, listener),
        restoring: null,
      };
      live.add(owner);
      try {
        await restoreLive(owner);
      } catch (cause) {
        live.delete(owner);
        throw cause;
      }
      return () => {
        live.delete(owner);
      };
    },
    subscribeNotificationStream: async (input, onFrame, onFailure) =>
      notifications.subscribe(input, onFrame, onFailure),
    subscribeTaskStream: taskOwners.subscribeTaskStream,
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
      subscribeRecovery: (recover) => {
        terminalRecoveries.add(recover);
        return () => {
          terminalRecoveries.delete(recover);
        };
      },
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

import {
  REMOTE_BASELINE_CAPABILITIES,
  REMOTE_PROTOCOL_VERSION,
  type AgentSessionLiveAttachInput,
  type HostEventEnvelope,
} from "@openducktor/contracts";
import { createAgentSessionLiveAttachment } from "@openducktor/host-client";
import {
  createRemoteHostClient,
  type RemoteHostClient,
  type RemoteSynchronizationContext,
  type RemoteTransport,
} from "@openducktor/host-client/remote";
import type { QueryClient } from "@tanstack/react-query";
import {
  type ConnectionControlListener,
  type HostConnection,
  logListenerFailure,
} from "../connection/host-connection";
import { connectionStreamWarningEvent } from "./connection-control-events";
import { createNotificationFrameRelay } from "./notification-frame-relay";
import { synchronizeConnectionState } from "./state-recovery";
import { createRemoteTaskSubscriptions, waitForRemoteAdmission } from "./task-subscriptions";

type LiveOwner = {
  input: AgentSessionLiveAttachInput;
  attachment: ReturnType<typeof createAgentSessionLiveAttachment>;
  restoring: Promise<void> | null;
};

/** Recovers platform state, such as a terminal view, before remote work unlocks. */
export type RemoteRecoveryOwner = (signal: AbortSignal) => Promise<void>;

export type RemoteHostConnection = HostConnection & {
  remote: RemoteHostClient;
  /** Runs `recover` after each admission, before remote work unlocks, until you stop it. */
  subscribeRecovery(recover: RemoteRecoveryOwner): () => void;
  /** Resolves when the host admits this client. Rejects on a connection failure or abort. */
  waitForAdmission(signal?: AbortSignal): Promise<void>;
};

export type RemoteHostConnectionOptions = {
  endpoint: string;
  /** The client app version that the host reports in compatibility failures. */
  version: string;
  transport: RemoteTransport;
  /** The query client of the same client connection. Recovery refetches its active reads. */
  queryClient: QueryClient;
};

/** Shares one remote host connection across views and waits for their recovery before work unlocks. */
export const createRemoteHostConnection = ({
  endpoint,
  version,
  transport,
  queryClient,
}: RemoteHostConnectionOptions): RemoteHostConnection => {
  const notifications = createNotificationFrameRelay();
  const live = new Set<LiveOwner>();
  const recoveryOwners = new Set<RemoteRecoveryOwner>();
  const controls = new Set<ConnectionControlListener>();
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
    await Promise.all([...recoveryOwners].map((recover) => recover(context.signal)));
    context.signal.throwIfAborted();
    // Fresh bootstrap reads can await connect; later attempts must recover owners that failed.
    if (context.generation > 1 || context.previousHostInstanceId !== null) {
      const missed =
        context.previousHostInstanceId === null ||
        context.previousHostInstanceId !== context.host.hostInstanceId ||
        context.hostReplay.hostChanged ||
        context.hostReplay.gaps.length > 0;
      await synchronizeConnectionState(queryClient, controls, missed);
      context.signal.throwIfAborted();
    }
  };
  const remote = createRemoteHostClient(
    endpoint,
    {
      appVersion: version,
      supportedProtocolVersions: [REMOTE_PROTOCOL_VERSION],
      requiredCapabilities: [...REMOTE_BASELINE_CAPABILITIES],
      optionalCapabilities: [],
    },
    transport,
    synchronize,
  );
  const taskOwners = createRemoteTaskSubscriptions(remote);
  remote.subscribeState((state) => {
    if (state.status === "disconnected" || state.status === "failed" || state.status === "idle") {
      notifications.fail(new Error(state.failure?.message ?? "The remote connection was lost."));
      taskOwners.invalidate();
      for (const owner of live) owner.attachment.restart();
      for (const listener of controls)
        logListenerFailure(listener(connectionStreamWarningEvent(state.failure?.message)));
    }
  });
  remote.subscribeNotifications((frame) => notifications.accept(frame));
  remote.subscribeHostEvents((event) => {
    if (event.channel === "openducktor://agent-session-live-event")
      for (const owner of live) owner.attachment.accept(event.payload);
  });
  const subscribe = async (
    listener: (event: HostEventEnvelope) => void,
    controlListener?: ConnectionControlListener,
  ) => {
    const stop = remote.subscribeHostEvents(listener);
    if (controlListener) controls.add(controlListener);
    return () => {
      stop();
      if (controlListener) controls.delete(controlListener);
    };
  };
  // Admission starts before mounting. View owners add their synchronization work as they mount.
  void remote.connect().catch((cause) => console.error("Remote host connection failed", cause));
  return {
    client: remote.client,
    remote,
    waitForAdmission,
    subscribeRecovery: (recover) => {
      recoveryOwners.add(recover);
      return () => {
        recoveryOwners.delete(recover);
      };
    },
    subscribeRuntimeChanges: (listener) =>
      subscribe((event) => {
        if (event.channel === "openducktor://runtime-changed")
          logListenerFailure(listener(event.payload));
      }, listener),
    subscribeBrowserTabEvents: (listener) =>
      subscribe((event) => {
        if (event.channel === "openducktor://browser-event")
          logListenerFailure(listener(event.payload));
      }, listener),
    subscribeRunEvents: (listener) =>
      subscribe((event) => {
        if (event.channel === "openducktor://run-event")
          logListenerFailure(listener(event.payload));
      }, listener),
    subscribeWorkspaceSessionUpdates: (listener) =>
      subscribe((event) => {
        if (event.channel === "openducktor://workspace-session-updated")
          logListenerFailure(listener(event.payload));
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
    observeAgentSessionLive: async (input, listener) => {
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
  };
};

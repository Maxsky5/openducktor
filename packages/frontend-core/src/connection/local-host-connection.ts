import {
  notificationStreamSubscribeSchema,
  type HostEventChannel,
  type NotificationCursor,
  type RemoteAccessState,
} from "@openducktor/contracts";
import {
  BROWSER_EVENT_STREAM_NAME,
  createAgentSessionLiveAttachment,
  createHostClient,
  HostInvokeError,
  liveSessionStreamEventName,
  STARTUP_EVENT_STREAM_NAME,
  type HostClient,
} from "@openducktor/host-client";
import { HostChannelRequestError } from "@openducktor/host-client/channel";
import {
  CONNECTION_RECONNECTED_EVENT_KIND,
  connectionStreamWarningEvent,
  type ConnectionControlEvent,
} from "../recovery/connection-control-events";
import type { HostConnection } from "./host-connection";
import {
  createLocalHostChannel,
  type LocalHostChannel,
  type LocalHostChannelDependencies,
  type LocalHostChannelEvent,
  type LocalHostChannelListener,
} from "./local-host-channel";

const RUN_EVENT_CHANNEL = "openducktor://run-event";
const AGENT_SESSION_LIVE_EVENT_CHANNEL = "openducktor://agent-session-live-event";
const AZURE_DEVOPS_CONNECTION_EVENT_CHANNEL = "openducktor://azure-devops-connection-updated";
const RUNTIME_CHANGED_EVENT_CHANNEL = "openducktor://runtime-changed";
const TASK_MERGE_STATUS_EVENT_CHANNEL = "openducktor://task-merge-status-updated";
const BROWSER_EVENT_CHANNEL = "openducktor://browser-event";
const DEFAULT_EVENT_NAME = "message";
const INITIAL_CHANNEL_READY_TIMEOUT_MS = 10_000;

/** The parts of a host connection that the shell's own host channel serves. */
export type LocalHostConnection = Pick<
  HostConnection,
  | "client"
  | "subscribeRunEvents"
  | "subscribeAzureDevOpsConnectionUpdates"
  | "subscribeWorkspaceProviderSetupUpdates"
  | "subscribeWorkspaceSessionUpdates"
  | "subscribeStartupProgress"
  | "subscribeRuntimeChanges"
  | "subscribeTaskMergeStatusUpdates"
  | "subscribeBrowserTabEvents"
  | "observeAgentSessionLive"
  | "subscribeNotificationStream"
  | "subscribeTaskStream"
> & {
  /** Delivers the live remote access state of the local operator. */
  observeRemoteAccess(listener: (state: RemoteAccessState) => void): Promise<() => void>;
};

export type LocalHostConnectionOptions = Pick<
  LocalHostChannelDependencies,
  "prepare" | "openSocket" | "schedule"
> & {
  /**
   * The shell error of a failed request. The default turns a host failure into a
   * `HostInvokeError` and keeps other errors.
   */
  mapError?(cause: unknown, operation: string): Error;
};

/** The default shell error of a failed channel request. */
export const hostChannelInvokeError = (cause: unknown): Error => {
  if (cause instanceof HostChannelRequestError) {
    const { error } = cause;
    return new HostInvokeError(
      cause.message,
      error.kind === "host" ? (error.response.failure ?? null) : null,
      cause,
    );
  }
  return cause instanceof Error ? cause : new Error(String(cause));
};

const isControlEvent = (event: LocalHostChannelEvent): event is ConnectionControlEvent =>
  "__openducktorConnectionControl" in event;

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Serves the commands and event streams of the shell's own host over one host channel. The
 * channel opens on first use and closes when nothing uses it; the next use opens a new one.
 */
export const createLocalHostConnection = ({
  prepare,
  openSocket,
  schedule,
  mapError = hostChannelInvokeError,
}: LocalHostConnectionOptions): LocalHostConnection => {
  let channel: LocalHostChannel | null = null;
  const current = (notificationCursor: NotificationCursor | null = null): LocalHostChannel => {
    if (channel) return channel;
    const dependencies: LocalHostChannelDependencies = {
      prepare,
      openSocket,
      notificationCursor,
      onDispose: () => {
        if (channel === created) channel = null;
      },
    };
    if (schedule) dependencies.schedule = schedule;
    const created = createLocalHostChannel(dependencies);
    channel = created;
    return created;
  };

  const client: HostClient = createHostClient(async (command, args, resultSchema, options) => {
    const signal = options?.signal;
    try {
      return resultSchema.parse(
        await current().request({ method: "invoke", command, args: args ?? {} }, signal),
      );
    } catch (cause) {
      // The caller stopped waiting. The host interrupts a read and keeps other work.
      if (signal?.aborted && cause === signal.reason) throw cause;
      throw mapError(cause, "invoke");
    }
  });

  /** Adds a listener and waits until the channel finished its first replay. */
  const subscribeReady = async (
    eventChannel: HostEventChannel,
    listener: LocalHostChannelListener,
    eventName = DEFAULT_EVENT_NAME,
  ): Promise<() => void> => {
    const opened = current();
    let active = true;
    const remove = opened.addListener({
      channel: eventChannel,
      eventName,
      listener,
      receivesControlEvents: true,
    });
    const unsubscribe = () => {
      active = false;
      remove();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        opened.ready,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("Timed out waiting for the host channel to open.")),
            INITIAL_CHANNEL_READY_TIMEOUT_MS,
          );
        }),
      ]);
      // The first open does not prove the channel is connected now. A control subscriber that
      // joins during a connection failure gets that failure before its subscription is ready.
      const warning = opened.readConnectionWarning();
      if (active && warning !== null) await listener(connectionStreamWarningEvent(warning));
    } catch (cause) {
      unsubscribe();
      throw mapError(cause, "await-ready");
    } finally {
      clearTimeout(timer);
    }
    return unsubscribe;
  };

  return {
    client,
    subscribeRunEvents: (listener) =>
      // Control events report reconnects, so a listener can read the state that it missed.
      subscribeReady(RUN_EVENT_CHANNEL, (event) => {
        if (isControlEvent(event)) return listener(event);
        if (event.channel === RUN_EVENT_CHANNEL) return listener(event.payload);
      }),
    subscribeAzureDevOpsConnectionUpdates: (listener) =>
      subscribeReady(AZURE_DEVOPS_CONNECTION_EVENT_CHANNEL, (event) => {
        if (!isControlEvent(event) && event.channel === AZURE_DEVOPS_CONNECTION_EVENT_CHANNEL)
          listener(event.payload);
      }),
    subscribeWorkspaceProviderSetupUpdates: (listener) =>
      subscribeReady("openducktor://workspace-provider-setup-updated", (event) => {
        if (
          !isControlEvent(event) &&
          event.channel === "openducktor://workspace-provider-setup-updated"
        )
          listener(event.payload);
      }),
    subscribeWorkspaceSessionUpdates: (listener) =>
      subscribeReady("openducktor://workspace-session-updated", (event) => {
        if (isControlEvent(event)) return listener(event);
        if (event.channel === "openducktor://workspace-session-updated")
          return listener(event.payload);
      }),
    subscribeStartupProgress: (listener) =>
      subscribeReady(
        "openducktor://session-startup-progress",
        (event) => {
          if (isControlEvent(event) || event.channel === "openducktor://session-startup-progress")
            return listener(event);
        },
        STARTUP_EVENT_STREAM_NAME,
      ),
    subscribeRuntimeChanges: (listener) =>
      subscribeReady(RUNTIME_CHANGED_EVENT_CHANNEL, (event) => {
        if (isControlEvent(event)) return listener(event);
        if (event.channel === RUNTIME_CHANGED_EVENT_CHANNEL) return listener(event.payload);
      }),
    subscribeTaskMergeStatusUpdates: (listener) =>
      subscribeReady(TASK_MERGE_STATUS_EVENT_CHANNEL, (event) => {
        if (isControlEvent(event)) return listener(event);
        if (event.channel === TASK_MERGE_STATUS_EVENT_CHANNEL) return listener(event.payload);
      }),
    subscribeBrowserTabEvents: (listener) =>
      subscribeReady(
        BROWSER_EVENT_CHANNEL,
        (event) => {
          if (isControlEvent(event)) return listener(event);
          if (event.channel === BROWSER_EVENT_CHANNEL) return listener(event.payload);
        },
        BROWSER_EVENT_STREAM_NAME,
      ),
    observeAgentSessionLive: async (input, listener) => {
      let closed = false;
      // Each attach request takes a new generation. Only the latest one can install its snapshot.
      let attachGeneration = 0;
      const attachment = createAgentSessionLiveAttachment(input.repoPath, listener);
      const attach = async (generation: number): Promise<void> => {
        const snapshot = await client.agentSessionLiveAttach(input);
        if (!closed && generation === attachGeneration) attachment.install(snapshot);
      };
      // A complete replay keeps the current state. Missed events need a new host snapshot.
      const reattach = (): void => {
        const generation = ++attachGeneration;
        attachment.restart();
        attach(generation).catch((cause: unknown) => {
          if (!closed && generation === attachGeneration)
            listener({
              type: "fault",
              repoPath: input.repoPath,
              operation: "agent-session-live.attach",
              message: errorMessage(cause),
            });
        });
      };
      const unsubscribe = await subscribeReady(
        AGENT_SESSION_LIVE_EVENT_CHANNEL,
        (event) => {
          if (isControlEvent(event)) {
            if (event.kind === CONNECTION_RECONNECTED_EVENT_KIND && event.missedEvents) reattach();
            return;
          }
          if (event.channel === AGENT_SESSION_LIVE_EVENT_CHANNEL) attachment.accept(event.payload);
        },
        liveSessionStreamEventName(input.repoPath),
      );
      try {
        // A recovery before the first open can already have started a newer request.
        await attach(++attachGeneration);
      } catch (cause) {
        unsubscribe();
        throw mapError(cause, "agent-session-live.attach");
      }
      return () => {
        closed = true;
        unsubscribe();
      };
    },
    subscribeTaskStream: async (input, onFrame, onTerminalFailure) => {
      let subscription: Awaited<ReturnType<LocalHostChannel["subscribeTaskEvents"]>>;
      try {
        subscription = await current().subscribeTaskEvents(input, onFrame, onTerminalFailure);
      } catch (cause) {
        throw mapError(cause, "task-event-stream.subscribe");
      }
      return {
        subscriptionId: subscription.subscriptionId,
        acknowledge: async (cursor) => {
          try {
            await subscription.acknowledge(cursor);
          } catch (cause) {
            throw mapError(cause, "task-event-stream.acknowledge");
          }
        },
        unsubscribe: () => subscription.unsubscribe(),
      };
    },
    subscribeNotificationStream: async (input, onFrame, onFailure) => {
      const parsed = notificationStreamSubscribeSchema.parse(input);
      return current(parsed.cursor).subscribeNotifications(parsed, onFrame, onFailure);
    },
    observeRemoteAccess: async (listener) => {
      return current().observeRemoteAccess(listener);
    },
  };
};

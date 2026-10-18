import type {
  AgentSessionLiveAttachInput,
  AgentSessionLiveEnvelope,
  HostEventPayload,
  NotificationCursor,
  NotificationStreamFrame,
  TaskEventCursor,
  TaskEventStreamFrame,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import type { ConnectionControlEvent } from "../recovery/connection-control-events";

/** Reconnect handlers return the recovery that must finish before remote work unlocks. */
export type ConnectionControlListener = (payload: ConnectionControlEvent) => void | Promise<void>;

/** Logs a listener failure when the transport cannot await the listener. */
export const logListenerFailure = (result: void | Promise<void>): void => {
  void Promise.resolve(result).catch((cause: unknown) => {
    console.error("Host event listener failed", cause);
  });
};

/** Run events, such as Autopilot outcomes. Control events report stream loss and reconnects. */
export type RunEventListener = (
  payload: HostEventPayload<"openducktor://run-event"> | ConnectionControlEvent,
) => void | Promise<void>;
export type AzureDevOpsConnectionUpdateListener = (
  payload: HostEventPayload<"openducktor://azure-devops-connection-updated">,
) => void;
export type WorkspaceProviderSetupUpdateListener = (
  payload: HostEventPayload<"openducktor://workspace-provider-setup-updated">,
) => void;
export type WorkspaceSessionUpdateListener = (
  payload: HostEventPayload<"openducktor://workspace-session-updated"> | ConnectionControlEvent,
) => void | Promise<void>;
/** Host runtime lifecycle changes. Control events report stream loss and reconnects. */
export type RuntimeChangeListener = (
  payload: HostEventPayload<"openducktor://runtime-changed"> | ConnectionControlEvent,
) => void | Promise<void>;

export type TaskStreamFrame = TaskEventStreamFrame;

export type TaskStreamSubscription = {
  subscriptionId: string;
  acknowledge(cursor: TaskEventCursor): Promise<void>;
  unsubscribe(): void | Promise<void>;
};

/** The typed commands and the event streams of one host. */
export type HostConnection = {
  subscribeWorkspaceProviderSetupUpdates: (
    listener: WorkspaceProviderSetupUpdateListener,
  ) => Promise<() => void>;
  client: HostClient;
  subscribeWorkspaceSessionUpdates: (
    listener: WorkspaceSessionUpdateListener,
  ) => Promise<() => void>;
  subscribeRuntimeChanges: (listener: RuntimeChangeListener) => Promise<() => void>;
  subscribeRunEvents: (listener: RunEventListener) => Promise<() => void>;
  subscribeAzureDevOpsConnectionUpdates: (
    listener: AzureDevOpsConnectionUpdateListener,
  ) => Promise<() => void>;
  observeAgentSessionLive: (
    input: AgentSessionLiveAttachInput,
    listener: (envelope: AgentSessionLiveEnvelope) => void,
  ) => Promise<() => void>;
  subscribeNotificationStream: (
    input: { cursor: NotificationCursor | null },
    onFrame: (frame: NotificationStreamFrame) => void,
    onFailure: (cause: unknown) => void,
  ) => Promise<() => void>;
  subscribeTaskStream: (
    input: { cursor: TaskEventCursor | null },
    onFrame: (frame: TaskStreamFrame) => void,
    onTerminalFailure?: (cause: unknown) => void,
    signal?: AbortSignal,
  ) => Promise<TaskStreamSubscription>;
};

import type {
  AppUpdateCheckInput,
  AppUpdateCommandResult,
  AppUpdateState,
  HostInvokeFailure,
  TaskEventCursor,
  TaskEventStreamAcknowledge,
  TaskEventStreamFrame,
  TaskEventStreamSubscribe,
} from "@openducktor/contracts";
import {
  taskEventStreamAcknowledgeSchema,
  taskEventStreamFrameSchema,
} from "@openducktor/contracts";
import type { HostCommandName } from "@openducktor/host";

export const ELECTRON_HOST_INVOKE_CHANNEL = "openducktor:host-invoke";
export const ELECTRON_HOST_EVENT_CHANNEL = "openducktor:host-event";
export const ELECTRON_OPEN_EXTERNAL_URL_CHANNEL = "openducktor:open-external-url";
export const ELECTRON_LOCAL_ATTACHMENT_PREVIEW_CHANNEL = "openducktor:local-attachment-preview-src";
export const ELECTRON_APP_UPDATE_GET_STATE_CHANNEL = "openducktor:app-update:get-state";
export const ELECTRON_APP_UPDATE_CHECK_CHANNEL = "openducktor:app-update:check";
export const ELECTRON_APP_UPDATE_DOWNLOAD_CHANNEL = "openducktor:app-update:download";
export const ELECTRON_APP_UPDATE_INSTALL_CHANNEL = "openducktor:app-update:install";
export const ELECTRON_APP_UPDATE_STATE_CHANGED_CHANNEL = "openducktor:app-update:state-changed";
export const ELECTRON_HOST_SHUTDOWN_MESSAGE =
  "OpenDucktor is shutting down. The requested command was not run.";
export const ELECTRON_TERMINAL_SEND_CHANNEL = "openducktor:terminal:send";
export const ELECTRON_TERMINAL_DISCONNECT_CHANNEL = "openducktor:terminal:disconnect";
export const ELECTRON_TERMINAL_EVENT_CHANNEL = "openducktor:terminal:event";
export const ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL = "openducktor:task-stream:subscribe";
export const ELECTRON_TASK_STREAM_FRAME_CHANNEL = "openducktor:task-stream:frame";
export const ELECTRON_TASK_STREAM_ACKNOWLEDGE_CHANNEL = "openducktor:task-stream:acknowledge";
export const ELECTRON_TASK_STREAM_UNSUBSCRIBE_CHANNEL = "openducktor:task-stream:unsubscribe";

export type ElectronHostInvokeRequest = {
  command: string;
  args?: Record<string, unknown>;
};

export type ElectronHostInvokeResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      error: {
        message: string;
        failure?: HostInvokeFailure;
      };
    };

export type ElectronHostInvokeResponse =
  | {
      status: "success";
      payload: unknown;
    }
  | {
      status: "shutdown";
    };

export type ElectronHostEventEnvelope = {
  channel: string;
  payload: unknown;
};

export type ElectronTerminalEventEnvelope = {
  clientId: string;
  frame: Uint8Array;
};

export const electronTaskStreamSubscriptionSchema = taskEventStreamAcknowledgeSchema.pick({
  subscriptionId: true,
});
export type ElectronTaskStreamSubscription = Pick<TaskEventStreamAcknowledge, "subscriptionId">;

export const electronTaskStreamUnsubscribeSchema = taskEventStreamAcknowledgeSchema.pick({
  subscriptionId: true,
});
export type ElectronTaskStreamUnsubscribe = Pick<TaskEventStreamAcknowledge, "subscriptionId">;

export const electronTaskStreamFrameEnvelopeSchema = taskEventStreamAcknowledgeSchema
  .extend({ frame: taskEventStreamFrameSchema })
  .pick({ frame: true, subscriptionId: true });
export type ElectronTaskStreamFrameEnvelope = Pick<TaskEventStreamAcknowledge, "subscriptionId"> & {
  frame: TaskEventStreamFrame;
};

export type ElectronAppUpdateCheckInput = AppUpdateCheckInput;

export type OpenDucktorElectronAppUpdateApi = {
  getState(): Promise<AppUpdateState>;
  check(input: ElectronAppUpdateCheckInput): Promise<AppUpdateCommandResult>;
  download(): Promise<AppUpdateCommandResult>;
  install(): Promise<AppUpdateCommandResult>;
  subscribe(listener: (state: AppUpdateState) => void): () => void;
};

export type OpenDucktorElectronTerminalApi = {
  send(clientId: string, frame: Uint8Array): Promise<void>;
  disconnect(clientId: string): Promise<void>;
  subscribe(clientId: string, listener: (frame: Uint8Array) => void): () => void;
};

export type OpenDucktorElectronTaskStreamApi = {
  subscribe(
    input: TaskEventStreamSubscribe,
    listener: (frame: TaskEventStreamFrame) => void,
  ): Promise<{
    subscriptionId: string;
    acknowledge(cursor: TaskEventCursor): Promise<void>;
    unsubscribe(): void | Promise<void>;
  }>;
};

export type OpenDucktorElectronApi = {
  invoke(
    command: HostCommandName,
    args?: Record<string, unknown>,
  ): Promise<ElectronHostInvokeResult>;
  subscribe(channel: string, listener: (payload: unknown) => void): () => void;
  appUpdates: OpenDucktorElectronAppUpdateApi;
  openExternalUrl(url: string): Promise<void>;
  resolveLocalAttachmentPreviewSrc(path: string): Promise<string>;
  terminals: OpenDucktorElectronTerminalApi;
  taskStream: OpenDucktorElectronTaskStreamApi;
};

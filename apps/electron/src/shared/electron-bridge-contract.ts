import type {
  AppPlatform,
  AppUpdateCheckInput,
  AppUpdateCommandResult,
  AppUpdateState,
  HostEventChannel,
  HostEventEnvelope,
  HostEventPayload,
  NotificationClickEvent,
  NotificationDeliveryResult,
  NotificationOsCapability,
  NotificationOsDeliveryRequest,
  TaskEventCursor,
  TaskEventStreamAcknowledge,
  TaskEventStreamFrame,
  TaskEventStreamSubscribe,
} from "@openducktor/contracts";
import {
  hostInvokeFailureSchema,
  taskEventStreamAcknowledgeSchema,
  taskEventStreamFrameSchema,
  notificationClickEventSchema,
  notificationDeliveryResultSchema,
  notificationOsCapabilitySchema,
  notificationOsDeliveryRequestSchema,
} from "@openducktor/contracts";
import type { HostCommandName, HostCommandResult } from "@openducktor/host";
import { z } from "zod";

export const ELECTRON_HOST_INVOKE_CHANNEL = "openducktor:host-invoke";
export const ELECTRON_HOST_EVENT_CHANNEL = "openducktor:host-event";
export const ELECTRON_OPEN_EXTERNAL_URL_CHANNEL = "openducktor:open-external-url";
export const ELECTRON_LOCAL_ATTACHMENT_PREVIEW_CHANNEL = "openducktor:local-attachment-preview-src";
export const ELECTRON_EDITOR_CLIPBOARD_READ_CHANNEL = "openducktor:editor-clipboard:read";
export const ELECTRON_APP_UPDATE_GET_STATE_CHANNEL = "openducktor:app-update:get-state";
export const ELECTRON_APP_UPDATE_CHECK_CHANNEL = "openducktor:app-update:check";
export const ELECTRON_APP_UPDATE_DOWNLOAD_CHANNEL = "openducktor:app-update:download";
export const ELECTRON_APP_UPDATE_INSTALL_CHANNEL = "openducktor:app-update:install";
export const ELECTRON_APP_UPDATE_STATE_CHANGED_CHANNEL = "openducktor:app-update:state-changed";
export const ELECTRON_HOST_SHUTDOWN_MESSAGE =
  "OpenDucktor is shutting down. The requested command was not run.";
export const ELECTRON_TERMINAL_SEND_CHANNEL = "openducktor:terminal:send";
export const PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE =
  "application/vnd.pierre.diffs-selections+json" as const;
export type EditorClipboardReadType = typeof PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE;
export const ELECTRON_TERMINAL_DISCONNECT_CHANNEL = "openducktor:terminal:disconnect";
export const ELECTRON_TERMINAL_EVENT_CHANNEL = "openducktor:terminal:event";
export const ELECTRON_TASK_STREAM_SUBSCRIBE_CHANNEL = "openducktor:task-stream:subscribe";
export const ELECTRON_TASK_STREAM_FRAME_CHANNEL = "openducktor:task-stream:frame";
export const ELECTRON_TASK_STREAM_TERMINAL_FAILURE_CHANNEL =
  "openducktor:task-stream:terminal-failure";
export const ELECTRON_TASK_STREAM_ACKNOWLEDGE_CHANNEL = "openducktor:task-stream:acknowledge";
export const ELECTRON_TASK_STREAM_UNSUBSCRIBE_CHANNEL = "openducktor:task-stream:unsubscribe";
export const ELECTRON_NOTIFICATION_CLICKED_CHANNEL = "openducktor:notification:clicked";
export const ELECTRON_NOTIFICATION_GET_CAPABILITY_CHANNEL =
  "openducktor:notification:get-capability";
export const ELECTRON_NOTIFICATION_REQUEST_PERMISSION_CHANNEL =
  "openducktor:notification:request-permission";
export const ELECTRON_NOTIFICATION_GET_APP_FOCUS_CHANNEL = "openducktor:notification:get-app-focus";
export const ELECTRON_NOTIFICATION_SHOW_CHANNEL = "openducktor:notification:show";
export const ELECTRON_WINDOW_TITLE_BAR_HEIGHT = 40;

const ipcRecordSchema = z.record(z.string(), z.unknown()).refine((value) => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
});

export const electronHostInvokeRequestSchema = ipcRecordSchema.and(
  z.strictObject({
    command: z.string(),
    args: ipcRecordSchema.optional(),
  }),
);
export type ElectronHostInvokeRequest = z.output<typeof electronHostInvokeRequestSchema>;

const electronHostInvokeResultWireSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), value: z.unknown() }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({
      message: z.string(),
      failure: hostInvokeFailureSchema.optional(),
    }),
  }),
]);
type ElectronHostInvokeFailureResult = Extract<
  z.output<typeof electronHostInvokeResultWireSchema>,
  { ok: false }
>;
export type ElectronHostInvokeWireResult = z.output<typeof electronHostInvokeResultWireSchema>;
export type ElectronHostInvokeResult<Command extends HostCommandName = HostCommandName> =
  | { ok: true; value: HostCommandResult<Command> }
  | ElectronHostInvokeFailureResult;

export const electronHostInvokeResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("success"), payload: electronHostInvokeResultWireSchema }),
  z.strictObject({ status: z.literal("shutdown") }),
]);
export type ElectronHostInvokeResponseEnvelope = z.output<typeof electronHostInvokeResponseSchema>;

export type ElectronHostEventEnvelope = HostEventEnvelope;

export type ElectronTerminalEventEnvelope = {
  clientId: string;
  frame: Uint8Array;
};
export const electronTerminalEventEnvelopeSchema: z.ZodType<ElectronTerminalEventEnvelope> =
  z.strictObject({
    clientId: z.string(),
    frame: z.instanceof(Uint8Array),
  });

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

export const electronTaskStreamTerminalFailureEnvelopeSchema =
  electronTaskStreamSubscriptionSchema.extend({
    message: z.string().min(1),
  });
export type ElectronTaskStreamTerminalFailureEnvelope = Pick<
  TaskEventStreamAcknowledge,
  "subscriptionId"
> & {
  message: string;
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
    onTerminalFailure?: (cause: unknown) => void,
  ): Promise<{
    subscriptionId: string;
    acknowledge(cursor: TaskEventCursor): Promise<void>;
    unsubscribe(): void | Promise<void>;
  }>;
};

export const electronNotificationCapabilitySchema = notificationOsCapabilitySchema;
export const electronNotificationDeliveryRequestSchema = notificationOsDeliveryRequestSchema;
export const electronNotificationDeliveryResultSchema = notificationDeliveryResultSchema;
export const electronNotificationClickEventSchema = notificationClickEventSchema;

export type OpenDucktorElectronNotificationApi = {
  getCapability(): Promise<NotificationOsCapability>;
  requestPermission(): Promise<NotificationOsCapability>;
  isAppFocused(): Promise<boolean>;
  show(request: NotificationOsDeliveryRequest): Promise<NotificationDeliveryResult>;
  subscribeClicks(listener: (event: NotificationClickEvent) => void): () => void;
};

export type OpenDucktorElectronApi = {
  platform: AppPlatform;
  invoke(
    command: HostCommandName,
    args?: ElectronHostInvokeRequest["args"],
  ): Promise<ElectronHostInvokeWireResult>;
  subscribe<Channel extends HostEventChannel>(
    channel: Channel,
    listener: (payload: HostEventPayload<Channel>) => void,
  ): () => void;
  appUpdates: OpenDucktorElectronAppUpdateApi;
  notifications: OpenDucktorElectronNotificationApi;
  openExternalUrl(url: string): Promise<void>;
  resolveLocalAttachmentPreviewSrc(path: string): Promise<string>;
  terminals: OpenDucktorElectronTerminalApi;
  taskStream: OpenDucktorElectronTaskStreamApi;
  editorClipboard: {
    readText(type?: EditorClipboardReadType): Promise<string>;
  };
};

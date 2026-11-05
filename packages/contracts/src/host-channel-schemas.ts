import { z } from "zod";
import {
  taskEventCursorSchema,
  taskEventStreamFrameSchema,
  taskEventStreamSubscribeSchema,
} from "./external-task-sync-schemas";
import { hostCommandInputRecordSchema } from "./host-command-contracts";
import { hostErrorResponseSchema } from "./host-invoke-failure-schemas";
import {
  notificationCursorSchema,
  notificationStreamFrameSchema,
} from "./notification-stream-schemas";
import { remoteAccessStateSchema, remoteFailureSchema } from "./remote-host-schemas";

/**
 * One host channel WebSocket carries the commands, host events, notifications, task event streams,
 * and remote access state of one client. Each frame is binary UTF-8 text: one JSON header, then an
 * optional body after the first line feed. `JSON.stringify` never writes a raw line feed.
 */
export const HOST_CHANNEL_SUBPROTOCOL = "openducktor-channel.v1";
/** The host sends a heartbeat message on each channel at this interval. */
export const HOST_CHANNEL_HEARTBEAT_INTERVAL_MS = 15_000;
/** A channel without messages for three heartbeats went down on the way without closing. */
export const HOST_CHANNEL_SILENCE_LIMIT_MS = 3 * HOST_CHANNEL_HEARTBEAT_INTERVAL_MS;
/** The largest client message that a host reads, such as a command with attachments. */
export const HOST_CHANNEL_MAX_CLIENT_MESSAGE_BYTES = 64 * 1024 * 1024;

const requestIdSchema = z.number().int().nonnegative();
const subscriptionIdSchema = z.uuid();

/** The position of a client in the host event replay. It is valid only for one host process. */
export const hostEventCursorSchema = z.strictObject({
  hostEpoch: z.string().min(1),
  hostEventId: z.number().int().nonnegative(),
});
export type HostEventCursor = z.infer<typeof hostEventCursorSchema>;

export const hostChannelRequestSchema = z.discriminatedUnion("method", [
  z.strictObject({
    type: z.literal("request"),
    id: requestIdSchema,
    method: z.literal("events.open"),
    cursor: hostEventCursorSchema.nullable(),
    notificationCursor: notificationCursorSchema.nullable(),
  }),
  z.strictObject({
    type: z.literal("request"),
    id: requestIdSchema,
    method: z.literal("invoke"),
    command: z.string().min(1),
    args: hostCommandInputRecordSchema,
  }),
  z.strictObject({
    type: z.literal("request"),
    id: requestIdSchema,
    method: z.literal("task_events.subscribe"),
    input: taskEventStreamSubscribeSchema,
  }),
  z.strictObject({
    type: z.literal("request"),
    id: requestIdSchema,
    method: z.literal("task_events.attach"),
    subscriptionId: subscriptionIdSchema,
  }),
  z.strictObject({
    type: z.literal("request"),
    id: requestIdSchema,
    method: z.literal("task_events.ack"),
    subscriptionId: subscriptionIdSchema,
    cursor: taskEventCursorSchema,
  }),
  z.strictObject({
    type: z.literal("request"),
    id: requestIdSchema,
    method: z.literal("task_events.release"),
    subscriptionId: subscriptionIdSchema,
  }),
  z.strictObject({
    type: z.literal("request"),
    id: requestIdSchema,
    method: z.literal("remote_access.observe"),
  }),
  z.strictObject({
    type: z.literal("request"),
    id: requestIdSchema,
    method: z.literal("remote_access.unobserve"),
  }),
]);
/** A client request message. */
export type HostChannelRequestMessage = z.infer<typeof hostChannelRequestSchema>;

/**
 * The client no longer waits for request `id`. The host interrupts a running host read command and
 * sends no answer. A command that can change host state keeps running.
 */
export const hostChannelCancelSchema = z.strictObject({
  type: z.literal("cancel"),
  id: requestIdSchema,
});

/** A message from a client to the host. */
export const hostChannelClientMessageSchema = z.union([
  hostChannelRequestSchema,
  hostChannelCancelSchema,
]);
export type HostChannelClientMessage = z.infer<typeof hostChannelClientMessageSchema>;
type DistributiveOmit<Value, Key extends PropertyKey> = Value extends unknown
  ? Omit<Value, Key>
  : never;
/** A client request without its frame type and request ID. */
export type HostChannelRequest = DistributiveOmit<HostChannelRequestMessage, "type" | "id">;

/** The result of `events.open`, sent after the replay of the retained host events. */
export const hostEventsOpenedSchema = z.strictObject({
  hostEpoch: z.string().min(1),
  /** The last host event ID at the end of the replay. Later events have higher IDs. */
  hostEventId: z.number().int().nonnegative(),
  /** The cursor came from another host process, so the client must read current state again. */
  hostChanged: z.boolean(),
  /** The host event names whose missed events the host no longer retains. */
  gaps: z.array(z.string().min(1)),
});
export type HostEventsOpened = z.infer<typeof hostEventsOpenedSchema>;

/** The result of `task_events.subscribe`. */
export const taskEventLeaseSchema = z.strictObject({
  subscriptionId: subscriptionIdSchema,
  replayBoundary: taskEventCursorSchema,
});
export type TaskEventLease = z.infer<typeof taskEventLeaseSchema>;

/** Why a request has no result. */
export const hostChannelErrorSchema = z.discriminatedUnion("kind", [
  /** The host ran the command, and it failed. */
  z.strictObject({ kind: z.literal("host"), response: hostErrorResponseSchema }),
  /** The host ran no work. */
  z.strictObject({ kind: z.literal("refused"), failure: remoteFailureSchema }),
  /** The host ran the command, but its reply is larger than the limit of this channel. */
  z.strictObject({
    kind: z.literal("reply_too_large"),
    limitBytes: z.number().int().positive(),
  }),
]);
export type HostChannelError = z.infer<typeof hostChannelErrorSchema>;

/** The header of a host message. A `result` and a `host_event` have a JSON body. */
export const hostChannelMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("result"), id: requestIdSchema }),
  z.strictObject({ type: z.literal("error"), id: requestIdSchema, error: hostChannelErrorSchema }),
  /** The body is the host event envelope. `name` selects its replay buffer and its listeners. */
  z.strictObject({
    type: z.literal("host_event"),
    id: z.number().int().positive(),
    name: z.string().min(1),
  }),
  z.strictObject({ type: z.literal("notification"), frame: notificationStreamFrameSchema }),
  z.strictObject({
    type: z.literal("task_frame"),
    subscriptionId: subscriptionIdSchema,
    frame: taskEventStreamFrameSchema,
  }),
  z.strictObject({ type: z.literal("remote_access_state"), state: remoteAccessStateSchema }),
  z.strictObject({ type: z.literal("heartbeat") }),
]);
export type HostChannelMessage = z.infer<typeof hostChannelMessageSchema>;

const LINE_FEED = 0x0a;
const encoder = new TextEncoder();
// A decode call without `stream` keeps no state, so one decoder serves every frame.
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Encodes one frame. A body must be JSON text. */
export const encodeHostChannelFrame = (
  header: HostChannelMessage | HostChannelClientMessage,
  body?: string,
): Uint8Array => {
  const text = JSON.stringify(header);
  return encoder.encode(body === undefined ? text : `${text}\n${body}`);
};

type HostChannelFrame = {
  /** The header JSON text. */
  header: string;
  /** The body bytes, or null for a frame without a body. */
  body: Uint8Array | null;
};

/** Splits one frame. The body stays encoded, so a reader decodes only the bodies that it uses. */
export const splitHostChannelFrame = (bytes: Uint8Array): HostChannelFrame => {
  const end = bytes.indexOf(LINE_FEED);
  if (end < 0) return { header: decoder.decode(bytes), body: null };
  return { header: decoder.decode(bytes.subarray(0, end)), body: bytes.subarray(end + 1) };
};

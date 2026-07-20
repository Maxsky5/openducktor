import { z } from "zod";
import {
  terminalFailureSchema,
  terminalIdSchema,
  terminalLifecycleSchema,
} from "./terminal-schemas";

export const TERMINAL_PROTOCOL_VERSION = 1 as const;
export const TERMINAL_PROTOCOL_SUBPROTOCOL = "openducktor-terminal.v1";
export const TERMINAL_PROTOCOL_MAX_MESSAGE_BYTES = 1024 * 1024;
export const TERMINAL_PROTOCOL_MAX_HEADER_BYTES = 64 * 1024;
export const TERMINAL_PROTOCOL_MAX_INPUT_BYTES = 64 * 1024;
export const TERMINAL_PROTOCOL_MAX_COLUMNS = 500;
export const TERMINAL_PROTOCOL_MAX_ROWS = 300;

const sequenceSchema = z.number().int().nonnegative();
const protocolBaseSchema = z.object({ version: z.literal(TERMINAL_PROTOCOL_VERSION) });

export const terminalClientMessageSchema = z.discriminatedUnion("type", [
  protocolBaseSchema
    .extend({
      type: z.literal("attach"),
      terminalId: terminalIdSchema,
      lastConsumedSequence: sequenceSchema.nullable(),
    })
    .strict(),
  protocolBaseSchema.extend({ type: z.literal("input"), terminalId: terminalIdSchema }).strict(),
  protocolBaseSchema
    .extend({
      type: z.literal("resize"),
      terminalId: terminalIdSchema,
      columns: z.number().int().min(1).max(TERMINAL_PROTOCOL_MAX_COLUMNS),
      rows: z.number().int().min(1).max(TERMINAL_PROTOCOL_MAX_ROWS),
    })
    .strict(),
  protocolBaseSchema
    .extend({
      type: z.literal("ack"),
      terminalId: terminalIdSchema,
      sequenceEnd: sequenceSchema,
    })
    .strict(),
  protocolBaseSchema.extend({ type: z.literal("detach"), terminalId: terminalIdSchema }).strict(),
]);
export type TerminalClientMessage = z.infer<typeof terminalClientMessageSchema>;

export const terminalServerMessageSchema = z.discriminatedUnion("type", [
  protocolBaseSchema
    .extend({
      type: z.literal("snapshot"),
      terminalId: terminalIdSchema,
      earliestRetainedSequence: sequenceSchema,
      snapshotSequenceEnd: sequenceSchema,
      lifecycle: terminalLifecycleSchema,
      title: z.string().min(1),
      complete: z.boolean(),
    })
    .strict(),
  protocolBaseSchema
    .extend({
      type: z.literal("output"),
      terminalId: terminalIdSchema,
      sequenceStart: sequenceSchema,
      sequenceEnd: sequenceSchema,
      replay: z.boolean(),
    })
    .strict()
    .superRefine((message, context) => {
      if (message.sequenceEnd <= message.sequenceStart) {
        context.addIssue({
          code: "custom",
          message: "sequenceEnd must be greater than sequenceStart",
          path: ["sequenceEnd"],
        });
      }
    }),
  protocolBaseSchema
    .extend({
      type: z.literal("replay_gap"),
      terminalId: terminalIdSchema,
      missingSequenceStart: sequenceSchema,
      missingSequenceEnd: sequenceSchema,
    })
    .strict()
    .superRefine((message, context) => {
      if (message.missingSequenceEnd <= message.missingSequenceStart) {
        context.addIssue({
          code: "custom",
          message: "missingSequenceEnd must be greater than missingSequenceStart",
          path: ["missingSequenceEnd"],
        });
      }
    }),
  protocolBaseSchema
    .extend({
      type: z.literal("lifecycle"),
      terminalId: terminalIdSchema,
      lifecycle: terminalLifecycleSchema,
      finalSequence: sequenceSchema.optional(),
      exitCode: z.number().int().nullable().optional(),
      signal: z.string().min(1).nullable().optional(),
    })
    .strict(),
  protocolBaseSchema
    .extend({ type: z.literal("output_overflow"), terminalId: terminalIdSchema })
    .strict(),
  protocolBaseSchema
    .extend({ type: z.literal("title"), terminalId: terminalIdSchema, title: z.string().min(1) })
    .strict(),
  protocolBaseSchema
    .extend({ type: z.literal("terminal_forgotten"), terminalId: terminalIdSchema })
    .strict(),
  protocolBaseSchema
    .extend({
      type: z.literal("protocol_error"),
      terminalId: terminalIdSchema.optional(),
      failure: terminalFailureSchema,
    })
    .strict(),
]);
export type TerminalServerMessage = z.infer<typeof terminalServerMessageSchema>;
export type TerminalProtocolMessage = TerminalClientMessage | TerminalServerMessage;

export const isTerminalClientMessage = (
  message: TerminalProtocolMessage,
): message is TerminalClientMessage => terminalClientMessageSchema.safeParse(message).success;

const terminalProtocolHeaderSchema = z
  .object({
    message: z.union([terminalClientMessageSchema, terminalServerMessageSchema]),
    payloadLength: z.number().int().nonnegative(),
  })
  .strict();

export type TerminalProtocolFrame = {
  message: TerminalProtocolMessage;
  payload: Uint8Array;
};

const assertPayloadContract = (message: TerminalProtocolMessage, payloadLength: number): void => {
  const requiresPayload = message.type === "input" || message.type === "output";
  if (requiresPayload && payloadLength === 0) {
    throw new Error(`Terminal ${message.type} frame requires a non-empty binary payload.`);
  }
  if (!requiresPayload && payloadLength !== 0) {
    throw new Error(`Terminal ${message.type} frame does not accept a binary payload.`);
  }
  if (message.type === "input" && payloadLength > TERMINAL_PROTOCOL_MAX_INPUT_BYTES) {
    throw new Error("Terminal input frame exceeds the 64 KiB input limit.");
  }
  if (message.type === "output" && message.sequenceEnd - message.sequenceStart !== payloadLength) {
    throw new Error("Terminal output sequence range must equal its binary payload length.");
  }
};

export const encodeTerminalProtocolFrame = ({
  message,
  payload,
}: TerminalProtocolFrame): Uint8Array => {
  const parsedMessage = z
    .union([terminalClientMessageSchema, terminalServerMessageSchema])
    .parse(message);
  assertPayloadContract(parsedMessage, payload.byteLength);
  const headerBytes = new TextEncoder().encode(
    JSON.stringify({ message: parsedMessage, payloadLength: payload.byteLength }),
  );
  if (headerBytes.byteLength > TERMINAL_PROTOCOL_MAX_HEADER_BYTES) {
    throw new Error("Terminal protocol header exceeds the 64 KiB header limit.");
  }
  const frameLength = 4 + headerBytes.byteLength + payload.byteLength;
  if (frameLength > TERMINAL_PROTOCOL_MAX_MESSAGE_BYTES) {
    throw new Error("Terminal protocol frame exceeds the 1 MiB message limit.");
  }
  const frame = new Uint8Array(frameLength);
  new DataView(frame.buffer).setUint32(0, headerBytes.byteLength, false);
  frame.set(headerBytes, 4);
  frame.set(payload, 4 + headerBytes.byteLength);
  return frame;
};

export const decodeTerminalProtocolFrame = (frame: Uint8Array): TerminalProtocolFrame => {
  if (frame.byteLength > TERMINAL_PROTOCOL_MAX_MESSAGE_BYTES) {
    throw new Error("Terminal protocol frame exceeds the 1 MiB message limit.");
  }
  if (frame.byteLength < 4) {
    throw new Error("Terminal protocol frame is missing its header length.");
  }
  const headerLength = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(
    0,
    false,
  );
  if (headerLength === 0 || headerLength > TERMINAL_PROTOCOL_MAX_HEADER_BYTES) {
    throw new Error("Terminal protocol header length is invalid.");
  }
  const payloadOffset = 4 + headerLength;
  if (payloadOffset > frame.byteLength) {
    throw new Error("Terminal protocol frame header is truncated.");
  }
  const headerText = new TextDecoder("utf-8", { fatal: true }).decode(
    frame.subarray(4, payloadOffset),
  );
  const header = terminalProtocolHeaderSchema.parse(JSON.parse(headerText));
  const payload = frame.slice(payloadOffset);
  if (payload.byteLength !== header.payloadLength) {
    throw new Error("Terminal protocol payload length does not match its header.");
  }
  assertPayloadContract(header.message, payload.byteLength);
  return { message: header.message, payload };
};

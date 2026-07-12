import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  TERMINAL_PROTOCOL_VERSION,
  type TerminalClientMessage,
  type TerminalFailure,
  type TerminalServerMessage,
  terminalFailureCodeSchema,
} from "@openducktor/contracts";
import type { TerminalService } from "@openducktor/host";
import { Effect } from "effect";
import { type WebLogger, writeWebLogEffect } from "../logger";

const OUTBOUND_QUEUE_LIMIT = 2 * 1024 * 1024;
const EMPTY_PAYLOAD: Uint8Array = new Uint8Array(0);

export type TerminalWebSocketData = {
  connectionId: string;
  terminalService: TerminalService;
  attachments: Set<string>;
  backpressured: boolean;
  inFlightBytes: number;
  pendingBytes: number;
  pendingFrames: Uint8Array[];
  logger: WebLogger;
  onBackgroundFailure(failure: unknown): void;
};

const isClientMessage = (message: { type: string }): message is TerminalClientMessage =>
  message.type === "attach" ||
  message.type === "input" ||
  message.type === "resize" ||
  message.type === "ack" ||
  message.type === "detach";

const attachmentId = (data: TerminalWebSocketData, terminalId: string): string =>
  `browser:${data.connectionId}:${terminalId}`;

const closeForQueueOverflow = (socket: Bun.ServerWebSocket<TerminalWebSocketData>): void => {
  socket.close(1013, "Terminal outbound queue limit exceeded.");
};

const sendFrame = (socket: Bun.ServerWebSocket<TerminalWebSocketData>, frame: Uint8Array): void => {
  const data = socket.data;
  const queuedBytes = data.inFlightBytes + data.pendingBytes;
  if (queuedBytes + frame.byteLength > OUTBOUND_QUEUE_LIMIT) {
    closeForQueueOverflow(socket);
    return;
  }
  if (data.backpressured) {
    data.pendingFrames.push(frame);
    data.pendingBytes += frame.byteLength;
    return;
  }
  const status = socket.send(frame, false);
  if (status === 0) {
    socket.close(1011, "Terminal connection could not send data.");
    return;
  }
  if (status === -1) {
    data.backpressured = true;
    data.inFlightBytes = frame.byteLength;
  }
};

const sendMessage = (
  socket: Bun.ServerWebSocket<TerminalWebSocketData>,
  message: TerminalServerMessage,
  payload: Uint8Array = EMPTY_PAYLOAD,
): void => sendFrame(socket, encodeTerminalProtocolFrame({ message, payload }));

const sendProtocolError = (
  socket: Bun.ServerWebSocket<TerminalWebSocketData>,
  failure: TerminalFailure,
  terminalId?: string,
): void =>
  sendMessage(socket, {
    version: TERMINAL_PROTOCOL_VERSION,
    type: "protocol_error",
    ...(terminalId ? { terminalId } : {}),
    failure,
  });

const handleClientMessage = (
  socket: Bun.ServerWebSocket<TerminalWebSocketData>,
  message: TerminalClientMessage,
  payload: Uint8Array,
) => {
  const service = socket.data.terminalService;
  const id = attachmentId(socket.data, message.terminalId);
  if (message.type === "attach") {
    socket.data.attachments.add(message.terminalId);
    return service.attach({
      terminalId: message.terminalId,
      attachmentId: id,
      lastConsumedSequence: message.lastConsumedSequence,
      sink: (event, eventPayload) => sendMessage(socket, event, eventPayload),
    });
  }
  if (message.type === "input") return service.write(message.terminalId, payload);
  if (message.type === "resize") {
    return service.resize(message.terminalId, {
      columns: message.columns,
      rows: message.rows,
    });
  }
  if (message.type === "ack") {
    return service.acknowledge(message.terminalId, id, message.sequenceEnd);
  }
  socket.data.attachments.delete(message.terminalId);
  return service.detach(message.terminalId, id);
};

const runClientMessage = (
  socket: Bun.ServerWebSocket<TerminalWebSocketData>,
  raw: string | Buffer,
): void => {
  if (typeof raw === "string") {
    sendProtocolError(socket, {
      code: "protocol_error",
      message: "Terminal WebSocket messages must be binary.",
    });
    socket.close(1003, "Binary terminal frames required.");
    return;
  }
  let decoded: ReturnType<typeof decodeTerminalProtocolFrame>;
  try {
    decoded = decodeTerminalProtocolFrame(
      new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength),
    );
  } catch (cause) {
    sendProtocolError(socket, {
      code: raw.byteLength > 1024 * 1024 ? "message_too_large" : "protocol_error",
      message: cause instanceof Error ? cause.message : String(cause),
    });
    socket.close(raw.byteLength > 1024 * 1024 ? 1009 : 1002, "Invalid terminal frame.");
    return;
  }
  if (!isClientMessage(decoded.message)) {
    sendProtocolError(socket, {
      code: "protocol_error",
      message: "Browser terminal traffic must use a client message type.",
    });
    socket.close(1002, "Invalid terminal message direction.");
    return;
  }
  void Effect.runPromise(handleClientMessage(socket, decoded.message, decoded.payload)).catch(
    (cause: unknown) => {
      const terminalId = decoded.message.terminalId;
      const parsedCode =
        typeof cause === "object" && cause !== null && "code" in cause
          ? terminalFailureCodeSchema.safeParse(cause.code)
          : null;
      sendProtocolError(
        socket,
        {
          code: parsedCode?.success ? parsedCode.data : "protocol_error",
          message: cause instanceof Error ? cause.message : String(cause),
          terminalId,
        },
        terminalId,
      );
    },
  );
};

export const terminalWebSocketHandler: Bun.WebSocketHandler<TerminalWebSocketData> = {
  perMessageDeflate: false,
  maxPayloadLength: 1024 * 1024,
  message: runClientMessage,
  drain(socket) {
    const data = socket.data;
    data.backpressured = false;
    data.inFlightBytes = 0;
    while (data.pendingFrames.length > 0 && !data.backpressured) {
      const frame = data.pendingFrames.shift();
      if (!frame) break;
      data.pendingBytes -= frame.byteLength;
      sendFrame(socket, frame);
    }
  },
  close(socket) {
    const { attachments, connectionId, logger, onBackgroundFailure, terminalService } = socket.data;
    for (const terminalId of attachments) {
      void Effect.runPromise(
        terminalService.detach(terminalId, `browser:${connectionId}:${terminalId}`),
      ).catch((cause: unknown) => {
        void Effect.runPromise(
          writeWebLogEffect(
            logger,
            "error",
            `Failed to detach terminal ${terminalId} from browser connection ${connectionId}: ${cause instanceof Error ? cause.message : String(cause)}`,
          ),
        ).catch(onBackgroundFailure);
      });
    }
    attachments.clear();
  },
};

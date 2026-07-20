import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  isTerminalClientMessage,
  TERMINAL_PROTOCOL_MAX_MESSAGE_BYTES,
  TERMINAL_PROTOCOL_VERSION,
  type TerminalFailure,
  type TerminalServerMessage,
} from "@openducktor/contracts";
import {
  createTerminalClientSession,
  type TerminalClientSession,
  type TerminalService,
} from "@openducktor/host";
import { Effect } from "effect";
import { type WebLogger, writeWebLogEffect } from "../logger";

const OUTBOUND_QUEUE_LIMIT = 2 * 1024 * 1024;
const EMPTY_PAYLOAD: Uint8Array = new Uint8Array(0);

export type TerminalWebSocketData = {
  connectionId: string;
  terminalService: TerminalService;
  clientSession: TerminalClientSession | null;
  backpressured: boolean;
  inFlightBytes: number;
  pendingBytes: number;
  pendingFrames: Uint8Array[];
  logger: WebLogger;
  onBackgroundFailure(failure: unknown): void;
};

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

const getClientSession = (
  socket: Bun.ServerWebSocket<TerminalWebSocketData>,
): TerminalClientSession => {
  const existing = socket.data.clientSession;
  if (existing) return existing;
  const clientSession = createTerminalClientSession({
    clientId: `browser:${socket.data.connectionId}`,
    terminalService: socket.data.terminalService,
    send: (message, payload) => sendMessage(socket, message, payload),
  });
  socket.data.clientSession = clientSession;
  return clientSession;
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
      code:
        raw.byteLength > TERMINAL_PROTOCOL_MAX_MESSAGE_BYTES
          ? "message_too_large"
          : "protocol_error",
      message: cause instanceof Error ? cause.message : String(cause),
    });
    socket.close(
      raw.byteLength > TERMINAL_PROTOCOL_MAX_MESSAGE_BYTES ? 1009 : 1002,
      "Invalid terminal frame.",
    );
    return;
  }
  if (!isTerminalClientMessage(decoded.message)) {
    sendProtocolError(socket, {
      code: "protocol_error",
      message: "Browser terminal traffic must use a client message type.",
    });
    socket.close(1002, "Invalid terminal message direction.");
    return;
  }
  Effect.runFork(getClientSession(socket).handle(decoded.message, decoded.payload));
};

export const terminalWebSocketHandler: Bun.WebSocketHandler<TerminalWebSocketData> = {
  perMessageDeflate: false,
  maxPayloadLength: TERMINAL_PROTOCOL_MAX_MESSAGE_BYTES,
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
    const { clientSession, connectionId, logger, onBackgroundFailure } = socket.data;
    socket.data.clientSession = null;
    if (!clientSession) return;
    void Effect.runPromise(clientSession.close()).catch((cause: unknown) => {
      void Effect.runPromise(
        writeWebLogEffect(
          logger,
          "error",
          `Failed to detach terminals from browser connection ${connectionId}: ${cause instanceof Error ? cause.message : String(cause)}`,
        ),
      ).catch(onBackgroundFailure);
    });
  },
};

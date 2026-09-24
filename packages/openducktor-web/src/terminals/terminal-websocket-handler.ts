import {
  decodeTerminalProtocolFrame,
  encodeTerminalProtocolFrame,
  isTerminalClientMessage,
  TERMINAL_PROTOCOL_MAX_HEADER_BYTES,
  TERMINAL_PROTOCOL_MAX_INPUT_BYTES,
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

const OUTBOUND_QUEUE_LIMIT = TERMINAL_PROTOCOL_MAX_MESSAGE_BYTES * 2;
const MAX_CLIENT_FRAME_BYTES =
  4 + TERMINAL_PROTOCOL_MAX_HEADER_BYTES + TERMINAL_PROTOCOL_MAX_INPUT_BYTES;
const EMPTY_PAYLOAD: Uint8Array = new Uint8Array(0);

export type TerminalWebSocketService = Pick<
  TerminalService,
  "acknowledge" | "attach" | "detach" | "resize" | "write"
>;

export type TerminalWebSocketData = {
  connectionId: string;
  terminalService: TerminalWebSocketService;
  clientSession: TerminalClientSession | null;
  backpressured: boolean;
  inFlightBytes: number;
  pendingBytes: number;
  pendingFrames: Uint8Array[];
  drainWaiters: Set<(writable: boolean) => void>;
  attachPermit: ReturnType<typeof Effect.unsafeMakeSemaphore>;
  messagePermits: Map<
    string,
    { permit: ReturnType<typeof Effect.unsafeMakeSemaphore>; pending: number }
  >;
  closed: boolean;
  logger: WebLogger;
  onBackgroundFailure(cause: unknown): void;
};

export type TerminalServerSocket = {
  data: TerminalWebSocketData;
  close(code: number, reason: string): void;
  send(frame: Uint8Array, compress: boolean): number;
};

const beginClose = (socket: TerminalServerSocket, code: number, reason: string): void => {
  if (socket.data.closed) return;
  socket.data.closed = true;
  for (const finish of socket.data.drainWaiters) finish(false);
  socket.close(code, reason);
};

const closeForQueueOverflow = (socket: TerminalServerSocket): void => {
  beginClose(socket, 1013, "Terminal outbound queue limit exceeded.");
};

const sendFrame = (socket: TerminalServerSocket, frame: Uint8Array): boolean => {
  const data = socket.data;
  if (data.closed) return false;
  const queuedBytes = data.inFlightBytes + data.pendingBytes;
  if (queuedBytes + frame.byteLength > OUTBOUND_QUEUE_LIMIT) {
    closeForQueueOverflow(socket);
    return false;
  }
  if (data.backpressured) {
    data.pendingFrames.push(frame);
    data.pendingBytes += frame.byteLength;
    return true;
  }
  const status = socket.send(frame, false);
  if (status === 0) {
    beginClose(socket, 1011, "Terminal connection could not send data.");
    return false;
  }
  if (status === -1) {
    data.backpressured = true;
    data.inFlightBytes = frame.byteLength;
  }
  return true;
};

const sendMessage = (
  socket: TerminalServerSocket,
  message: TerminalServerMessage,
  payload: Uint8Array = EMPTY_PAYLOAD,
): boolean => sendFrame(socket, encodeTerminalProtocolFrame({ message, payload }));

const waitForWritable = (socket: TerminalServerSocket): Effect.Effect<void> =>
  Effect.async<void>((resume, signal) => {
    const data = socket.data;
    if (data.closed) {
      resume(Effect.interrupt);
      return;
    }
    if (!data.backpressured) {
      resume(Effect.void);
      return;
    }
    const finish = (writable: boolean): void => {
      data.drainWaiters.delete(finish);
      signal.removeEventListener("abort", canceled);
      resume(writable ? Effect.void : Effect.interrupt);
    };
    const canceled = (): void => {
      data.drainWaiters.delete(finish);
      signal.removeEventListener("abort", canceled);
    };
    data.drainWaiters.add(finish);
    signal.addEventListener("abort", canceled, { once: true });
  });

const sendProtocolError = (
  socket: TerminalServerSocket,
  failure: TerminalFailure,
  terminalId?: string,
): void => {
  const message: TerminalServerMessage = {
    version: TERMINAL_PROTOCOL_VERSION,
    type: "protocol_error",
    failure,
  };
  if (terminalId) {
    message.terminalId = terminalId;
  }
  sendMessage(socket, message);
};

const getClientSession = (socket: TerminalServerSocket): TerminalClientSession => {
  const existing = socket.data.clientSession;
  if (existing) return existing;
  const clientSession = createTerminalClientSession({
    clientId: `browser:${socket.data.connectionId}`,
    terminalService: socket.data.terminalService,
    send: (message, payload) => {
      if (!sendMessage(socket, message, payload))
        throw new Error("Terminal WebSocket could not queue an outbound frame.");
    },
  });
  socket.data.clientSession = clientSession;
  return clientSession;
};

const runClientMessage = (socket: TerminalServerSocket, raw: string | Buffer): void => {
  if (!Buffer.isBuffer(raw)) {
    sendProtocolError(socket, {
      code: "protocol_error",
      message: "Terminal WebSocket messages must be binary.",
    });
    beginClose(socket, 1003, "Binary terminal frames required.");
    return;
  }
  if (raw.byteLength > MAX_CLIENT_FRAME_BYTES) {
    sendProtocolError(socket, {
      code: "message_too_large",
      message: "Terminal client frame exceeds the 128 KiB input and header limit.",
    });
    beginClose(socket, 1009, "Terminal client frame is too large.");
    return;
  }
  let decoded: ReturnType<typeof decodeTerminalProtocolFrame>;
  try {
    decoded = decodeTerminalProtocolFrame(
      new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength),
    );
  } catch (cause) {
    sendProtocolError(socket, {
      code: "protocol_error",
      message: cause instanceof Error ? cause.message : String(cause),
    });
    beginClose(socket, 1002, "Invalid terminal frame.");
    return;
  }
  if (!isTerminalClientMessage(decoded.message)) {
    sendProtocolError(socket, {
      code: "protocol_error",
      message: "Browser terminal traffic must use a client message type.",
    });
    beginClose(socket, 1002, "Invalid terminal message direction.");
    return;
  }
  const message = decoded.message;
  let entry = socket.data.messagePermits.get(message.terminalId);
  if (!entry) {
    entry = { permit: Effect.unsafeMakeSemaphore(1), pending: 0 };
    socket.data.messagePermits.set(message.terminalId, entry);
  }
  entry.pending += 1;
  const messageEntry = entry;
  const handle = Effect.suspend(() =>
    socket.data.closed ? Effect.void : getClientSession(socket).handle(message, decoded.payload),
  );
  const operation =
    message.type === "attach"
      ? socket.data.attachPermit.withPermits(1)(
          waitForWritable(socket).pipe(Effect.flatMap(() => handle)),
        )
      : handle;
  Effect.runFork(
    messageEntry.permit
      .withPermits(1)(operation)
      .pipe(
        Effect.ensuring(
          Effect.sync(() => {
            messageEntry.pending -= 1;
            if (messageEntry.pending === 0) socket.data.messagePermits.delete(message.terminalId);
          }),
        ),
      ),
  );
};

export const terminalWebSocketHandler = {
  perMessageDeflate: false,
  maxPayloadLength: MAX_CLIENT_FRAME_BYTES,
  message: runClientMessage,
  drain(socket: TerminalServerSocket) {
    const data = socket.data;
    if (data.closed) return;
    data.backpressured = false;
    data.inFlightBytes = 0;
    while (data.pendingFrames.length > 0 && !data.backpressured) {
      const frame = data.pendingFrames.shift();
      if (!frame) break;
      data.pendingBytes -= frame.byteLength;
      if (!sendFrame(socket, frame)) return;
    }
    if (!data.backpressured) {
      for (const finish of data.drainWaiters) finish(true);
    }
  },
  close(socket: TerminalServerSocket) {
    const { clientSession, connectionId, logger, onBackgroundFailure, drainWaiters } = socket.data;
    socket.data.closed = true;
    for (const finish of drainWaiters) finish(false);
    socket.data.pendingFrames.length = 0;
    socket.data.pendingBytes = 0;
    socket.data.messagePermits.clear();
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

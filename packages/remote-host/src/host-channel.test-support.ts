import {
  encodeHostChannelFrame,
  HOST_CHANNEL_SUBPROTOCOL,
  hostChannelMessageSchema,
  REMOTE_SOCKET_AUTHORIZATION_PREFIX,
  REMOTE_SOCKET_CONNECTION_PREFIX,
  splitHostChannelFrame,
  type HostChannelMessage,
  type HostChannelRequest,
} from "@openducktor/contracts";
import { WebSocket } from "ws";
import type { JSONType } from "zod";
import {
  createHostChannelSocketData,
  hostChannelWebSocketHandler,
  type HostChannelOptions,
  type HostChannelSocket,
} from "./host-channel";

export type SentChannelMessage = { header: HostChannelMessage; body: string | null };

/**
 * One host channel socket without a network. A stalled socket keeps each sent frame in its buffer
 * until `flush`, as a client that stops reading does.
 */
export const createFakeChannelSocket = (options: HostChannelOptions) => {
  const sent: SentChannelMessage[] = [];
  const closes: { code: number; reason: string }[] = [];
  let buffered = 0;
  let stalled = false;
  let open = true;
  let nextId = 0;
  const socket: HostChannelSocket = {
    data: createHostChannelSocketData(options),
    close: (code, reason) => {
      closes.push({ code, reason });
      disconnect();
    },
    send: (frame) => {
      if (!open) return 0;
      const { header, body } = splitHostChannelFrame(frame);
      sent.push({
        header: hostChannelMessageSchema.parse(JSON.parse(header)),
        body: body === null ? null : new TextDecoder().decode(body),
      });
      if (stalled) buffered += frame.byteLength;
      return stalled ? -1 : frame.byteLength;
    },
    bufferedAmount: () => buffered,
  };
  /** The socket closed, as the network reports it. */
  const disconnect = () => {
    if (!open) return;
    open = false;
    hostChannelWebSocketHandler.close(socket);
  };
  hostChannelWebSocketHandler.open(socket);
  return {
    socket,
    sent,
    closes,
    /** Sends one request and returns its ID. */
    request(request: HostChannelRequest): number {
      const id = nextId++;
      hostChannelWebSocketHandler.message(
        socket,
        Buffer.from(JSON.stringify({ type: "request", id, ...request })),
      );
      return id;
    },
    /** Sends raw text as a client message. */
    raw(text: string): void {
      hostChannelWebSocketHandler.message(socket, Buffer.from(text));
    },
    /** The reply to request `id`, or undefined while it has none. */
    reply(id: number): SentChannelMessage | undefined {
      return sent.find(
        ({ header }) => (header.type === "result" || header.type === "error") && header.id === id,
      );
    },
    /** The parsed result body of request `id`. */
    result(id: number): JSONType {
      const reply = sent.find(({ header }) => header.type === "result" && header.id === id);
      if (!reply) throw new Error(`Request ${id} has no result.`);
      if (reply.body === null) return null;
      const value: JSONType = JSON.parse(reply.body);
      return value;
    },
    ofType<Type extends HostChannelMessage["type"]>(type: Type) {
      return sent.filter(
        (
          message,
        ): message is {
          header: Extract<HostChannelMessage, { type: Type }>;
          body: string | null;
        } => message.header.type === type,
      );
    },
    /** Keeps later frames in the socket buffer. */
    stall(): void {
      stalled = true;
    },
    /** Sends the buffered frames and reports the drain. */
    flush(): void {
      stalled = false;
      buffered = 0;
      hostChannelWebSocketHandler.drain(socket);
    },
    setBufferedAmount(bytes: number): void {
      buffered = bytes;
    },
    disconnect,
    get open() {
      return open;
    },
  };
};

export type FakeChannelSocket = ReturnType<typeof createFakeChannelSocket>;

/**
 * A host channel client on a real listener. It offers the channel protocol, the connection tag,
 * and the authorization tag, as remote clients do.
 */
export const openRemoteChannelClient = async (
  base: string,
  admission: { connectionId: string; connectionToken: string },
  headers: Record<string, string> = {},
) => {
  const socket = new WebSocket(
    `${base.replace(/^http/, "ws")}/channel`,
    [
      HOST_CHANNEL_SUBPROTOCOL,
      `${REMOTE_SOCKET_CONNECTION_PREFIX}${admission.connectionId}`,
      `${REMOTE_SOCKET_AUTHORIZATION_PREFIX}${admission.connectionToken}`,
    ],
    { headers },
  );
  const messages: SentChannelMessage[] = [];
  const listeners = new Set<() => void>();
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() })),
  );
  socket.on("message", (data) => {
    const bytes = Array.isArray(data)
      ? Buffer.concat(data)
      : data instanceof ArrayBuffer
        ? Buffer.from(data)
        : data;
    const { header, body } = splitHostChannelFrame(bytes);
    messages.push({
      header: hostChannelMessageSchema.parse(JSON.parse(header)),
      body: body === null ? null : new TextDecoder().decode(body),
    });
    // oxlint-disable-next-line unicorn/no-useless-spread -- listeners remove themselves during delivery
    for (const listener of [...listeners]) listener();
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  let nextId = 0;
  const until = (check: () => SentChannelMessage | undefined, what: string) =>
    new Promise<SentChannelMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(test);
        reject(new Error(`Timed out waiting for ${what}.`));
      }, 500);
      const test = () => {
        const found = check();
        if (!found) return;
        clearTimeout(timer);
        listeners.delete(test);
        resolve(found);
      };
      listeners.add(test);
      test();
    });
  return {
    socket,
    messages,
    closed,
    /** Sends one request and resolves with its reply. */
    request(request: HostChannelRequest): Promise<SentChannelMessage> {
      const id = nextId++;
      socket.send(encodeHostChannelFrame({ type: "request", id, ...request }));
      return until(
        () =>
          messages.find(
            ({ header }) =>
              (header.type === "result" || header.type === "error") && header.id === id,
          ),
        `the reply to ${request.method}`,
      );
    },
    /** Resolves with the first message of `type` after `skip` such messages. */
    next(type: HostChannelMessage["type"], skip = 0): Promise<SentChannelMessage> {
      return until(
        () => messages.filter(({ header }) => header.type === type)[skip],
        `a ${type} message`,
      );
    },
    close(): Promise<{ code: number; reason: string }> {
      socket.close();
      return closed;
    },
  };
};

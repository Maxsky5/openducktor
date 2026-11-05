import { describe, expect, mock, test } from "bun:test";
import {
  REMOTE_CONNECTION_HEADER,
  REMOTE_SOCKET_CONNECTION_PREFIX,
  REMOTE_SOCKET_AUTHORIZATION_PREFIX,
  HOST_CHANNEL_SUBPROTOCOL,
  TERMINAL_PROTOCOL_SUBPROTOCOL,
} from "@openducktor/contracts";
import { openRemoteSocket, openWebSocket } from "./socket";

class FakeSocket {
  binaryType: "blob" | "arraybuffer" = "blob";
  protocol = "";
  readyState: WebSocket["readyState"] = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data?: ArrayBuffer | string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readonly sent: Uint8Array[] = [];
  closeCalls = 0;

  constructor(readonly protocols: string[]) {}

  send(data: Parameters<WebSocket["send"]>[0]): void {
    if (!(data instanceof Uint8Array)) throw new Error("The socket sends only binary frames.");
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
  }

  open(protocol: string): void {
    this.protocol = protocol;
    this.readyState = 1;
    this.onopen?.();
  }

  closeFromHost(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

const rejection = async <T>(operation: Promise<T>): Promise<Error> => {
  try {
    await operation;
  } catch (cause) {
    if (cause instanceof Error) return cause;
    throw new Error("The operation rejected without an Error.", { cause });
  }
  throw new Error("The operation did not reject.");
};

const setup = () => {
  const sockets: FakeSocket[] = [];
  const create = (protocols: string[]) => {
    const socket = new FakeSocket(protocols);
    sockets.push(socket);
    return socket;
  };
  return { sockets, create };
};

describe("openRemoteSocket", () => {
  const headers = {
    [REMOTE_CONNECTION_HEADER]: "connection-1",
    authorization: `Bearer ${"c".repeat(43)}`,
  };

  test("offers the requested protocol and the connection subprotocols", async () => {
    const { sockets, create } = setup();
    const pending = openRemoteSocket(
      create,
      TERMINAL_PROTOCOL_SUBPROTOCOL,
      headers,
      new AbortController().signal,
      () => {},
      () => {},
    );
    const socket = sockets[0];

    expect(socket?.protocols).toEqual([
      TERMINAL_PROTOCOL_SUBPROTOCOL,
      `${REMOTE_SOCKET_CONNECTION_PREFIX}connection-1`,
      `${REMOTE_SOCKET_AUTHORIZATION_PREFIX}${"c".repeat(43)}`,
    ]);
    expect(socket?.binaryType).toBe("arraybuffer");

    socket?.open(TERMINAL_PROTOCOL_SUBPROTOCOL);
    const connection = await pending;
    await connection.send(new Uint8Array([1, 2, 3]));
    expect(socket?.sent).toEqual([new Uint8Array([1, 2, 3])]);
  });

  test("rejects without a connection header", async () => {
    const { sockets, create } = setup();

    expect(
      await rejection(
        openRemoteSocket(
          create,
          TERMINAL_PROTOCOL_SUBPROTOCOL,
          {},
          new AbortController().signal,
          () => {},
          () => {},
        ),
      ),
    ).toMatchObject({ failure: { code: "connection_expired" } });
    expect(sockets).toHaveLength(0);
  });

  test("rejects and closes when the host selects another protocol", async () => {
    const { sockets, create } = setup();
    const pending = openRemoteSocket(
      create,
      TERMINAL_PROTOCOL_SUBPROTOCOL,
      headers,
      new AbortController().signal,
      () => {},
      () => {},
    );
    sockets[0]?.open("other");

    expect(await rejection(pending)).toMatchObject({ failure: { code: "invalid_protocol" } });
    expect(sockets[0]?.closeCalls).toBe(1);
  });

  test("rejects when the socket closes during setup", async () => {
    const { sockets, create } = setup();
    const pending = openRemoteSocket(
      create,
      TERMINAL_PROTOCOL_SUBPROTOCOL,
      headers,
      new AbortController().signal,
      () => {},
      () => {},
    );
    sockets[0]?.closeFromHost();

    expect(await rejection(pending)).toMatchObject({
      failure: { code: "transport_failure", message: "The host socket closed during setup." },
    });
  });

  test("rejects when the socket fails during setup", async () => {
    const { sockets, create } = setup();
    const pending = openRemoteSocket(
      create,
      TERMINAL_PROTOCOL_SUBPROTOCOL,
      headers,
      new AbortController().signal,
      () => {},
      () => {},
    );
    sockets[0]?.onerror?.();
    sockets[0]?.closeFromHost();

    expect(await rejection(pending)).toMatchObject({
      failure: { code: "transport_failure", message: "The host socket failed." },
    });
  });

  test("rejects with the abort reason and closes the socket on abort", async () => {
    const { sockets, create } = setup();
    const controller = new AbortController();
    const reason = new Error("stopped");
    const pending = openRemoteSocket(
      create,
      TERMINAL_PROTOCOL_SUBPROTOCOL,
      headers,
      controller.signal,
      () => {},
      () => {},
    );
    controller.abort(reason);

    expect(await rejection(pending)).toBe(reason);
    expect(sockets[0]?.closeCalls).toBe(1);
  });

  test("delivers binary frames as bytes and ignores text frames", async () => {
    const { sockets, create } = setup();
    const frames: Uint8Array[] = [];
    const pending = openRemoteSocket(
      create,
      TERMINAL_PROTOCOL_SUBPROTOCOL,
      headers,
      new AbortController().signal,
      (frame) => frames.push(frame),
      () => {},
    );
    sockets[0]?.open(TERMINAL_PROTOCOL_SUBPROTOCOL);
    await pending;
    sockets[0]?.onmessage?.({ data: new Uint8Array([4, 5]).buffer });
    sockets[0]?.onmessage?.({ data: "text" });

    expect(frames).toEqual([new Uint8Array([4, 5])]);
  });

  test("reports a host close after open and rejects input after the close", async () => {
    const { sockets, create } = setup();
    const onClose = mock(() => {});
    const pending = openRemoteSocket(
      create,
      TERMINAL_PROTOCOL_SUBPROTOCOL,
      headers,
      new AbortController().signal,
      () => {},
      onClose,
    );
    sockets[0]?.open(TERMINAL_PROTOCOL_SUBPROTOCOL);
    const connection = await pending;
    sockets[0]?.closeFromHost();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith();
    expect(await rejection(connection.send(new Uint8Array([1])))).toMatchObject({
      message: "The socket is disconnected.",
    });
    expect(sockets[0]?.sent).toEqual([]);
  });

  test("does not report a close after the caller aborts", async () => {
    const { sockets, create } = setup();
    const controller = new AbortController();
    const onClose = mock(() => {});
    const pending = openRemoteSocket(
      create,
      TERMINAL_PROTOCOL_SUBPROTOCOL,
      headers,
      controller.signal,
      () => {},
      onClose,
    );
    sockets[0]?.open(TERMINAL_PROTOCOL_SUBPROTOCOL);
    const connection = await pending;
    controller.abort(new Error("stopped"));
    sockets[0]?.closeFromHost();

    expect(onClose).not.toHaveBeenCalled();
    expect(await rejection(connection.send(new Uint8Array([1])))).toBeInstanceOf(Error);
  });
});

describe("openWebSocket", () => {
  test("offers only the given protocols and resolves when the host selects the first", async () => {
    const { sockets, create } = setup();
    const pending = openWebSocket(
      create,
      [HOST_CHANNEL_SUBPROTOCOL],
      new AbortController().signal,
      () => {},
      () => {},
    );
    expect(sockets[0]?.protocols).toEqual([HOST_CHANNEL_SUBPROTOCOL]);
    sockets[0]?.open(HOST_CHANNEL_SUBPROTOCOL);
    const connection = await pending;
    await connection.send(new Uint8Array([7]));
    expect(sockets[0]?.sent).toEqual([new Uint8Array([7])]);
  });

  test("names the missing protocol when the host selects another one", async () => {
    const { sockets, create } = setup();
    const pending = openWebSocket(
      create,
      [HOST_CHANNEL_SUBPROTOCOL],
      new AbortController().signal,
      () => {},
      () => {},
    );
    sockets[0]?.open("");
    expect(await rejection(pending)).toMatchObject({
      failure: {
        code: "invalid_protocol",
        message: `The host did not select ${HOST_CHANNEL_SUBPROTOCOL}.`,
      },
    });
  });
});

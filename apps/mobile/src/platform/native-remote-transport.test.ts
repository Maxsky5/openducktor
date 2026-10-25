import { describe, expect, test } from "bun:test";
import {
  REMOTE_CONNECTION_HEADER,
  REMOTE_TERMINAL_CONNECTION_PREFIX,
  TERMINAL_PROTOCOL_SUBPROTOCOL,
} from "@openducktor/contracts";
import { RemoteConnectionError } from "@openducktor/host-client/remote";
import type { NativeHttpHead, OpenDucktorNetworkModule } from "../../modules/openducktor-network";
import { createNativeRemoteTransport } from "./native-remote-transport";

type Deferred<T> = { resolve: (value: T) => void; reject: (cause: Error) => void };
type StartCall = Deferred<NativeHttpHead> & {
  requestId: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
};
type ReadCall = Deferred<Uint8Array | null> & { requestId: string };

class FakeNetwork implements OpenDucktorNetworkModule {
  readonly starts: StartCall[] = [];
  readonly reads: ReadCall[] = [];
  readonly canceled: string[] = [];

  start(
    requestId: string,
    method: "GET" | "POST" | "DELETE",
    url: string,
    headers: Record<string, string>,
    body: string | null,
  ): Promise<NativeHttpHead> {
    return new Promise((resolve, reject) => {
      this.starts.push({ requestId, method, url, headers, body, resolve, reject });
    });
  }

  read(requestId: string): Promise<Uint8Array | null> {
    return new Promise((resolve, reject) => {
      this.reads.push({ requestId, resolve, reject });
    });
  }

  cancel(requestId: string): void {
    this.canceled.push(requestId);
  }
}

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

  constructor(
    readonly url: string,
    readonly protocols: string[],
    readonly options: { headers: Record<string, string> },
  ) {}

  send(data: Parameters<WebSocket["send"]>[0]): void {
    if (!(data instanceof Uint8Array)) throw new Error("The terminal sends only binary frames.");
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

const nativeError = (code: string, message: string): Error =>
  Object.assign(new Error(message), { code });

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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
  const network = new FakeNetwork();
  const sockets: FakeSocket[] = [];
  let nextId = 0;
  const transport = createNativeRemoteTransport({
    network,
    createWebSocket: (url, protocols, options) => {
      const socket = new FakeSocket(url, protocols, options);
      sockets.push(socket);
      return socket;
    },
    createRequestId: () => `request-${++nextId}`,
  });
  return { network, sockets, transport };
};

const startedRequest = async (
  head: NativeHttpHead = { status: 200, headers: { "content-type": "text/event-stream" } },
) => {
  const context = setup();
  const controller = new AbortController();
  const pending = context.transport.request(
    "GET",
    "https://host.test/events",
    {},
    controller.signal,
  );
  context.network.starts[0]?.resolve(head);
  const response = await pending;
  return { ...context, controller, response };
};

describe("createNativeRemoteTransport request", () => {
  test("passes the exact request to the network module", async () => {
    const { network, transport } = setup();
    const headers = { "content-type": "application/json", [REMOTE_CONNECTION_HEADER]: "id-1" };
    void transport.request(
      "POST",
      "https://host.test/invoke/a",
      headers,
      new AbortController().signal,
      "{}",
    );
    void transport.request(
      "DELETE",
      "https://host.test/connections/current",
      {},
      new AbortController().signal,
    );

    expect(
      network.starts.map(({ requestId, method, url, headers: sent, body }) => ({
        requestId,
        method,
        url,
        headers: sent,
        body,
      })),
    ).toEqual([
      {
        requestId: "request-1",
        method: "POST",
        url: "https://host.test/invoke/a",
        headers,
        body: "{}",
      },
      {
        requestId: "request-2",
        method: "DELETE",
        url: "https://host.test/connections/current",
        headers: {},
        body: null,
      },
    ]);
  });

  test("streams chunks in order and reads only when the consumer pulls", async () => {
    const { network, response } = await startedRequest();
    const iterator = response.body[Symbol.asyncIterator]();
    expect(network.reads).toHaveLength(0);

    const first = iterator.next();
    expect(network.reads).toHaveLength(1);
    network.reads[0]?.resolve(new Uint8Array([1, 2]));
    expect(await first).toEqual({ done: false, value: new Uint8Array([1, 2]) });
    await settle();
    expect(network.reads).toHaveLength(1);

    const second = iterator.next();
    network.reads[1]?.resolve(new Uint8Array([3]));
    expect(await second).toEqual({ done: false, value: new Uint8Array([3]) });

    const end = iterator.next();
    network.reads[2]?.resolve(null);
    expect(await end).toEqual({ done: true, value: undefined });
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(network.reads).toHaveLength(3);
    expect(network.canceled).toEqual([]);
  });

  test("returns the response head as received, including a redirect", async () => {
    const { response } = await startedRequest({
      status: 302,
      headers: { location: "https://other.test/" },
    });

    expect(response.status).toBe(302);
    expect(response.headers).toEqual({ location: "https://other.test/" });
  });

  test("an early iterator return cancels the native request", async () => {
    const { network, response } = await startedRequest();
    const iterator = response.body[Symbol.asyncIterator]();
    const first = iterator.next();
    network.reads[0]?.resolve(new Uint8Array([1]));
    await first;

    expect(await iterator.return?.()).toEqual({ done: true, value: undefined });
    expect(network.canceled).toEqual(["request-1"]);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(network.reads).toHaveLength(1);
  });

  test("a loop that stops early cancels the native request", async () => {
    const { network, response } = await startedRequest();
    const consumed = (async () => {
      for await (const chunk of response.body) {
        expect(chunk).toEqual(new Uint8Array([7]));
        break;
      }
    })();
    network.reads[0]?.resolve(new Uint8Array([7]));
    await consumed;

    expect(network.canceled).toEqual(["request-1"]);
  });

  test("an already aborted signal starts no native request", async () => {
    const { network, transport } = setup();
    const reason = new Error("stopped");

    expect(
      await rejection(
        transport.request("GET", "https://host.test/", {}, AbortSignal.abort(reason)),
      ),
    ).toBe(reason);
    expect(network.starts).toHaveLength(0);
  });

  test("an abort before the head cancels the request and rejects with the abort reason", async () => {
    const { network, transport } = setup();
    const controller = new AbortController();
    const reason = new Error("stopped");
    const pending = transport.request("GET", "https://host.test/events", {}, controller.signal);

    controller.abort(reason);
    network.starts[0]?.reject(nativeError("ERR_ODT_CANCELED", "cancelled"));

    expect(await rejection(pending)).toBe(reason);
    expect(network.canceled).toEqual(["request-1"]);
  });

  test("an abort after the head cancels a pending read and rejects with the abort reason", async () => {
    const { controller, network, response } = await startedRequest();
    const iterator = response.body[Symbol.asyncIterator]();
    const reason = new Error("stopped");
    const pending = iterator.next();

    controller.abort(reason);
    network.reads[0]?.reject(nativeError("ERR_ODT_CANCELED", "cancelled"));

    expect(await rejection(pending)).toBe(reason);
    expect(network.canceled).toEqual(["request-1"]);
    expect(await rejection(iterator.next())).toBe(reason);
  });

  test.each([
    {
      code: "ERR_ODT_NETWORK",
      failure: {
        code: "unavailable",
        message: "The host does not answer at this address.",
        nextAction:
          "Check that OpenDucktor is open on the host computer with Remote control on, and that this device is on the same network.",
        transportCause: "network",
      },
    },
    {
      code: "ERR_ODT_TIMEOUT",
      failure: {
        code: "unavailable",
        message: "The host took too long to answer.",
        nextAction:
          "Check that the host computer is awake and on the same network, then try again.",
        transportCause: "timeout",
      },
    },
    {
      code: "ERR_ODT_TLS",
      failure: {
        code: "transport_failure",
        message: "This device does not trust the host certificate.",
        nextAction:
          "Install a certificate that this device trusts on the host or its proxy, then try again.",
        transportCause: "tls",
      },
    },
    {
      code: "ERR_ODT_LOCAL_NETWORK_DENIED",
      failure: {
        code: "unavailable",
        message: "OpenDucktor needs Local Network access to reach this host.",
        nextAction:
          "Allow Local Network when iOS asks, or turn it on in Settings, Privacy & Security, Local Network. Then try again.",
        transportCause: "network",
      },
    },
    {
      code: "ERR_ODT_CANCELED",
      failure: {
        code: "transport_failure",
        message: "The request stopped before the host answered.",
        nextAction: "Try again.",
      },
    },
  ])("maps a $code start rejection to a remote failure", async ({ code, failure }) => {
    const { network, transport } = setup();
    const pending = transport.request(
      "GET",
      "https://host.test/",
      {},
      new AbortController().signal,
    );
    network.starts[0]?.reject(nativeError(code, "offline"));

    const error = await rejection(pending);
    expect(error).toBeInstanceOf(RemoteConnectionError);
    expect(error).toMatchObject({ failure });
  });

  test("maps a read rejection and releases the native request", async () => {
    const { network, response } = await startedRequest();
    const iterator = response.body[Symbol.asyncIterator]();
    const pending = iterator.next();
    network.reads[0]?.reject(nativeError("ERR_ODT_NETWORK", "connection lost"));

    expect(await rejection(pending)).toMatchObject({
      failure: { code: "unavailable", transportCause: "network" },
    });
    expect(network.canceled).toEqual(["request-1"]);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  });

  test("passes through a rejection that does not come from the network module", async () => {
    const { network, transport } = setup();
    const failure = new Error("Argument conversion failed.");
    const pending = transport.request(
      "GET",
      "https://host.test/",
      {},
      new AbortController().signal,
    );
    network.starts[0]?.reject(failure);

    expect(await rejection(pending)).toBe(failure);
  });
});

describe("createNativeRemoteTransport openTerminal", () => {
  test("opens the React Native socket with the subprotocols and the connection header", async () => {
    const { sockets, transport } = setup();
    const headers = { [REMOTE_CONNECTION_HEADER]: "connection-1" };
    const pending = transport.openTerminal(
      "wss://host.test/terminal",
      headers,
      new AbortController().signal,
      () => {},
      () => {},
    );
    const socket = sockets[0];

    expect(socket?.url).toBe("wss://host.test/terminal");
    expect(socket?.protocols).toEqual([
      TERMINAL_PROTOCOL_SUBPROTOCOL,
      `${REMOTE_TERMINAL_CONNECTION_PREFIX}connection-1`,
    ]);
    expect(socket?.options).toEqual({ headers });

    socket?.open(TERMINAL_PROTOCOL_SUBPROTOCOL);
    const connection = await pending;
    await connection.send(new Uint8Array([1, 2, 3]));
    expect(socket?.sent).toEqual([new Uint8Array([1, 2, 3])]);
  });
});

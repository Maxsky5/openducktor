import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { TerminalFailure } from "@openducktor/contracts";
import { configureBrowserRuntimeConfig } from "../browser-config";
import { createFetchFixture } from "../test-support";
import { createBrowserTerminalBridge } from "./browser-terminal-transport";

class FakeWebSocket extends EventTarget implements WebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  binaryType: BinaryType = "blob";
  readonly bufferedAmount = 0;
  readonly extensions = "";
  onclose: ((this: WebSocket, event: CloseEvent) => void) | null = null;
  onerror: ((this: WebSocket, event: Event) => void) | null = null;
  onmessage: ((this: WebSocket, event: MessageEvent) => void) | null = null;
  onopen: ((this: WebSocket, event: Event) => void) | null = null;
  readyState: WebSocket["readyState"] = FakeWebSocket.CONNECTING;
  readonly sentData: (string | ArrayBufferLike | Blob | ArrayBufferView)[] = [];

  readonly url: string;
  readonly protocol: string;

  constructor(url: string | URL, protocols?: string | string[]) {
    super();
    this.url = url.toString();
    this.protocol = Array.isArray(protocols) ? (protocols[0] ?? "") : (protocols ?? "");
    FakeWebSocket.instances.push(this);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sentData.push(data);
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = 3;
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  emitClose(code: number, reason: string): void {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event("close"), { code, reason }));
  }

  emitMessage(data: ArrayBuffer): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

const waitForSocket = async (): Promise<FakeWebSocket> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const socket = FakeWebSocket.instances[0];
    if (socket) return socket;
    await Promise.resolve();
  }
  throw new Error("Expected the terminal WebSocket to be created.");
};

beforeEach(() => {
  FakeWebSocket.instances = [];
  configureBrowserRuntimeConfig({ backendUrl: "http://127.0.0.1:14327", appToken: "app-token" });
  globalThis.fetch = createFetchFixture(async () => new Response(JSON.stringify({ ok: true })));
  globalThis.WebSocket = FakeWebSocket;
});

afterEach(() => {
  configureBrowserRuntimeConfig({});
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
});

describe("createBrowserTerminalBridge", () => {
  test("copies outgoing frames to an ArrayBuffer-backed view", async () => {
    const bridge = createBrowserTerminalBridge();
    const connecting = bridge.connect(
      () => undefined,
      () => undefined,
      () => undefined,
    );
    const socket = await waitForSocket();
    socket.emitOpen();
    const connection = await connecting;
    const frame = new Uint8Array(new SharedArrayBuffer(3));
    frame.set([1, 2, 3]);

    await connection.send(frame);

    const sent = socket.sentData[0];
    expect(sent).toBeInstanceOf(Uint8Array);
    if (!(sent instanceof Uint8Array)) throw new Error("Expected a Uint8Array WebSocket frame.");
    expect(sent).not.toBe(frame);
    expect(sent.buffer).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(sent)).toEqual([1, 2, 3]);
  });

  test("forwards incoming ArrayBuffer frames", async () => {
    const frames: Uint8Array[] = [];
    const bridge = createBrowserTerminalBridge();
    const connecting = bridge.connect(
      (frame) => frames.push(frame),
      () => undefined,
      () => undefined,
    );
    const socket = await waitForSocket();
    socket.emitOpen();
    await connecting;

    socket.emitMessage(Uint8Array.from([4, 5, 6]).buffer);

    expect(frames.map((frame) => Array.from(frame))).toEqual([[4, 5, 6]]);
  });

  test("reports an abnormal WebSocket close before marking the transport disconnected", async () => {
    const failures: TerminalFailure[] = [];
    const states: string[] = [];
    const bridge = createBrowserTerminalBridge();
    const connectWithFailure: (
      onFrame: (frame: Uint8Array) => void,
      onStateChange: (state: "connected" | "disconnected") => void,
      onFailure: (failure: TerminalFailure) => void,
    ) => ReturnType<typeof bridge.connect> = bridge.connect;

    const connecting = connectWithFailure(
      () => undefined,
      (state) => states.push(state),
      (failure) => failures.push(failure),
    );
    const socket = await waitForSocket();
    socket.emitOpen();
    await connecting;

    socket.emitClose(1013, "Terminal outbound queue limit exceeded.");

    expect(failures).toEqual([
      {
        code: "protocol_error",
        message: "Terminal outbound queue limit exceeded.",
      },
    ]);
    expect(states).toEqual(["connected", "disconnected"]);
  });

  test("keeps a normal WebSocket close silent", async () => {
    const failures: TerminalFailure[] = [];
    const bridge = createBrowserTerminalBridge();
    const connecting = bridge.connect(
      () => undefined,
      () => undefined,
      (failure) => failures.push(failure),
    );
    const socket = await waitForSocket();
    socket.emitOpen();
    await connecting;

    socket.emitClose(1000, "Terminal renderer disconnected.");

    expect(failures).toEqual([]);
  });
});

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
  readyState = 0;

  readonly url: string;
  readonly protocol: string;

  constructor(url: string | URL, protocols?: string | string[]) {
    super();
    this.url = url.toString();
    this.protocol = Array.isArray(protocols) ? (protocols[0] ?? "") : (protocols ?? "");
    FakeWebSocket.instances.push(this);
  }

  send(_data: string | ArrayBufferLike | Blob | ArrayBufferView): void {}

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

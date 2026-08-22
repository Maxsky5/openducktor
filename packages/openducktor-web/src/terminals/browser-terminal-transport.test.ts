import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { TerminalFailure } from "@openducktor/contracts";
import { configureBrowserRuntimeConfig } from "../browser-config";
import { createFetchFixture } from "../test-support";
import { createBrowserTerminalBridge } from "./browser-terminal-transport";

type SocketListener = (event: Event) => void;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  binaryType = "blob";
  readyState = 0;
  private readonly listeners = new Map<string, Set<SocketListener>>();

  readonly url: string;
  readonly protocol: string;

  constructor(url: string | URL, protocols?: string | string[]) {
    this.url = url.toString();
    this.protocol = Array.isArray(protocols) ? (protocols[0] ?? "") : (protocols ?? "");
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: SocketListener): void {
    const listeners = this.listeners.get(type) ?? new Set<SocketListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(): void {}

  close(): void {
    this.readyState = 3;
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", new Event("open"));
  }

  emitClose(code: number, reason: string): void {
    this.readyState = 3;
    // SAFETY: This test controls the fixture and supplies `CloseEvent` used by this case.
    this.emit("close", { code, reason } as CloseEvent);
  }

  private emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
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
  const webSocketConstructor: object = FakeWebSocket;
  // SAFETY: this fake implements the constructor and instance members used by the bridge tests.
  globalThis.WebSocket = webSocketConstructor as typeof WebSocket;
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
    // SAFETY: This test controls the fixture and supplies the asserted shape used by this case.
    const connectWithFailure = bridge.connect as (
      onFrame: (frame: Uint8Array) => void,
      onStateChange: (state: "connected" | "disconnected") => void,
      onFailure: (failure: TerminalFailure) => void,
    ) => ReturnType<typeof bridge.connect>;

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

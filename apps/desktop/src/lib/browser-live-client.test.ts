import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type FakeEventSourceListener = (event: MessageEvent<string>) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  closed = false;
  private readonly listeners = new Map<string, Set<FakeEventSourceListener>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const typedListener = listener as FakeEventSourceListener;
    const current = this.listeners.get(type) ?? new Set<FakeEventSourceListener>();
    current.add(typedListener);
    this.listeners.set(type, current);
  }

  removeEventListener(type: string, listener: EventListener): void {
    const current = this.listeners.get(type);
    if (!current) {
      return;
    }
    current.delete(listener as FakeEventSourceListener);
    if (current.size === 0) {
      this.listeners.delete(type);
    }
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: string): void {
    const current = this.listeners.get(type);
    if (!current) {
      return;
    }
    const event = { data } as MessageEvent<string>;
    for (const listener of current) {
      listener(event);
    }
  }

  static reset(): void {
    FakeEventSource.instances = [];
  }
}

const originalEventSource = globalThis.EventSource;

const loadBrowserLiveClient = () => import("./browser-live-client");

beforeEach(() => {
  mock.restore();
  FakeEventSource.reset();
  // @ts-expect-error test shim
  globalThis.EventSource = FakeEventSource;
});

afterEach(() => {
  globalThis.EventSource = originalEventSource;
});

describe("readBrowserLiveErrorMessage", () => {
  test("preserves plain-text backend error bodies", async () => {
    const { readBrowserLiveErrorMessage } = await loadBrowserLiveClient();
    const response = new Response("Plain backend error", {
      status: 500,
      headers: { "content-type": "text/plain" },
    });

    await expect(readBrowserLiveErrorMessage(response)).resolves.toBe("Plain backend error");
  });

  test("returns the structured error field from JSON bodies", async () => {
    const { readBrowserLiveErrorMessage } = await loadBrowserLiveClient();
    const response = new Response(JSON.stringify({ error: "Structured backend error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });

    await expect(readBrowserLiveErrorMessage(response)).resolves.toBe("Structured backend error");
  });

  test("falls back to the status message when the body is empty", async () => {
    const { readBrowserLiveErrorMessage } = await loadBrowserLiveClient();
    const response = new Response("", {
      status: 502,
      headers: { "content-type": "text/plain" },
    });

    await expect(readBrowserLiveErrorMessage(response)).resolves.toBe(
      "Browser backend request failed with status 502.",
    );
  });
});

describe("browser live SSE subscriptions", () => {
  test("shares one EventSource for multiple run-event subscribers", async () => {
    const { subscribeBrowserLiveRunEvents } = await loadBrowserLiveClient();
    const listenerA = mock(() => {});
    const listenerB = mock(() => {});

    const unsubscribeA = await subscribeBrowserLiveRunEvents(listenerA);
    const unsubscribeB = await subscribeBrowserLiveRunEvents(listenerB);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe("http://127.0.0.1:14327/events");

    FakeEventSource.instances[0]?.emit("message", JSON.stringify({ type: "run" }));

    expect(listenerA).toHaveBeenCalledWith({ type: "run" });
    expect(listenerB).toHaveBeenCalledWith({ type: "run" });

    unsubscribeA();
    expect(FakeEventSource.instances[0]?.closed).toBe(false);

    unsubscribeB();
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
  });

  test("shares one EventSource for multiple dev-server subscribers", async () => {
    const { subscribeBrowserLiveDevServerEvents } = await loadBrowserLiveClient();
    const listenerA = mock(() => {});
    const listenerB = mock(() => {});

    const unsubscribeA = await subscribeBrowserLiveDevServerEvents(listenerA);
    const unsubscribeB = await subscribeBrowserLiveDevServerEvents(listenerB);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe("http://127.0.0.1:14327/dev-server-events");

    FakeEventSource.instances[0]?.emit("message", JSON.stringify({ type: "dev-server" }));

    expect(listenerA).toHaveBeenCalledWith({ type: "dev-server" });
    expect(listenerB).toHaveBeenCalledWith({ type: "dev-server" });

    unsubscribeA();
    expect(FakeEventSource.instances[0]?.closed).toBe(false);

    unsubscribeB();
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
  });
});

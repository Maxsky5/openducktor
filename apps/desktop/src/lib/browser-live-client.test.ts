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
const originalFetch = globalThis.fetch;

const loadBrowserLiveClient = () => import("./browser-live-client");

beforeEach(() => {
  FakeEventSource.reset();
  // @ts-expect-error test shim
  globalThis.EventSource = FakeEventSource;
});

afterEach(() => {
  globalThis.EventSource = originalEventSource;
  globalThis.fetch = originalFetch;
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

describe("createBrowserLiveHostClient", () => {
  test("preserves structured timeout metadata through browser live runtimeEnsure", async () => {
    const { createBrowserLiveHostClient } = await loadBrowserLiveClient();
    const fetchMock = mock(async () => {
      return new Response(
        JSON.stringify({
          error: "OpenCode runtime is still starting",
          failureKind: "timeout",
        }),
        {
          status: 504,
          headers: { "content-type": "application/json" },
        },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const client = createBrowserLiveHostClient();
    const result = await client.runtimeEnsure("/repo", "opencode").then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    if (result.ok) {
      throw new Error("Expected runtimeEnsure to reject");
    }

    const { error } = result;
    expect(error instanceof Error).toBe(true);
    if (!(error instanceof Error)) {
      throw new Error("Expected runtimeEnsure to reject with an Error");
    }
    expect(error.message).toBe("OpenCode runtime is still starting");
    expect(Reflect.get(error, "failureKind")).toBe("timeout");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:14327/invoke/runtime_ensure",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoPath: "/repo", runtimeKind: "opencode" }),
      }),
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

  test("does not emit dev-server control payloads for run-event subscribers", async () => {
    const { subscribeBrowserLiveRunEvents } = await loadBrowserLiveClient();
    const listener = mock(() => {});

    const unsubscribe = await subscribeBrowserLiveRunEvents(listener);

    FakeEventSource.instances[0]?.emit("open", "");
    FakeEventSource.instances[0]?.emit("open", "");
    FakeEventSource.instances[0]?.emit("stream-warning", "ignored");
    FakeEventSource.instances[0]?.emit("message", JSON.stringify({ type: "run" }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ type: "run" });

    unsubscribe();
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

  test("emits reconnect and stream-warning control payloads for dev-server subscribers", async () => {
    const { subscribeBrowserLiveDevServerEvents } = await loadBrowserLiveClient();
    const listener = mock(() => {});

    const unsubscribe = await subscribeBrowserLiveDevServerEvents(listener);

    FakeEventSource.instances[0]?.emit("open", "");
    expect(listener).not.toHaveBeenCalled();

    FakeEventSource.instances[0]?.emit("open", "");
    FakeEventSource.instances[0]?.emit(
      "stream-warning",
      "Dev server stream skipped 4 events; reconnect will replay buffered events.",
    );

    expect(listener).toHaveBeenNthCalledWith(1, {
      __openducktorBrowserLive: true,
      kind: "reconnected",
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      __openducktorBrowserLive: true,
      kind: "stream-warning",
      message: "Dev server stream skipped 4 events; reconnect will replay buffered events.",
    });

    unsubscribe();
  });

  test("shares one EventSource for multiple task-event subscribers", async () => {
    const { subscribeBrowserLiveTaskEvents } = await loadBrowserLiveClient();
    const listenerA = mock(() => {});
    const listenerB = mock(() => {});

    const unsubscribeA = await subscribeBrowserLiveTaskEvents(listenerA);
    const unsubscribeB = await subscribeBrowserLiveTaskEvents(listenerB);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe("http://127.0.0.1:14327/task-events");

    FakeEventSource.instances[0]?.emit(
      "message",
      JSON.stringify({ kind: "external_task_created", repoPath: "/repo", taskId: "task-1" }),
    );

    expect(listenerA).toHaveBeenCalledWith({
      kind: "external_task_created",
      repoPath: "/repo",
      taskId: "task-1",
    });
    expect(listenerB).toHaveBeenCalledWith({
      kind: "external_task_created",
      repoPath: "/repo",
      taskId: "task-1",
    });

    unsubscribeA();
    expect(FakeEventSource.instances[0]?.closed).toBe(false);

    unsubscribeB();
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
  });
});

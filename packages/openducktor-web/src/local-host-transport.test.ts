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
const originalBackendUrl = process.env.VITE_ODT_BROWSER_BACKEND_URL;
const originalAuthToken = process.env.VITE_ODT_BROWSER_AUTH_TOKEN;

const loadLocalHostTransport = () => import("./local-host-transport");

beforeEach(() => {
  FakeEventSource.reset();
  process.env.VITE_ODT_BROWSER_BACKEND_URL = "http://127.0.0.1:14327";
  process.env.VITE_ODT_BROWSER_AUTH_TOKEN = "app-token";
  // @ts-expect-error test shim
  globalThis.EventSource = FakeEventSource;
});

afterEach(() => {
  globalThis.EventSource = originalEventSource;
  globalThis.fetch = originalFetch;
  if (originalBackendUrl === undefined) {
    delete process.env.VITE_ODT_BROWSER_BACKEND_URL;
  } else {
    process.env.VITE_ODT_BROWSER_BACKEND_URL = originalBackendUrl;
  }
  if (originalAuthToken === undefined) {
    delete process.env.VITE_ODT_BROWSER_AUTH_TOKEN;
  } else {
    process.env.VITE_ODT_BROWSER_AUTH_TOKEN = originalAuthToken;
  }
});

describe("readLocalHostErrorMessage", () => {
  test("preserves plain-text backend error bodies", async () => {
    const { readLocalHostErrorMessage } = await loadLocalHostTransport();
    const response = new Response("Plain backend error", {
      status: 500,
      headers: { "content-type": "text/plain" },
    });

    await expect(readLocalHostErrorMessage(response)).resolves.toBe("Plain backend error");
  });

  test("returns the structured error field from JSON bodies", async () => {
    const { readLocalHostErrorMessage } = await loadLocalHostTransport();
    const response = new Response(JSON.stringify({ error: "Structured backend error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });

    await expect(readLocalHostErrorMessage(response)).resolves.toBe("Structured backend error");
  });

  test("returns the host status message when the body is empty", async () => {
    const { readLocalHostErrorMessage } = await loadLocalHostTransport();
    const response = new Response("", {
      status: 502,
      headers: { "content-type": "text/plain" },
    });

    await expect(readLocalHostErrorMessage(response)).resolves.toBe(
      "OpenDucktor web host request failed with status 502.",
    );
  });
});

describe("createLocalHostClient", () => {
  test("preserves structured timeout metadata through local web runtimeEnsure", async () => {
    const { createLocalHostClient } = await loadLocalHostTransport();
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

    const client = createLocalHostClient();
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
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": "app-token",
        },
        body: JSON.stringify({ repoPath: "/repo", runtimeKind: "opencode" }),
      }),
    );
  });
});

describe("local host SSE subscriptions", () => {
  test("shares one EventSource for multiple run-event subscribers", async () => {
    const { subscribeLocalHostRunEvents } = await loadLocalHostTransport();
    const listenerA = mock(() => {});
    const listenerB = mock(() => {});

    const unsubscribeA = await subscribeLocalHostRunEvents(listenerA);
    const unsubscribeB = await subscribeLocalHostRunEvents(listenerB);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe("http://127.0.0.1:14327/events?token=app-token");

    FakeEventSource.instances[0]?.emit("message", JSON.stringify({ type: "run" }));

    expect(listenerA).toHaveBeenCalledWith({ type: "run" });
    expect(listenerB).toHaveBeenCalledWith({ type: "run" });

    unsubscribeA();
    expect(FakeEventSource.instances[0]?.closed).toBe(false);

    unsubscribeB();
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
  });

  test("emits reconnect and stream-warning control payloads for task-event subscribers", async () => {
    const { subscribeLocalHostTaskEvents } = await loadLocalHostTransport();
    const listener = mock(() => {});

    const unsubscribe = await subscribeLocalHostTaskEvents(listener);

    FakeEventSource.instances[0]?.emit("open", "");
    expect(listener).not.toHaveBeenCalled();

    FakeEventSource.instances[0]?.emit("open", "");
    FakeEventSource.instances[0]?.emit(
      "stream-warning",
      "Task stream skipped 2 events; reconnect will replay buffered events.",
    );

    expect(listener).toHaveBeenNthCalledWith(1, {
      __openducktorBrowserLive: true,
      kind: "reconnected",
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      __openducktorBrowserLive: true,
      kind: "stream-warning",
      message: "Task stream skipped 2 events; reconnect will replay buffered events.",
    });

    unsubscribe();
  });

  test("buildLocalAttachmentPreviewUrl normalizes the backend base URL", async () => {
    const { buildLocalAttachmentPreviewUrl } = await loadLocalHostTransport();

    expect(
      buildLocalAttachmentPreviewUrl("http://127.0.0.1:14327/", "app-token", "/tmp/preview.png"),
    ).toBe(
      "http://127.0.0.1:14327/local-attachment-preview?path=%2Ftmp%2Fpreview.png&token=app-token",
    );
  });
});

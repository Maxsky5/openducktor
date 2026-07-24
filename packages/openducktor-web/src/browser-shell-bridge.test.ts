import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import packageJson from "../package.json";
import { configureBrowserRuntimeConfig } from "./browser-config";
import { createBrowserShellBridge } from "./browser-shell-bridge";
import { validateExternalBrowserUrl } from "./browser-url-validation";

class TaskEventSource {
  static instance: TaskEventSource | null = null;
  private readonly listeners = new Map<string, EventListener>();

  constructor(_url: string, _options?: EventSourceInit) {
    TaskEventSource.instance = this;
  }

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }

  close(): void {}

  emit(type: string, data: string): void {
    this.listeners.get(type)?.({ data } as MessageEvent<string> as Event);
  }

  hasListener(type: string): boolean {
    return this.listeners.has(type);
  }
}

const originalEventSource = globalThis.EventSource;
const originalFetch = globalThis.fetch;

const waitForTaskEventSource = async (): Promise<TaskEventSource> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (TaskEventSource.instance) {
      return TaskEventSource.instance;
    }
    await Promise.resolve();
  }

  throw new Error("Expected EventSource subscription.");
};

const waitForTaskEventSourceListener = async (
  eventSource: TaskEventSource,
  type: string,
): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (eventSource.hasListener(type)) {
      return;
    }
    await Promise.resolve();
  }

  throw new Error(`Expected task EventSource listener for ${type}.`);
};

describe("browser shell bridge", () => {
  let previousAppVersion: string | undefined;

  beforeEach(() => {
    TaskEventSource.instance = null;
    previousAppVersion = process.env.VITE_ODT_APP_VERSION;
    process.env.VITE_ODT_APP_VERSION = packageJson.version;
  });

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
    globalThis.fetch = originalFetch;
    configureBrowserRuntimeConfig({});
    if (previousAppVersion === undefined) {
      delete process.env.VITE_ODT_APP_VERSION;
      return;
    }

    process.env.VITE_ODT_APP_VERSION = previousAppVersion;
  });

  test("forwards task stream frames without mutating task metadata", async () => {
    configureBrowserRuntimeConfig({ backendUrl: "http://127.0.0.1:14327", appToken: "app-token" });
    // @ts-expect-error test EventSource shim
    globalThis.EventSource = TaskEventSource;
    const subscriptionId = "05e77c20-ebf2-4e7f-a880-9c95c24627ee";
    const fetchMock = mock(async (url: string | URL | Request, _init?: RequestInit) => {
      if (url.toString().endsWith("/subscriptions")) {
        return new Response(JSON.stringify({ streamToken: "stream-token", subscriptionId }), {
          status: 201,
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const bridge = createBrowserShellBridge();
    const reconcile = mock(() => {});
    bridge.client.reconcileExternalTaskSyncEvent = reconcile;
    const listener = mock(() => {});
    const subscriptionPromise = bridge.subscribeTaskStream({ cursor: null }, listener);
    const eventSource = await waitForTaskEventSource();
    await waitForTaskEventSourceListener(eventSource, "open");
    eventSource.emit("open", "");
    const subscription = await subscriptionPromise;

    const frame = {
      type: "snapshot_required",
      cursor: { epoch: "fc49d1f9-708c-4198-b56b-f1437b2bbcea", sequence: 0 },
      reason: "buffer_gap",
    };
    eventSource.emit("task-frame", JSON.stringify(frame));

    expect(listener).toHaveBeenCalledWith(frame);
    expect(reconcile).not.toHaveBeenCalled();
    await subscription.acknowledge(frame.cursor);
    await subscription.unsubscribe();

    const calls = fetchMock.mock.calls;
    expect(calls.map(([url]) => url.toString())).toContain(
      `http://127.0.0.1:14327/task-events/subscriptions/${subscriptionId}/ack`,
    );
    expect(calls.map(([url]) => url.toString())).toContain(
      `http://127.0.0.1:14327/task-events/subscriptions/${subscriptionId}`,
    );
    const acknowledgeCall = calls.find(([url]) => url.toString().endsWith("/ack"));
    expect(acknowledgeCall?.[1]).toMatchObject({
      body: JSON.stringify({ cursor: frame.cursor }),
      headers: {
        "content-type": "application/json",
        "x-openducktor-task-stream-token": "stream-token",
      },
      method: "POST",
    });
  });

  test("reports the web runner version and external update policy", async () => {
    const bridge = createBrowserShellBridge();

    expect(await bridge.appUpdates.getState()).toEqual({
      status: "disabled",
      currentVersion: packageJson.version,
      disabledCode: "unsupported_web_runner",
      disabledReason: "The browser runner does not install updates in OpenDucktor.",
    });
  });

  test("fails when the web build version is missing", () => {
    delete process.env.VITE_ODT_APP_VERSION;

    expect(() => createBrowserShellBridge()).toThrow("OpenDucktor web build version is missing.");
  });

  test("allows absolute http and https external URLs", () => {
    expect(validateExternalBrowserUrl("https://example.com/path?q=1")).toBe(
      "https://example.com/path?q=1",
    );
    expect(validateExternalBrowserUrl(" http://localhost:1420/kanban ")).toBe(
      "http://localhost:1420/kanban",
    );
  });

  test("rejects non-http external URL schemes", () => {
    expect(() => validateExternalBrowserUrl("javascript:alert(1)")).toThrow(
      "OpenDucktor web can only open http or https URLs.",
    );
    expect(() => validateExternalBrowserUrl("file:///tmp/secret.txt")).toThrow(
      "OpenDucktor web can only open http or https URLs.",
    );
  });

  test("rejects malformed or relative external URLs", () => {
    expect(() => validateExternalBrowserUrl("/relative/path")).toThrow(
      "OpenDucktor web can only open absolute http or https URLs.",
    );
    expect(() => validateExternalBrowserUrl("not a url")).toThrow(
      "OpenDucktor web can only open absolute http or https URLs.",
    );
  });

  test("does not treat noopener window.open null results as blocked popups", async () => {
    const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        open: () => null,
      },
    });

    try {
      await expect(
        createBrowserShellBridge().openExternalUrl("https://example.com/docs"),
      ).resolves.toBeUndefined();
    } finally {
      if (originalWindowDescriptor) {
        Object.defineProperty(globalThis, "window", originalWindowDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });
});

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";
import { configureBrowserRuntimeConfig } from "./browser-config";

type FakeEventSourceListener = (event: MessageEvent<string>) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readonly options: EventSourceInit | undefined;
  closed = false;
  private readonly listeners = new Map<string, Set<FakeEventSourceListener>>();

  constructor(url: string, options?: EventSourceInit) {
    this.url = url;
    this.options = options;
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
let localHostTransportImportId = 0;
let localHostTransportImportPath = "./local-host-transport.ts?test=0";

const loadLocalHostTransport = () => import(localHostTransportImportPath);

const waitForEventSourceInstance = async (index = 0): Promise<FakeEventSource> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const instance = FakeEventSource.instances[index];
    if (instance) {
      return instance;
    }
    await Promise.resolve();
  }

  throw new Error(`Expected EventSource instance ${index} to be created.`);
};

beforeEach(async () => {
  localHostTransportImportId += 1;
  localHostTransportImportPath = `./local-host-transport.ts?test=${localHostTransportImportId}`;
  FakeEventSource.reset();
  configureBrowserRuntimeConfig({ backendUrl: "http://127.0.0.1:14327", appToken: "app-token" });
  process.env.VITE_ODT_BROWSER_BACKEND_URL = "http://127.0.0.1:14327";
  process.env.VITE_ODT_BROWSER_AUTH_TOKEN = "app-token";
  // @ts-expect-error test shim
  globalThis.EventSource = FakeEventSource;
});

afterEach(() => {
  globalThis.EventSource = originalEventSource;
  globalThis.fetch = originalFetch;
  configureBrowserRuntimeConfig({});
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

describe("readLocalHostErrorPayload", () => {
  test("preserves plain-text backend error bodies", async () => {
    const { readLocalHostErrorPayload } = await import("./local-host-errors");
    const response = new Response("Plain backend error", {
      status: 500,
      headers: { "content-type": "text/plain" },
    });

    await expect(readLocalHostErrorPayload(response)).resolves.toMatchObject({
      message: "Plain backend error",
      payload: null,
    });
  });

  test("returns the structured error field from JSON bodies", async () => {
    const { readLocalHostErrorPayload } = await import("./local-host-errors");
    const response = new Response(JSON.stringify({ error: "Structured backend error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });

    await expect(readLocalHostErrorPayload(response)).resolves.toMatchObject({
      message: "Structured backend error",
      payload: { error: "Structured backend error" },
    });
  });

  test("returns the host status message when the body is empty", async () => {
    const { readLocalHostErrorPayload } = await import("./local-host-errors");
    const response = new Response("", {
      status: 502,
      headers: { "content-type": "text/plain" },
    });

    await expect(readLocalHostErrorPayload(response)).resolves.toMatchObject({
      message: "OpenDucktor web host request failed with status 502.",
      payload: null,
    });
  });
});

describe("createLocalHostClient", () => {
  test("rejects local host session failures with a typed web host request error", async () => {
    const { ensureLocalHostSession } = await loadLocalHostTransport();
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ error: "Session rejected" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof globalThis.fetch;

    const session = ensureLocalHostSession();
    await expect(session).rejects.toThrow("Session rejected");
    await expect(session).rejects.toMatchObject({
      _tag: "WebHostRequestError",
    });
  });

  test("preserves structured timeout metadata through local web runtimeEnsure", async () => {
    const { createLocalHostClient } = await loadLocalHostTransport();
    const fetchMock = mock(async (url: string | URL | Request) => {
      if (url.toString().endsWith("/session")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

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

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:14327/session",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: {
          "x-openducktor-app-token": "app-token",
        },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:14327/invoke/runtime_ensure",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": "app-token",
        },
        body: JSON.stringify({ repoPath: "/repo", runtimeKind: "opencode" }),
      }),
    );
  });

  test("preserves structured terminal failures through the local web transport", async () => {
    const { createLocalHostClient } = await loadLocalHostTransport();
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      if (url.toString().endsWith("/session")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      return new Response(
        JSON.stringify({
          error: "Interactive terminals are unavailable in this runtime.",
          failure: {
            kind: "terminal",
            terminalFailure: {
              code: "unsupported_runtime",
              message: "Interactive terminals are unavailable in this runtime.",
            },
          },
        }),
        { status: 500 },
      );
    }) as unknown as typeof globalThis.fetch;

    await expect(
      createLocalHostClient().terminalCreate({ workingDir: "/repo", context: {} }),
    ).rejects.toMatchObject({
      name: "HostTerminalClientError",
      code: "unsupported_runtime",
    });
  });
});

describe("local host SSE subscriptions", () => {
  test("shares one EventSource across every host event channel", async () => {
    const {
      observeLocalHostAgentSessions,
      subscribeLocalHostDevServerEvents,
      subscribeLocalHostRunEvents,
      subscribeLocalHostTaskEvents,
    } = await loadLocalHostTransport();
    const fetchMock = mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const runListener = mock(() => {});
    const devServerListener = mock(() => {});
    const taskListener = mock(() => {});
    const liveSessionListener = mock(() => {});

    const unsubscribeRun = await subscribeLocalHostRunEvents(runListener);
    const unsubscribeTask = await subscribeLocalHostTaskEvents(taskListener);
    const devServerSubscription = subscribeLocalHostDevServerEvents(devServerListener);
    const liveSessionObservation = observeLocalHostAgentSessions(
      { repoPath: "/repo" },
      liveSessionListener,
    );

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe("http://127.0.0.1:14327/events");
    expect(FakeEventSource.instances[0]?.options).toEqual({ withCredentials: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    FakeEventSource.instances[0]?.emit("open", "");
    const { unsubscribe: unsubscribeDevServer } = await devServerSubscription;
    const stopObservingLiveSessions = await liveSessionObservation;

    const emitHostEvent = (channel: string, payload: unknown): void => {
      FakeEventSource.instances[0]?.emit("message", JSON.stringify({ channel, payload }));
    };
    emitHostEvent("openducktor://run-event", { type: "run" });
    emitHostEvent("openducktor://dev-server-event", { type: "dev-server" });
    emitHostEvent("openducktor://task-event", { type: "task" });
    emitHostEvent("openducktor://agent-session-live-event", {
      type: "snapshot",
      repoPath: "/repo",
      sessions: [],
    });

    expect(runListener).toHaveBeenCalledWith({ type: "run" });
    expect(devServerListener).toHaveBeenCalledWith({ type: "dev-server" });
    expect(taskListener).toHaveBeenCalledWith({ type: "task" });
    expect(liveSessionListener).toHaveBeenCalledWith({
      type: "snapshot",
      repoPath: "/repo",
      sessions: [],
    });

    unsubscribeRun();
    unsubscribeTask();
    unsubscribeDevServer();
    expect(FakeEventSource.instances[0]?.closed).toBe(false);

    stopObservingLiveSessions();
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
  });

  test("emits reconnect and stream-warning control payloads for task-event subscribers", async () => {
    const { subscribeLocalHostTaskEvents } = await loadLocalHostTransport();
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
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
      transportEpoch: "events:1",
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      __openducktorBrowserLive: true,
      kind: "stream-warning",
      message: "Task stream skipped 2 events; reconnect will replay buffered events.",
    });

    unsubscribe();
  });

  test("resolves dev-server subscriptions on initial open and emits reconnect control payloads afterward", async () => {
    const { subscribeLocalHostDevServerEvents } = await loadLocalHostTransport();
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const listener = mock(() => {});

    const subscription = subscribeLocalHostDevServerEvents(listener);
    const eventSource = await waitForEventSourceInstance();
    let didResolve = false;
    void subscription.then(() => {
      didResolve = true;
    });

    await Promise.resolve();
    expect(didResolve).toBe(false);

    eventSource.emit("open", "");
    const { transportEpoch, unsubscribe } = await subscription;
    expect(transportEpoch).toBe("events:0");
    expect(listener).not.toHaveBeenCalled();

    eventSource.emit("open", "");
    expect(listener).toHaveBeenNthCalledWith(1, {
      __openducktorBrowserLive: true,
      kind: "reconnected",
      transportEpoch: "events:1",
    });

    unsubscribe();
  });

  test("keeps the shared connection usable when a retained task subscriber sees an error before open", async () => {
    const { observeLocalHostAgentSessions, subscribeLocalHostTaskEvents } =
      await loadLocalHostTransport();
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;

    const unsubscribeTask = await subscribeLocalHostTaskEvents(mock(() => {}));
    const eventSource = await waitForEventSourceInstance();
    eventSource.emit("error", "initial connection failed");

    const liveSessionObservation = observeLocalHostAgentSessions(
      { repoPath: "/repo" },
      mock(() => {}),
    );
    eventSource.emit("open", "");

    const stopObserving = await liveSessionObservation;
    expect(FakeEventSource.instances).toHaveLength(1);

    stopObserving();
    unsubscribeTask();
    expect(eventSource.closed).toBe(true);
  });

  test("refreshes live-session state on the shared connection without losing ordered deltas", async () => {
    const { observeLocalHostAgentSessions } = await loadLocalHostTransport();
    let refreshCallCount = 0;
    let resolveSecondRefresh: () => void = () => {};
    const secondRefresh = new Promise<void>((resolve) => {
      resolveSecondRefresh = resolve;
    });
    const fetchMock = mock(async (url: string | URL | Request) => {
      if (url.toString().endsWith("/invoke/agent_session_live_refresh")) {
        refreshCallCount += 1;
        if (refreshCallCount === 2) {
          resolveSecondRefresh();
        }
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const listener = mock((_envelope: AgentSessionLiveEnvelope) => {});

    const observation = observeLocalHostAgentSessions({ repoPath: "/repo" }, listener);
    const eventSource = await waitForEventSourceInstance();
    expect(new URL(eventSource.url).pathname).toBe("/events");

    eventSource.emit("open", "");
    const stopObserving = await observation;
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:14327/invoke/agent_session_live_refresh",
      expect.objectContaining({ body: JSON.stringify({ repoPath: "/repo" }) }),
    );

    const transcriptEvent = {
      type: "transcript_event",
      event: {
        type: "assistant_message",
        externalSessionId: "child-thread",
        messageId: "assistant-1",
        message: "New child output",
        timestamp: "2026-07-17T08:00:00.000Z",
        sessionRef: {
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo/worktree",
          externalSessionId: "child-thread",
        },
      },
    } satisfies AgentSessionLiveEnvelope;
    eventSource.emit(
      "message",
      JSON.stringify({
        channel: "openducktor://agent-session-live-event",
        payload: transcriptEvent,
      }),
    );
    expect(listener).not.toHaveBeenCalled();

    const snapshot = {
      type: "snapshot",
      repoPath: "/repo",
      sessions: [],
    } satisfies AgentSessionLiveEnvelope;
    eventSource.emit(
      "message",
      JSON.stringify({
        channel: "openducktor://agent-session-live-event",
        payload: snapshot,
      }),
    );
    expect(listener.mock.calls.map(([envelope]) => envelope)).toEqual([snapshot, transcriptEvent]);

    eventSource.emit("open", "");
    await secondRefresh;
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        url.toString().endsWith("/invoke/agent_session_live_refresh"),
      ),
    ).toHaveLength(2);

    const transcriptGap = {
      type: "transcript_gap",
      repoPath: "/repo",
      message: "Host event stream skipped 2 events; reconnect will replay buffered events.",
    } satisfies AgentSessionLiveEnvelope;
    eventSource.emit("stream-warning", transcriptGap.message);
    expect(listener).toHaveBeenNthCalledWith(3, transcriptGap);

    const reconnectTranscriptEvent = {
      ...transcriptEvent,
      event: {
        ...transcriptEvent.event,
        messageId: "assistant-2",
        message: "Output during reconnect",
      },
    } satisfies AgentSessionLiveEnvelope;
    eventSource.emit(
      "message",
      JSON.stringify({
        channel: "openducktor://agent-session-live-event",
        payload: reconnectTranscriptEvent,
      }),
    );
    expect(listener).toHaveBeenCalledTimes(3);
    const replayedSnapshot = { ...snapshot };
    eventSource.emit(
      "message",
      JSON.stringify({
        channel: "openducktor://agent-session-live-event",
        payload: replayedSnapshot,
      }),
    );
    const refreshedSnapshot = { ...snapshot };
    eventSource.emit(
      "message",
      JSON.stringify({
        channel: "openducktor://agent-session-live-event",
        payload: refreshedSnapshot,
      }),
    );
    expect(listener.mock.calls.map(([envelope]) => envelope)).toEqual([
      snapshot,
      transcriptEvent,
      transcriptGap,
      replayedSnapshot,
      reconnectTranscriptEvent,
      refreshedSnapshot,
    ]);

    stopObserving();
  });

  test("delivers replay gaps to every live-session observer when one listener fails", async () => {
    const { observeLocalHostAgentSessions } = await loadLocalHostTransport();
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const throwingListener = mock((envelope: AgentSessionLiveEnvelope) => {
      if (envelope.type === "transcript_gap") {
        throw new Error("listener failed");
      }
    });
    const listener = mock((_envelope: AgentSessionLiveEnvelope) => {});

    const firstObservation = observeLocalHostAgentSessions({ repoPath: "/repo" }, throwingListener);
    const eventSource = await waitForEventSourceInstance();
    const secondObservation = observeLocalHostAgentSessions({ repoPath: "/repo" }, listener);
    eventSource.emit("open", "");
    const stopFirstObservation = await firstObservation;
    const stopSecondObservation = await secondObservation;

    expect(() =>
      eventSource.emit("stream-warning", "Host event replay skipped transcript events."),
    ).toThrow("listener failed");
    expect(listener).toHaveBeenCalledWith({
      type: "transcript_gap",
      repoPath: "/repo",
      message: "Host event replay skipped transcript events.",
    });

    stopFirstObservation();
    stopSecondObservation();
  });

  test("waits for the native EventSource reconnect when the initial open fails", async () => {
    const { subscribeLocalHostDevServerEvents } = await loadLocalHostTransport();
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const listener = mock(() => {});

    const subscription = subscribeLocalHostDevServerEvents(listener);
    const eventSource = await waitForEventSourceInstance();

    eventSource.emit("error", "failed");
    eventSource.emit("error", "still failed");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      __openducktorBrowserLive: true,
      kind: "stream-warning",
      message: "EventSource events reported an error before opening.",
    });
    expect(eventSource.closed).toBe(false);

    eventSource.emit("open", "");
    const { transportEpoch, unsubscribe } = await subscription;
    expect(transportEpoch).toBe("events:0");
    unsubscribe();
    expect(eventSource.closed).toBe(true);
  });

  test("emits a stream-warning control payload when dev-server EventSource errors after opening", async () => {
    const { subscribeLocalHostDevServerEvents } = await loadLocalHostTransport();
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const listener = mock(() => {});

    const subscription = subscribeLocalHostDevServerEvents(listener);
    const eventSource = await waitForEventSourceInstance();
    eventSource.emit("open", "");
    const { unsubscribe } = await subscription;

    eventSource.emit("error", "lost connection");

    expect(listener).toHaveBeenNthCalledWith(1, {
      __openducktorBrowserLive: true,
      kind: "stream-warning",
      message: "EventSource events reported an error after opening.",
    });

    eventSource.emit("error", "still disconnected");
    expect(listener).toHaveBeenCalledTimes(1);

    eventSource.emit("open", "");
    expect(listener).toHaveBeenNthCalledWith(2, {
      __openducktorBrowserLive: true,
      kind: "reconnected",
      transportEpoch: "events:1",
    });

    eventSource.emit("error", "lost again");
    expect(listener).toHaveBeenNthCalledWith(3, {
      __openducktorBrowserLive: true,
      kind: "stream-warning",
      message: "EventSource events reported an error after opening.",
    });

    unsubscribe();
  });

  test("isolates post-open dev-server stream-warning listener failures", async () => {
    const { subscribeLocalHostDevServerEvents } = await loadLocalHostTransport();
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const throwingListener = mock(() => {
      throw new Error("listener failed");
    });
    const listener = mock(() => {});

    const throwingSubscription = subscribeLocalHostDevServerEvents(throwingListener);
    const eventSource = await waitForEventSourceInstance();
    eventSource.emit("open", "");
    const { unsubscribe: unsubscribeThrowing } = await throwingSubscription;
    const { unsubscribe } = await subscribeLocalHostDevServerEvents(listener);

    expect(() => eventSource.emit("error", "lost connection")).toThrow("listener failed");
    expect(listener).toHaveBeenNthCalledWith(1, {
      __openducktorBrowserLive: true,
      kind: "stream-warning",
      message: "EventSource events reported an error after opening.",
    });

    eventSource.emit("error", "still disconnected");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribeThrowing();
    unsubscribe();
  });

  test("isolates named dev-server stream-warning listener failures", async () => {
    const { subscribeLocalHostDevServerEvents } = await loadLocalHostTransport();
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const throwingListener = mock(() => {
      throw new Error("listener failed");
    });
    const listener = mock(() => {});

    const throwingSubscription = subscribeLocalHostDevServerEvents(throwingListener);
    const eventSource = await waitForEventSourceInstance();
    eventSource.emit("open", "");
    const { unsubscribe: unsubscribeThrowing } = await throwingSubscription;
    const { unsubscribe } = await subscribeLocalHostDevServerEvents(listener);

    expect(() =>
      eventSource.emit(
        "stream-warning",
        "Dev server stream skipped 2 events; reconnect will replay buffered events.",
      ),
    ).toThrow("listener failed");
    expect(listener).toHaveBeenNthCalledWith(1, {
      __openducktorBrowserLive: true,
      kind: "stream-warning",
      message: "Dev server stream skipped 2 events; reconnect will replay buffered events.",
    });

    unsubscribeThrowing();
    unsubscribe();
  });

  test("buildLocalAttachmentPreviewUrl normalizes the backend base URL", async () => {
    const { buildLocalAttachmentPreviewUrl } = await loadLocalHostTransport();

    expect(buildLocalAttachmentPreviewUrl("http://127.0.0.1:14327/", "/tmp/preview.png")).toBe(
      "http://127.0.0.1:14327/local-attachment-preview?path=%2Ftmp%2Fpreview.png",
    );
  });
});

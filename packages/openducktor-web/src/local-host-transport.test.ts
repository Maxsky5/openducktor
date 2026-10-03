import { liveSessionStreamEventName } from "./host-event-stream-name";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentSessionLiveBaseline, AgentSessionLiveEnvelope } from "@openducktor/contracts";
import { Effect } from "effect";
import type { JSONType } from "zod";
import { configureBrowserRuntimeConfig } from "./browser-config";
import { WebDependencyError } from "./effect/web-errors";
import { createFetchFixture } from "./test-support";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly url: string;
  readonly options: EventSourceInit | undefined;
  closed = false;
  readyState = FakeEventSource.CONNECTING;
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(url: string, options?: EventSourceInit) {
    this.url = url;
    this.options = options;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const current = this.listeners.get(type) ?? new Set<EventListener>();
    current.add(listener);
    this.listeners.set(type, current);
  }

  removeEventListener(type: string, listener: EventListener): void {
    const current = this.listeners.get(type);
    if (!current) {
      return;
    }
    current.delete(listener);
    if (current.size === 0) {
      this.listeners.delete(type);
    }
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(type: string, data: string): void {
    if (type === "open") {
      this.readyState = FakeEventSource.OPEN;
    }
    if (type === "open") {
      const boundary = JSON.stringify({
        hostEpoch: TEST_HOST_EPOCH,
        sequence: 0,
        hostChanged: false,
        losses: [],
      });
      this.emit("replay-start", boundary);
      this.emit("replay-complete", boundary);
    }
    const current = this.listeners.get(type);
    if (!current) {
      return;
    }
    const event =
      type === "open" || type === "error"
        ? new Event(type)
        : new MessageEvent<string>(type, { data });
    for (const listener of current) {
      listener(event);
    }
  }

  emitAsBrowser(type: string, data: string): void {
    const target = new EventTarget();
    for (const listener of this.listeners.get(type) ?? []) target.addEventListener(type, listener);
    target.dispatchEvent(new MessageEvent(type, { data }));
  }

  hasListener(type: string): boolean {
    return (this.listeners.get(type)?.size ?? 0) > 0;
  }

  static reset(): void {
    FakeEventSource.instances = [];
  }
}

const TEST_HOST_EPOCH = "12345678-1234-4234-9234-123456789abc";
const liveBaseline = (sequence: number): AgentSessionLiveBaseline => ({
  repoPath: "/repo",
  sessions: [
    {
      ref: {
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        externalSessionId: "thread",
      },
      activity: "idle",
      title: "Initial",
      startedAt: "2026-10-01T08:00:00Z",
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: null,
    },
  ],
  runtimeGenerations: [],
  complete: true,
  failures: [],
  cursor: { hostEpoch: TEST_HOST_EPOCH, sequence },
});

const originalEventSource = globalThis.EventSource;
const originalFetch = globalThis.fetch;
const originalBackendUrl = process.env.VITE_ODT_BROWSER_BACKEND_URL;
const originalAuthToken = process.env.VITE_ODT_BROWSER_AUTH_TOKEN;
let localHostTransportImportId = 0;
let localHostTransportImportPath = "./local-host-transport.ts?test=0";

const loadLocalHostTransport = () => import(localHostTransportImportPath);

const waitForEventSourceInstance = async (index = 0): Promise<FakeEventSource> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const instance = FakeEventSource.instances[index];
    if (instance) {
      return instance;
    }
    await Promise.resolve();
  }

  throw new Error(`Expected EventSource instance ${index} to be created.`);
};

const waitForEventSourceListener = async (
  eventSource: FakeEventSource,
  type: string,
): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (eventSource.hasListener(type)) {
      return;
    }
    await Promise.resolve();
  }

  throw new Error(`Expected EventSource listener for ${type}.`);
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

  test("returns the parsed structured payload without reparsing its message", async () => {
    const { readLocalHostErrorPayload } = await import("./local-host-errors");
    const response = new Response(JSON.stringify({ error: "  Structured backend error  " }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });

    await expect(readLocalHostErrorPayload(response)).resolves.toEqual({
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
    globalThis.fetch = createFetchFixture(
      mock(
        async () =>
          new Response(JSON.stringify({ error: "Session rejected" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const session = ensureLocalHostSession();
    await expect(session).rejects.toThrow("Session rejected");
    await expect(session).rejects.toMatchObject({
      _tag: "WebHostRequestError",
    });
  });

  test("preserves structured timeout metadata through local web runtimeEnsure", async () => {
    const { createLocalHostClient } = await loadLocalHostTransport();
    const fetchMock = mock(async (url: string | URL | Request, _init?: RequestInit) => {
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
    globalThis.fetch = createFetchFixture(fetchMock);

    const client = createLocalHostClient();
    let error: unknown;
    try {
      await client.runtimeEnsure("/repo", "opencode");
    } catch (cause) {
      error = cause;
    }

    expect(error instanceof Error).toBe(true);
    if (!(error instanceof Error)) {
      throw new Error("Expected runtimeEnsure to reject with an Error");
    }
    expect(error.message).toBe("OpenCode runtime is still starting");
    expect(error).toMatchObject({ failureKind: "timeout" });

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
    globalThis.fetch = createFetchFixture(
      mock(async (url: string | URL | Request) => {
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
      }),
    );

    await expect(
      createLocalHostClient().terminalCreate({ workingDir: "/repo", context: {} }),
    ).rejects.toMatchObject({
      name: "HostTerminalClientError",
      code: "unsupported_runtime",
    });
  });

  test("preserves acceptance through the local web transport and host client", async () => {
    const { createLocalHostClient } = await loadLocalHostTransport();
    const sessionRef = {
      repoPath: "/repo",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo",
      externalSessionId: "native",
    };
    const failure = {
      kind: "agent_session_message_accepted",
      sessionRef,
      acceptedMessage: {
        type: "user_message",
        externalSessionId: "native",
        messageId: "message-1",
        timestamp: "2026-09-12T10:00:00Z",
        message: "Hello",
        parts: [],
        state: "read",
      },
      stage: "live_update",
    };
    globalThis.fetch = createFetchFixture(
      mock(async (url: string | URL | Request) =>
        url.toString().endsWith("/session")
          ? new Response(JSON.stringify({ ok: true }), { status: 200 })
          : new Response(
              JSON.stringify({
                error: "The runtime accepted the message, but the session update failed.",
                failure,
              }),
              { status: 500 },
            ),
      ),
    );
    await expect(
      createLocalHostClient().agentSessionControlSend({
        ...sessionRef,
        sessionScope: { kind: "repository" },
        parts: [{ kind: "text", text: "Hello" }],
      }),
    ).rejects.toMatchObject({ name: "HostInvokeError", failure });
  });

  test("preserves workspace write failures through the local web transport", async () => {
    const { createLocalHostClient } = await loadLocalHostTransport();
    globalThis.fetch = createFetchFixture(
      mock(async (url: string | URL | Request) => {
        if (url.toString().endsWith("/session")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }

        return new Response(
          JSON.stringify({
            error: "The file changed after it was loaded.",
            failure: {
              kind: "workspace_text_file_write",
              workspaceTextFileWriteFailure: {
                code: "stale_revision",
                message: "The file changed after it was loaded.",
                rootPath: "/repo",
                relativePath: "src/file.ts",
              },
            },
          }),
          { status: 500 },
        );
      }),
    );

    await expect(
      createLocalHostClient().filesystemWriteTextFile({
        rootPath: "/repo",
        relativePath: "src/file.ts",
        contents: "draft",
        revision: "sha256:old",
      }),
    ).rejects.toMatchObject({
      name: "HostInvokeError",
      failure: {
        kind: "workspace_text_file_write",
        workspaceTextFileWriteFailure: { code: "stale_revision" },
      },
    });
  });

  test("keeps invalid invoke failure envelopes as typed dependency errors", async () => {
    const { createLocalHostClient } = await loadLocalHostTransport();
    const fetchMock = mock(async (url: string | URL | Request, _init?: RequestInit) => {
      if (url.toString().endsWith("/session")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      return new Response(
        JSON.stringify({
          error: "Invalid terminal failure",
          failure: { kind: "terminal", terminalFailure: { code: "missing_code" } },
        }),
        { status: 500 },
      );
    });
    globalThis.fetch = Object.assign(fetchMock, { preconnect: originalFetch.preconnect });

    await expect(
      createLocalHostClient().terminalCreate({ workingDir: "/repo", context: {} }),
    ).rejects.toMatchObject({
      _tag: "WebDependencyError",
      message: "The local host returned an invalid invoke failure envelope.",
    });
  });
});

describe("local host SSE subscriptions", () => {
  test("waits for the Azure connection stream to open", async () => {
    const { subscribeLocalHostAzureDevOpsConnectionUpdates } = await loadLocalHostTransport();
    globalThis.fetch = createFetchFixture(
      mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const listener = mock(() => {});
    let ready = false;
    const subscription = subscribeLocalHostAzureDevOpsConnectionUpdates(listener).then(
      (stop: () => void) => {
        ready = true;
        return stop;
      },
    );
    const eventSource = await waitForEventSourceInstance();
    await waitForEventSourceListener(eventSource, "replay-complete");

    eventSource.emit("error", "initial failure");
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ kind: "stream-warning" }));

    eventSource.emit("open", "");
    const unsubscribe = await subscription;
    expect(ready).toBe(true);
    unsubscribe();
    expect(eventSource.closed).toBe(true);
  });

  test("shares one EventSource across non-task host event channels", async () => {
    const {
      observeLocalHostAgentSessions,
      subscribeLocalHostDevServerEvents,
      subscribeLocalHostRunEvents,
      subscribeLocalHostWorkspaceSessionUpdates,
    } = await loadLocalHostTransport();
    const fetchMock = mock(
      async (url: string | URL | Request) =>
        new Response(
          JSON.stringify(
            url.toString().includes("/invoke/")
              ? {
                  repoPath: "/repo",
                  sessions: [],
                  runtimeGenerations: [],
                  complete: true,
                  failures: [],
                  cursor: { hostEpoch: TEST_HOST_EPOCH, sequence: 0 },
                }
              : { ok: true },
          ),
          {
            status: 200,
          },
        ),
    );
    globalThis.fetch = createFetchFixture(fetchMock);
    const runListener = mock(() => {});
    const devServerListener = mock(() => {});
    const liveSessionListener = mock(() => {});
    const workspaceSessionListener = mock(() => {});

    const unsubscribeRun = await subscribeLocalHostRunEvents(runListener);
    const devServerSubscription = subscribeLocalHostDevServerEvents(devServerListener);
    const workspaceSessionSubscription =
      subscribeLocalHostWorkspaceSessionUpdates(workspaceSessionListener);
    const liveSessionObservation = observeLocalHostAgentSessions(
      { repoPath: "/repo" },
      liveSessionListener,
    );

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe("http://127.0.0.1:14327/events?notifications=1");
    expect(FakeEventSource.instances[0]?.options).toEqual({ withCredentials: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    FakeEventSource.instances[0]?.emit("open", "");
    const { unsubscribe: unsubscribeDevServer } = await devServerSubscription;
    const unsubscribeWorkspaceSession = await workspaceSessionSubscription;
    const stopObservingLiveSessions = await liveSessionObservation;

    const emitHostEvent = (channel: string, payload: JSONType): void => {
      FakeEventSource.instances[0]?.emit(
        channel === "openducktor://agent-session-live-event"
          ? liveSessionStreamEventName("/repo")
          : "message",
        JSON.stringify({ channel, payload }),
      );
    };
    emitHostEvent("openducktor://run-event", { type: "run" });
    const workspaceSessionUpdate = {
      workspaceId: "workspace-A",
      session: {
        id: "session-1",
        runtimeKind: "codex",
        externalSessionId: "native-1",
        executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
        roleSnapshot: null,
        selectedModel: null,
        generatedTitle: null,
        manualTitle: "Example",
        createdAt: 1000,
        updatedAt: 1000,
        archivedAt: null,
      },
    };
    emitHostEvent("openducktor://workspace-session-updated", workspaceSessionUpdate);
    expect(workspaceSessionListener).toHaveBeenCalledWith(workspaceSessionUpdate);
    emitHostEvent("openducktor://dev-server-event", {
      type: "snapshot",
      state: {
        repoPath: "/repo",
        owner: { kind: "task", taskId: "task-1" },
        workingDirectory: null,
        scripts: [],
        revision: 0,
        updatedAt: "2026-03-19T15:30:00.000Z",
      },
    });
    emitHostEvent("openducktor://agent-session-live-event", {
      type: "snapshot",
      repoPath: "/repo",
      sessions: [],
    });

    expect(runListener).toHaveBeenCalledWith({ type: "run" });
    expect(devServerListener).toHaveBeenCalledWith({
      type: "snapshot",
      state: {
        repoPath: "/repo",
        owner: { kind: "task", taskId: "task-1" },
        workingDirectory: null,
        scripts: [],
        revision: 0,
        updatedAt: "2026-03-19T15:30:00.000Z",
      },
    });
    expect(liveSessionListener).toHaveBeenCalledWith(
      expect.objectContaining({
        isConnectionSnapshot: true,
        type: "snapshot",
        repoPath: "/repo",
        sessions: [],
      }),
    );
    expect(() => emitHostEvent("openducktor://dev-server-event", { type: "dev-server" })).toThrow(
      "Invalid OpenDucktor host event envelope.",
    );
    expect(devServerListener).toHaveBeenCalledTimes(2);

    unsubscribeRun();
    unsubscribeDevServer();
    unsubscribeWorkspaceSession();
    expect(FakeEventSource.instances[0]?.closed).toBe(false);

    stopObservingLiveSessions();
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
  });

  test("delivers data once to a listener removed by a failing earlier listener", async () => {
    const { subscribeLocalHostRunEvents } = await loadLocalHostTransport();
    globalThis.fetch = createFetchFixture(
      mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const failure = new Error("run listener failed");
    let unsubscribeLater: () => void;
    const first = mock(() => {
      unsubscribeLater();
      throw failure;
    });
    const later = mock(() => {});
    const unsubscribeFirst = await subscribeLocalHostRunEvents(first);
    unsubscribeLater = await subscribeLocalHostRunEvents(later);
    const eventSource = await waitForEventSourceInstance();
    eventSource.emit("open", "");
    const data = JSON.stringify({ channel: "openducktor://run-event", payload: { type: "run" } });

    let thrown: unknown;
    try {
      eventSource.emit("message", data);
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toBe(failure);
    expect(first).toHaveBeenCalledTimes(1);
    expect(later).toHaveBeenCalledTimes(1);
    expect(later).toHaveBeenCalledWith({ type: "run" });

    expect(() => eventSource.emit("message", data)).toThrow("run listener failed");
    expect(later).toHaveBeenCalledTimes(1);
    unsubscribeFirst();
  });

  test("routes named live events only to observed repositories and removes unused listeners", async () => {
    const { observeLocalHostAgentSessions } = await loadLocalHostTransport();
    globalThis.fetch = createFetchFixture(
      mock(
        async (_url: string | URL | Request, init?: RequestInit) =>
          new Response(
            JSON.stringify({
              repoPath: JSON.parse(String(init?.body ?? "{}")).repoPath ?? "/repo",
              sessions: [],
              runtimeGenerations: [],
              complete: true,
              failures: [],
              cursor: { hostEpoch: TEST_HOST_EPOCH, sequence: 0 },
            }),
          ),
      ),
    );
    const first = mock((_event: AgentSessionLiveEnvelope) => {});
    const duplicate = mock((_event: AgentSessionLiveEnvelope) => {});
    const second = mock((_event: AgentSessionLiveEnvelope) => {});
    const firstSetup = observeLocalHostAgentSessions({ repoPath: "/first" }, first);
    const source = await waitForEventSourceInstance();
    source.emit("open", "");
    const stopFirst = await firstSetup;
    const stopDuplicate = await observeLocalHostAgentSessions({ repoPath: "/first" }, duplicate);
    const stopSecond = await observeLocalHostAgentSessions({ repoPath: "/second" }, second);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(() => source.emit(liveSessionStreamEventName("/unobserved"), "not-json")).not.toThrow();
    const snapshot = { type: "snapshot", repoPath: "/first", sessions: [] };
    source.emit(
      liveSessionStreamEventName("/first"),
      JSON.stringify({
        channel: "openducktor://agent-session-live-event",
        payload: snapshot,
      }),
    );
    expect(first).toHaveBeenCalledTimes(2);
    expect(duplicate).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
    expect(() =>
      source.emit(
        liveSessionStreamEventName("/first"),
        JSON.stringify({
          channel: "openducktor://agent-session-live-event",
          payload: { ...snapshot, sessions: "invalid" },
        }),
      ),
    ).toThrow("Invalid OpenDucktor host event envelope");
    expect(() =>
      source.emit(
        liveSessionStreamEventName("/second"),
        JSON.stringify({
          channel: "openducktor://agent-session-live-event",
          payload: snapshot,
        }),
      ),
    ).toThrow("wrong stream event name");
    stopFirst();
    expect(source.hasListener(liveSessionStreamEventName("/first"))).toBe(true);
    stopDuplicate();
    expect(source.hasListener(liveSessionStreamEventName("/first"))).toBe(false);
    expect(source.closed).toBe(false);
    stopSecond();
    expect(source.hasListener(liveSessionStreamEventName("/second"))).toBe(false);
    expect(source.closed).toBe(true);
  });

  test("resolves dev-server subscriptions on initial open and emits reconnect control payloads afterward", async () => {
    const { subscribeLocalHostDevServerEvents } = await loadLocalHostTransport();
    globalThis.fetch = createFetchFixture(
      mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const listener = mock(() => {});

    const subscription = subscribeLocalHostDevServerEvents(listener);
    const eventSource = await waitForEventSourceInstance();
    let didResolve = false;
    void subscription.then(() => {
      didResolve = true;
    });

    await Promise.resolve();
    expect(didResolve).toBe(false);

    eventSource.emitAsBrowser("open", "");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(didResolve).toBe(false);
    const boundary = JSON.stringify({
      hostEpoch: TEST_HOST_EPOCH,
      sequence: 0,
      hostChanged: false,
      losses: [],
    });
    eventSource.emit("replay-start", boundary);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(didResolve).toBe(false);
    eventSource.emit("replay-complete", boundary);
    const { transportEpoch, unsubscribe } = await subscription;
    expect(transportEpoch).toBe(TEST_HOST_EPOCH);
    expect(listener).not.toHaveBeenCalled();

    eventSource.emit("open", "");
    expect(listener).toHaveBeenNthCalledWith(1, {
      __openducktorBrowserLive: true,
      kind: "reconnected",
      transportEpoch: TEST_HOST_EPOCH,
    });

    unsubscribe();
  });

  test("delivers reconnect once to a listener removed by a failing earlier listener", async () => {
    const { subscribeLocalHostDevServerEvents } = await loadLocalHostTransport();
    globalThis.fetch = createFetchFixture(
      mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const failure = new Error("reconnect listener failed");
    let unsubscribeLater: () => void;
    const first = mock(() => {
      unsubscribeLater();
      throw failure;
    });
    const later = mock(() => {});
    const firstSubscription = subscribeLocalHostDevServerEvents(first);
    const eventSource = await waitForEventSourceInstance();
    eventSource.emit("open", "");
    const { unsubscribe: unsubscribeFirst } = await firstSubscription;
    const laterSubscription = await subscribeLocalHostDevServerEvents(later);
    unsubscribeLater = laterSubscription.unsubscribe;

    let thrown: unknown;
    try {
      eventSource.emit("open", "");
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toBe(failure);
    expect(first).toHaveBeenCalledTimes(1);
    expect(later).toHaveBeenCalledTimes(1);
    expect(later).toHaveBeenCalledWith({
      __openducktorBrowserLive: true,
      kind: "reconnected",
      transportEpoch: TEST_HOST_EPOCH,
    });

    expect(() => eventSource.emit("open", "")).toThrow("reconnect listener failed");
    expect(later).toHaveBeenCalledTimes(1);
    unsubscribeFirst();
  });

  test("keeps complete replay reconnects on the stream without a source refresh", async () => {
    const { observeLocalHostAgentSessions } = await loadLocalHostTransport();
    const fetchMock = mock(
      async (url: string | URL | Request) =>
        new Response(
          JSON.stringify(
            url.toString().includes("/invoke/")
              ? {
                  repoPath: "/repo",
                  sessions: [],
                  runtimeGenerations: [],
                  complete: true,
                  failures: [],
                  cursor: { hostEpoch: TEST_HOST_EPOCH, sequence: 0 },
                }
              : { ok: true },
          ),
        ),
    );
    globalThis.fetch = createFetchFixture(fetchMock);
    const listener = mock((_envelope: AgentSessionLiveEnvelope) => {});
    const observation = observeLocalHostAgentSessions({ repoPath: "/repo" }, listener);
    const source = await waitForEventSourceInstance();
    source.emit("open", "");
    const stop = await observation;
    source.emit("error", "disconnect");
    source.emit("open", "");
    expect(
      fetchMock.mock.calls.filter(([url]) => url.toString().includes("/invoke/")),
    ).toHaveLength(1);
    expect(listener.mock.calls.map(([event]) => event.type)).toEqual([
      "snapshot",
      "connection_state",
      "connection_state",
    ]);
    stop();
  });

  test("delivers scoped transcript loss to every observer after a callback failure", async () => {
    const { observeLocalHostAgentSessions } = await loadLocalHostTransport();
    globalThis.fetch = createFetchFixture(
      mock(
        async () =>
          new Response(
            JSON.stringify({
              repoPath: "/repo",
              sessions: [],
              runtimeGenerations: [],
              complete: true,
              failures: [],
              cursor: { hostEpoch: TEST_HOST_EPOCH, sequence: 0 },
            }),
          ),
      ),
    );
    const throwing = mock((event: AgentSessionLiveEnvelope) => {
      if (event.type === "transcript_gap") throw new Error("listener failed");
    });
    const listener = mock((_event: AgentSessionLiveEnvelope) => {});
    const first = observeLocalHostAgentSessions({ repoPath: "/repo" }, throwing);
    const source = await waitForEventSourceInstance();
    source.emit("open", "");
    const stopFirst = await first;
    const stopSecond = await observeLocalHostAgentSessions({ repoPath: "/repo" }, listener);
    const ref = {
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "thread",
    };
    expect(() =>
      source.emit(
        "replay-start",
        JSON.stringify({
          hostEpoch: TEST_HOST_EPOCH,
          sequence: 3,
          hostChanged: false,
          losses: [
            {
              channel: "openducktor://agent-session-live-event",
              repoPath: "/repo",
              facet: "transcript",
              refs: [ref],
            },
          ],
        }),
      ),
    ).toThrow("listener failed");
    expect(listener).toHaveBeenCalledWith({
      type: "transcript_gap",
      repoPath: "/repo",
      message: "Transcript events were lost. Reload affected conversation history.",
      refs: [ref],
      replayPending: true,
    });
    stopFirst();
    stopSecond();
  });

  test("waits for the native EventSource reconnect when the initial open fails", async () => {
    const { subscribeLocalHostDevServerEvents } = await loadLocalHostTransport();
    globalThis.fetch = createFetchFixture(
      mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
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
    expect(transportEpoch).toBe(TEST_HOST_EPOCH);
    unsubscribe();
    expect(eventSource.closed).toBe(true);
  });

  test("emits a stream-warning control payload when dev-server EventSource errors after opening", async () => {
    const { subscribeLocalHostDevServerEvents } = await loadLocalHostTransport();
    globalThis.fetch = createFetchFixture(
      mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
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
      transportEpoch: TEST_HOST_EPOCH,
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
    globalThis.fetch = createFetchFixture(
      mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
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
    globalThis.fetch = createFetchFixture(
      mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
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

  test("keeps initial task stream setup pending until its first frame", async () => {
    const { subscribeLocalHostTaskStream } = await loadLocalHostTransport();
    const subscriptionId = "05e77c20-ebf2-4e7f-a880-9c95c24627ee";
    const fetchMock = mock(async (url: string | URL | Request, _init?: RequestInit) => {
      if (url.toString().endsWith("/subscriptions")) {
        return new Response(JSON.stringify({ streamToken: "stream-token", subscriptionId }), {
          status: 201,
        });
      }
      return new Response(null, { status: 204 });
    });
    globalThis.fetch = createFetchFixture(fetchMock);
    const listener = mock(() => {});

    const subscription = subscribeLocalHostTaskStream({ cursor: null }, listener);
    const eventSource = await waitForEventSourceInstance();
    await waitForEventSourceListener(eventSource, "open");
    let didResolve = false;
    void subscription.then(() => {
      didResolve = true;
    });

    eventSource.emit("error", "native reconnecting");
    await Promise.resolve();
    expect(didResolve).toBe(false);
    expect(FakeEventSource.instances).toHaveLength(1);

    eventSource.emit("open", "");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(didResolve).toBe(false);

    const frame = {
      type: "snapshot_required",
      cursor: { epoch: "fc49d1f9-708c-4198-b56b-f1437b2bbcea", sequence: 0 },
      reason: "buffer_gap",
    };
    eventSource.emit("task-frame", JSON.stringify(frame));
    const readySubscription = await subscription;
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(listener).toHaveBeenCalledWith(frame);

    await readySubscription.acknowledge(frame.cursor);
    const firstUnsubscribe = readySubscription.unsubscribe();
    const secondUnsubscribe = readySubscription.unsubscribe();
    await Promise.all([firstUnsubscribe, secondUnsubscribe]);

    expect(fetchMock.mock.calls.map(([url]) => url.toString())).toEqual([
      "http://127.0.0.1:14327/session",
      "http://127.0.0.1:14327/task-events/subscriptions",
      `http://127.0.0.1:14327/task-events/subscriptions/${subscriptionId}/ack`,
      `http://127.0.0.1:14327/task-events/subscriptions/${subscriptionId}`,
    ]);
    const ackOptions = fetchMock.mock.calls[2]?.[1];
    expect(ackOptions).toMatchObject({
      body: JSON.stringify({ cursor: frame.cursor }),
      headers: {
        "content-type": "application/json",
        "x-openducktor-task-stream-token": "stream-token",
      },
      method: "POST",
    });
    expect(eventSource.closed).toBe(true);
  });

  test("accepts a valid task frame as initial readiness and delivers it once", async () => {
    const { subscribeLocalHostTaskStream } = await loadLocalHostTransport();
    const subscriptionId = "05e77c20-ebf2-4e7f-a880-9c95c24627ee";
    globalThis.fetch = createFetchFixture(
      mock(async (url: string | URL | Request) => {
        if (url.toString().endsWith("/subscriptions")) {
          return new Response(JSON.stringify({ streamToken: "stream-token", subscriptionId }), {
            status: 201,
          });
        }
        return new Response(null, { status: 204 });
      }),
    );
    const listener = mock(() => {});
    const setup = subscribeLocalHostTaskStream({ cursor: null }, listener);
    const eventSource = await waitForEventSourceInstance();
    await waitForEventSourceListener(eventSource, "task-frame");
    const frame = {
      type: "snapshot_required",
      cursor: { epoch: "fc49d1f9-708c-4198-b56b-f1437b2bbcea", sequence: 0 },
      reason: "buffer_gap",
    };

    eventSource.emit("task-frame", JSON.stringify(frame));
    const subscription = await setup;

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(frame);
    await subscription.unsubscribe();
  });

  test("closes, deletes, and rejects when the initial task stream fails closed", async () => {
    const { subscribeLocalHostTaskStream } = await loadLocalHostTransport();
    const subscriptionId = "05e77c20-ebf2-4e7f-a880-9c95c24627ee";
    const fetchMock = mock(async (url: string | URL | Request) => {
      if (url.toString().endsWith("/subscriptions")) {
        return new Response(JSON.stringify({ streamToken: "stream-token", subscriptionId }), {
          status: 201,
        });
      }
      return new Response(null, { status: 204 });
    });
    globalThis.fetch = createFetchFixture(fetchMock);

    const setup = subscribeLocalHostTaskStream(
      { cursor: null },
      mock(() => {}),
    );
    const eventSource = await waitForEventSourceInstance();
    await waitForEventSourceListener(eventSource, "error");
    eventSource.readyState = FakeEventSource.CLOSED;
    eventSource.emit("error", "stream rejected");

    await expect(setup).rejects.toThrow("closed before its initial connection was ready");
    expect(eventSource.closed).toBe(true);
    expect(fetchMock.mock.calls.map(([url]) => url.toString())).toEqual([
      "http://127.0.0.1:14327/session",
      "http://127.0.0.1:14327/task-events/subscriptions",
      `http://127.0.0.1:14327/task-events/subscriptions/${subscriptionId}`,
    ]);
  });

  test("closes, deletes, and rejects when initial task stream readiness times out", async () => {
    const { subscribeLocalTaskEventStreamEffect } = await import("./local-task-event-transport");
    const subscriptionId = "05e77c20-ebf2-4e7f-a880-9c95c24627ee";
    const fetchMock = mock(async (url: string | URL | Request) => {
      if (url.toString().endsWith("/subscriptions")) {
        return new Response(JSON.stringify({ streamToken: "stream-token", subscriptionId }), {
          status: 201,
        });
      }
      return new Response(null, { status: 204 });
    });
    const scheduledTimers: Array<() => void> = [];
    globalThis.fetch = createFetchFixture(fetchMock);
    const setup = Effect.runPromise(
      subscribeLocalTaskEventStreamEffect(
        { cursor: null },
        mock(() => {}),
        undefined,
        {
          ensureSession: () => Effect.void,
          localHostRequestErrorEffect: (response) =>
            Effect.fail(
              new WebDependencyError({
                dependency: "local-web-host",
                operation: "test.request",
                message: `Unexpected HTTP ${response.status}`,
              }),
            ),
          scheduleInitialReadinessTimeout: (callback) => {
            scheduledTimers.push(callback);
            return () => {};
          },
        },
      ),
    );
    const eventSource = await waitForEventSourceInstance();
    await waitForEventSourceListener(eventSource, "open");
    eventSource.emit("open", "");
    for (let attempt = 0; scheduledTimers.length === 0 && attempt < 10; attempt += 1) {
      await Promise.resolve();
    }
    scheduledTimers[0]?.();

    await expect(setup).rejects.toThrow("Timed out waiting for task event stream subscription");
    expect(eventSource.closed).toBe(true);
    expect(fetchMock.mock.calls.map(([url]) => url.toString())).toEqual([
      "http://127.0.0.1:14327/task-events/subscriptions",
      `http://127.0.0.1:14327/task-events/subscriptions/${subscriptionId}`,
    ]);
  });

  test("rejects and cleans up when the task stream closes after opening but before its first frame", async () => {
    const { subscribeLocalHostTaskStream } = await loadLocalHostTransport();
    const subscriptionId = "05e77c20-ebf2-4e7f-a880-9c95c24627ee";
    const fetchMock = mock(async (url: string | URL | Request) => {
      if (url.toString().endsWith("/subscriptions")) {
        return new Response(JSON.stringify({ streamToken: "stream-token", subscriptionId }), {
          status: 201,
        });
      }
      return new Response(null, { status: 204 });
    });
    globalThis.fetch = createFetchFixture(fetchMock);
    const onTerminalFailure = mock(() => {});

    const setup = subscribeLocalHostTaskStream(
      { cursor: null },
      mock(() => {}),
      onTerminalFailure,
    );
    const eventSource = await waitForEventSourceInstance();
    await waitForEventSourceListener(eventSource, "open");
    eventSource.emit("open", "");
    eventSource.readyState = FakeEventSource.CLOSED;
    eventSource.emit("error", "terminal failure");

    await expect(setup).rejects.toThrow("closed before its initial connection was ready");
    expect(onTerminalFailure).not.toHaveBeenCalled();
    expect(eventSource.closed).toBe(true);
    expect(eventSource.hasListener("task-frame")).toBe(false);
    expect(eventSource.hasListener("open")).toBe(false);
    expect(eventSource.hasListener("error")).toBe(false);
    expect(fetchMock.mock.calls.map(([url]) => url.toString())).toEqual([
      "http://127.0.0.1:14327/session",
      "http://127.0.0.1:14327/task-events/subscriptions",
      `http://127.0.0.1:14327/task-events/subscriptions/${subscriptionId}`,
    ]);
  });

  test("rejects and cleans up when a task frame is malformed after opening but before setup returns", async () => {
    const { subscribeLocalHostTaskStream } = await loadLocalHostTransport();
    const subscriptionId = "05e77c20-ebf2-4e7f-a880-9c95c24627ee";
    const fetchMock = mock(async (url: string | URL | Request) => {
      if (url.toString().endsWith("/subscriptions")) {
        return new Response(JSON.stringify({ streamToken: "stream-token", subscriptionId }), {
          status: 201,
        });
      }
      return new Response(null, { status: 204 });
    });
    globalThis.fetch = createFetchFixture(fetchMock);
    const onTerminalFailure = mock(() => {});

    const setup = subscribeLocalHostTaskStream(
      { cursor: null },
      mock(() => {}),
      onTerminalFailure,
    );
    const eventSource = await waitForEventSourceInstance();
    await waitForEventSourceListener(eventSource, "open");
    eventSource.emit("open", "");
    eventSource.emit("task-frame", "not-json");

    await expect(setup).rejects.toThrow("invalid JSON");
    expect(onTerminalFailure).not.toHaveBeenCalled();
    expect(eventSource.closed).toBe(true);
    expect(eventSource.hasListener("task-frame")).toBe(false);
    expect(eventSource.hasListener("open")).toBe(false);
    expect(eventSource.hasListener("error")).toBe(false);
    expect(fetchMock.mock.calls.map(([url]) => url.toString())).toEqual([
      "http://127.0.0.1:14327/session",
      "http://127.0.0.1:14327/task-events/subscriptions",
      `http://127.0.0.1:14327/task-events/subscriptions/${subscriptionId}`,
    ]);
  });

  test("rejects and cleans up when a decoded task frame is invalid after opening but before setup returns", async () => {
    const { subscribeLocalHostTaskStream } = await loadLocalHostTransport();
    const subscriptionId = "05e77c20-ebf2-4e7f-a880-9c95c24627ee";
    const fetchMock = mock(async (url: string | URL | Request) => {
      if (url.toString().endsWith("/subscriptions")) {
        return new Response(JSON.stringify({ streamToken: "stream-token", subscriptionId }), {
          status: 201,
        });
      }
      return new Response(null, { status: 204 });
    });
    globalThis.fetch = createFetchFixture(fetchMock);
    const onTerminalFailure = mock(() => {});

    const setup = subscribeLocalHostTaskStream(
      { cursor: null },
      mock(() => {}),
      onTerminalFailure,
    );
    const eventSource = await waitForEventSourceInstance();
    await waitForEventSourceListener(eventSource, "open");
    eventSource.emit("open", "");
    eventSource.emit("task-frame", JSON.stringify({ type: "invalid" }));

    await expect(setup).rejects.toThrow("invalid frame");
    expect(onTerminalFailure).not.toHaveBeenCalled();
    expect(eventSource.closed).toBe(true);
    expect(eventSource.hasListener("task-frame")).toBe(false);
    expect(eventSource.hasListener("open")).toBe(false);
    expect(eventSource.hasListener("error")).toBe(false);
    expect(fetchMock.mock.calls.map(([url]) => url.toString())).toEqual([
      "http://127.0.0.1:14327/session",
      "http://127.0.0.1:14327/task-events/subscriptions",
      `http://127.0.0.1:14327/task-events/subscriptions/${subscriptionId}`,
    ]);
  });

  test("leaves reconnects to the native EventSource after task stream readiness", async () => {
    const { subscribeLocalHostTaskStream } = await loadLocalHostTransport();
    const subscriptionId = "05e77c20-ebf2-4e7f-a880-9c95c24627ee";
    const fetchMock = mock(async (url: string | URL | Request) => {
      if (url.toString().endsWith("/subscriptions")) {
        return new Response(JSON.stringify({ streamToken: "stream-token", subscriptionId }), {
          status: 201,
        });
      }
      return new Response(null, { status: 204 });
    });
    globalThis.fetch = createFetchFixture(fetchMock);
    const onTerminalFailure = mock(() => {});

    const setup = subscribeLocalHostTaskStream(
      { cursor: { epoch: "fc49d1f9-708c-4198-b56b-f1437b2bbcea", sequence: 0 } },
      mock(() => {}),
      onTerminalFailure,
    );
    const eventSource = await waitForEventSourceInstance();
    await waitForEventSourceListener(eventSource, "open");
    eventSource.emit("open", "");
    const subscription = await setup;
    eventSource.readyState = FakeEventSource.CONNECTING;
    eventSource.emit("error", "native reconnecting");

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onTerminalFailure).not.toHaveBeenCalled();
    await subscription.unsubscribe();
  });

  test("reports one terminal failure after readiness and still deletes the lease on unsubscribe", async () => {
    const { subscribeLocalHostTaskStream } = await loadLocalHostTransport();
    const subscriptionId = "05e77c20-ebf2-4e7f-a880-9c95c24627ee";
    const fetchMock = mock(async (url: string | URL | Request) => {
      if (url.toString().endsWith("/subscriptions")) {
        return new Response(JSON.stringify({ streamToken: "stream-token", subscriptionId }), {
          status: 201,
        });
      }
      return new Response(null, { status: 204 });
    });
    globalThis.fetch = createFetchFixture(fetchMock);
    const onTerminalFailure = mock(() => {});

    const setup = subscribeLocalHostTaskStream(
      { cursor: null },
      mock(() => {}),
      onTerminalFailure,
    );
    const eventSource = await waitForEventSourceInstance();
    await waitForEventSourceListener(eventSource, "open");
    eventSource.emit("open", "");
    eventSource.emit(
      "task-frame",
      JSON.stringify({
        type: "snapshot_required",
        cursor: { epoch: "fc49d1f9-708c-4198-b56b-f1437b2bbcea", sequence: 0 },
        reason: "buffer_gap",
      }),
    );
    const subscription = await setup;
    eventSource.readyState = FakeEventSource.CLOSED;
    eventSource.emit("error", "terminal failure");
    eventSource.emit("error", "terminal failure again");

    expect(onTerminalFailure).toHaveBeenCalledTimes(1);
    expect(onTerminalFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "WebDependencyError",
        message: "Task event stream closed after initial readiness.",
      }),
    );
    await subscription.unsubscribe();
    expect(fetchMock.mock.calls.map(([url]) => url.toString())).toEqual([
      "http://127.0.0.1:14327/session",
      "http://127.0.0.1:14327/task-events/subscriptions",
      `http://127.0.0.1:14327/task-events/subscriptions/${subscriptionId}`,
    ]);
  });

  test("reports malformed task frames once and suppresses terminal reports after unsubscribe", async () => {
    const { subscribeLocalHostTaskStream } = await loadLocalHostTransport();
    const subscriptionId = "05e77c20-ebf2-4e7f-a880-9c95c24627ee";
    const fetchMock = mock(async (url: string | URL | Request) => {
      if (url.toString().endsWith("/subscriptions")) {
        return new Response(JSON.stringify({ streamToken: "stream-token", subscriptionId }), {
          status: 201,
        });
      }
      return new Response(null, { status: 204 });
    });
    globalThis.fetch = createFetchFixture(fetchMock);
    const onTerminalFailure = mock(() => {});

    const setup = subscribeLocalHostTaskStream(
      { cursor: null },
      mock(() => {}),
      onTerminalFailure,
    );
    const eventSource = await waitForEventSourceInstance();
    await waitForEventSourceListener(eventSource, "open");
    eventSource.emit("open", "");
    eventSource.emit(
      "task-frame",
      JSON.stringify({
        type: "snapshot_required",
        cursor: { epoch: "fc49d1f9-708c-4198-b56b-f1437b2bbcea", sequence: 0 },
        reason: "buffer_gap",
      }),
    );
    const subscription = await setup;
    eventSource.emit("task-frame", "not-json");
    eventSource.emit("task-frame", JSON.stringify({ type: "invalid" }));

    expect(onTerminalFailure).toHaveBeenCalledTimes(1);
    expect(onTerminalFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "WebDependencyError",
        message: expect.stringContaining("invalid JSON"),
      }),
    );
    await subscription.unsubscribe();
    eventSource.emit("error", "after unsubscribe");
    expect(onTerminalFailure).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => url.toString().endsWith(subscriptionId)),
    ).toHaveLength(1);
  });

  test("reports invalid decoded task frames once and suppresses terminal reports after unsubscribe", async () => {
    const { subscribeLocalHostTaskStream } = await loadLocalHostTransport();
    const subscriptionId = "05e77c20-ebf2-4e7f-a880-9c95c24627ee";
    const fetchMock = mock(async (url: string | URL | Request) => {
      if (url.toString().endsWith("/subscriptions")) {
        return new Response(JSON.stringify({ streamToken: "stream-token", subscriptionId }), {
          status: 201,
        });
      }
      return new Response(null, { status: 204 });
    });
    globalThis.fetch = createFetchFixture(fetchMock);
    const onTerminalFailure = mock(() => {});

    const setup = subscribeLocalHostTaskStream(
      { cursor: null },
      mock(() => {}),
      onTerminalFailure,
    );
    const eventSource = await waitForEventSourceInstance();
    await waitForEventSourceListener(eventSource, "open");
    eventSource.emit("open", "");
    eventSource.emit(
      "task-frame",
      JSON.stringify({
        type: "snapshot_required",
        cursor: { epoch: "fc49d1f9-708c-4198-b56b-f1437b2bbcea", sequence: 0 },
        reason: "buffer_gap",
      }),
    );
    const subscription = await setup;
    eventSource.emit("task-frame", JSON.stringify({ type: "invalid" }));
    eventSource.emit("task-frame", JSON.stringify({ type: "invalid" }));

    expect(onTerminalFailure).toHaveBeenCalledTimes(1);
    expect(onTerminalFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "WebDependencyError",
        operation: "validate-frame",
        message: expect.stringContaining("invalid frame"),
      }),
    );
    await subscription.unsubscribe();
    eventSource.emit("error", "after unsubscribe");
    expect(onTerminalFailure).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => url.toString().endsWith(subscriptionId)),
    ).toHaveLength(1);
  });

  test("deletes a newly-created task lease when native EventSource construction fails", async () => {
    const { subscribeLocalHostTaskStream } = await loadLocalHostTransport();
    const subscriptionId = "05e77c20-ebf2-4e7f-a880-9c95c24627ee";
    const fetchMock = mock(async (url: string | URL | Request) => {
      if (url.toString().endsWith("/subscriptions")) {
        return new Response(JSON.stringify({ streamToken: "stream-token", subscriptionId }), {
          status: 201,
        });
      }
      return new Response(null, { status: 204 });
    });
    globalThis.fetch = createFetchFixture(fetchMock);
    class ThrowingEventSource {
      constructor() {
        throw new Error("EventSource construction failed");
      }
    }
    // @ts-expect-error test shim
    globalThis.EventSource = ThrowingEventSource;

    await expect(
      subscribeLocalHostTaskStream(
        { cursor: null },
        mock(() => {}),
      ),
    ).rejects.toThrow("EventSource construction failed");
    await Promise.resolve();

    expect(fetchMock.mock.calls.map(([url]) => url.toString())).toEqual([
      "http://127.0.0.1:14327/session",
      "http://127.0.0.1:14327/task-events/subscriptions",
      `http://127.0.0.1:14327/task-events/subscriptions/${subscriptionId}`,
    ]);
  });

  test("buildLocalAttachmentPreviewUrl normalizes the backend base URL", async () => {
    const { buildLocalAttachmentPreviewUrl } = await loadLocalHostTransport();

    expect(buildLocalAttachmentPreviewUrl("http://127.0.0.1:14327/", "/tmp/preview.png")).toBe(
      "http://127.0.0.1:14327/local-attachment-preview?path=%2Ftmp%2Fpreview.png",
    );
  });

  test("buildTaskAssetUrl keeps runtime routing outside Markdown", async () => {
    const { buildTaskAssetUrl } = await loadLocalHostTransport();

    expect(
      buildTaskAssetUrl("http://127.0.0.1:14327/", {
        workspaceId: "workspace-1",
        taskId: "task-1",
        scope: "description",
        assetId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    ).toBe(
      "http://127.0.0.1:14327/task-assets/workspace-1/task-1/description/550e8400-e29b-41d4-a716-446655440000",
    );
  });
});

test("notification and host listeners share one physical stream and retain independent cleanup", async () => {
  globalThis.fetch = createFetchFixture(async () => new Response("{}", { status: 200 }));
  const transport = await loadLocalHostTransport();
  const failures = mock(() => {});
  const frames = mock(() => {});
  const stopNotifications = await transport.subscribeLocalHostNotificationStream(
    { cursor: null },
    frames,
    failures,
  );
  const stopRun = await transport.subscribeLocalHostRunEvents(() => {});
  expect(FakeEventSource.instances).toHaveLength(1);
  const source = FakeEventSource.instances[0]!;
  const frame = {
    type: "attached",
    reason: "new",
    cursor: { epoch: "11111111-1111-4111-8111-111111111111", sequence: 0 },
    health: [],
  };
  source.emit("notification-frame", JSON.stringify(frame));
  expect(frames).toHaveBeenCalledWith(frame);
  source.emit("error", "");
  expect(failures).toHaveBeenCalledTimes(1);
  stopRun();
  expect(source.closed).toBe(false);
  const late = mock(() => {});
  const stopLate = await transport.subscribeLocalHostNotificationStream(
    { cursor: null },
    late,
    () => {},
  );
  expect(FakeEventSource.instances).toHaveLength(1);
  expect(late).toHaveBeenCalledWith(frame);
  stopNotifications();
  expect(source.closed).toBe(false);
  stopLate();
  expect(source.closed).toBe(true);
});

test("a notification reconnect cursor is sent when it opens the shared connection", async () => {
  const fetchMock = mock(async () => new Response("{}", { status: 200 }));
  globalThis.fetch = createFetchFixture(fetchMock);
  const transport = await loadLocalHostTransport();
  const cursor = { epoch: "11111111-1111-4111-8111-111111111111", sequence: 42 };
  const stop = await transport.subscribeLocalHostNotificationStream(
    { cursor },
    () => {},
    () => {},
  );
  const url = new URL(FakeEventSource.instances[0]!.url);
  expect(url.pathname).toBe("/events");
  expect(url.searchParams.get("notifications")).toBe("1");
  expect(JSON.parse(url.searchParams.get("notificationCursor")!)).toEqual(cursor);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  stop();
});

test("one replay boundary coalesces state and transcript losses without stale baseline installation", async () => {
  const { observeLocalHostAgentSessions } = await loadLocalHostTransport();
  const finish = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  const baseline = liveBaseline;
  const session = baseline(0).sessions[0]!;
  const ref = session.ref;
  let reads = 0;
  globalThis.fetch = createFetchFixture(
    mock(async (url: string | URL | Request) => {
      if (!url.toString().includes("/invoke/")) return new Response(JSON.stringify({ ok: true }));
      reads += 1;
      if (reads === 1) return new Response(JSON.stringify(baseline(0)));
      if (reads === 2) {
        started.resolve();
        return finish.promise;
      }
      return new Response(JSON.stringify(baseline(11)));
    }),
  );
  const received: AgentSessionLiveEnvelope[] = [];
  const observing = observeLocalHostAgentSessions(
    { repoPath: "/repo" },
    (event: AgentSessionLiveEnvelope) => received.push(event),
  );
  const source = await waitForEventSourceInstance();
  source.emit("open", "");
  const stop = await observing;
  try {
    const boundary = {
      hostEpoch: TEST_HOST_EPOCH,
      sequence: 12,
      hostChanged: false,
      losses: ["state", "transcript"].map((facet) => ({
        channel: "openducktor://agent-session-live-event",
        repoPath: "/repo",
        facet,
        refs: [ref],
      })),
    };
    source.emit("replay-start", JSON.stringify(boundary));
    await started.promise;
    source.emit(
      liveSessionStreamEventName("/repo"),
      JSON.stringify({
        channel: "openducktor://agent-session-live-event",
        payload: {
          type: "session_upsert",
          session: { ...session, title: "New live state" },
          cursor: { hostEpoch: TEST_HOST_EPOCH, sequence: 12 },
        },
      }),
    );
    finish.resolve(new Response(JSON.stringify(baseline(10))));
    for (let turn = 0; turn < 100; turn += 1) await Promise.resolve();
    expect(reads).toBe(2);
    expect(received.filter((event) => event.type === "snapshot")).toHaveLength(1);
    expect(
      received.filter((event) => event.type === "transcript_gap" && !event.replayPending),
    ).toHaveLength(0);
    source.emit("replay-complete", JSON.stringify(boundary));
    expect(
      received
        .filter((event) => event.type === "snapshot" || event.type === "session_upsert")
        .map((event) => (event.type === "snapshot" ? event.cursor?.sequence : event.session.title)),
    ).toEqual([0, 10, "New live state"]);
  } finally {
    finish.resolve(new Response(JSON.stringify(baseline(10))));
    stop();
  }
});

test("a delivered transcript gap does not return after reopening with a persist fault", async () => {
  const { observeLocalHostAgentSessions, subscribeLocalHostRunEvents } =
    await loadLocalHostTransport();
  const fault = {
    operation: "agent-session.persist",
    message: "Session metadata could not be saved.",
  };
  const baseline = { ...liveBaseline(10), complete: false, failures: [fault] };
  let recoveries = 0;
  globalThis.fetch = createFetchFixture(
    mock(async (url: string | URL | Request) => {
      if (!url.toString().includes("/invoke/")) return new Response(JSON.stringify({ ok: true }));
      if (url.toString().includes("agent_session_live_recover")) recoveries += 1;
      return new Response(JSON.stringify(baseline));
    }),
  );
  const runSubscription = subscribeLocalHostRunEvents(() => {});
  const source = await waitForEventSourceInstance();
  source.emit("open", "");
  const stopRuns = await runSubscription;
  const received: AgentSessionLiveEnvelope[] = [];
  const stop = await observeLocalHostAgentSessions(
    { repoPath: "/repo" },
    (event: AgentSessionLiveEnvelope) => received.push(event),
  );
  let stopReplacement: (() => void) | undefined;
  try {
    const boundary = {
      hostEpoch: TEST_HOST_EPOCH,
      sequence: 10,
      hostChanged: false,
      losses: [
        {
          channel: "openducktor://agent-session-live-event",
          repoPath: "/repo",
          facet: "transcript",
          refs: [baseline.sessions[0]!.ref],
        },
      ],
    };
    source.emit("replay-start", JSON.stringify(boundary));
    for (let turn = 0; turn < 100; turn++) await Promise.resolve();
    source.emit("replay-complete", JSON.stringify(boundary));
    expect(
      received.filter((event) => event.type === "transcript_gap" && !event.replayPending),
    ).toHaveLength(1);
    expect(received).toContainEqual({ type: "fault", repoPath: "/repo", ...fault });
    expect(recoveries).toBe(1);
    stop();

    const reopened: AgentSessionLiveEnvelope[] = [];
    stopReplacement = await observeLocalHostAgentSessions(
      { repoPath: "/repo" },
      (event: AgentSessionLiveEnvelope) => reopened.push(event),
    );
    for (let turn = 0; turn < 100; turn++) await Promise.resolve();
    expect(reopened.some((event) => event.type === "transcript_gap")).toBe(false);
    expect(reopened).toContainEqual({ type: "fault", repoPath: "/repo", ...fault });
    expect(recoveries).toBe(1);
  } finally {
    stop();
    stopReplacement?.();
    stopRuns();
  }
});

test("a new loss during recovery keeps replay buffered until the last baseline", async () => {
  const { observeLocalHostAgentSessions } = await loadLocalHostTransport();
  const finishes = [Promise.withResolvers<Response>(), Promise.withResolvers<Response>()];
  const starts = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  let reads = 0;
  const baseline = liveBaseline;
  const session = baseline(0).sessions[0]!;
  const ref = session.ref;
  globalThis.fetch = createFetchFixture(
    mock(async (url: string | URL | Request) => {
      if (!url.toString().includes("/invoke/")) return new Response(JSON.stringify({ ok: true }));
      reads += 1;
      if (reads === 1) return new Response(JSON.stringify(baseline(0)));
      starts[reads - 2]!.resolve();
      return finishes[reads - 2]!.promise;
    }),
  );
  const received: AgentSessionLiveEnvelope[] = [];
  const observing = observeLocalHostAgentSessions(
    { repoPath: "/repo" },
    (event: AgentSessionLiveEnvelope) => received.push(event),
  );
  const source = await waitForEventSourceInstance();
  source.emit("open", "");
  const stop = await observing;
  const loss = (sequence: number) => {
    const boundary = {
      hostEpoch: TEST_HOST_EPOCH,
      sequence,
      hostChanged: false,
      losses: [
        {
          channel: "openducktor://agent-session-live-event",
          repoPath: "/repo",
          facet: "transcript",
          refs: [ref],
        },
      ],
    };
    source.emit("replay-start", JSON.stringify(boundary));
    return boundary;
  };
  try {
    loss(10);
    await starts[0]!.promise;
    const lastBoundary = loss(11);
    finishes[0]!.resolve(new Response(JSON.stringify(baseline(10))));
    await starts[1]!.promise;
    source.emit(
      liveSessionStreamEventName("/repo"),
      JSON.stringify({
        channel: "openducktor://agent-session-live-event",
        payload: {
          type: "session_upsert",
          session: { ...session, title: "Live 12" },
          cursor: { hostEpoch: TEST_HOST_EPOCH, sequence: 12 },
        },
      }),
    );
    expect(received.filter((event) => event.type === "snapshot")).toHaveLength(1);
    expect(received.filter((event) => event.type === "session_upsert")).toHaveLength(0);
    expect(
      received.filter((event) => event.type === "transcript_gap" && !event.replayPending),
    ).toHaveLength(0);
    finishes[1]!.resolve(new Response(JSON.stringify(baseline(11))));
    for (let turn = 0; turn < 100; turn += 1) await Promise.resolve();
    expect(reads).toBe(3);
    expect(received.filter((event) => event.type === "snapshot")).toHaveLength(1);
    expect(
      received.filter((event) => event.type === "transcript_gap" && !event.replayPending),
    ).toHaveLength(0);
    source.emit("replay-complete", JSON.stringify(lastBoundary));
    expect(
      received
        .filter((event) => event.type === "snapshot" || event.type === "session_upsert")
        .map((event) => (event.type === "snapshot" ? event.cursor?.sequence : event.session.title)),
    ).toEqual([0, 11, "Live 12"]);
    expect(
      received.filter((event) => event.type === "transcript_gap" && !event.replayPending),
    ).toHaveLength(2);
  } finally {
    for (const finish of finishes) finish.resolve(new Response(JSON.stringify(baseline(11))));
    stop();
  }
});

for (const timing of ["before", "after"] as const) {
  test(`state recovery arriving ${timing} retained replay preserves transcript content exactly once`, async () => {
    const { observeLocalHostAgentSessions } = await loadLocalHostTransport();
    const finish = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    const baseline = liveBaseline;
    const session = baseline(0).sessions[0]!;
    const ref = session.ref;
    const cursor = (sequence: number) => ({ hostEpoch: TEST_HOST_EPOCH, sequence });
    let reads = 0;
    globalThis.fetch = createFetchFixture(
      mock(async (url: string | URL | Request) => {
        if (!url.toString().includes("/invoke/")) return new Response(JSON.stringify({ ok: true }));
        reads += 1;
        if (reads === 1) return new Response(JSON.stringify(baseline(1)));
        started.resolve();
        return finish.promise;
      }),
    );
    const received: AgentSessionLiveEnvelope[] = [];
    const observing = observeLocalHostAgentSessions(
      { repoPath: "/repo" },
      (event: AgentSessionLiveEnvelope) => received.push(event),
    );
    const source = await waitForEventSourceInstance();
    source.emit("open", "");
    const stop = await observing;
    const publish = (payload: AgentSessionLiveEnvelope) =>
      source.emit(
        liveSessionStreamEventName("/repo"),
        JSON.stringify({ channel: "openducktor://agent-session-live-event", payload }),
      );
    const message = (messageId: string, sequence: number): AgentSessionLiveEnvelope => ({
      type: "transcript_event",
      cursor: cursor(sequence),
      event: {
        type: "assistant_message",
        externalSessionId: ref.externalSessionId,
        sessionRef: ref,
        messageId,
        message: messageId,
        timestamp: session.startedAt,
      },
    });
    const resolveRecovery = async () => {
      finish.resolve(new Response(JSON.stringify(baseline(10))));
      for (let turn = 0; turn < 100; turn += 1) await Promise.resolve();
      expect(received.filter((event) => event.type === "snapshot")).toHaveLength(2);
    };
    try {
      publish(message("prior", 2));
      const boundary = {
        hostEpoch: TEST_HOST_EPOCH,
        sequence: 10,
        hostChanged: false,
        losses: [
          { channel: "openducktor://agent-session-live-event", repoPath: "/repo", facet: "state" },
        ],
      };
      source.emit("replay-start", JSON.stringify(boundary));
      await started.promise;
      if (timing === "before") await resolveRecovery();
      publish(message("prior", 2));
      publish({
        type: "session_upsert",
        session: { ...session, activity: "running" },
        cursor: cursor(7),
      });
      publish({
        type: "transcript_event",
        cursor: cursor(8),
        event: {
          type: "session_status",
          externalSessionId: ref.externalSessionId,
          sessionRef: ref,
          timestamp: session.startedAt,
          status: { type: "busy", message: "Earlier activity" },
        },
      });
      publish(message("retained", 9));
      publish(message("retained", 9));
      if (timing === "after") await resolveRecovery();
      source.emit("replay-complete", JSON.stringify(boundary));
      publish(message("retained", 9));
      publish(message("later", 11));
      publish(message("later", 11));
      const transcripts = received.filter((event) => event.type === "transcript_event");
      expect(transcripts.map((event) => event.cursor?.sequence)).toEqual([2, 8, 9, 11]);
      expect(
        transcripts.filter((event) => event.stateCovered).map((event) => event.cursor?.sequence),
      ).toEqual([8, 9]);
      expect(received.some((event) => event.type === "session_upsert")).toBe(false);
      expect(received.some((event) => event.type === "transcript_gap")).toBe(false);
      expect(reads).toBe(2);
    } finally {
      finish.resolve(new Response(JSON.stringify(baseline(10))));
      stop();
    }
  });
}

for (const { timing, attachment, invalid } of [
  { timing: "before", attachment: "settled" },
  { timing: "after", attachment: "settled" },
  { timing: "before", attachment: "pending" },
  { timing: "after", attachment: "pending" },
  { timing: "before", attachment: "late" },
  { timing: "after", attachment: "late" },
  { timing: "before", attachment: "replacement" },
  { timing: "after", attachment: "replacement" },
  { timing: "after", attachment: "replacement_completed" },
  { timing: "before", attachment: "settled", invalid: "mismatch" },
  { timing: "before", attachment: "settled", invalid: "start" },
  { timing: "before", attachment: "settled", invalid: "complete" },
].map((input) => ({ ...input, invalid: "invalid" in input ? input.invalid : undefined }))) {
  test(`transcript repair waits for replay with ${attachment} initial attachment and recovery arriving ${timing} retained deltas, invalid control ${invalid ?? "none"}`, async () => {
    const initialPending = attachment === "pending" || attachment === "late";
    const { observeLocalHostAgentSessions } = await loadLocalHostTransport();
    const finish = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    const initialStarted = Promise.withResolvers<void>();
    const initialFinish = Promise.withResolvers<Response>();
    const baseline = liveBaseline;
    const session = baseline(0).sessions[0]!;
    const ref = session.ref;
    const timestamp = session.startedAt;
    const received: AgentSessionLiveEnvelope[] = [];
    const applyEnvelope = (event: AgentSessionLiveEnvelope) => received.push(event);
    const readyGaps = () =>
      received.filter((event) => event.type === "transcript_gap" && !event.replayPending);
    let reads = 0;
    globalThis.fetch = createFetchFixture(
      mock(async (url: string | URL | Request) => {
        if (!url.toString().includes("/invoke/")) return new Response(JSON.stringify({ ok: true }));
        reads += 1;
        if (url.toString().includes("agent_session_live_attach")) {
          initialStarted.resolve();
          return initialPending ? initialFinish.promise : new Response(JSON.stringify(baseline(1)));
        }
        started.resolve();
        return finish.promise.then((response) => response.clone());
      }),
    );
    const background = attachment.startsWith("replacement")
      ? observeLocalHostAgentSessions({ repoPath: "/repo" }, () => {})
      : null;
    let observing = observeLocalHostAgentSessions({ repoPath: "/repo" }, applyEnvelope);
    const source = await waitForEventSourceInstance();
    source.emit("open", "");
    await initialStarted.promise;
    let stop: (() => void) | undefined;
    if (!initialPending) stop = await observing;
    const stopBackground = background ? await background : undefined;
    const resolveBaseline = async () => {
      finish.resolve(new Response(JSON.stringify(baseline(10))));
      for (let turn = 0; turn < 100; turn++) await Promise.resolve();
    };
    const boundary = {
      hostEpoch: TEST_HOST_EPOCH,
      sequence: 10,
      hostChanged: false,
      losses: [
        {
          channel: "openducktor://agent-session-live-event",
          repoPath: "/repo",
          facet: "transcript",
          refs: [ref],
        },
      ],
    };
    try {
      source.emit("replay-start", JSON.stringify(boundary));
      await started.promise;
      if (attachment === "replacement") {
        stop?.();
        observing = observeLocalHostAgentSessions({ repoPath: "/repo" }, applyEnvelope);
        stop = await observing;
      }
      if (attachment === "pending") {
        initialFinish.resolve(new Response(JSON.stringify(baseline(10))));
        stop = await observing;
        for (let turn = 0; turn < 100; turn++) await Promise.resolve();
      }
      if (timing === "before") await resolveBaseline();
      expect(readyGaps()).toHaveLength(0);
      expect(received).toContainEqual(
        expect.objectContaining({ type: "transcript_gap", replayPending: true }),
      );
      if (invalid) {
        source.emitAsBrowser(
          invalid === "start" ? "replay-start" : "replay-complete",
          invalid === "mismatch" ? JSON.stringify({ ...boundary, sequence: 11 }) : "{",
        );
        await Promise.resolve();
        expect(received).toContainEqual(
          expect.objectContaining({
            type: "fault",
            operation: "agent-session-live.replay",
            message: expect.stringContaining("Reload the browser to reconnect"),
          }),
        );
        expect(source.closed).toBe(true);
        expect(readyGaps()).toHaveLength(0);
        return;
      }

      source.emit(
        liveSessionStreamEventName("/repo"),
        JSON.stringify({
          channel: "openducktor://agent-session-live-event",
          payload: {
            type: "transcript_event",
            cursor: { hostEpoch: TEST_HOST_EPOCH, sequence: 9 },
            event: {
              type: "assistant_delta",
              sessionRef: ref,
              externalSessionId: ref.externalSessionId,
              timestamp,
              messageId: "reply",
              channel: "text",
              delta: " world",
            },
          },
        }),
      );
      source.emit("replay-complete", JSON.stringify(boundary));
      if (attachment === "replacement_completed") {
        stop?.();
        observing = observeLocalHostAgentSessions({ repoPath: "/repo" }, applyEnvelope);
        stop = await observing;
      }
      if (timing === "after") {
        expect(readyGaps()).toHaveLength(0);
        await resolveBaseline();
      }
      if (attachment === "late") {
        initialFinish.resolve(new Response(JSON.stringify(baseline(1))));
        stop = await observing;
      }
      const transcripts = received.filter((event) => event.type === "transcript_event");
      expect(readyGaps().length).toBeGreaterThan(0);
      if (attachment === "replacement_completed") {
        expect(transcripts).toHaveLength(0);
      } else {
        expect(transcripts).toHaveLength(1);
        expect(transcripts[0]).toMatchObject({
          cursor: { sequence: 9 },
          event: { type: "assistant_delta", delta: " world" },
        });
        expect(received.indexOf(transcripts[0]!)).toBeLessThan(received.indexOf(readyGaps()[0]!));
      }
      const snapshots = received.filter((event) => event.type === "snapshot");
      expect(snapshots.at(-1)?.cursor?.sequence).toBe(10);
      expect(reads).toBe(attachment.startsWith("replacement") ? 6 : 2);
    } finally {
      finish.resolve(new Response(JSON.stringify(baseline(10))));
      initialFinish.resolve(new Response(JSON.stringify(baseline(10))));
      (stop ?? (await observing))();
      stopBackground?.();
    }
  });
}

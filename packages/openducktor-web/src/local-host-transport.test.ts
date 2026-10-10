import { liveSessionStreamEventName } from "./host-event-stream-name";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";
import { Effect } from "effect";
import type { JSONType } from "zod";
import { configureBrowserRuntimeConfig } from "./browser-config";
import { WebDependencyError } from "./effect/web-errors";
import { createFetchFixture } from "./test-support";
import type { RuntimeChangeListener } from "@openducktor/frontend/lib/shell-bridge";

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

  /** Opens the connection and ends its replay, as the host does for each connection. */
  connect(replay: { hostChanged: boolean; gaps: string[] } = { hostChanged: false, gaps: [] }) {
    this.emit("open", "");
    this.emit("replay-complete", JSON.stringify(replay));
  }

  hasListener(type: string): boolean {
    return (this.listeners.get(type)?.size ?? 0) > 0;
  }

  static reset(): void {
    FakeEventSource.instances = [];
  }
}

const liveAttachBody = (repoPath: string, sequence = 0): string =>
  JSON.stringify({ type: "snapshot", repoPath, sessions: [], sequence });
// Answers live attachments with an empty snapshot of the requested repository.
const hostFetch = (sequence = 0) =>
  mock(async (url: string | URL | Request, init?: RequestInit) =>
    url.toString().endsWith("/invoke/agent_session_live_attach")
      ? new Response(liveAttachBody(JSON.parse(String(init?.body)).repoPath, sequence), {
          status: 200,
        })
      : new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );

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

const waitForCondition = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Expected the condition to become true.");
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

  test("preserves structured timeout metadata through local web runtime status", async () => {
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
      await client.runtimeStatus();
    } catch (cause) {
      error = cause;
    }

    expect(error instanceof Error).toBe(true);
    if (!(error instanceof Error)) {
      throw new Error("Expected runtimeStatus to reject with an Error");
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
      "http://127.0.0.1:14327/invoke/runtime_status",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-openducktor-app-token": "app-token",
        },
        body: JSON.stringify({}),
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
    expect(listener).not.toHaveBeenCalled();

    eventSource.connect();
    const unsubscribe = await subscription;
    expect(ready).toBe(true);
    unsubscribe();
    expect(eventSource.closed).toBe(true);
  });

  test("shares one EventSource across non-task host event channels", async () => {
    const {
      observeLocalHostAgentSessions,
      subscribeLocalHostRunEvents,
      subscribeLocalHostWorkspaceSessionUpdates,
      subscribeLocalHostWorkspaceProviderSetupUpdates,
    } = await loadLocalHostTransport();
    const fetchMock = mock(
      async (url: string | URL | Request) =>
        new Response(
          url.toString().includes("/invoke/")
            ? liveAttachBody("/repo")
            : JSON.stringify({ ok: true }),
          { status: 200 },
        ),
    );
    globalThis.fetch = createFetchFixture(fetchMock);
    const runListener = mock(() => {});
    const liveSessionListener = mock(() => {});
    const workspaceSessionListener = mock(() => {});
    const setupListener = mock(() => {});

    const unsubscribeRun = await subscribeLocalHostRunEvents(runListener);
    const workspaceSessionSubscription =
      subscribeLocalHostWorkspaceSessionUpdates(workspaceSessionListener);
    const setupSubscription = subscribeLocalHostWorkspaceProviderSetupUpdates(setupListener);
    const liveSessionObservation = observeLocalHostAgentSessions(
      { repoPath: "/repo" },
      liveSessionListener,
    );

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe("http://127.0.0.1:14327/events");
    expect(FakeEventSource.instances[0]?.options).toEqual({ withCredentials: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    FakeEventSource.instances[0]?.connect();
    const unsubscribeWorkspaceSession = await workspaceSessionSubscription;
    const unsubscribeSetup = await setupSubscription;
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
    const setupUpdate = {
      setupId: crypto.randomUUID(),
      repoPath: "/new-repo",
      revision: 2,
      configurationFingerprint: "current",
      attemptId: crypto.randomUUID(),
      state: { status: "connected", account: "user" },
    };
    emitHostEvent("openducktor://workspace-provider-setup-updated", setupUpdate);
    expect(setupListener).toHaveBeenCalledWith(setupUpdate);
    emitHostEvent("openducktor://agent-session-live-event", {
      type: "snapshot",
      repoPath: "/repo",
      sessions: [],
      sequence: 1,
    });

    expect(runListener).toHaveBeenCalledWith({ type: "run" });
    expect(liveSessionListener).toHaveBeenCalledTimes(2);
    expect(liveSessionListener).toHaveBeenNthCalledWith(1, {
      type: "snapshot",
      repoPath: "/repo",
      sessions: [],
      sequence: 0,
      isConnectionSnapshot: true,
    });
    expect(liveSessionListener).toHaveBeenNthCalledWith(2, {
      type: "snapshot",
      repoPath: "/repo",
      sessions: [],
      sequence: 1,
    });
    expect(() =>
      emitHostEvent("openducktor://workspace-session-updated", { workspaceId: "workspace-A" }),
    ).toThrow("Invalid OpenDucktor host event envelope.");
    expect(workspaceSessionListener).toHaveBeenCalledTimes(1);

    unsubscribeRun();
    unsubscribeWorkspaceSession();
    unsubscribeSetup();
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
    eventSource.connect();
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
    globalThis.fetch = createFetchFixture(hostFetch());
    const first = mock((_event: AgentSessionLiveEnvelope) => {});
    const duplicate = mock((_event: AgentSessionLiveEnvelope) => {});
    const second = mock((_event: AgentSessionLiveEnvelope) => {});
    const firstSetup = observeLocalHostAgentSessions({ repoPath: "/first" }, first);
    const source = await waitForEventSourceInstance();
    source.connect();
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
    // Each observer received its own attachment snapshot first.
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

  test("resolves host event subscriptions on initial open and emits reconnect control payloads afterward", async () => {
    const { subscribeLocalHostWorkspaceSessionUpdates } = await loadLocalHostTransport();
    globalThis.fetch = createFetchFixture(
      mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const listener = mock(() => {});

    const subscription = subscribeLocalHostWorkspaceSessionUpdates(listener);
    const eventSource = await waitForEventSourceInstance();
    let didResolve = false;
    void subscription.then(() => {
      didResolve = true;
    });

    await Promise.resolve();
    expect(didResolve).toBe(false);

    eventSource.connect();
    const unsubscribe = await subscription;
    expect(listener).not.toHaveBeenCalled();

    eventSource.connect();
    eventSource.connect({ hostChanged: false, gaps: [liveSessionStreamEventName("/repo")] });
    eventSource.connect({ hostChanged: false, gaps: ["message"] });
    eventSource.connect({ hostChanged: true, gaps: [] });
    expect(listener).toHaveBeenCalledTimes(4);
    for (const [index, missedEvents] of [false, false, true, true].entries()) {
      expect(listener).toHaveBeenNthCalledWith(index + 1, {
        __openducktorBrowserLive: true,
        kind: "reconnected",
        missedEvents,
      });
    }

    unsubscribe();
  });

  test("delivers host runtime changes and connection control events", async () => {
    const { subscribeLocalHostRuntimeChanges } = await loadLocalHostTransport();
    globalThis.fetch = createFetchFixture(
      mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const listener = mock(() => {});
    const subscription = subscribeLocalHostRuntimeChanges(listener);
    const eventSource = await waitForEventSourceInstance();
    eventSource.connect();
    const unsubscribe = await subscription;
    const payload = {
      type: "runtime_changed",
      hostInstanceId: "host-1",
      status: {
        kind: "opencode",
        enabled: true,
        configuredExecutablePath: "",
        effectiveExecutablePath: null,
        version: null,
        state: "starting",
        trigger: "host_startup",
        runtimeId: null,
        startedAt: null,
        updatedAt: "2026-02-22T08:00:00.000Z",
        failure: null,
        revision: 1,
      },
    };

    eventSource.emit(
      "message",
      JSON.stringify({ channel: "openducktor://runtime-changed", payload }),
    );
    eventSource.connect();

    expect(listener).toHaveBeenNthCalledWith(1, payload);
    expect(listener).toHaveBeenNthCalledWith(2, {
      __openducktorBrowserLive: true,
      kind: "reconnected",
      missedEvents: false,
    });
    unsubscribe();
  });

  test("delivers reconnect once to a listener removed by a failing earlier listener", async () => {
    const { subscribeLocalHostWorkspaceSessionUpdates } = await loadLocalHostTransport();
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
    const firstSubscription = subscribeLocalHostWorkspaceSessionUpdates(first);
    const eventSource = await waitForEventSourceInstance();
    eventSource.connect();
    const unsubscribeFirst = await firstSubscription;
    unsubscribeLater = await subscribeLocalHostWorkspaceSessionUpdates(later);

    let thrown: unknown;
    try {
      eventSource.connect();
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toBe(failure);
    expect(first).toHaveBeenCalledTimes(1);
    expect(later).toHaveBeenCalledTimes(1);
    expect(later).toHaveBeenCalledWith({
      __openducktorBrowserLive: true,
      kind: "reconnected",
      missedEvents: false,
    });

    expect(() => eventSource.connect()).toThrow("reconnect listener failed");
    expect(later).toHaveBeenCalledTimes(1);
    unsubscribeFirst();
  });

  test("keeps live-session state across a complete replay and reattaches after missed events", async () => {
    const { observeLocalHostAgentSessions } = await loadLocalHostTransport();
    const attachResponses = [Promise.withResolvers<number>(), Promise.withResolvers<number>()];
    let attachCount = 0;
    const fetchMock = mock(async (url: string | URL | Request) => {
      if (!url.toString().endsWith("/invoke/agent_session_live_attach")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      const sequence = await attachResponses[attachCount++]!.promise;
      return new Response(liveAttachBody("/repo", sequence), { status: 200 });
    });
    globalThis.fetch = createFetchFixture(fetchMock);
    const listener = mock((_envelope: AgentSessionLiveEnvelope) => {});
    const sessionRef = {
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo/worktree",
      externalSessionId: "child-thread",
    } as const;
    const transcriptEvent = (messageId: string) =>
      ({
        type: "transcript_event",
        event: {
          type: "assistant_message",
          externalSessionId: "child-thread",
          messageId,
          message: messageId,
          timestamp: "2026-07-17T08:00:00.000Z",
          sessionRef,
        },
      }) satisfies AgentSessionLiveEnvelope;
    const removal = (sequence: number) =>
      ({ type: "session_removed", ref: sessionRef, sequence }) satisfies AgentSessionLiveEnvelope;

    const observation = observeLocalHostAgentSessions({ repoPath: "/repo" }, listener);
    const eventSource = await waitForEventSourceInstance();
    eventSource.connect();
    await waitForCondition(() => attachCount === 1);
    const emitLive = (payload: AgentSessionLiveEnvelope) =>
      eventSource.emit(
        liveSessionStreamEventName("/repo"),
        JSON.stringify({ channel: "openducktor://agent-session-live-event", payload }),
      );
    // Changes that arrive during the attachment wait for its snapshot.
    emitLive(removal(4));
    emitLive(transcriptEvent("during-attach"));
    emitLive(removal(6));
    expect(listener).not.toHaveBeenCalled();
    attachResponses[0]!.resolve(5);
    const stopObserving = await observation;
    expect(listener.mock.calls.map(([envelope]) => envelope)).toEqual([
      {
        type: "snapshot",
        repoPath: "/repo",
        sessions: [],
        sequence: 5,
        isConnectionSnapshot: true,
      },
      transcriptEvent("during-attach"),
      removal(6),
    ]);

    listener.mockClear();
    eventSource.connect();
    eventSource.connect({ hostChanged: false, gaps: [liveSessionStreamEventName("/other")] });
    expect(attachCount).toBe(1);
    expect(listener).not.toHaveBeenCalled();

    eventSource.connect({ hostChanged: false, gaps: [liveSessionStreamEventName("/repo")] });
    await waitForCondition(() => attachCount === 2);
    emitLive(removal(8));
    emitLive(transcriptEvent("during-reattach"));
    expect(listener).not.toHaveBeenCalled();
    attachResponses[1]!.resolve(9);
    await waitForCondition(() => listener.mock.calls.length === 2);
    expect(listener.mock.calls.map(([envelope]) => envelope)).toEqual([
      {
        type: "snapshot",
        repoPath: "/repo",
        sessions: [],
        sequence: 9,
        isConnectionSnapshot: true,
      },
      transcriptEvent("during-reattach"),
    ]);

    stopObserving();
  });

  test("reattaches every live-session observer after a host change when one listener fails", async () => {
    const { observeLocalHostAgentSessions } = await loadLocalHostTransport();
    globalThis.fetch = createFetchFixture(hostFetch());
    let snapshots = 0;
    const throwingListener = mock((envelope: AgentSessionLiveEnvelope) => {
      if (envelope.type === "snapshot" && ++snapshots === 2) {
        throw new Error("listener failed");
      }
    });
    const listener = mock((_envelope: AgentSessionLiveEnvelope) => {});

    const firstObservation = observeLocalHostAgentSessions({ repoPath: "/repo" }, throwingListener);
    const eventSource = await waitForEventSourceInstance();
    const secondObservation = observeLocalHostAgentSessions({ repoPath: "/repo" }, listener);
    eventSource.connect();
    const stopFirstObservation = await firstObservation;
    const stopSecondObservation = await secondObservation;

    eventSource.connect({ hostChanged: true, gaps: [] });
    await waitForCondition(() => listener.mock.calls.length === 2);
    await waitForCondition(() => throwingListener.mock.calls.length === 3);
    expect(listener.mock.calls[1]?.[0]).toMatchObject({
      type: "snapshot",
      isConnectionSnapshot: true,
    });
    expect(throwingListener.mock.calls[2]?.[0]).toEqual({
      type: "fault",
      repoPath: "/repo",
      operation: "agent-session-live.attach",
      message: "listener failed",
    });

    stopFirstObservation();
    stopSecondObservation();
  });

  test("waits for the native EventSource reconnect when the initial open fails", async () => {
    const { subscribeLocalHostWorkspaceSessionUpdates } = await loadLocalHostTransport();
    globalThis.fetch = createFetchFixture(
      mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const listener = mock(() => {});

    const subscription = subscribeLocalHostWorkspaceSessionUpdates(listener);
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

    eventSource.connect();
    // The first connection has no cursor, so consumers read a current baseline.
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({
      __openducktorBrowserLive: true,
      kind: "reconnected",
      missedEvents: true,
    });
    const unsubscribe = await subscription;

    // A subscriber that joins after this recovery gets no old warning.
    const late = mock(() => {});
    const unsubscribeLate = await subscribeLocalHostWorkspaceSessionUpdates(late);
    expect(late).not.toHaveBeenCalled();
    unsubscribeLate();
    unsubscribe();
    expect(eventSource.closed).toBe(true);
  });

  test("emits a stream-warning control payload when the EventSource errors after opening", async () => {
    const { subscribeLocalHostWorkspaceSessionUpdates } = await loadLocalHostTransport();
    globalThis.fetch = createFetchFixture(
      mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const listener = mock(() => {});

    const subscription = subscribeLocalHostWorkspaceSessionUpdates(listener);
    const eventSource = await waitForEventSourceInstance();
    eventSource.connect();
    const unsubscribe = await subscription;

    eventSource.emit("error", "lost connection");

    expect(listener).toHaveBeenNthCalledWith(1, {
      __openducktorBrowserLive: true,
      kind: "stream-warning",
      message: "EventSource events reported an error after opening.",
    });

    eventSource.emit("error", "still disconnected");
    expect(listener).toHaveBeenCalledTimes(1);

    eventSource.connect();
    expect(listener).toHaveBeenNthCalledWith(2, {
      __openducktorBrowserLive: true,
      kind: "reconnected",
      missedEvents: false,
    });

    eventSource.emit("error", "lost again");
    expect(listener).toHaveBeenNthCalledWith(3, {
      __openducktorBrowserLive: true,
      kind: "stream-warning",
      message: "EventSource events reported an error after opening.",
    });

    unsubscribe();
  });

  test("gives a runtime subscriber that joins during a connection failure the current warning", async () => {
    const { subscribeLocalHostRuntimeChanges } = await loadLocalHostTransport();
    globalThis.fetch = createFetchFixture(
      mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const existing = mock<RuntimeChangeListener>(() => {});
    const subscription = subscribeLocalHostRuntimeChanges(existing);
    const eventSource = await waitForEventSourceInstance();
    eventSource.connect();
    const stopExisting = await subscription;
    eventSource.emit("error", "lost connection");

    const late = mock<RuntimeChangeListener>(() => {});
    const stopLate = await subscribeLocalHostRuntimeChanges(late);

    const warning = {
      __openducktorBrowserLive: true,
      kind: "stream-warning",
      message: "EventSource events reported an error after opening.",
    };
    expect(existing).toHaveBeenCalledTimes(1);
    expect(existing).toHaveBeenCalledWith(warning);
    expect(late).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledWith(warning);

    eventSource.connect();
    const reconnected = {
      __openducktorBrowserLive: true,
      kind: "reconnected",
      missedEvents: false,
    };
    expect(late).toHaveBeenLastCalledWith(reconnected);

    // A subscriber that joins after the reconnect gets no old warning.
    const afterRecovery = mock<RuntimeChangeListener>(() => {});
    const stopAfterRecovery = await subscribeLocalHostRuntimeChanges(afterRecovery);
    expect(afterRecovery).not.toHaveBeenCalled();

    stopExisting();
    stopLate();
    stopAfterRecovery();
  });

  test("isolates post-open stream-warning listener failures", async () => {
    const { subscribeLocalHostWorkspaceSessionUpdates } = await loadLocalHostTransport();
    globalThis.fetch = createFetchFixture(
      mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const throwingListener = mock(() => {
      throw new Error("listener failed");
    });
    const listener = mock(() => {});

    const throwingSubscription = subscribeLocalHostWorkspaceSessionUpdates(throwingListener);
    const eventSource = await waitForEventSourceInstance();
    eventSource.connect();
    const unsubscribeThrowing = await throwingSubscription;
    const unsubscribe = await subscribeLocalHostWorkspaceSessionUpdates(listener);

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

  test("isolates missed-event reconnect listener failures", async () => {
    const { subscribeLocalHostWorkspaceSessionUpdates } = await loadLocalHostTransport();
    globalThis.fetch = createFetchFixture(
      mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const throwingListener = mock(() => {
      throw new Error("listener failed");
    });
    const listener = mock(() => {});

    const throwingSubscription = subscribeLocalHostWorkspaceSessionUpdates(throwingListener);
    const eventSource = await waitForEventSourceInstance();
    eventSource.connect();
    const unsubscribeThrowing = await throwingSubscription;
    const unsubscribe = await subscribeLocalHostWorkspaceSessionUpdates(listener);

    expect(() => eventSource.connect({ hostChanged: false, gaps: ["message"] })).toThrow(
      "listener failed",
    );
    expect(listener).toHaveBeenNthCalledWith(1, {
      __openducktorBrowserLive: true,
      kind: "reconnected",
      missedEvents: true,
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

    eventSource.connect();
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
    eventSource.connect();
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
    eventSource.connect();
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
    eventSource.connect();
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
    eventSource.connect();
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
    eventSource.connect();
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
    eventSource.connect();
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
    eventSource.connect();
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
    eventSource.connect();
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
  expect(JSON.parse(url.searchParams.get("notificationCursor")!)).toEqual(cursor);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  stop();
});

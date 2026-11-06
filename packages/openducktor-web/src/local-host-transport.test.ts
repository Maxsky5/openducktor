import { liveSessionStreamEventName } from "@openducktor/host-client";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type {
  AgentSessionLiveEnvelope,
  HostInvokeFailure,
  HostChannelError,
  HostChannelRequestMessage,
  HostEventEnvelope,
  RemoteAccessState,
  TaskEventStreamFrame,
} from "@openducktor/contracts";
import {
  createFakeHostChannel,
  type FakeHostChannel,
  type FakeHostChannelOptions,
  type FakeHostChannelReply,
} from "@openducktor/host-client/remote/test-support/host-channel";
import type { HostChannelReplay } from "@openducktor/host-client/channel";
import { configureBrowserRuntimeConfig } from "./browser-config";
import { createFetchFixture } from "./test-support";
import type {
  RuntimeChangeListener,
  StartupProgressListener,
} from "@openducktor/frontend-core/connection/host-connection";
import {
  connectionReconnectedEvent,
  connectionStreamWarningEvent,
} from "@openducktor/frontend-core/recovery/connection-control-events";

const BACKEND_URL = "http://127.0.0.1:14327";
const RECONNECT_DELAYS_MS = new Set([500, 1_000, 2_000, 4_000, 5_000]);

const originalWebSocket = globalThis.WebSocket;
const originalFetch = globalThis.fetch;
let importId = 0;
/** Each test loads its own module, so the tab channel singleton starts closed. */
const loadLocalHostTransport = (): Promise<typeof import("./local-host-transport")> =>
  import(`./local-host-transport.ts?test=${++importId}`);

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const waitFor = async (condition: () => boolean, label: string): Promise<void> => {
  for (let index = 0; index < 100; index += 1) {
    if (condition()) return;
    await tick();
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

type HostSetup = {
  host: () => FakeHostChannel;
  replaceHost(options: FakeHostChannelOptions): FakeHostChannel;
  socketUrls: string[];
  fetchMock: ReturnType<typeof mock>;
};

/** Answers the session request and opens browser sockets on a fake host channel. */
const setupHost = (options: FakeHostChannelOptions = {}): HostSetup => {
  let host = createFakeHostChannel(options);
  const socketUrls: string[] = [];
  const fetchMock = mock(async (url: string | URL | Request) => {
    if (url.toString() !== `${BACKEND_URL}/session`)
      throw new Error(`Unexpected request ${url.toString()}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  globalThis.fetch = createFetchFixture(fetchMock);
  class StubWebSocket {
    constructor(url: string, protocols: string[]) {
      socketUrls.push(url);
      return host.createSocket(protocols);
    }
  }
  // @ts-expect-error test shim: the fake socket has the members that the channel uses.
  globalThis.WebSocket = StubWebSocket;
  return {
    host: () => host,
    replaceHost: (next) => {
      host = createFakeHostChannel(next);
      return host;
    },
    socketUrls,
    fetchMock,
  };
};

/** Runs reconnect timers at once, so a test can follow a reconnect. */
const runReconnectsAtOnce = () => {
  const realSetTimeout = globalThis.setTimeout;
  // SAFETY: the replacement keeps the call shape and the return value of the real setTimeout.
  return spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: () => void,
    delay?: number,
  ) =>
    realSetTimeout(
      callback,
      delay !== undefined && RECONNECT_DELAYS_MS.has(delay) ? 0 : delay,
    )) as typeof setTimeout);
};

const hostError = (response: Extract<HostChannelError, { kind: "host" }>["response"]) =>
  ({ error: { kind: "host", response } }) satisfies FakeHostChannelReply;

const methods = (requests: HostChannelRequestMessage[]) =>
  requests.map((request) => request.method);

const reconnected = (missedEvents: boolean, hostChanged = false, missedEventNames: string[] = []) =>
  connectionReconnectedEvent(missedEvents, { hostChanged, missedEventNames });

const liveSnapshot = (repoPath: string, sequence: number) => ({
  type: "snapshot" as const,
  messageQueues: [],
  repoPath,
  sessions: [],
  sequence,
});

beforeEach(() => {
  configureBrowserRuntimeConfig({ backendUrl: BACKEND_URL, appToken: "app-token" });
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  globalThis.fetch = originalFetch;
  configureBrowserRuntimeConfig({});
});

describe("readLocalHostErrorPayload", () => {
  test("preserves plain-text backend error bodies", async () => {
    const { readLocalHostErrorPayload } = await import("./local-host-errors");
    const response = new Response("Plain backend error", { status: 500 });

    await expect(readLocalHostErrorPayload(response)).resolves.toEqual({
      message: "Plain backend error",
      payload: null,
    });
  });

  test("returns the trimmed structured error field of a JSON body", async () => {
    const { readLocalHostErrorPayload } = await import("./local-host-errors");
    const response = new Response(JSON.stringify({ error: "  Structured backend error  " }), {
      status: 500,
    });

    await expect(readLocalHostErrorPayload(response)).resolves.toEqual({
      message: "Structured backend error",
      payload: { error: "Structured backend error" },
    });
  });

  test("returns the host status message when the body is empty", async () => {
    const { readLocalHostErrorPayload } = await import("./local-host-errors");

    await expect(readLocalHostErrorPayload(new Response("", { status: 502 }))).resolves.toEqual({
      message: "OpenDucktor web host request failed with status 502.",
      payload: null,
    });
  });
});

describe("local host client", () => {
  test("rejects local host session failures with a typed web host request error", async () => {
    const { ensureLocalHostSession } = await loadLocalHostTransport();
    globalThis.fetch = createFetchFixture(
      mock(
        async () => new Response(JSON.stringify({ error: "Session rejected" }), { status: 401 }),
      ),
    );

    const session = ensureLocalHostSession();
    await expect(session).rejects.toThrow("Session rejected");
    await expect(session).rejects.toMatchObject({ _tag: "WebHostRequestError", status: 401 });
  });

  test("sends commands over the host channel after the session cookie request", async () => {
    const gitCheck = { ok: true, executablePath: "/usr/bin/git", version: "2.50.0", error: null };
    const setup = setupHost({ invoke: () => ({ result: gitCheck }) });
    const { localHostConnection: host } = await loadLocalHostTransport();

    await expect(host.client.gitCheck()).resolves.toEqual(gitCheck);

    expect(setup.fetchMock).toHaveBeenCalledTimes(1);
    expect(setup.fetchMock).toHaveBeenCalledWith(
      `${BACKEND_URL}/session`,
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "x-openducktor-app-token": "app-token" },
      }),
    );
    expect(setup.socketUrls).toEqual(["ws://127.0.0.1:14327/channel"]);
    expect(setup.host().sockets[0]?.protocols).toEqual(["openducktor-channel.v1"]);
    expect(setup.host().requests.at(-1)).toMatchObject({
      method: "invoke",
      command: "git_check",
      args: {},
    });
  });

  test("keeps structured terminal failures", async () => {
    setupHost({
      invoke: () =>
        hostError({
          error: "Interactive terminals are unavailable in this runtime.",
          failure: {
            kind: "terminal",
            terminalFailure: {
              code: "unsupported_runtime",
              message: "Interactive terminals are unavailable in this runtime.",
            },
          },
        }),
    });
    const { localHostConnection: host } = await loadLocalHostTransport();

    await expect(
      host.client.terminalCreate({ workingDir: "/repo", context: {} }),
    ).rejects.toMatchObject({ name: "HostTerminalClientError", code: "unsupported_runtime" });
  });

  test("keeps an accepted message failure as a host invoke error", async () => {
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
    } satisfies HostInvokeFailure;
    setupHost({
      invoke: () =>
        hostError({
          error: "The runtime accepted the message, but the session update failed.",
          failure,
        }),
    });
    const { localHostConnection: host } = await loadLocalHostTransport();

    await expect(
      host.client.agentSessionMessageSubmit({
        ...sessionRef,
        sessionScope: { kind: "repository", workspaceId: "workspace-1" },
        submissionId: "submission-1",
        mode: "default",
        parts: [{ kind: "text", text: "Hello" }],
      }),
    ).rejects.toMatchObject({ name: "HostInvokeError", failure });
  });

  test("reports a host refusal with its next action", async () => {
    setupHost({
      invoke: () => ({
        error: {
          kind: "refused",
          failure: {
            code: "unavailable",
            message: "The host is shutting down.",
            nextAction: "Reopen OpenDucktor.",
          },
        },
      }),
    });
    const { localHostConnection: host } = await loadLocalHostTransport();

    await expect(host.client.gitCheck()).rejects.toMatchObject({
      name: "HostInvokeError",
      message: "The host is shutting down. Reopen OpenDucktor.",
    });
  });

  test("reports an unreadable host error as a protocol error", async () => {
    setupHost({
      invoke: () =>
        hostError({
          error: "Invalid terminal failure",
          // SAFETY: the test sends an invalid failure on purpose. It makes the frame unreadable.
          failure: { kind: "terminal", terminalFailure: { code: "missing_code" } } as never,
        }),
    });
    const { localHostConnection: host } = await loadLocalHostTransport();

    await expect(
      host.client.terminalCreate({ workingDir: "/repo", context: {} }),
    ).rejects.toMatchObject({ name: "HostChannelProtocolError" });
  });

  test("rejects an aborted command with the abort reason at once", async () => {
    const setup = setupHost({ invoke: () => "none" });
    const { localHostConnection: host } = await loadLocalHostTransport();
    const abort = new AbortController();

    const pending = host.client.pathCheck(false, { signal: abort.signal });
    await waitFor(() => methods(setup.host().requests).includes("invoke"), "the command");
    const reason = new Error("Timed out after 30000ms");
    abort.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });
});

describe("local host event subscriptions", () => {
  const providerSetup = () => ({
    setupId: crypto.randomUUID(),
    repoPath: "/new-repo",
    revision: 2,
    configurationFingerprint: "current",
    attemptId: crypto.randomUUID(),
    state: { status: "disconnected" as const },
  });

  test("shares one channel across host event subscribers and closes it with the last one", async () => {
    const setup = setupHost();
    const { localHostConnection: host } = await loadLocalHostTransport();
    const runListener = mock(() => {});
    const setupListener = mock(() => {});
    const azureListener = mock(() => {});

    const stopRun = await host.subscribeRunEvents(runListener);
    const stopSetup = await host.subscribeWorkspaceProviderSetupUpdates(setupListener);
    const stopAzure = await host.subscribeAzureDevOpsConnectionUpdates(azureListener);
    expect(setup.socketUrls).toHaveLength(1);

    const run = { type: "autopilot_failure", failure: null } as const;
    setup.host().emit({ channel: "openducktor://run-event", payload: run });
    const update = providerSetup();
    setup
      .host()
      .emit({ channel: "openducktor://workspace-provider-setup-updated", payload: update });
    await waitFor(() => setupListener.mock.calls.length === 1, "the setup update");

    expect(runListener).toHaveBeenCalledWith(run);
    expect(setupListener).toHaveBeenCalledWith(update);
    expect(azureListener).not.toHaveBeenCalled();

    stopRun();
    stopSetup();
    expect(setup.host().sockets[0]?.closed).toBe(false);
    stopAzure();
    await waitFor(() => setup.host().sockets[0]?.closed === true, "the channel close");
  });

  test("routes live-session events only to observed repositories", async () => {
    const setup = setupHost({
      invoke: (command, args) =>
        command === "agent_session_live_attach"
          ? { result: liveSnapshot(String(args.repoPath), 0) }
          : { result: null },
    });
    const { localHostConnection: host } = await loadLocalHostTransport();
    const listener = mock((_envelope: AgentSessionLiveEnvelope) => {});

    const stop = await host.observeAgentSessionLive({ repoPath: "/repo" }, listener);
    const live = (repoPath: string, sequence: number): HostEventEnvelope => ({
      channel: "openducktor://agent-session-live-event",
      payload: liveSnapshot(repoPath, sequence),
    });
    setup.host().emit(live("/other", 1), liveSessionStreamEventName("/other"));
    setup.host().emit(live("/repo", 2), liveSessionStreamEventName("/repo"));
    await waitFor(() => listener.mock.calls.length === 2, "the observed live event");

    expect(listener.mock.calls.map(([envelope]) => envelope)).toEqual([
      { ...liveSnapshot("/repo", 0), isConnectionSnapshot: true },
      liveSnapshot("/repo", 2),
    ]);
    stop();
  });

  test("reports reconnects and the coverage of the startup event name", async () => {
    const reconnects = runReconnectsAtOnce();
    let opens = 0;
    let replay: HostChannelReplay = { hostChanged: false, gaps: [] };
    const setup = setupHost({
      answer: (request) => {
        if (request.method !== "events.open" || ++opens === 1) return undefined;
        return { result: { hostEpoch: "fake-host-epoch", hostEventId: 0, ...replay } };
      },
    });
    const { localHostConnection: host } = await loadLocalHostTransport();
    const listener = mock<StartupProgressListener>(() => {});
    const stop = await host.subscribeStartupProgress(listener);
    const reconnectWith = async (next: HostChannelReplay) => {
      replay = next;
      const calls = listener.mock.calls.length;
      setup.host().closeAll();
      // The warning and the reconnect arrive for each loss.
      await waitFor(() => listener.mock.calls.length === calls + 2, "the reconnect");
    };

    try {
      await reconnectWith({ hostChanged: false, gaps: ["message"] });
      expect(listener).toHaveBeenLastCalledWith(reconnected(false, false, ["message"]));
      await reconnectWith({ hostChanged: false, gaps: ["startup"] });
      expect(listener).toHaveBeenLastCalledWith(reconnected(true, false, ["startup"]));
      await reconnectWith({ hostChanged: true, gaps: [] });
      expect(listener).toHaveBeenLastCalledWith(reconnected(true, true));
      expect(listener.mock.calls[0]?.[0]).toMatchObject({ kind: "stream-warning" });
    } finally {
      stop();
      reconnects.mockRestore();
    }
  });

  test("gives a subscriber that joins during a connection failure the current warning", async () => {
    const setup = setupHost();
    const { localHostConnection: host } = await loadLocalHostTransport();
    const existing = mock<RuntimeChangeListener>(() => {});
    const stopExisting = await host.subscribeRuntimeChanges(existing);
    setup.host().closeAll();
    await waitFor(() => existing.mock.calls.length === 1, "the warning");

    const late = mock<RuntimeChangeListener>(() => {});
    const stopLate = await host.subscribeRuntimeChanges(late);

    expect(existing).toHaveBeenCalledWith(
      connectionStreamWarningEvent(
        "The host channel reported an error after opening: The host channel closed.",
      ),
    );
    expect(late.mock.calls).toEqual(existing.mock.calls);
    stopExisting();
    stopLate();
  });

  test("keeps live-session state after a complete replay and reattaches after missed events", async () => {
    const reconnects = runReconnectsAtOnce();
    let attaches = 0;
    let opens = 0;
    let gaps: string[] = [];
    const setup = setupHost({
      invoke: (command, args) => {
        if (command !== "agent_session_live_attach") return { result: null };
        attaches += 1;
        return { result: liveSnapshot(String(args.repoPath), attaches * 10) };
      },
      answer: (request) => {
        if (request.method !== "events.open" || ++opens === 1) return undefined;
        return {
          result: { hostEpoch: "fake-host-epoch", hostEventId: 0, hostChanged: false, gaps },
        };
      },
    });
    const { localHostConnection: host } = await loadLocalHostTransport();
    const listener = mock((_envelope: AgentSessionLiveEnvelope) => {});
    const stop = await host.observeAgentSessionLive({ repoPath: "/repo" }, listener);
    const reconnectAndWait = async () => {
      const sockets = setup.host().sockets.length;
      setup.host().closeAll();
      await waitFor(() => setup.host().sockets.length > sockets, "the new socket");
      await waitFor(
        () => methods(setup.host().sockets.at(-1)?.requests ?? []).includes("events.open"),
        "the replay",
      );
      // Let the reconnect control event run its listeners.
      await tick();
      await tick();
    };

    try {
      gaps = [liveSessionStreamEventName("/other")];
      await reconnectAndWait();
      expect(attaches).toBe(1);

      gaps = [liveSessionStreamEventName("/repo")];
      await reconnectAndWait();
      await waitFor(() => listener.mock.calls.length === 2, "the second snapshot");
      expect(attaches).toBe(2);
      expect(listener.mock.calls[1]?.[0]).toEqual({
        ...liveSnapshot("/repo", 20),
        isConnectionSnapshot: true,
        historyReplayGap: true,
      });
    } finally {
      stop();
      reconnects.mockRestore();
    }
  });
});

describe("local host task and status streams", () => {
  const frame: TaskEventStreamFrame = {
    type: "snapshot_required",
    cursor: { epoch: "00000000-0000-4000-8000-000000000002", sequence: 0 },
    reason: "buffer_gap",
  };

  test("delivers task frames, acknowledges cursors, and releases the lease", async () => {
    const setup = setupHost({ initialTaskFrames: () => [frame] });
    const { localHostConnection: host } = await loadLocalHostTransport();
    const frames: TaskEventStreamFrame[] = [];

    const subscription = await host.subscribeTaskStream({ cursor: null }, (next) =>
      frames.push(next),
    );
    await waitFor(() => frames.length === 1, "the first frame");
    await subscription.acknowledge(frame.cursor);
    await subscription.unsubscribe();

    expect(frames).toEqual([frame]);
    expect(setup.host().requests.slice(-3)).toEqual([
      expect.objectContaining({ method: "task_events.subscribe", input: { cursor: null } }),
      expect.objectContaining({ method: "task_events.ack", cursor: frame.cursor }),
      expect.objectContaining({
        method: "task_events.release",
        subscriptionId: subscription.subscriptionId,
      }),
    ]);
  });

  test("reports a refused task subscription with its next action", async () => {
    setupHost({
      answer: (request) =>
        request.method === "task_events.subscribe"
          ? {
              error: {
                kind: "refused",
                failure: {
                  code: "unavailable",
                  message: "The host is shutting down.",
                  nextAction: "Reopen OpenDucktor.",
                },
              },
            }
          : undefined,
    });
    const { localHostConnection: host } = await loadLocalHostTransport();

    await expect(host.subscribeTaskStream({ cursor: null }, () => {})).rejects.toMatchObject({
      name: "HostInvokeError",
      message: "The host is shutting down. Reopen OpenDucktor.",
    });
  });

  test("delivers remote access states to the local operator", async () => {
    const setup = setupHost();
    const { localHostConnection: host } = await loadLocalHostTransport();
    const states: RemoteAccessState[] = [];
    const stop = await host.observeRemoteAccess((state) => states.push(state));
    await waitFor(
      () => methods(setup.host().requests).includes("remote_access.observe"),
      "the observe request",
    );
    const state: RemoteAccessState = {
      status: "disabled",
      configuration: null,
      connectedClients: null,
      clients: null,
      pairing: null,
    };
    setup.host().remoteAccessState(state);
    await waitFor(() => states.length === 1, "the state");

    expect(states).toEqual([state]);
    stop();
  });

  test("shares the channel with notification subscribers and replays their retained frames", async () => {
    const cursor = { epoch: "11111111-1111-4111-8111-111111111111", sequence: 42 };
    const setup = setupHost();
    const { localHostConnection: host } = await loadLocalHostTransport();
    const frames = mock(() => {});
    const failures = mock(() => {});

    const stopNotifications = await host.subscribeNotificationStream({ cursor }, frames, failures);
    await waitFor(() => frames.mock.calls.length === 1, "the attached frame");
    expect(setup.host().requests[0]).toMatchObject({
      method: "events.open",
      notificationCursor: cursor,
    });
    const stopRun = await host.subscribeRunEvents(() => {});
    expect(setup.socketUrls).toHaveLength(1);

    const late = mock(() => {});
    const stopLate = await host.subscribeNotificationStream({ cursor: null }, late, () => {});
    expect(late).toHaveBeenCalledWith(expect.objectContaining({ type: "attached" }));
    setup.host().closeAll();
    await waitFor(() => failures.mock.calls.length === 1, "the notification failure");

    stopRun();
    stopNotifications();
    stopLate();
  });
});

describe("local host resource URLs", () => {
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

describe("local host session", () => {
  /** A session endpoint whose first request stays pending until its signal aborts. */
  const stallFirstSession = () => {
    const signals: AbortSignal[] = [];
    const fetchMock = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal;
      if (!signal) throw new Error("The session request has no signal.");
      signals.push(signal);
      if (signals.length > 1) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    globalThis.fetch = createFetchFixture(fetchMock);
    return { signals, fetchMock };
  };

  test("aborts a stalled request when its last waiter leaves, and a later call succeeds", async () => {
    const { signals } = stallFirstSession();
    const { ensureLocalHostSession } = await loadLocalHostTransport();
    const leave = new AbortController();
    const waiting = ensureLocalHostSession(leave.signal);
    await waitFor(() => signals.length === 1, "the session request");
    const reason = new Error("The host channel did not finish setup.");
    leave.abort(reason);

    await expect(waiting).rejects.toBe(reason);
    expect(signals[0]?.aborted).toBe(true);
    await ensureLocalHostSession(new AbortController().signal);
    expect(signals).toHaveLength(2);
  });

  test("keeps the shared request while another waiter needs it", async () => {
    const { signals } = stallFirstSession();
    const { ensureLocalHostSession } = await loadLocalHostTransport();
    const first = new AbortController();
    const firstWait = ensureLocalHostSession(first.signal);
    const secondWaiter = new AbortController();
    const second = ensureLocalHostSession(secondWaiter.signal);
    await waitFor(() => signals.length === 1, "the session request");
    first.abort(new Error("Left."));

    await expect(firstWait).rejects.toThrow("Left.");
    expect(signals[0]?.aborted).toBe(false);
    expect(signals).toHaveLength(1);
    secondWaiter.abort(new Error("Done."));
    await expect(second).rejects.toThrow("Done.");
    expect(signals[0]?.aborted).toBe(true);
  });
});

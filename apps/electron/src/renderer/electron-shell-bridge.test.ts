import {
  DEFAULT_AGENT_RUNTIMES,
  HOST_CHANNEL_SUBPROTOCOL,
  REMOTE_SOCKET_AUTHORIZATION_PREFIX,
  settingsSnapshotSchema,
} from "@openducktor/contracts";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshotEnvelope,
  AppUpdateCommandResult,
  AppUpdateState,
  ExternalTaskSyncEvent,
  ThemePreference,
  WorkspaceRef,
  HostEventEnvelope,
  RemoteAccessState,
  TaskEventCursor,
  TaskEventStreamFrame,
} from "@openducktor/contracts";
import {
  createHostClient,
  HostInvokeError,
  HostTerminalClientError,
  liveSessionStreamEventName,
} from "@openducktor/host-client";
import {
  createFakeHostChannel,
  type FakeHostChannel,
  type FakeHostChannelOptions,
} from "@openducktor/host-client/remote/test-support/host-channel";
import { createTaskStreamController } from "@openducktor/frontend-core/tasks/task-stream-controller";
import type { TaskSnapshotResult } from "@openducktor/frontend-core/queries/task-view-sync";
import { createTaskEventStream } from "../../../../packages/host/src/events/task-event-stream";
import type {
  ElectronBrowserSetSurfaceRequest,
  OpenDucktorElectronApi,
} from "../shared/electron-bridge-contract";
import {
  createElectronShellBridge,
  withElectronDesktopShell,
  withElectronNativeTheme,
  ElectronPreloadBridgeUnavailableError,
} from "./electron-shell-bridge";

const originalWindow = globalThis.window;
const originalWebSocket = globalThis.WebSocket;
const CHANNEL_TOKEN = "t".repeat(43);
const CHANNEL_URL = "ws://127.0.0.1:1/channel";

/** The fake desktop host of the current test, and the sockets that the renderer opened. */
let host: FakeHostChannel = createFakeHostChannel();
const openedSockets: Array<{ url: string; protocols: string[] }> = [];

/** Serves the renderer's host channel from `host`, as the Electron main channel server does. */
const useHost = (options: FakeHostChannelOptions = {}): FakeHostChannel => {
  host = createFakeHostChannel(options);
  return host;
};

const liveSnapshot: AgentSessionLiveSnapshotEnvelope = {
  type: "snapshot",
  messageQueues: [],
  repoPath: "/repo",
  sessions: [],
  sequence: 0,
};

const settle = async (condition: () => boolean, label: string): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

const taskStreamEpoch = "11111111-1111-4111-8111-111111111111";
const taskStreamCursor = (sequence: number): TaskEventCursor => ({
  epoch: taskStreamEpoch,
  sequence,
});
const taskStreamEvent = (sequence: number): ExternalTaskSyncEvent => ({
  eventId: `event-${sequence}`,
  kind: "external_task_created",
  boardChanges: null,
  workspaceId: "repo",
  repoPath: "/repo",
  taskId: `task-${sequence}`,
  taskSnapshot: {
    id: `task-${sequence}`,
    title: "Task",
    status: "open",
    workflow: { id: "openducktor-spec-plan-build", revision: 2 },
  },
  emittedAt: "2026-04-10T13:00:00.000Z",
});

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const flushTaskStream = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

const setElectronApi = (electronApi: OpenDucktorElectronApi | undefined): void => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { openducktorElectron: electronApi },
  });
};

const disabledRemoteAccess: RemoteAccessState = {
  status: "disabled",
  configuration: null,
  connectedClients: null,
  clients: null,
  pairing: null,
};

const downloadedUpdate: AppUpdateCommandResult = {
  accepted: true,
  state: {
    status: "downloaded",
    currentVersion: "0.4.2",
    availableVersion: "0.4.3",
    progressPercent: 100,
  },
};

const createElectronApi = () => {
  const unsubscribe = mock(() => {});
  const unsubscribeAppUpdates = mock(() => {});
  let appUpdateListener:
    | Parameters<OpenDucktorElectronApi["appUpdates"]["subscribe"]>[0]
    | undefined;
  const electronApi = {
    getArtifactPreviewEnvironment: mock(async () => ({
      bootstrapUrl: "odt-artifact-preview://bootstrap",
      scriptedHtml: { supported: true as const },
    })),
    platform: "darwin" as const,
    selectHost: mock(async () => {}),
    setNativeTheme: mock(async (_theme: ThemePreference) => {}),
    hostChannelEndpoint: mock(async () => ({ url: CHANNEL_URL, token: CHANNEL_TOKEN })),
    remoteAccess: {
      readState: mock(async () => disabledRemoteAccess),
      readNetworks: mock(async () => []),
      enable: mock(async () => disabledRemoteAccess),
      disable: mock(async () => disabledRemoteAccess),
      revokeClient: mock(async () => disabledRemoteAccess),
      startPairing: mock(async () => disabledRemoteAccess),
      stopPairing: mock(async () => disabledRemoteAccess),
    },
    appUpdates: {
      getState: mock(async (): Promise<AppUpdateState> => ({
        status: "idle",
        currentVersion: "0.4.2",
      })),
      check: mock(
        async (_input: { initiator: "menu" | "settings" }): Promise<AppUpdateCommandResult> => ({
          accepted: true,
          state: {
            status: "upToDate",
            currentVersion: "0.4.2",
            checkedAt: "2026-07-08T22:00:00.000Z",
          },
        }),
      ),
      download: mock(async (): Promise<AppUpdateCommandResult> => downloadedUpdate),
      install: mock(async (): Promise<AppUpdateCommandResult> => downloadedUpdate),
      subscribe: mock((listener: (state: AppUpdateState) => void) => {
        appUpdateListener = listener;
        return unsubscribeAppUpdates;
      }),
    },
    notifications: {
      getCapability: mock(async () => ({
        platform: "electron" as const,
        supported: true,
        permission: "granted" as const,
        canGuaranteeSilent: true,
        canOpenSystemSettings: true,
      })),
      requestPermission: mock(async () => ({
        platform: "electron" as const,
        supported: true,
        permission: "granted" as const,
        canGuaranteeSilent: true,
        canOpenSystemSettings: true,
      })),
      openSystemSettings: mock(async () => {}),
      isAppFocused: mock(async () => false),
      show: mock(async () => ({ status: "shown" as const })),
      subscribeClicks: mock(() => unsubscribe),
    },
    openExternalUrl: mock(async () => {}),
    resolveLocalAttachmentPreviewSrc: mock(async () => "file:///tmp/brief.md"),
    editorClipboard: {
      readText: mock(async (type?: string) => (type ? `typed:${type}` : "plain")),
    },
    terminals: {
      disconnect: mock(async (_clientId: string) => {}),
      send: mock(async (_clientId: string, _frame: Uint8Array) => {}),
      subscribe: mock((_clientId: string, _listener: (frame: Uint8Array) => void) => unsubscribe),
    },
    browser: {
      connect: mock(async (_clientId: string) => {}),
      disconnect: mock(async (_clientId: string) => {}),
      send: mock(async (_clientId: string, _frame: Uint8Array) => {}),
      subscribe: mock((_clientId: string, _listener: (frame: Uint8Array) => void) => unsubscribe),
      setSurface: mock(async (_input: ElectronBrowserSetSurfaceRequest) => {}),
      focusPage: mock(async (_tabId: string) => {}),
      capturePage: mock(async (_tabId: string) => "data:image/png;base64,AAAA"),
      pickFiles: mock(async (_input: { multiple: boolean; accept: readonly string[] }) => [
        "/tmp/photo.png",
      ]),
    },
  } satisfies OpenDucktorElectronApi;
  return {
    electronApi,
    emitAppUpdate(state: Parameters<NonNullable<typeof appUpdateListener>>[0]) {
      if (!appUpdateListener) {
        throw new Error("Expected an app-update subscription before emitting state.");
      }
      appUpdateListener(state);
    },
    unsubscribeAppUpdates,
    unsubscribe,
  };
};

describe("electron shell bridge", () => {
  beforeEach(() => {
    useHost({
      invoke: (command) => ({
        result: command === "agent_session_live_attach" ? liveSnapshot : null,
      }),
    });
    openedSockets.length = 0;
    // The renderer opens its channel with the platform WebSocket.
    function FakeWebSocket(url: string, protocols: string[]) {
      openedSockets.push({ url, protocols });
      return host.createSocket(protocols);
    }
    Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: FakeWebSocket });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: originalWebSocket,
    });
  });

  test("fails fast when the preload bridge was not installed", () => {
    setElectronApi(undefined);

    const error = (() => {
      try {
        createElectronShellBridge();
      } catch (caught) {
        return caught;
      }
      throw new Error("Expected createElectronShellBridge to fail.");
    })();

    expect(error).toBeInstanceOf(ElectronPreloadBridgeUnavailableError);
    if (!(error instanceof Error)) {
      throw new TypeError("Expected an Error instance.");
    }
    expect(error.message).toContain("OpenDucktor Electron preload bridge is unavailable.");
  });

  test("serves host traffic over the channel with the per-launch token", async () => {
    const { electronApi } = createElectronApi();
    setElectronApi(electronApi);
    const bridge = createElectronShellBridge();
    const runEvents = mock(() => {});
    const runtimeChanges = mock(() => {});
    const live = mock(() => {});

    const stopRunEvents = await bridge.subscribeRunEvents(runEvents);
    const stopRuntimeChanges = await bridge.subscribeRuntimeChanges(runtimeChanges);
    const stopLive = await bridge.observeAgentSessionLive({ repoPath: "/repo" }, live);
    const runtimeEvent: HostEventEnvelope = {
      channel: "openducktor://runtime-changed",
      payload: { type: "runtime_impact_changed", runtimeKinds: ["codex"] },
    };
    host.emit(runtimeEvent);
    await settle(() => runtimeChanges.mock.calls.length > 0, "the runtime change");

    expect(bridge.capabilities).toEqual({
      canOpenExternalUrls: true,
      canPreviewLocalAttachments: true,
    });
    expect(await bridge.editorClipboard?.readText()).toBe("plain");
    expect(
      await bridge.editorClipboard?.readText("application/vnd.pierre.diffs-selections+json"),
    ).toBe("typed:application/vnd.pierre.diffs-selections+json");
    // One socket carries every subscription, and it offers the token that main gave this window.
    expect(openedSockets).toEqual([
      {
        url: CHANNEL_URL,
        protocols: [
          HOST_CHANNEL_SUBPROTOCOL,
          `${REMOTE_SOCKET_AUTHORIZATION_PREFIX}${CHANNEL_TOKEN}`,
        ],
      },
    ]);
    expect(runtimeChanges).toHaveBeenCalledWith(runtimeEvent.payload);
    expect(runEvents).not.toHaveBeenCalled();
    expect(host.requests).toContainEqual(
      expect.objectContaining({
        method: "invoke",
        command: "agent_session_live_attach",
        args: { repoPath: "/repo" },
      }),
    );
    expect(live).toHaveBeenCalledWith({ ...liveSnapshot, isConnectionSnapshot: true });

    stopRunEvents();
    stopRuntimeChanges();
    stopLive();
    // Nothing uses the channel any more, so it closes.
    await settle(() => host.sockets.every((socket) => socket.closed), "the channel close");
  });

  test("reports rejected host event listeners without stopping delivery", async () => {
    const { electronApi } = createElectronApi();
    setElectronApi(electronApi);
    const failure = new Error("Runtime event failed.");
    const listener = mock(() => Promise.reject(failure));
    const report = spyOn(console, "error").mockImplementation(() => {});
    try {
      const stop = await createElectronShellBridge().subscribeRuntimeChanges(listener);
      const event = {
        channel: "openducktor://runtime-changed",
        payload: { type: "runtime_impact_changed", runtimeKinds: ["codex"] },
      } satisfies HostEventEnvelope;
      host.emit(event);
      await settle(() => report.mock.calls.length > 0, "the listener report");
      expect(listener).toHaveBeenCalledWith(event.payload);
      expect(report).toHaveBeenCalledWith("Host event listener failed.", failure);
      stop();
    } finally {
      report.mockRestore();
    }
  });

  test("delivers and acknowledges task stream frames over the channel", async () => {
    const boundary = taskStreamCursor(3);
    const snapshot: TaskEventStreamFrame = {
      type: "snapshot_required",
      cursor: boundary,
      reason: "buffer_gap",
    };
    useHost({ taskBoundary: boundary, initialTaskFrames: () => [snapshot] });
    const { electronApi } = createElectronApi();
    setElectronApi(electronApi);
    const frames: unknown[] = [];

    const subscription = await createElectronShellBridge().subscribeTaskStream(
      { cursor: null },
      (frame) => frames.push(frame),
    );
    await settle(() => frames.length === 1, "the task frame");
    await subscription.acknowledge(boundary);
    await subscription.unsubscribe();

    expect(frames).toEqual([snapshot]);
    expect(host.requests.map((request) => request.method)).toEqual([
      "events.open",
      "task_events.subscribe",
      "task_events.ack",
      "task_events.release",
    ]);
  });

  test("delivers remote control state from the channel and operations through the preload", async () => {
    const { electronApi } = createElectronApi();
    setElectronApi(electronApi);
    const bridge = createElectronShellBridge();
    const states: RemoteAccessState[] = [];
    if (!bridge.remoteAccess) throw new Error("Expected the local remote access bridge.");

    const stop = await bridge.remoteAccess.subscribeState((state) => states.push(state));
    await settle(
      () => host.requests.some((request) => request.method === "remote_access.observe"),
      "the remote access observation",
    );
    host.remoteAccessState(disabledRemoteAccess);
    await settle(() => states.length === 1, "the remote access state");
    await bridge.remoteAccess.disable();
    stop();

    expect(states).toEqual([disabledRemoteAccess]);
    expect(electronApi.remoteAccess.disable).toHaveBeenCalledTimes(1);
  });

  test("supersedes an in-flight change with the host overflow snapshot without acknowledging the obsolete cursor", async () => {
    const failures: unknown[] = [];
    let nextSubscriptionId = 0;
    const stream = createTaskEventStream({
      epochFactory: () => taskStreamEpoch,
      reporter: { report: (failure) => failures.push(failure) },
      subscriptionIdFactory: () =>
        ["22222222-2222-4222-8222-222222222222"][nextSubscriptionId++] ?? crypto.randomUUID(),
    });
    const acknowledgements: TaskEventCursor[] = [];
    const firstChangeStarted = deferred<void>();
    const finishFirstChange = deferred<void>();
    const reconcileExternalEvent = mock(async (event: ExternalTaskSyncEvent) => {
      if (event.kind === "external_task_created" && event.taskId === "task-1") {
        firstChangeStarted.resolve();
        await finishFirstChange.promise;
      }
    });
    const workspace: WorkspaceRef = { workspaceId: "repo", repoPath: "/repo" };
    const snapshotTaskIds = new Map<WorkspaceRef, string[]>([[workspace, ["task-1"]]]);
    const reconcileStreamSnapshot = mock(
      async (_openRepoPaths: readonly WorkspaceRef[]): Promise<TaskSnapshotResult> => ({
        taskIdsByRepo: snapshotTaskIds,
        failures: new Map(),
      }),
    );
    const admitAgentSessionExternalEvent = mock(async (event: ExternalTaskSyncEvent) => ({
      repoPath: { workspaceId: event.workspaceId, repoPath: event.repoPath },
      changedTaskIds: [],
    }));
    const reconcileAgentSessionStreamSnapshot = mock(
      async (_taskIdsByRepo: ReadonlyMap<WorkspaceRef, string[]>, _isCurrentOwner: () => boolean) =>
        new Map<WorkspaceRef, unknown>(),
    );
    const controller = createTaskStreamController({
      transport: {
        subscribeTaskStream: async (input, onFrame) => {
          const subscription = stream.subscribe(input, onFrame);
          return {
            subscriptionId: subscription.subscriptionId,
            acknowledge: async (cursor) => {
              acknowledgements.push(cursor);
              stream.acknowledge({ subscriptionId: subscription.subscriptionId, cursor });
            },
            unsubscribe: async () => subscription.unsubscribe(),
          };
        },
      },
      taskViewSync: {
        refreshAfterTaskRetentionChange: async () => {},
        releaseWorkspace: async () => {},
        loadWorkspace: async () => {},
        refreshManually: async () => {},
        refreshDocumentsForTasks: async () => {},
        reconcileExternalEvent,
        reconcileStreamSnapshot,
      },
      agentSessionViewSync: {
        admitExternalEvent: admitAgentSessionExternalEvent,
        completeExternalEvents: async (changes) => {
          await Promise.all(changes);
        },
        cancelReads: () => {},
        reconcileStreamSnapshot: reconcileAgentSessionStreamSnapshot,
        releaseWorkspace: async () => {},
      },
      getOpenRepoPaths: () => [workspace],
      onDegraded: (error) => failures.push(error),
      onWorkspaceFailures: (workspaceFailures) => failures.push(...workspaceFailures.values()),
    });

    await controller.start();
    await flushTaskStream();
    expect(acknowledgements).toEqual([taskStreamCursor(0)]);
    reconcileStreamSnapshot.mockClear();
    reconcileAgentSessionStreamSnapshot.mockClear();

    stream.publish(taskStreamEvent(1));
    await firstChangeStarted.promise;
    for (let sequence = 2; sequence <= 258; sequence += 1) {
      stream.publish(taskStreamEvent(sequence));
    }
    await flushTaskStream();
    finishFirstChange.resolve();
    await flushTaskStream();

    expect(reconcileExternalEvent).toHaveBeenCalledTimes(1);
    expect(admitAgentSessionExternalEvent).toHaveBeenCalledWith(taskStreamEvent(1));
    expect(reconcileStreamSnapshot).toHaveBeenCalledWith([workspace]);
    expect(reconcileAgentSessionStreamSnapshot).toHaveBeenCalledWith(
      snapshotTaskIds,
      expect.any(Function),
    );
    expect(acknowledgements).toEqual([taskStreamCursor(0), taskStreamCursor(258)]);
    expect(failures).toEqual([]);

    await controller.stop();
  });

  test("delivers changes received during live-session attachment after its snapshot", async () => {
    let resolveAttach: (snapshot: AgentSessionLiveSnapshotEnvelope) => void = () => {};
    const attachRequested = deferred<void>();
    useHost({
      invoke: (command) =>
        command === "agent_session_live_attach"
          ? new Promise((resolve) => {
              resolveAttach = (value) => resolve({ result: value });
              attachRequested.resolve();
            })
          : { result: null },
    });
    const { electronApi } = createElectronApi();
    setElectronApi(electronApi);
    const bridge = createElectronShellBridge();
    const listener = mock((_envelope: AgentSessionLiveEnvelope) => {});

    const observing = bridge.observeAgentSessionLive({ repoPath: "/repo" }, listener);
    await attachRequested.promise;
    const sessionRef = {
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo/worktree",
      externalSessionId: "child-thread",
    } as const;
    const transcriptEvent = {
      type: "transcript_event",
      event: {
        type: "assistant_message",
        externalSessionId: "child-thread",
        messageId: "assistant-1",
        message: "New child output",
        timestamp: "2026-07-17T08:00:00.000Z",
        sessionRef,
      },
    } as const;
    const coveredRemoval = { type: "session_removed", ref: sessionRef, sequence: 4 } as const;
    const newerRemoval = { ...coveredRemoval, sequence: 6 };
    const snapshot: AgentSessionLiveSnapshotEnvelope = { ...liveSnapshot, sequence: 5 };
    const eventName = liveSessionStreamEventName("/repo");

    for (const payload of [coveredRemoval, transcriptEvent, newerRemoval])
      host.emit({ channel: "openducktor://agent-session-live-event", payload }, eventName);
    await settle(
      () => host.sockets[0]?.requests.length === 2,
      "the events open and attach requests",
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(listener).not.toHaveBeenCalled();
    resolveAttach(snapshot);
    const stop = await observing;

    expect(listener.mock.calls.map(([envelope]) => envelope)).toEqual([
      { ...snapshot, isConnectionSnapshot: true },
      transcriptEvent,
      newerRemoval,
    ]);
    stop();
  });

  test("uses the preload bridge for app update state and actions", async () => {
    const { electronApi, emitAppUpdate, unsubscribeAppUpdates } = createElectronApi();
    setElectronApi(electronApi);

    const bridge = createElectronShellBridge();
    const listener = mock(() => {});
    const unsubscribe = await bridge.appUpdates.subscribeState(listener);

    await expect(bridge.appUpdates.getState()).resolves.toEqual({
      status: "idle",
      currentVersion: "0.4.2",
    });
    await bridge.appUpdates.check({ initiator: "settings" });
    await bridge.appUpdates.download();
    await bridge.appUpdates.install();
    emitAppUpdate({
      status: "available",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    unsubscribe();

    expect(electronApi.appUpdates.subscribe).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      status: "available",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    expect(electronApi.appUpdates.check).toHaveBeenCalledWith({ initiator: "settings" });
    expect(electronApi.appUpdates.download).toHaveBeenCalled();
    expect(electronApi.appUpdates.install).toHaveBeenCalled();
    expect(unsubscribeAppUpdates).toHaveBeenCalled();
  });

  test("uses the preload bridge for native browser pages", async () => {
    const { electronApi, unsubscribe } = createElectronApi();
    setElectronApi(electronApi);
    const bridge = createElectronShellBridge();
    if (bridge.browser.surface !== "electron") {
      throw new Error("Expected the Electron browser bridge.");
    }
    const onFrame = mock(() => {});
    const onStateChange = mock((_state: "connected" | "disconnected") => {});
    const listener = mock(() => {});

    const stopTabEvents = await bridge.subscribeBrowserTabEvents(listener);
    const connection = await bridge.browser.connect(onFrame, onStateChange, () => {});
    const clientId = electronApi.browser.connect.mock.calls[0]?.[0];
    await connection.send(new Uint8Array([1]));
    await connection.close();
    const tabId = "11111111-1111-4111-8111-111111111111";
    const bounds = { x: 1, y: 2, width: 300, height: 200 };
    await bridge.browser.setSurface({ tabId, visible: true, bounds });
    await bridge.browser.focusPage(tabId);
    const snapshot = await bridge.browser.capturePage(tabId);
    const paths = await bridge.browser.pickFiles({ multiple: true, accept: [".png"] });

    expect(host.requests.map((request) => request.method)).toEqual(["events.open"]);
    stopTabEvents();
    expect(electronApi.browser.subscribe).toHaveBeenCalledWith(clientId, onFrame);
    expect(electronApi.browser.send).toHaveBeenCalledWith(clientId, new Uint8Array([1]));
    expect(electronApi.browser.disconnect).toHaveBeenCalledWith(clientId);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(onStateChange.mock.calls).toEqual([["connected"], ["disconnected"]]);
    expect(electronApi.browser.setSurface).toHaveBeenCalledWith({ tabId, visible: true, bounds });
    expect(electronApi.browser.focusPage).toHaveBeenCalledWith(tabId);
    expect(electronApi.browser.capturePage).toHaveBeenCalledWith(tabId);
    expect(snapshot).toBe("data:image/png;base64,AAAA");
    expect(paths).toEqual(["/tmp/photo.png"]);
  });

  test("uses the preload bridge for shell actions", async () => {
    const { electronApi } = createElectronApi();
    setElectronApi(electronApi);

    const bridge = createElectronShellBridge();
    await bridge.notifications.openSystemSettings();
    await bridge.openExternalUrl("https://openducktor.local/docs");
    await expect(
      bridge.resolveLocalAttachmentPreview("brief.md", new AbortController().signal),
    ).resolves.toEqual({ kind: "url", src: "file:///tmp/brief.md" });

    expect(electronApi.notifications.openSystemSettings).toHaveBeenCalledTimes(1);
    expect(electronApi.openExternalUrl).toHaveBeenCalledWith("https://openducktor.local/docs");
    expect(electronApi.resolveLocalAttachmentPreviewSrc).toHaveBeenCalledWith("brief.md");
  });

  test("reconstructs structured host failures in the renderer realm", async () => {
    useHost({
      invoke: () => ({
        error: {
          kind: "host",
          response: {
            message: "Terminal creation is unavailable.",
            failure: {
              kind: "terminal",
              terminalFailure: {
                code: "unsupported_runtime",
                message: "Interactive terminals are unavailable in this runtime.",
              },
            },
          },
        },
      }),
    });
    const { electronApi } = createElectronApi();
    setElectronApi(electronApi);

    const bridge = createElectronShellBridge();
    let error: unknown;
    try {
      await bridge.client.terminalCreate({ workingDir: "/repo", context: {} });
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(HostTerminalClientError);
    expect(error).toMatchObject({
      code: "unsupported_runtime",
      message: "Interactive terminals are unavailable in this runtime.",
    });
  });

  test("preserves workspace write failures in the renderer realm", async () => {
    useHost({
      invoke: () => ({
        error: {
          kind: "host",
          response: {
            message: "The file changed after it was loaded.",
            failure: {
              kind: "workspace_text_file_write",
              workspaceTextFileWriteFailure: {
                code: "stale_revision",
                message: "The file changed after it was loaded.",
                rootPath: "/repo",
                relativePath: "src/file.ts",
              },
            },
          },
        },
      }),
    });
    const { electronApi } = createElectronApi();
    setElectronApi(electronApi);

    let error: unknown;
    try {
      await createElectronShellBridge().client.filesystemWriteTextFile({
        rootPath: "/repo",
        relativePath: "src/file.ts",
        contents: "draft",
        revision: "sha256:old",
      });
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(HostInvokeError);
    expect(error).toMatchObject({
      failure: {
        kind: "workspace_text_file_write",
        workspaceTextFileWriteFailure: { code: "stale_revision" },
      },
    });
  });
});

test("the remote theme client keeps every other host command", async () => {
  const host = createHostClient(async (command, _args, schema) =>
    schema.parse(command === "runtime_definitions_list" ? [] : undefined),
  );
  const client = withElectronNativeTheme(host, async () => {});

  expect(await client.runtimeDefinitionsList()).toEqual([]);
});

test.each(["read", "write"])(
  "remote theme %s updates local chrome only after host success",
  async (action) => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let failure: Error | null = null;
    const snapshot = settingsSnapshotSchema.parse({
      theme: "dark",
      agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    });
    const host = createHostClient(async (command, _args, schema) => {
      await pending;
      if (failure) throw failure;
      return schema.parse(command === "workspace_get_settings_snapshot" ? snapshot : undefined);
    });
    const applyTheme = mock(async () => {});
    const client = withElectronNativeTheme(host, applyTheme);
    const run = () =>
      action === "read" ? client.workspaceGetSettingsSnapshot() : client.setTheme("dark");
    const result = run();
    expect(applyTheme).not.toHaveBeenCalled();
    finish();
    await result;
    expect(applyTheme).toHaveBeenCalledWith("dark");
    failure = new Error("The host refused the command.");
    expect(await run().catch((cause: unknown) => cause)).toBe(failure);
    expect(applyTheme).toHaveBeenCalledTimes(1);
  },
);

test("a remote host bridge previews artifacts through the desktop protocol", async () => {
  const { electronApi } = createElectronApi();
  const desktop = {
    bootstrapUrl: "odt-artifact-preview://bootstrap",
    scriptedHtml: { supported: true as const },
  };
  setElectronApi({ ...electronApi, getArtifactPreviewEnvironment: async () => desktop });
  const remote = createElectronShellBridge();

  const bridge = withElectronDesktopShell({
    ...remote,
    // The browser shell bridge builds this URL from the renderer origin, which is file:// here.
    getArtifactPreviewEnvironment: async () => ({
      bootstrapUrl: "file:///artifact-preview-bootstrap",
      scriptedHtml: { supported: true },
    }),
  });

  expect(await bridge.getArtifactPreviewEnvironment()).toEqual(desktop);
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});

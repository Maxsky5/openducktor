import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ExternalTaskSyncEvent, TaskEventCursor } from "@openducktor/contracts";
import { HostTerminalClientError } from "@openducktor/host-client";
import { createTaskStreamController } from "../../../../packages/frontend/src/state/tasks/task-stream-controller";
import { createTaskEventStream } from "../../../../packages/host/src/events/task-event-stream";
import type { OpenDucktorElectronApi } from "../shared/electron-bridge-contract";
import {
  createElectronShellBridge,
  ElectronPreloadBridgeUnavailableError,
} from "./electron-shell-bridge";

const originalWindow = globalThis.window;

const taskStreamEpoch = "11111111-1111-4111-8111-111111111111";
const taskStreamCursor = (sequence: number): TaskEventCursor => ({
  epoch: taskStreamEpoch,
  sequence,
});
const taskStreamEvent = (sequence: number): ExternalTaskSyncEvent => ({
  eventId: `event-${sequence}`,
  kind: "external_task_created",
  repoPath: "/repo",
  taskId: `task-${sequence}`,
  emittedAt: "2026-04-10T13:00:00.000Z",
});

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
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

const createElectronApi = (): {
  electronApi: OpenDucktorElectronApi;
  unsubscribeAppUpdates: ReturnType<typeof mock>;
  unsubscribe: ReturnType<typeof mock>;
  unsubscribeTaskStream: ReturnType<typeof mock>;
} => {
  const unsubscribe = mock(() => {});
  const unsubscribeAppUpdates = mock(() => {});
  const unsubscribeTaskStream = mock(() => {});
  return {
    electronApi: {
      invoke: mock(async () => ({ ok: true as const, value: {} })),
      subscribe: mock(() => unsubscribe),
      appUpdates: {
        getState: mock(async () => ({ status: "idle", currentVersion: "0.4.2" })),
        check: mock(async () => ({
          accepted: true,
          state: {
            status: "upToDate",
            currentVersion: "0.4.2",
            checkedAt: "2026-07-08T22:00:00.000Z",
          },
        })),
        download: mock(async () => ({
          accepted: true,
          state: {
            status: "downloaded",
            currentVersion: "0.4.2",
            availableVersion: "0.4.3",
            progressPercent: 100,
          },
        })),
        install: mock(async () => ({
          accepted: true,
          state: {
            status: "downloaded",
            currentVersion: "0.4.2",
            availableVersion: "0.4.3",
            progressPercent: 100,
          },
        })),
        subscribe: mock(() => unsubscribeAppUpdates),
      },
      openExternalUrl: mock(async () => {}),
      resolveLocalAttachmentPreviewSrc: mock(async () => "file:///tmp/brief.md"),
      taskStream: {
        subscribe: mock(async () => ({
          acknowledge: mock(async () => {}),
          subscriptionId: "22222222-2222-4222-8222-222222222222",
          unsubscribe: unsubscribeTaskStream,
        })),
      },
      terminals: {
        disconnect: mock(async () => {}),
        send: mock(async () => {}),
        subscribe: mock(() => unsubscribe),
      },
    },
    unsubscribeAppUpdates,
    unsubscribe,
    unsubscribeTaskStream,
  };
};

describe("electron shell bridge", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
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
    expect((error as Error).message).toContain(
      "OpenDucktor Electron preload bridge is unavailable.",
    );
  });

  test("uses the preload bridge for event subscriptions and shell capabilities", async () => {
    const { electronApi, unsubscribe: unsubscribeSpy } = createElectronApi();
    setElectronApi(electronApi);

    const bridge = createElectronShellBridge();
    const listener = mock(() => {});
    const onTerminalFailure = mock((_error: unknown) => {});
    const unsubscribeRunEvents = await bridge.subscribeRunEvents(listener);
    const devServerSubscription = await bridge.subscribeDevServerEvents(listener);
    const stopObservingLiveSessions = await bridge.observeAgentSessionLive(
      { repoPath: "/repo" },
      listener,
    );
    const taskStreamSubscription = await bridge.subscribeTaskStream(
      { cursor: null },
      listener,
      onTerminalFailure,
    );

    expect(bridge.capabilities).toEqual({
      canOpenExternalUrls: true,
      canPreviewLocalAttachments: true,
    });
    expect(electronApi.subscribe).toHaveBeenCalledWith("openducktor://run-event", listener);
    expect(electronApi.subscribe).toHaveBeenCalledWith("openducktor://dev-server-event", listener);
    expect(electronApi.taskStream.subscribe).toHaveBeenCalledWith(
      { cursor: null },
      listener,
      onTerminalFailure,
    );
    expect(electronApi.subscribe).toHaveBeenCalledWith(
      "openducktor://agent-session-live-event",
      expect.any(Function),
    );
    expect(electronApi.invoke).toHaveBeenCalledWith("agent_session_live_refresh", {
      repoPath: "/repo",
    });

    unsubscribeRunEvents();
    expect(devServerSubscription.transportEpoch).toMatch(/^electron:\d+$/);
    devServerSubscription.unsubscribe();
    stopObservingLiveSessions();
    taskStreamSubscription.unsubscribe();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(3);
  });

  test("forwards task stream frames without mutating client task metadata", async () => {
    const { electronApi } = createElectronApi();
    setElectronApi(electronApi);
    const bridge = createElectronShellBridge();
    const reconcile = mock(() => {});
    bridge.client.reconcileExternalTaskSyncEvent = reconcile;
    const listener = mock(() => {});

    await bridge.subscribeTaskStream({ cursor: null }, listener);

    expect(electronApi.taskStream.subscribe).toHaveBeenCalledWith(
      { cursor: null },
      listener,
      undefined,
    );
    expect(reconcile).not.toHaveBeenCalled();
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
    const reconcileStreamSnapshot = mock(async () => {});
    const invalidateAllTaskMetadata = mock(() => {});
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
      metadata: {
        reconcileExternalTaskSyncEvent: mock(() => {}),
        invalidateAllTaskMetadata,
      },
      taskViewSync: {
        loadWorkspace: async () => {},
        refreshManually: async () => {},
        refreshAfterLocalMutation: async () => {},
        reconcileExternalEvent,
        reconcileStreamSnapshot,
      },
      getActiveRepoPath: () => "/repo",
      onDegraded: (error) => failures.push(error),
    });

    await controller.start();
    await flushTaskStream();
    expect(acknowledgements).toEqual([taskStreamCursor(0)]);
    reconcileStreamSnapshot.mockClear();
    invalidateAllTaskMetadata.mockClear();

    stream.publish(taskStreamEvent(1));
    await firstChangeStarted.promise;
    for (let sequence = 2; sequence <= 257; sequence += 1) {
      stream.publish(taskStreamEvent(sequence));
    }
    await flushTaskStream();
    finishFirstChange.resolve();
    await flushTaskStream();

    expect(reconcileExternalEvent).toHaveBeenCalledTimes(1);
    expect(reconcileStreamSnapshot).toHaveBeenCalledWith("/repo");
    expect(invalidateAllTaskMetadata).toHaveBeenCalledTimes(1);
    expect(acknowledgements).toEqual([taskStreamCursor(0), taskStreamCursor(257)]);
    expect(failures).toEqual([]);

    await controller.stop();
  });

  test("delivers transcript events received during live-session attachment after its snapshot", async () => {
    const { electronApi } = createElectronApi();
    setElectronApi(electronApi);
    const bridge = createElectronShellBridge();
    const listener = mock(() => {});

    await bridge.observeAgentSessionLive({ repoPath: "/repo" }, listener);
    const subscription = (electronApi.subscribe as ReturnType<typeof mock>).mock.calls.find(
      ([channel]) => channel === "openducktor://agent-session-live-event",
    )?.[1] as ((payload: unknown) => void) | undefined;
    if (!subscription) {
      throw new Error("Expected live-session subscription.");
    }
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
    };
    const snapshot = { type: "snapshot", repoPath: "/repo", sessions: [] };

    subscription(transcriptEvent);
    expect(listener).not.toHaveBeenCalled();
    subscription(snapshot);

    expect(listener.mock.calls.map(([envelope]) => envelope)).toEqual([snapshot, transcriptEvent]);
  });

  test("uses the preload bridge for app update state and actions", async () => {
    const { electronApi, unsubscribeAppUpdates } = createElectronApi();
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
    const appUpdateListener = (electronApi.appUpdates.subscribe as ReturnType<typeof mock>).mock
      .calls[0]?.[0];
    appUpdateListener?.({
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

  test("uses the preload bridge for shell actions", async () => {
    const { electronApi } = createElectronApi();
    setElectronApi(electronApi);

    const bridge = createElectronShellBridge();
    await bridge.openExternalUrl("https://openducktor.local/docs");
    await expect(bridge.resolveLocalAttachmentPreviewSrc("brief.md")).resolves.toBe(
      "file:///tmp/brief.md",
    );

    expect(electronApi.openExternalUrl).toHaveBeenCalledWith("https://openducktor.local/docs");
    expect(electronApi.resolveLocalAttachmentPreviewSrc).toHaveBeenCalledWith("brief.md");
  });

  test("reconstructs structured host failures in the renderer realm", async () => {
    const { electronApi } = createElectronApi();
    electronApi.invoke = mock(async () => ({
      ok: false,
      error: {
        message: "Terminal creation is unavailable.",
        failure: {
          kind: "terminal",
          terminalFailure: {
            code: "unsupported_runtime",
            message: "Interactive terminals are unavailable in this runtime.",
          },
        },
      },
    }));
    setElectronApi(electronApi);

    const bridge = createElectronShellBridge();
    const result = await bridge.client.terminalCreate({ workingDir: "/repo", context: {} }).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected terminalCreate to reject.");
    expect(result.error).toBeInstanceOf(HostTerminalClientError);
    expect(result.error).toMatchObject({
      code: "unsupported_runtime",
      message: "Interactive terminals are unavailable in this runtime.",
    });
  });
});

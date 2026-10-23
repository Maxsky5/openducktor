import assert from "node:assert/strict";
import {
  REMOTE_BASELINE_CAPABILITIES,
  REMOTE_PROTOCOL_VERSION,
  type ExternalTaskSyncEvent,
  type HostRuntimeSnapshot,
  type RemoteHostDescriptor,
} from "@openducktor/contracts";
import type { RemoteTransport } from "@openducktor/host-client/remote";
import { createClientQueryClient } from "@openducktor/frontend-core/connection/client-query-client";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { createHostRuntimeStatusOwner } from "@openducktor/frontend-core/runtime/host-runtime-status-owner";
import { createHostMcpBridgeStatusFixture } from "../../frontend/src/test-utils/shared-test-fixtures";
import { createTaskStreamController } from "@openducktor/frontend-core/tasks/task-stream-controller";
import { createUnavailableShellBridge } from "@openducktor/frontend/lib/shell-bridge";
import { createRemoteShellBridge } from "@openducktor/frontend/lib/remote/shell-bridge";

const page = Object.assign(new EventTarget(), { location: { origin: "https://host.test" } });
Object.defineProperty(globalThis, "window", { configurable: true, value: page });
Object.defineProperty(globalThis, "document", { configurable: true, value: new EventTarget() });
const host: RemoteHostDescriptor = {
  shell: "web",
  appVersion: "test-host",
  hostInstanceId: "host-a",
  accessPolicy: "network_reach",
  protocols: [
    { version: REMOTE_PROTOCOL_VERSION, capabilities: [...REMOTE_BASELINE_CAPABILITIES] },
  ],
};
const snapshot: HostRuntimeSnapshot = {
  hostInstanceId: "host-a",
  runtimes: [],
  mcpBridge: createHostMcpBridgeStatusFixture(),
};
const json = <T>(value: T, status = 200) => ({
  status,
  headers: {},
  body: (async function* () {
    if (status !== 204) yield new TextEncoder().encode(JSON.stringify(value));
  })(),
});

for (const { readFails, firstFailure, stopDuringReplay } of [
  { readFails: false, firstFailure: "remote_disabled", stopDuringReplay: false },
  { readFails: true, firstFailure: "remote_disabled", stopDuringReplay: false },
  { readFails: false, firstFailure: "task_subscription", stopDuringReplay: false },
  { readFails: false, firstFailure: "remote_disabled", stopDuringReplay: true },
]) {
  let available = firstFailure === "task_subscription";
  let taskSetupFailed = firstFailure !== "task_subscription";
  let runtimeReads = 0;
  let taskSubscriptions = 0;
  let deliverTask = (_frame: string) => {};
  const taskSnapshotStarted = Promise.withResolvers<void>();
  const taskSnapshotGate = Promise.withResolvers<void>();
  const taskAckStarted = Promise.withResolvers<void>();
  const taskAckGate = Promise.withResolvers<void>();
  const taskChanged = Promise.withResolvers<void>();
  const sessionsChanged = Promise.withResolvers<void>();
  const cursor = { epoch: crypto.randomUUID(), sequence: 0 };
  const runtimeStarted = Promise.withResolvers<void>();
  const runtimeGate = Promise.withResolvers<HostRuntimeSnapshot>();
  const transport: RemoteTransport = {
    async request(method, url, _headers, signal) {
      if (method === "DELETE") return json(null, 204);
      if (url.endsWith("/remote")) {
        if (!available)
          return json(
            {
              status: "rejected",
              failure: {
                code: "remote_disabled",
                message: "Remote access is disabled.",
                nextAction: "Ask the host operator to enable remote access.",
              },
            },
            503,
          );
        return json(host);
      }
      if (url.endsWith("/connections"))
        return json({
          status: "accepted",
          host,
          connectionId: crypto.randomUUID(),
          protocolVersion: REMOTE_PROTOCOL_VERSION,
          missingOptionalCapabilities: [],
        });
      if (url.endsWith("/events"))
        return {
          status: 200,
          headers: {},
          body: (async function* () {
            yield new TextEncoder().encode(
              `event: replay-complete\ndata: ${JSON.stringify({ hostChanged: false, gaps: [] })}\n\nevent: notification-frame\ndata: ${JSON.stringify({ type: "attached", cursor: { epoch: crypto.randomUUID(), sequence: 0 }, reason: "new", health: [] })}\n\n`,
            );
            await new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => resolve(), { once: true });
              if (signal.aborted) resolve();
            });
          })(),
        };
      if (url.endsWith("/invoke/runtime_status")) {
        runtimeReads += 1;
        runtimeStarted.resolve();
        try {
          return json(await runtimeGate.promise);
        } catch {
          return json({ error: "host_command_failed", message: "Runtime read failed." }, 500);
        }
      }
      if (url.endsWith("/task-events/subscriptions")) {
        if (!taskSetupFailed) {
          taskSetupFailed = true;
          return json(
            { error: "host_command_failed", message: "Task subscription setup failed." },
            500,
          );
        }
        taskSubscriptions += 1;
        return json({ subscriptionId: crypto.randomUUID(), replayBoundary: cursor });
      }
      if (url.endsWith("/stream"))
        return {
          status: 200,
          headers: {},
          body: (async function* () {
            yield new TextEncoder().encode(
              `event: task-frame\ndata: ${JSON.stringify({ type: "snapshot_required", cursor, reason: "buffer_gap" })}\n\n`,
            );
            while (!signal.aborted) {
              const frame = await new Promise<string>((resolve, reject) => {
                deliverTask = resolve;
                signal.addEventListener("abort", () => reject(signal.reason), { once: true });
                if (signal.aborted) reject(signal.reason);
              });
              yield new TextEncoder().encode(frame);
            }
          })(),
        };
      if (url.endsWith("/ack")) {
        taskAckStarted.resolve();
        await taskAckGate.promise;
        return json(null, 204);
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    },
    openTerminal: async () => {
      throw new Error("No terminal was selected.");
    },
  };
  const queryClient = createClientQueryClient();
  const bridge = createRemoteShellBridge({
    endpoint: "https://host.test/remote",
    version: "test-browser",
    transport,
    notifications: createUnavailableShellBridge().notifications,
    queryClient,
  });
  const clientConnection = createTestClientConnection({ host: bridge, queryClient });
  const connection = bridge.remoteConnection!;
  const controller = createTaskStreamController({
    transport: bridge,
    taskViewSync: {
      loadWorkspace: async () => {},
      refreshManually: async () => {},
      refreshAfterTaskRetentionChange: async () => {},
      refreshDocumentsForTasks: async () => {},
      reconcileExternalEvent: async () => {
        taskChanged.resolve();
      },
      reconcileStreamSnapshot: async () => {
        taskSnapshotStarted.resolve();
        await taskSnapshotGate.promise;
        return { taskIdsByRepo: new Map([["/repo", []]]), failures: new Map() };
      },
      releaseWorkspace: async () => {},
    },
    agentSessionViewSync: {
      cancelReads: () => {},
      releaseWorkspace: async () => {},
      reconcileStreamSnapshot: async () => new Map(),
      admitExternalEvent: async (event) => ({
        repoPath: event.repoPath,
        changedTaskIds: [],
      }),
      completeExternalEvents: async (changes) => {
        await Promise.all(changes);
        sessionsChanged.resolve();
      },
    },
    getOpenRepoPaths: () => ["/repo"],
    onDegraded: (cause) => {
      throw cause;
    },
    onWorkspaceFailures: () => {},
  });
  const started = controller.start().catch((cause: unknown) => cause);
  const failed = Promise.withResolvers<void>();
  const stopState = connection.subscribeState((state) => {
    if (state.status === "failed") failed.resolve();
  });
  const owner = createHostRuntimeStatusOwner({
    queryClient,
    ports: {
      subscribeRuntimeChanges: bridge.subscribeRuntimeChanges,
      runtimeStatus: () => bridge.client.runtimeStatus(),
    },
  });
  const firstRead = Promise.withResolvers<void>();
  const stopOwner = owner.subscribeConnection(() => {
    if (owner.getConnection().readError !== null) firstRead.resolve();
  });
  try {
    await failed.promise;
    const canceled = new AbortController();
    const canceledSubscription = bridge
      .subscribeTaskStream(
        { cursor: null },
        () => {
          throw new Error("Canceled task subscription received a frame.");
        },
        undefined,
        canceled.signal,
      )
      .catch(() => null);
    canceled.abort();
    await (await canceledSubscription)?.unsubscribe();
    owner.start();
    await firstRead.promise;
    assert.equal(owner.getConnection().hasBaseline, false);
    assert.equal(runtimeReads, 0);
    available = true;
    const retry = connection.retry().then(
      () => null,
      (cause: unknown) => cause,
    );
    await Promise.race([
      taskSnapshotStarted.promise,
      runtimeStarted.promise.then(() => {
        throw new Error("Runtime recovery started without task delivery.");
      }),
      retry.then(() => {
        throw new Error("Connection completed without task delivery.");
      }),
    ]);
    assert.equal(taskSubscriptions, 1);
    assert.equal(connection.readState().status, "synchronizing");
    assert.equal(runtimeReads, 0);
    taskSnapshotGate.resolve();
    await taskAckStarted.promise;
    assert.equal(connection.readState().status, "synchronizing");
    assert.equal(runtimeReads, 0);
    if (stopDuringReplay) await controller.stop();
    taskAckGate.resolve();
    await Promise.race([
      runtimeStarted.promise,
      retry.then(() => {
        throw new Error("Connection completed before runtime recovery started.");
      }),
    ]);
    assert.equal(connection.readState().status, "synchronizing");
    assert.equal(owner.getConnection().hasBaseline, false);
    if (readFails) runtimeGate.reject(new Error("Runtime unavailable."));
    else runtimeGate.resolve(snapshot);
    const cause = await retry;
    assert.equal(runtimeReads, 1);
    if (readFails) {
      assert.ok(cause);
      assert.equal(connection.readState().status, "failed");
      assert.equal(connection.readState().failure?.code, "synchronization_failed");
    } else {
      assert.equal(cause, null);
      assert.equal(connection.readState().status, "connected");
      assert.equal(owner.getConnection().hasBaseline, true);
      assert.equal(owner.getConnection().readError, null);
      assert.equal(owner.getConnection().streamError, null);
      if (!stopDuringReplay) {
        const event: ExternalTaskSyncEvent = {
          kind: "external_task_created",
          eventId: "after-retry",
          boardChanges: null,
          repoPath: "/repo",
          taskId: "task",
          taskSnapshot: { id: "task", title: "After retry", status: "open" },
          emittedAt: "2026-10-14T12:00:00.000Z",
        };
        deliverTask(
          `event: task-frame\ndata: ${JSON.stringify({ type: "change", cursor: { ...cursor, sequence: 1 }, event })}\n\n`,
        );
        await Promise.all([taskChanged.promise, sessionsChanged.promise]);
      }
    }
  } finally {
    taskSnapshotGate.resolve();
    taskAckGate.resolve();
    runtimeGate.resolve(snapshot);
    await controller.stop();
    await started;
    stopState();
    stopOwner();
    owner.stop();
    await bridge.dispose?.();
    bridge.notifications.dispose();
    await clientConnection.dispose();
  }
}

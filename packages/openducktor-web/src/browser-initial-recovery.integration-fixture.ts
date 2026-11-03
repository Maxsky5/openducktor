Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: createMemoryClientStorage(),
});
import { createMemoryClientStorage } from "@openducktor/frontend-core/platform/client-storage";
import {
  TEST_HOST_ID,
  TEST_CONNECTION_TOKEN,
  savedTestAuthorization,
} from "../../host-client/src/remote/test-support/authorization";
import { builtinTaskWorkflow } from "@openducktor/workflows";
import assert from "node:assert/strict";
import {
  HOST_CHANNEL_SUBPROTOCOL,
  REMOTE_BASELINE_CAPABILITIES,
  REMOTE_PROTOCOL_VERSION,
  type ExternalTaskSyncEvent,
  type HostRuntimeSnapshot,
  type RemoteHostDescriptor,
} from "@openducktor/contracts";
import type { RemoteTransport } from "@openducktor/host-client/remote";
import { openRemoteSocket } from "@openducktor/host-client/remote/socket";
import { createFakeHostChannel } from "@openducktor/host-client/remote/test-support/host-channel";
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
  hostId: TEST_HOST_ID,
  accessPolicy: "pairing",
  protocols: [
    { version: REMOTE_PROTOCOL_VERSION, capabilities: [...REMOTE_BASELINE_CAPABILITIES] },
  ],
};
const workspace = { workspaceId: "repo", repoPath: "/repo" };
const snapshot: HostRuntimeSnapshot = {
  hostInstanceId: "host-a",
  runtimes: [],
  mcpBridge: createHostMcpBridgeStatusFixture(),
};
const waitUntil = async (condition: () => boolean) => {
  for (let wait = 0; wait < 400 && !condition(); wait += 1)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(condition());
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
  let ackedSubscription: string | null = null;
  const taskSnapshotStarted = Promise.withResolvers<void>();
  const taskSnapshotGate = Promise.withResolvers<void>();
  const taskAckStarted = Promise.withResolvers<void>();
  const taskAckGate = Promise.withResolvers<void>();
  const taskChanged = Promise.withResolvers<void>();
  const sessionsChanged = Promise.withResolvers<void>();
  const cursor = { epoch: crypto.randomUUID(), sequence: 0 };
  const runtimeStarted = Promise.withResolvers<void>();
  const runtimeGate = Promise.withResolvers<HostRuntimeSnapshot>();
  const channel = createFakeHostChannel({
    taskBoundary: cursor,
    initialTaskFrames: (boundary) => [
      { type: "snapshot_required", cursor: boundary, reason: "buffer_gap" },
    ],
    invoke: async (command) => {
      if (command !== "runtime_status") throw new Error(`Unexpected command: ${command}`);
      runtimeReads += 1;
      runtimeStarted.resolve();
      try {
        return { result: await runtimeGate.promise };
      } catch {
        return {
          error: {
            kind: "host",
            response: { error: "host_command_failed", message: "Runtime read failed." },
          },
        };
      }
    },
    answer: (request, socket) => {
      if (request.method === "task_events.subscribe") {
        if (taskSetupFailed) {
          taskSubscriptions += 1;
          return undefined;
        }
        taskSetupFailed = true;
        return {
          error: {
            kind: "refused",
            failure: {
              code: "unavailable",
              message: "Task subscription setup failed.",
              nextAction: "Retry.",
            },
          },
        };
      }
      if (request.method === "task_events.ack") {
        ackedSubscription = request.subscriptionId;
        taskAckStarted.resolve();
        void taskAckGate.promise.then(() =>
          socket.send({ type: "result", id: request.id }, "null"),
        );
        return "none";
      }
      return undefined;
    },
  });
  const transport: RemoteTransport = {
    async request(method, url, headers) {
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
          connectionToken: TEST_CONNECTION_TOKEN,
          authorization: headers.authorization ? undefined : savedTestAuthorization(),
          host,
          connectionId: crypto.randomUUID(),
          protocolVersion: REMOTE_PROTOCOL_VERSION,
          missingOptionalCapabilities: [],
        });
      throw new Error(`Unexpected request: ${method} ${url}`);
    },
    openSocket: (_url, protocol, headers, signal, onFrame, onClose) => {
      if (protocol !== HOST_CHANNEL_SUBPROTOCOL) throw new Error("No terminal was selected.");
      return openRemoteSocket(channel.createSocket, protocol, headers, signal, onFrame, onClose);
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
        return { taskIdsByRepo: new Map([[workspace, []]]), failures: new Map() };
      },
      releaseWorkspace: async () => {},
    },
    agentSessionViewSync: {
      cancelReads: () => {},
      releaseWorkspace: async () => {},
      reconcileStreamSnapshot: async () => new Map(),
      admitExternalEvent: async (event) => ({
        repoPath: { workspaceId: event.workspaceId, repoPath: event.repoPath },
        changedTaskIds: [],
      }),
      completeExternalEvents: async (changes) => {
        await Promise.all(changes);
        sessionsChanged.resolve();
      },
    },
    getOpenRepoPaths: () => [workspace],
    onDegraded: (cause) => {
      throw cause;
    },
    onWorkspaceFailures: () => {},
  });
  const started = controller.start().catch((cause: unknown) => cause);
  // A failed task subscription retries by itself. A disabled host stops the retries.
  const failed = Promise.withResolvers<void>();
  const stopState = connection.subscribeState((state) => {
    if (state.failure) failed.resolve();
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
    // A read waits while the client retries, and fails at once when the retries stopped.
    if (firstFailure === "remote_disabled") await firstRead.promise;
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
    // The read that waited for the reconnect runs after the barrier.
    if (firstFailure === "task_subscription") await waitUntil(() => runtimeReads === 2);
    else assert.equal(runtimeReads, 1);
    if (readFails) {
      assert.ok(cause);
      // A failed synchronization keeps its failure and retries by itself.
      assert.equal(connection.readState().status, "disconnected");
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
          workspaceId: workspace.workspaceId,
          repoPath: "/repo",
          taskId: "task",
          taskSnapshot: {
            workflow: builtinTaskWorkflow.reference,
            id: "task",
            title: "After retry",
            status: "open",
          },
          emittedAt: "2026-10-14T12:00:00.000Z",
        };
        assert.ok(ackedSubscription);
        channel.taskFrame(ackedSubscription, {
          type: "change",
          cursor: { ...cursor, sequence: 1 },
          event,
        });
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

import { specPlanBuildWorkflow } from "@openducktor/workflows";
import { createAuthorizedRemoteTestClient as createRemoteHostClient } from "../../../host-client/src/remote/test-support/authorization";
import {
  createFakeHostChannel,
  type FakeHostChannelSocket,
} from "../../../host-client/src/remote/test-support/host-channel";
import { expect, test } from "bun:test";
import { REMOTE_PROTOCOL_VERSION, type ExternalTaskSyncEvent } from "@openducktor/contracts";
import { createTaskStreamController } from "../tasks/task-stream-controller";
import type { TaskViewSync } from "../queries/task-view-sync";
import type { AgentSessionViewSync } from "../queries/agent-session-view-sync";
import {
  createChannelTestTransport,
  testRemoteDescriptor,
} from "../test-support/remote-channel-transport";
import { createRemoteTaskSubscriptions, type RemoteTaskSubscriptions } from "./task-subscriptions";

const latch = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};

test("restores task delivery after disconnect during acknowledgement and after inactivity", async () => {
  const cursor = { epoch: crypto.randomUUID(), sequence: 0 };
  const ackSeen = latch<void>();
  const lost = latch<void>();
  const updateApplied = latch<void>();
  let creates = 0;
  let acknowledgements = 0;
  const leases: { socket: FakeHostChannelSocket; subscriptionId: string }[] = [];
  const channel = createFakeHostChannel({
    notificationCursor: cursor,
    answer: (request, socket) => {
      if (request.method === "task_events.subscribe") {
        creates += 1;
        const subscriptionId = crypto.randomUUID();
        leases.push({ socket, subscriptionId });
        socket.send(
          { type: "result", id: request.id },
          JSON.stringify({ subscriptionId, replayBoundary: cursor }),
        );
        if (creates < 3)
          socket.send({
            type: "task_frame",
            subscriptionId,
            frame: { type: "snapshot_required", cursor, reason: "buffer_gap" },
          });
        return "none";
      }
      if (request.method === "task_events.ack") {
        acknowledgements += 1;
        // The first acknowledgement gets no reply before the channel drops.
        if (acknowledgements === 1) {
          ackSeen.resolve();
          return "none";
        }
      }
      return undefined;
    },
  });
  const { transport } = createChannelTestTransport({
    channel,
    descriptor: () =>
      testRemoteDescriptor({
        hostInstanceId: "host",
        protocols: [{ version: REMOTE_PROTOCOL_VERSION, capabilities: [] }],
      }),
  });
  let subscriptions!: RemoteTaskSubscriptions;
  const remote = createRemoteHostClient(
    "https://host.example/remote",
    {
      appVersion: "mobile",
      supportedProtocolVersions: [REMOTE_PROTOCOL_VERSION],
      requiredCapabilities: [],
      optionalCapabilities: [],
    },
    transport,
    () => subscriptions.synchronize(),
  );
  subscriptions = createRemoteTaskSubscriptions(remote);
  remote.subscribeState((state) => {
    if (["disconnected", "failed", "idle"].includes(state.status)) subscriptions.invalidate();
    if (state.status === "disconnected") lost.resolve();
  });
  const taskViewSync: TaskViewSync = {
    loadWorkspace: async () => {},
    refreshManually: async () => {},
    refreshAfterTaskRetentionChange: async () => {},
    refreshDocumentsForTasks: async () => {},
    reconcileExternalEvent: async (event) => {
      if (event.kind === "external_task_created" && event.taskSnapshot.title === "After foreground")
        updateApplied.resolve();
    },
    reconcileStreamSnapshot: async () => ({ taskIdsByRepo: new Map(), failures: new Map() }),
    releaseWorkspace: async () => {},
  };
  const agentSessionViewSync: AgentSessionViewSync = {
    cancelReads: () => {},
    releaseWorkspace: async () => {},
    reconcileStreamSnapshot: async () => new Map(),
    completeExternalEvents: async (changes) => {
      await Promise.all(changes);
    },
    admitExternalEvent: async (event) => ({
      repoPath: { workspaceId: event.workspaceId, repoPath: event.repoPath },
      changedTaskIds: [],
    }),
  };
  const controller = createTaskStreamController({
    transport: subscriptions,
    taskViewSync,
    agentSessionViewSync,
    getOpenRepoPaths: () => [],
    onDegraded: () => {},
    onWorkspaceFailures: () => {},
  });
  let started: Promise<void> | null = null;
  try {
    await remote.connect();
    started = controller.start();
    await ackSeen.promise;
    channel.closeAll();
    await lost.promise;
    // The current state owner must finish closing its canceled acknowledgement and reacquire.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await remote.connect();
    expect(creates).toBe(2);
    expect(acknowledgements).toBe(2);
    remote.setActive(false);
    remote.setActive(true);
    await remote.connect();
    expect(creates).toBe(3);
    const event: ExternalTaskSyncEvent = {
      kind: "external_task_created",
      workspaceId: "workspace-1",
      eventId: "after-foreground",
      boardChanges: null,
      repoPath: "/repo",
      taskId: "task",
      taskSnapshot: {
        workflow: specPlanBuildWorkflow.reference,
        id: "task",
        title: "After foreground",
        status: "open",
      },
      emittedAt: "2026-10-13T12:00:00.000Z",
    };
    const lease = leases.at(-1);
    if (!lease) throw new Error("The host created no task lease.");
    lease.socket.send({
      type: "task_frame",
      subscriptionId: lease.subscriptionId,
      frame: { type: "change", cursor: { ...cursor, sequence: 1 }, event },
    });
    await updateApplied.promise;
  } finally {
    await controller.stop();
    await remote.disconnect();
    await started;
  }
});

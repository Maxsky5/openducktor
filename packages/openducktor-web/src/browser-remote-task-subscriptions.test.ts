import { expect, test } from "bun:test";
import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import {
  createRemoteHostClient,
  type RemoteTransport,
  type RemoteHttpResponse,
} from "@openducktor/host-client/remote";
import { createTaskStreamController } from "../../frontend/src/state/tasks/task-stream-controller";
import type { TaskViewSync } from "../../frontend/src/state/queries/task-view-sync";
import type { AgentSessionViewSync } from "../../frontend/src/state/queries/agent-session-view-sync";
import {
  createBrowserRemoteTaskSubscriptions,
  type BrowserRemoteTaskSubscriptions,
} from "@openducktor/frontend/lib/remote/task-subscriptions";

const latch = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const encoder = new TextEncoder();
const json = <T>(value: T, status = 200): RemoteHttpResponse => ({
  status,
  headers: {},
  body: (async function* () {
    if (status !== 204) yield encoder.encode(JSON.stringify(value));
  })(),
});

test("restores task delivery after disconnect during acknowledgement and after inactivity", async () => {
  const host = {
    shell: "web",
    appVersion: "1",
    hostInstanceId: "host",
    accessPolicy: "network_reach",
    protocols: [{ version: 1, capabilities: [] }],
  };
  const cursor = { epoch: crypto.randomUUID(), sequence: 0 };
  const ackSeen = latch<void>();
  const lost = latch<void>();
  let deliverTask = (_frame: string) => {};
  const updateApplied = latch<void>();
  let endEvents = () => {};
  let creates = 0;
  let acknowledgements = 0;
  const stream = (signal: AbortSignal, prefix: string, events = false): RemoteHttpResponse => ({
    status: 200,
    headers: {},
    body: (async function* () {
      yield encoder.encode(prefix);
      while (true) {
        const next = await new Promise<string>((resolve, reject) => {
          if (events) endEvents = () => reject(new Error("Host event connection lost."));
          else deliverTask = resolve;
          const abort = () => reject(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
        yield encoder.encode(next);
      }
    })(),
  });
  const transport: RemoteTransport = {
    async request(method, url, _headers, signal) {
      if (url.endsWith("/events"))
        return stream(
          signal,
          `event: replay-complete\ndata: {"hostChanged":false,"gaps":[]}\n\nevent: notification-frame\ndata: ${JSON.stringify({ type: "attached", reason: "new", cursor, health: [] })}\n\n`,
          true,
        );
      if (url.endsWith("/connections"))
        return json({
          status: "accepted",
          host,
          connectionId: crypto.randomUUID(),
          protocolVersion: 1,
          missingOptionalCapabilities: [],
        });
      if (url.endsWith("/task-events/subscriptions")) {
        creates += 1;
        return json({ subscriptionId: crypto.randomUUID(), replayBoundary: cursor });
      }
      if (url.endsWith("/stream"))
        return stream(
          signal,
          creates >= 3
            ? ": openducktor-ready\n\n"
            : `event: task-frame\ndata: ${JSON.stringify({ type: "snapshot_required", cursor, reason: "buffer_gap" })}\n\n`,
        );
      if (url.endsWith("/ack")) {
        acknowledgements += 1;
        if (acknowledgements === 1) {
          ackSeen.resolve();
          await new Promise<never>((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
          );
        }
        return json(null, 204);
      }
      if (method === "DELETE") return json(null, 204);
      return json(host);
    },
    openTerminal: async () => {
      throw new Error("unused");
    },
  };
  let subscriptions!: BrowserRemoteTaskSubscriptions;
  const remote = createRemoteHostClient(
    "https://host.example/remote",
    {
      appVersion: "mobile",
      supportedProtocolVersions: [1],
      requiredCapabilities: [],
      optionalCapabilities: [],
    },
    transport,
    () => subscriptions.synchronize(),
  );
  subscriptions = createBrowserRemoteTaskSubscriptions(remote);
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
    admitExternalEvent: async (event) => ({ repoPath: event.repoPath, changedTaskIds: [] }),
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
    endEvents();
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
      eventId: "after-foreground",
      boardChanges: null,
      repoPath: "/repo",
      taskId: "task",
      taskSnapshot: { id: "task", title: "After foreground", status: "open" },
      emittedAt: "2026-10-13T12:00:00.000Z",
    };
    deliverTask(
      `event: task-frame\ndata: ${JSON.stringify({ type: "change", cursor: { ...cursor, sequence: 1 }, event })}\n\n`,
    );
    await updateApplied.promise;
  } finally {
    await controller.stop();
    await remote.disconnect();
    await started;
  }
});

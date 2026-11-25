import {
  type AgentSessionLiveEnvelope,
  type ExternalTaskSyncEvent,
  type HostEventPayload,
  type SessionStartupProgressEvent,
  type TaskEventCursor,
  type TaskEventStreamFrame,
  taskEventStreamFrameSchema,
} from "@openducktor/contracts";
import type {
  HostConnection,
  TaskStreamFrame,
} from "@openducktor/frontend-core/connection/host-connection";
import { createAgentSessionLiveAttachment, type HostClient } from "@openducktor/host-client";
import type { DemoClock } from "./demo-clock";

type Listener<Event> = (event: Event) => void | Promise<void>;

/** The event streams that the demo state publishes to the views. */
export type DemoEvents = {
  /** A task change of one workspace, as the host task stream sends it. Returns its cursor. */
  taskChanged(event: ExternalTaskSyncEvent): TaskEventCursor;
  /** A live session change of one repository. */
  live(envelope: AgentSessionLiveEnvelope): void;
  workspaceSessionUpdated(
    payload: HostEventPayload<"openducktor://workspace-session-updated">,
  ): void;
  startupProgress(event: SessionStartupProgressEvent): void;
};

const listenerSet = <Event>() => {
  const listeners = new Set<Listener<Event>>();
  return {
    add(listener: Listener<Event>): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event: Event) {
      for (const listener of Array.from(listeners)) void listener(event);
    },
  };
};

/**
 * The event streams of the demo, in the shape of a host connection. Every event goes out on a
 * later task, in publication order, as a host stream delivers it. Nothing is sent after the demo
 * ended.
 */
export const createDemoHostConnection = (client: HostClient, clock: DemoClock) => {
  const epoch = "00000000-0000-4000-8000-00000000d3e0";
  let sequence = 0;
  const taskStreams = new Set<(frame: TaskStreamFrame) => void>();
  const live = listenerSet<AgentSessionLiveEnvelope>();
  const workspaceSessions =
    listenerSet<HostEventPayload<"openducktor://workspace-session-updated">>();
  const startup = listenerSet<SessionStartupProgressEvent>();
  let nextSubscription = 1;

  /** Resolves after the caller continues, as a host subscription does. */
  const subscribed = async <Value>(value: Value): Promise<Value> => {
    await Promise.resolve();
    if (clock.ended) throw new Error("The demo ended. Open the demo again.");
    return value;
  };

  const noEvents = () => subscribed(() => {});

  const events: DemoEvents = {
    taskChanged(event) {
      sequence += 1;
      const published = sequence;
      const cursor: TaskEventCursor = { epoch, sequence: published };
      const frame: TaskEventStreamFrame = taskEventStreamFrameSchema.parse({
        type: "change",
        cursor,
        event,
      });
      clock.soon(() => {
        for (const onFrame of taskStreams) onFrame(frame);
      });
      return cursor;
    },
    live(envelope) {
      clock.soon(() => live.emit(envelope));
    },
    workspaceSessionUpdated(payload) {
      clock.soon(() => workspaceSessions.emit(payload));
    },
    startupProgress(event) {
      clock.soon(() => startup.emit(event));
    },
  };

  const connection: HostConnection = {
    client,
    subscribeWorkspaceProviderSetupUpdates: noEvents,
    // The demo has one built-in workflow, so its workflow library never changes.
    subscribeWorkflowLibraryChanges: noEvents,
    subscribeStartupProgress: (listener) => subscribed(startup.add(listener)),
    subscribeWorkspaceSessionUpdates: (listener) => subscribed(workspaceSessions.add(listener)),
    subscribeRuntimeChanges: noEvents,
    subscribeTaskMergeStatusUpdates: noEvents,
    subscribeUsageProgress: noEvents,
    subscribeBrowserTabEvents: noEvents,
    subscribeRunEvents: noEvents,
    subscribeAzureDevOpsConnectionUpdates: noEvents,
    subscribeNotificationStream: noEvents,
    observeAgentSessionLive: async (input, listener) => {
      // Subscribe first, then install the snapshot, as the host connection does.
      const attachment = createAgentSessionLiveAttachment(input.repoPath, listener);
      const stop = live.add((envelope) => attachment.accept(envelope));
      try {
        attachment.install(await client.agentSessionLiveAttach(input));
      } catch (cause) {
        stop();
        throw cause;
      }
      return stop;
    },
    subscribeTaskStream: async (_input, onFrame) => {
      // A new subscription reads the current tasks first, as after a host stream gap.
      taskStreams.add(onFrame);
      const snapshot = taskEventStreamFrameSchema.parse({
        type: "snapshot_required",
        cursor: { epoch, sequence },
        reason: "buffer_gap",
      });
      clock.soon(() => {
        if (taskStreams.has(onFrame)) onFrame(snapshot);
      });
      const subscriptionId = `00000000-0000-4000-8000-${String(nextSubscription++).padStart(12, "0")}`;
      await subscribed(undefined);
      return {
        subscriptionId,
        acknowledge: async () => {},
        unsubscribe: () => {
          taskStreams.delete(onFrame);
        },
      };
    },
  };
  return { connection, events };
};

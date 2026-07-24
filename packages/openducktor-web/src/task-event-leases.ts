import type {
  TaskEventCursor,
  TaskEventStreamFrame,
  TaskEventStreamSubscribe,
} from "@openducktor/contracts";
import type { EffectNodeHostCommandRouter } from "@openducktor/host";

const LEASE_EXPIRY_MS = 60_000;

type TaskEventStreamPort = EffectNodeHostCommandRouter["taskEventStream"];
type HostSubscription = ReturnType<TaskEventStreamPort["subscribe"]>;

export type TaskEventLease = {
  readonly subscriptionId: string;
  connection: TaskEventLeaseConnection | null;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  hostSubscription: HostSubscription;
  pendingFrames: TaskEventStreamFrame[];
  nextGeneration: number;
};

export type TaskEventLeaseConnection = {
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
  readonly generation: number;
};

export type TaskEventLeaseManager = {
  acknowledge(lease: TaskEventLease, cursor: TaskEventCursor): void;
  attach(lease: TaskEventLease, controller: ReadableStreamDefaultController<Uint8Array>): number;
  create(input: TaskEventStreamSubscribe, subscriptionId: string): TaskEventLease;
  delete(lease: TaskEventLease): void;
  detach(lease: TaskEventLease, generation: number): void;
  dispose(): void;
  get(subscriptionId: string): TaskEventLease | undefined;
};

export type CreateTaskEventLeaseManagerOptions = {
  clearExpiryTimer?(timer: ReturnType<typeof setTimeout>): void;
  encodeFrame(frame: TaskEventStreamFrame): Uint8Array;
  leaseExpiryMs?: number;
  reportDeliveryFailure(failure: { cause: unknown; subscriptionId: string }): void;
  scheduleExpiry?(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  taskEventStream: TaskEventStreamPort;
};

const freezeCursor = (cursor: TaskEventCursor): TaskEventCursor => Object.freeze({ ...cursor });

const freezeFrame = (frame: TaskEventStreamFrame): TaskEventStreamFrame => {
  if (frame.type === "snapshot_required") {
    return Object.freeze({ ...frame, cursor: freezeCursor(frame.cursor) });
  }
  const event =
    frame.event.kind === "tasks_updated"
      ? Object.freeze({
          ...frame.event,
          removedTaskIds: Object.freeze([...frame.event.removedTaskIds]),
          taskIds: Object.freeze([...frame.event.taskIds]),
        })
      : Object.freeze({ ...frame.event });
  return Object.freeze({
    ...frame,
    cursor: freezeCursor(frame.cursor),
    event,
  }) as TaskEventStreamFrame;
};

const cursorIsAcknowledged = (frame: TaskEventStreamFrame, cursor: TaskEventCursor): boolean =>
  frame.cursor.epoch === cursor.epoch && frame.cursor.sequence <= cursor.sequence;

export const createTaskEventLeaseManager = ({
  clearExpiryTimer = clearTimeout,
  encodeFrame,
  leaseExpiryMs = LEASE_EXPIRY_MS,
  reportDeliveryFailure,
  scheduleExpiry = setTimeout,
  taskEventStream,
}: CreateTaskEventLeaseManagerOptions): TaskEventLeaseManager => {
  const leases = new Map<string, TaskEventLease>();

  const report = (lease: TaskEventLease, cause: unknown): void => {
    try {
      reportDeliveryFailure({ cause, subscriptionId: lease.subscriptionId });
    } catch {
      // Host task publication must never be affected by delivery reporting.
    }
  };

  const clearExpiry = (lease: TaskEventLease): void => {
    if (lease.expiryTimer) {
      clearExpiryTimer(lease.expiryTimer);
      lease.expiryTimer = null;
    }
  };

  const deleteLease = (lease: TaskEventLease): void => {
    clearExpiry(lease);
    if (leases.get(lease.subscriptionId) !== lease) return;
    leases.delete(lease.subscriptionId);
    const connection = lease.connection;
    lease.connection = null;
    lease.pendingFrames = [];
    if (connection) {
      try {
        connection.controller.close();
      } catch (cause) {
        report(lease, cause);
      }
    }
    lease.hostSubscription.unsubscribe();
  };

  const armExpiry = (lease: TaskEventLease): void => {
    if (lease.expiryTimer || leases.get(lease.subscriptionId) !== lease) return;
    lease.expiryTimer = scheduleExpiry(() => {
      lease.expiryTimer = null;
      deleteLease(lease);
    }, leaseExpiryMs);
  };

  const detach = (lease: TaskEventLease, generation: number): void => {
    if (lease.connection?.generation !== generation) return;
    lease.connection = null;
    armExpiry(lease);
  };

  const write = (lease: TaskEventLease, frame: TaskEventStreamFrame): boolean => {
    const connection = lease.connection;
    if (!connection) return false;
    try {
      connection.controller.enqueue(encodeFrame(frame));
      return true;
    } catch (cause) {
      detach(lease, connection.generation);
      report(lease, cause);
      return false;
    }
  };

  const flush = (lease: TaskEventLease): void => {
    for (const frame of lease.pendingFrames) {
      if (!write(lease, frame)) return;
    }
  };

  const acceptFrame = (lease: TaskEventLease, frame: TaskEventStreamFrame): void => {
    try {
      const immutableFrame = freezeFrame(frame);
      if (immutableFrame.type === "snapshot_required") {
        lease.pendingFrames = [immutableFrame];
      } else {
        lease.pendingFrames.push(immutableFrame);
      }
      write(lease, immutableFrame);
    } catch (cause) {
      report(lease, cause);
    }
  };

  const create = (input: TaskEventStreamSubscribe, subscriptionId: string): TaskEventLease => {
    let lease: TaskEventLease | null = null;
    const initialFrames: TaskEventStreamFrame[] = [];
    const hostSubscription = taskEventStream.subscribe(input, (frame) => {
      if (lease) {
        acceptFrame(lease, frame);
      } else {
        initialFrames.push(frame);
      }
    });
    lease = {
      connection: null,
      expiryTimer: null,
      hostSubscription,
      nextGeneration: 0,
      pendingFrames: [],
      subscriptionId,
    };
    leases.set(subscriptionId, lease);
    armExpiry(lease);
    for (const frame of initialFrames) acceptFrame(lease, frame);
    return lease;
  };

  return {
    acknowledge(lease, cursor) {
      taskEventStream.acknowledge({
        cursor,
        subscriptionId: lease.hostSubscription.subscriptionId,
      });
      lease.pendingFrames = lease.pendingFrames.filter(
        (frame) => !cursorIsAcknowledged(frame, cursor),
      );
    },
    attach(lease, controller) {
      clearExpiry(lease);
      const previous = lease.connection;
      const generation = ++lease.nextGeneration;
      lease.connection = { controller, generation };
      if (previous) {
        try {
          previous.controller.close();
        } catch (cause) {
          report(lease, cause);
        }
      }
      flush(lease);
      return generation;
    },
    create,
    delete: deleteLease,
    detach,
    dispose() {
      for (const lease of [...leases.values()]) {
        deleteLease(lease);
      }
    },
    get(subscriptionId) {
      return leases.get(subscriptionId);
    },
  };
};

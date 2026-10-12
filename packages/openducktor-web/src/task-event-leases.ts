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
  resume(lease: TaskEventLease, generation: number): void;
};

export type CreateTaskEventLeaseManagerOptions = {
  clearExpiryTimer?(timer: ReturnType<typeof setTimeout>): void;
  encodeFrame(frame: TaskEventStreamFrame): Uint8Array;
  leaseExpiryMs?: number;
  reportDeliveryFailure(failure: { cause: unknown; subscriptionId: string }): void;
  scheduleExpiry?(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  taskEventStream: TaskEventStreamPort;
};

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
    if (
      !connection ||
      connection.controller.desiredSize === null ||
      connection.controller.desiredSize <= 0
    )
      return false;
    try {
      connection.controller.enqueue(encodeFrame(frame));
      return true;
    } catch (cause) {
      detach(lease, connection.generation);
      report(lease, cause);
      return false;
    }
  };

  const create = (input: TaskEventStreamSubscribe, subscriptionId: string): TaskEventLease => {
    let lease: TaskEventLease | null = null;
    const hostSubscription = taskEventStream.subscribe(input, (frame) =>
      lease ? write(lease, frame) : false,
    );
    lease = {
      connection: null,
      expiryTimer: null,
      hostSubscription,
      nextGeneration: 0,
      subscriptionId,
    };
    leases.set(subscriptionId, lease);
    armExpiry(lease);
    return lease;
  };

  return {
    acknowledge(lease, cursor) {
      taskEventStream.acknowledge({
        cursor,
        subscriptionId: lease.hostSubscription.subscriptionId,
      });
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
      if (generation === 1) lease.hostSubscription.resume();
      else lease.hostSubscription.replay();
      return generation;
    },
    resume(lease, generation) {
      if (lease.connection?.generation === generation) lease.hostSubscription.resume();
    },
    create,
    delete: deleteLease,
    detach,
    dispose() {
      for (const lease of leases.values()) {
        deleteLease(lease);
      }
    },
    get(subscriptionId) {
      return leases.get(subscriptionId);
    },
  };
};

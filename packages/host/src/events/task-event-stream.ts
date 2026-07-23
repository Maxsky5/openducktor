import {
  type ExternalTaskSyncEvent,
  externalTaskSyncEventSchema,
  type TaskEventCursor,
  type TaskEventSnapshotRequiredReason,
  type TaskEventStreamAcknowledge,
  type TaskEventStreamFrame,
  type TaskEventStreamSubscribe,
  taskEventStreamAcknowledgeSchema,
  taskEventStreamSubscribeSchema,
} from "@openducktor/contracts";
import { HostValidationError } from "../effect/host-errors";

const TASK_EVENT_STREAM_CAPACITY = 256;

export type TaskEventStreamDeliveryFailure = {
  subscriptionId: string;
  frame: TaskEventStreamFrame;
  cause: unknown;
};

export type TaskEventStreamDeliveryReporter = {
  report(failure: TaskEventStreamDeliveryFailure): void;
};

export type TaskEventStreamSink = (frame: TaskEventStreamFrame) => void;

export type TaskEventStreamSubscription = {
  subscriptionId: string;
  unsubscribe(): void;
};

export type TaskEventStreamPort = {
  publish(event: ExternalTaskSyncEvent): void;
  subscribe(
    input: TaskEventStreamSubscribe,
    sink: TaskEventStreamSink,
  ): TaskEventStreamSubscription;
  acknowledge(input: TaskEventStreamAcknowledge): void;
};

export type CreateTaskEventStreamInput = {
  epochFactory?: () => string;
  reporter: TaskEventStreamDeliveryReporter;
  subscriptionIdFactory?: () => string;
};

type Subscription = {
  active: boolean;
  highestDelivered: TaskEventCursor | null;
  lastAcknowledged: TaskEventCursor | null;
  queue: TaskEventStreamFrame[];
  scheduled: boolean;
  sink: TaskEventStreamSink;
  snapshotBoundary: TaskEventCursor | null;
  subscriptionId: string;
};

const cursorEquals = (left: TaskEventCursor, right: TaskEventCursor): boolean =>
  left.epoch === right.epoch && left.sequence === right.sequence;

const freezeCursor = (cursor: TaskEventCursor): TaskEventCursor => Object.freeze({ ...cursor });

const freezeEvent = (event: ExternalTaskSyncEvent): ExternalTaskSyncEvent => {
  if (event.kind === "tasks_updated") {
    const taskIds = [...event.taskIds];
    const removedTaskIds = [...event.removedTaskIds];
    Object.freeze(taskIds);
    Object.freeze(removedTaskIds);
    return Object.freeze({ ...event, taskIds, removedTaskIds });
  }
  return Object.freeze({ ...event });
};

const freezeFrame = (frame: TaskEventStreamFrame): TaskEventStreamFrame =>
  frame.type === "change"
    ? Object.freeze({
        ...frame,
        cursor: freezeCursor(frame.cursor),
        event: freezeEvent(frame.event),
      })
    : Object.freeze({ ...frame, cursor: freezeCursor(frame.cursor) });

const validationError = (message: string, field: string, details: Record<string, unknown>) =>
  new HostValidationError({ message, field, details });

export const createTaskEventStream = ({
  epochFactory = () => crypto.randomUUID(),
  reporter,
  subscriptionIdFactory = () => crypto.randomUUID(),
}: CreateTaskEventStreamInput): TaskEventStreamPort => {
  const epoch = epochFactory();
  const subscribers = new Map<string, Subscription>();
  let buffer: readonly TaskEventStreamFrame[] = [];
  let sequence = 0;

  const currentCursor = (): TaskEventCursor => ({ epoch, sequence });
  const canReplayFrom = (cursor: TaskEventCursor): boolean => {
    if (cursor.epoch !== epoch || cursor.sequence > sequence) {
      return false;
    }
    const firstRetainedSequence = buffer[0]?.cursor.sequence;
    return firstRetainedSequence === undefined || cursor.sequence >= firstRetainedSequence - 1;
  };
  const enqueue = (subscription: Subscription, frame: TaskEventStreamFrame): void => {
    subscription.queue.push(frame);
    if (subscription.scheduled) {
      return;
    }
    subscription.scheduled = true;
    queueMicrotask(() => {
      subscription.scheduled = false;
      while (subscription.active && subscription.queue.length > 0) {
        const frame = subscription.queue.shift();
        if (!frame) {
          return;
        }
        subscription.highestDelivered = frame.cursor;
        try {
          subscription.sink(frame);
        } catch (cause) {
          subscription.active = false;
          subscription.queue = [];
          subscribers.delete(subscription.subscriptionId);
          reporter.report({ subscriptionId: subscription.subscriptionId, frame, cause });
        }
      }
    });
  };
  const enqueueSnapshot = (
    subscription: Subscription,
    reason: TaskEventSnapshotRequiredReason,
  ): void => {
    if (subscription.snapshotBoundary) {
      return;
    }
    const cursor = freezeCursor(currentCursor());
    subscription.snapshotBoundary = cursor;
    subscription.queue = [];
    enqueue(
      subscription,
      freezeFrame({
        type: "snapshot_required",
        cursor,
        reason,
      }),
    );
  };
  const enqueueReplay = (subscription: Subscription): void => {
    const cursor = subscription.lastAcknowledged;
    if (!cursor || !canReplayFrom(cursor)) {
      enqueueSnapshot(subscription, "buffer_gap");
      return;
    }
    for (const frame of buffer) {
      if (frame.cursor.sequence > cursor.sequence) {
        enqueue(subscription, frame);
      }
    }
  };

  return {
    publish(event) {
      const parsed = externalTaskSyncEventSchema.safeParse(event);
      if (!parsed.success) {
        throw validationError("Task event stream requires a valid task event.", "event", {
          issues: parsed.error.issues,
        });
      }
      const frame = freezeFrame({
        type: "change",
        cursor: { epoch, sequence: ++sequence },
        event: parsed.data,
      });
      buffer = [...buffer, frame].slice(-TASK_EVENT_STREAM_CAPACITY);
      for (const subscription of subscribers.values()) {
        if (!subscription.active || subscription.snapshotBoundary) {
          continue;
        }
        if (!subscription.lastAcknowledged || !canReplayFrom(subscription.lastAcknowledged)) {
          enqueueSnapshot(subscription, "buffer_gap");
          continue;
        }
        enqueue(subscription, frame);
      }
    },
    subscribe(input, sink) {
      const parsed = taskEventStreamSubscribeSchema.safeParse(input);
      if (!parsed.success) {
        throw validationError("Task event stream subscription cursor is invalid.", "cursor", {
          issues: parsed.error.issues,
        });
      }
      const cursor = parsed.data.cursor;
      const subscription: Subscription = {
        active: true,
        highestDelivered: cursor ? freezeCursor(cursor) : null,
        lastAcknowledged: cursor && cursor.epoch === epoch ? freezeCursor(cursor) : null,
        queue: [],
        scheduled: false,
        sink,
        snapshotBoundary: null,
        subscriptionId: subscriptionIdFactory(),
      };
      subscribers.set(subscription.subscriptionId, subscription);
      if (cursor === null) {
        enqueueSnapshot(subscription, "buffer_gap");
      } else if (cursor.epoch !== epoch) {
        enqueueSnapshot(subscription, "epoch_mismatch");
      } else if (canReplayFrom(cursor)) {
        enqueueReplay(subscription);
      } else {
        enqueueSnapshot(subscription, "buffer_gap");
      }
      return {
        subscriptionId: subscription.subscriptionId,
        unsubscribe: () => {
          subscription.active = false;
          subscription.queue = [];
          subscribers.delete(subscription.subscriptionId);
        },
      };
    },
    acknowledge(input) {
      const parsed = taskEventStreamAcknowledgeSchema.safeParse(input);
      if (!parsed.success) {
        throw validationError("Task event stream acknowledgement is invalid.", "acknowledgement", {
          issues: parsed.error.issues,
        });
      }
      const { cursor, subscriptionId } = parsed.data;
      const subscription = subscribers.get(subscriptionId);
      if (!subscription?.active) {
        throw validationError(
          "Task event stream acknowledgement is for an unknown subscription.",
          "subscriptionId",
          {
            subscriptionId,
          },
        );
      }
      if (cursor.epoch !== epoch) {
        throw validationError(
          "Task event stream acknowledgement has the wrong epoch.",
          "cursor.epoch",
          {
            expectedEpoch: epoch,
            receivedEpoch: cursor.epoch,
          },
        );
      }
      if (subscription.snapshotBoundary) {
        if (
          !subscription.highestDelivered ||
          !cursorEquals(subscription.highestDelivered, subscription.snapshotBoundary) ||
          !cursorEquals(cursor, subscription.snapshotBoundary)
        ) {
          throw validationError(
            "Task event stream acknowledgement must acknowledge the delivered snapshot boundary.",
            "cursor",
            { expectedCursor: subscription.snapshotBoundary, receivedCursor: cursor },
          );
        }
        subscription.lastAcknowledged = freezeCursor(cursor);
        subscription.snapshotBoundary = null;
        enqueueReplay(subscription);
        return;
      }
      const lastAcknowledged = subscription.lastAcknowledged;
      if (!lastAcknowledged) {
        throw validationError(
          "Task event stream has no acknowledgement state for this subscription.",
          "cursor",
          {
            subscriptionId,
          },
        );
      }
      if (cursorEquals(cursor, lastAcknowledged)) {
        return;
      }
      if (cursor.sequence < lastAcknowledged.sequence) {
        throw validationError("Task event stream acknowledgement regressed.", "cursor.sequence", {
          lastAcknowledged,
          receivedCursor: cursor,
        });
      }
      if (
        !subscription.highestDelivered ||
        cursor.sequence > subscription.highestDelivered.sequence
      ) {
        throw validationError(
          "Task event stream acknowledgement is beyond delivered frames.",
          "cursor.sequence",
          {
            highestDelivered: subscription.highestDelivered,
            receivedCursor: cursor,
          },
        );
      }
      if (cursor.sequence !== lastAcknowledged.sequence + 1) {
        throw validationError(
          "Task event stream acknowledgement skipped a frame.",
          "cursor.sequence",
          {
            expectedSequence: lastAcknowledged.sequence + 1,
            receivedCursor: cursor,
          },
        );
      }
      subscription.lastAcknowledged = freezeCursor(cursor);
    },
  };
};

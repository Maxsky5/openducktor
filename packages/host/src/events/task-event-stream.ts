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
import type { HostErrorDetails } from "../effect/host-errors";
import { HostValidationError } from "../effect/host-errors";

const TASK_EVENT_STREAM_CAPACITY = 256;
const TASK_EVENT_STREAM_BYTE_CAPACITY = 8 * 1024 * 1024;

export type TaskEventStreamDeliveryFailure = {
  subscriptionId: string;
  frame: TaskEventStreamFrame;
  cause: unknown;
};

export type TaskEventStreamDeliveryReporter = {
  report(failure: TaskEventStreamDeliveryFailure): void;
};

// False pauses delivery until the transport resumes it. Void accepts the frame.
export type TaskEventStreamSink =
  | ((frame: TaskEventStreamFrame) => void)
  | ((frame: TaskEventStreamFrame) => boolean);

export type TaskEventStreamSubscription = {
  subscriptionId: string;
  resume(): void;
  replay(): void;
  unsubscribe(): void;
};

export type TaskEventStreamPort = {
  publish(event: ExternalTaskSyncEvent): TaskEventCursor;
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
  snapshotBoundary: Extract<TaskEventStreamFrame, { type: "snapshot_required" }> | null;
  subscriptionId: string;
};

export const createTaskEventStream = ({
  epochFactory = () => crypto.randomUUID(),
  reporter,
  subscriptionIdFactory = () => crypto.randomUUID(),
}: CreateTaskEventStreamInput): TaskEventStreamPort => {
  const epoch = epochFactory();
  const subscribers = new Map<string, Subscription>();
  let buffer: { frame: TaskEventStreamFrame; bytes: number }[] = [];
  let bufferBytes = 0;
  let replayFloor = 0;
  let sequence = 0;

  const currentCursor = (): TaskEventCursor => ({ epoch, sequence });
  const canReplayFrom = (cursor: TaskEventCursor): boolean => {
    if (cursor.epoch !== epoch || cursor.sequence > sequence) {
      return false;
    }
    return cursor.sequence >= replayFloor;
  };
  const resume = (subscription: Subscription): void => {
    if (!subscription.active || subscription.scheduled || subscription.queue.length === 0) {
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
        const previousDelivered = subscription.highestDelivered;
        if (
          frame.type === "snapshot_required" ||
          !previousDelivered ||
          previousDelivered.epoch !== epoch ||
          previousDelivered.sequence < frame.cursor.sequence
        )
          subscription.highestDelivered = frame.cursor;
        try {
          if (subscription.sink(frame) === false) {
            subscription.highestDelivered = previousDelivered;
            subscription.queue.unshift(frame);
            return;
          }
        } catch (cause) {
          subscription.active = false;
          subscription.queue = [];
          subscribers.delete(subscription.subscriptionId);
          reporter.report({ subscriptionId: subscription.subscriptionId, frame, cause });
        }
      }
    });
  };
  const enqueue = (subscription: Subscription, frame: TaskEventStreamFrame): void => {
    subscription.queue.push(frame);
    resume(subscription);
  };
  const enqueueSnapshot = (
    subscription: Subscription,
    reason: TaskEventSnapshotRequiredReason,
  ): void => {
    if (subscription.snapshotBoundary) {
      return;
    }
    const cursor = freezeCursor(currentCursor());
    const frame: Extract<TaskEventStreamFrame, { type: "snapshot_required" }> = Object.freeze({
      type: "snapshot_required",
      cursor,
      reason,
    });
    subscription.snapshotBoundary = frame;
    subscription.queue = [];
    enqueue(subscription, frame);
  };
  const enqueueReplay = (subscription: Subscription): void => {
    const cursor = subscription.lastAcknowledged;
    if (!cursor || !canReplayFrom(cursor)) {
      enqueueSnapshot(subscription, "buffer_gap");
      return;
    }
    for (const { frame } of buffer) {
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
          issues: jsonIssues(parsed.error.issues),
        });
      }
      const frame = freezeFrame({
        type: "change",
        cursor: { epoch, sequence: ++sequence },
        event: parsed.data,
      });
      const bytes = new TextEncoder().encode(JSON.stringify(frame)).byteLength;
      buffer.push({ frame, bytes });
      bufferBytes += bytes;
      while (
        buffer.length > TASK_EVENT_STREAM_CAPACITY ||
        bufferBytes > TASK_EVENT_STREAM_BYTE_CAPACITY
      ) {
        const removed = buffer.shift()!;
        bufferBytes -= removed.bytes;
        replayFloor = removed.frame.cursor.sequence;
      }
      for (const subscription of subscribers.values()) {
        if (!subscription.active || subscription.snapshotBoundary) {
          continue;
        }
        // Reconnection can replay older delivered frames. Bound retention from
        // the oldest queued frame, even when highestDelivered is farther ahead.
        const firstQueued = subscription.queue[0];
        const deliveryProgress = firstQueued
          ? { epoch, sequence: firstQueued.cursor.sequence - 1 }
          : (subscription.highestDelivered ?? subscription.lastAcknowledged);
        if (
          !subscription.lastAcknowledged ||
          !deliveryProgress ||
          !canReplayFrom(deliveryProgress)
        ) {
          enqueueSnapshot(subscription, "buffer_gap");
          continue;
        }
        enqueue(subscription, frame);
      }
      return frame.cursor;
    },
    subscribe(input, sink) {
      const parsed = taskEventStreamSubscribeSchema.safeParse(input);
      if (!parsed.success) {
        throw validationError("Task event stream subscription cursor is invalid.", "cursor", {
          issues: jsonIssues(parsed.error.issues),
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
        resume: () => resume(subscription),
        replay: () => {
          if (!subscription.active) return;
          subscription.queue = [];
          if (subscription.snapshotBoundary) enqueue(subscription, subscription.snapshotBoundary);
          else enqueueReplay(subscription);
        },
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
          issues: jsonIssues(parsed.error.issues),
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
          !cursorEquals(subscription.highestDelivered, subscription.snapshotBoundary.cursor) ||
          !cursorEquals(cursor, subscription.snapshotBoundary.cursor)
        ) {
          throw validationError(
            "Task event stream acknowledgement must acknowledge the delivered snapshot boundary.",
            "cursor",
            { expectedCursor: subscription.snapshotBoundary.cursor, receivedCursor: cursor },
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
      subscription.lastAcknowledged = freezeCursor(cursor);
      subscription.queue = subscription.queue.filter(
        (frame) => frame.cursor.sequence > cursor.sequence,
      );
    },
  };
};

const cursorEquals = (left: TaskEventCursor, right: TaskEventCursor): boolean =>
  left.epoch === right.epoch && left.sequence === right.sequence;

const freezeCursor = (cursor: TaskEventCursor): TaskEventCursor => Object.freeze({ ...cursor });

const freezeBoard = (
  board: ExternalTaskSyncEvent["boardChanges"],
): ExternalTaskSyncEvent["boardChanges"] => {
  if (!board) return null;
  const freeze = <T>(value: T): T => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Traverse an already schema-validated value to freeze its nested fields.
    if (value !== null && typeof value === "object") {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  };
  return freeze(board);
};

const freezeEvent = (event: ExternalTaskSyncEvent): ExternalTaskSyncEvent => {
  const boardChanges = freezeBoard(event.boardChanges);
  if (event.kind === "external_task_created") {
    return Object.freeze({
      ...event,
      boardChanges,
      taskSnapshot: Object.freeze({ ...event.taskSnapshot }),
    });
  }
  const taskIds = [...event.taskIds];
  const removedTaskIds = [...event.removedTaskIds];
  const taskSnapshots = event.taskSnapshots.map((task) => Object.freeze({ ...task }));
  const statusChanges = event.statusChanges.map((change) =>
    Object.freeze({ ...change, task: Object.freeze({ ...change.task }) }),
  );
  Object.freeze(taskIds);
  Object.freeze(removedTaskIds);
  Object.freeze(taskSnapshots);
  Object.freeze(statusChanges);
  return Object.freeze({
    ...event,
    boardChanges,
    taskIds,
    removedTaskIds,
    taskSnapshots,
    statusChanges,
  });
};

const freezeFrame = (frame: TaskEventStreamFrame): TaskEventStreamFrame =>
  frame.type === "change"
    ? Object.freeze({
        ...frame,
        cursor: freezeCursor(frame.cursor),
        event: freezeEvent(frame.event),
      })
    : Object.freeze({ ...frame, cursor: freezeCursor(frame.cursor) });

const validationError = <Details extends object>(
  message: string,
  field: string,
  details: HostErrorDetails<Details>,
) => new HostValidationError({ message, field, details });

const jsonIssues = (
  issues: ReadonlyArray<{ code: string; message: string; path: readonly PropertyKey[] }>,
): Array<{ code: string; message: string; path: string[] }> =>
  issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.map(String),
  }));

import {
  notificationStreamSubscribeSchema,
  notificationStreamFrameSchema,
  type NotificationCursor,
  type NotificationHealth,
  type NotificationStreamFrame,
  type SelectedNotification,
} from "@openducktor/contracts";
import { notificationReplayReason } from "@openducktor/core";
import { Deferred, Effect, Queue, Stream } from "effect";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
  toHostOperationError,
} from "../../effect/host-errors";

const RETENTION = 256;

/** Keep bounded replay and reader queues. Shutdown fails readers and waits for their scopes to close. */
export const createNotificationStream = (): NotificationStream => {
  const epoch = crypto.randomUUID();
  let sequence = 0;
  let stopped = false;
  const retained: NotificationStreamFrame[] = [];
  const health = new Map<string, NotificationHealth>();
  const subscribers = new Set<Subscriber>();
  const cursor = (): NotificationCursor => ({ epoch, sequence });
  const publish = (frame: NotificationStreamFrame) => {
    const validated = structuredClone(notificationStreamFrameSchema.parse(frame));
    retained.push(validated);
    if (retained.length > RETENTION) retained.shift();
    for (const subscriber of subscribers) {
      // Native event callbacks publish without yielding, so replay and live frames stay ordered.
      if (!subscriber.queue.unsafeOffer(validated)) {
        Deferred.unsafeDone(
          subscriber.failure,
          Effect.fail(
            streamError("Notification stream consumer cannot keep up. Reload to reconnect."),
          ),
        );
      }
    }
  };
  return {
    publishOccurrence(selected) {
      sequence += 1;
      publish({ type: "occurrence", cursor: cursor(), selected });
    },
    publishHealth(update) {
      const key = `${update.scope}:${update.source}`;
      if (update.message === null) health.delete(key);
      else health.set(key, update);
      sequence += 1;
      publish({ type: "health", cursor: cursor(), health: update });
    },
    subscribe(input) {
      return Stream.unwrapScoped(
        Effect.gen(function* () {
          const requested = yield* Effect.try({
            try: () => notificationStreamSubscribeSchema.parse(input).cursor,
            catch: (cause) => toHostOperationError(cause, "notifications.stream.subscribe"),
          });
          const subscriber = yield* Effect.acquireRelease(
            Effect.gen(function* () {
              const queue = yield* Queue.dropping<NotificationStreamFrame>(RETENTION + 1);
              const failure = yield* Deferred.make<void, HostOperationError>();
              const released = yield* Deferred.make<void>();
              return { queue, failure, released };
            }),
            (subscriber) =>
              Effect.gen(function* () {
                subscribers.delete(subscriber);
                yield* Queue.shutdown(subscriber.queue);
                yield* Deferred.succeed(subscriber.released, undefined);
              }),
          );
          if (stopped)
            return yield* streamError("Notification host stopped. Reconnect to the host.");
          const current = cursor();
          const reason = notificationReplayReason(requested, current, retained[0]?.cursor.sequence);
          subscribers.add(subscriber);
          subscriber.queue.unsafeOffer({
            type: "attached",
            cursor: reason === "replay" && requested ? requested : current,
            reason,
            health: structuredClone([...health.values()]),
          });
          if (reason === "replay" && requested) {
            for (const frame of retained)
              if (frame.cursor.sequence > requested.sequence) subscriber.queue.unsafeOffer(frame);
          }
          // Let the transport install its cleanup before the first frame reaches its listener.
          return Stream.fromEffect(Effect.yieldNow()).pipe(
            Stream.drain,
            Stream.concat(Stream.fromQueue(subscriber.queue)),
            Stream.map((frame) => structuredClone(frame)),
            Stream.interruptWhenDeferred(subscriber.failure),
          );
        }),
      );
    },
    dispose: () =>
      Effect.gen(function* () {
        stopped = true;
        const active = [...subscribers];
        for (const subscriber of active)
          yield* Deferred.fail(
            subscriber.failure,
            streamError("Notification host stopped. Reconnect to the host."),
          );
        for (const subscriber of active) yield* Deferred.await(subscriber.released);
        retained.length = 0;
      }),
  };
};

export type NotificationStream = {
  publishOccurrence(selected: SelectedNotification): void;
  publishHealth(update: NotificationHealth): void;
  subscribe(input: {
    cursor: NotificationCursor | null;
  }): Stream.Stream<NotificationStreamFrame, HostOperationErrorAggregate>;
  dispose(): Effect.Effect<void>;
};

type Subscriber = {
  queue: Queue.Queue<NotificationStreamFrame>;
  failure: Deferred.Deferred<void, HostOperationError>;
  released: Deferred.Deferred<void>;
};

const streamError = (message: string): HostOperationError =>
  new HostOperationError({ operation: "notifications.stream", message });

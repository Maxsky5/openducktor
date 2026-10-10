import {
  browserEventCursorSchema,
  notificationCursorSchema,
  type BrowserEventCursor,
  type BrowserReplayComplete,
} from "@openducktor/contracts";
import type { EffectNodeHostCommandRouter } from "@openducktor/host";
import { Effect, Fiber, Stream } from "effect";
import { WebHostRequestError } from "./effect/web-errors";
import type { BufferedHostEventStream } from "./typescript-host-backend-support";

export const createCombinedHostSseResponse = (
  request: Request,
  host: BufferedHostEventStream,
  notifications: EffectNodeHostCommandRouter["notificationStream"],
  corsHeaders: HeadersInit,
  reportDeliveryFailure: (cause: unknown) => void,
): Effect.Effect<Response, WebHostRequestError> =>
  Effect.try({
    try: () => {
      const raw = request.headers.get("last-event-id");
      const requested = new URL(request.url).searchParams.get("notificationCursor");
      const previous = raw === null ? null : browserEventCursorSchema.parse(JSON.parse(raw));
      // A cursor from another host process cannot be replayed. Its observers attach again.
      const hostChanged = previous !== null && previous.hostEpoch !== host.hostEpoch;
      const replay =
        previous && !hostChanged
          ? host.replayAfter(previous.hostEventId)
          : { events: [], gaps: [] };
      const replayComplete: BrowserReplayComplete = { hostChanged, gaps: replay.gaps };
      const cursor: BrowserEventCursor = {
        hostEpoch: host.hostEpoch,
        hostEventId: previous && !hostChanged ? previous.hostEventId : host.currentEventId(),
        notificationCursor: previous
          ? previous.notificationCursor
          : requested === null
            ? null
            : notificationCursorSchema.parse(JSON.parse(requested)),
      };
      let closed = false;
      let stopHost: (() => void) | null = null;
      let stopNotifications: (() => void) | null = null;
      const stop = () => {
        closed = true;
        stopHost?.();
        stopNotifications?.();
      };
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>(
        {
          start(controller) {
            const fail = (cause: unknown) => {
              if (closed) return;
              stop();
              reportDeliveryFailure(cause);
              controller.error(cause);
            };
            const write = (eventName: string, data: string) => {
              if (closed) return;
              try {
                if ((controller.desiredSize ?? 0) <= 0)
                  throw new Error("Host event consumer cannot keep up. Reload to reconnect.");
                controller.enqueue(
                  encoder.encode(
                    [
                      `id: ${JSON.stringify(cursor)}`,
                      `event: ${eventName}`,
                      ...data.split(/\r?\n/).map((line) => `data: ${line}`),
                      "",
                      "",
                    ].join("\n"),
                  ),
                );
              } catch (cause) {
                fail(cause);
              }
            };
            controller.enqueue(encoder.encode(": openducktor-ready\n\n"));
            for (const event of replay.events) {
              cursor.hostEventId = event.id;
              write(event.eventName, event.payload);
            }
            // The replay covers every retained event, and `gaps` reports the evicted ones.
            cursor.hostEventId = host.currentEventId();
            write("replay-complete", JSON.stringify(replayComplete));
            if (closed) return;
            stopHost = host.subscribe((event) => {
              cursor.hostEventId = event.id;
              write(event.eventName, event.payload);
            });
            const delivery = Effect.runFork(
              notifications.subscribe({ cursor: cursor.notificationCursor }).pipe(
                Stream.runForEach((frame) =>
                  Effect.sync(() => {
                    cursor.notificationCursor = frame.cursor;
                    write("notification-frame", JSON.stringify(frame));
                  }),
                ),
                Effect.catch((cause) => Effect.sync(() => fail(cause))),
              ),
            );
            stopNotifications = () => {
              Effect.runFork(Fiber.interrupt(delivery));
            };
          },
          cancel: stop,
        },
        // Host replay, a 256-frame notification replay, readiness, replay end, and attachment.
        { highWaterMark: replay.events.length + 259 },
      );
      return new Response(body, {
        headers: {
          ...corsHeaders,
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    },
    catch: (cause) =>
      new WebHostRequestError({
        status: 400,
        message: "Invalid combined event subscription. Reload to reconnect.",
        cause,
      }),
  });

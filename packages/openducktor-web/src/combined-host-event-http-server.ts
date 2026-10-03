import {
  browserEventCursorSchema,
  notificationCursorSchema,
  type BrowserEventCursor,
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
      let cursor: BrowserEventCursor;
      if (raw === null) {
        cursor = {
          hostEventId: host.currentEventId(),
          notificationCursor:
            requested === null ? null : notificationCursorSchema.parse(JSON.parse(requested)),
        };
      } else {
        cursor = browserEventCursorSchema.parse(JSON.parse(raw));
      }
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
            const replay = host.replayAfterWithDiagnostics(cursor.hostEventId);
            if (replay.skippedEventCount > 0)
              write(
                "stream-warning",
                `Host event stream skipped ${replay.skippedEventCount} events; reconnect will replay buffered events.`,
              );
            for (const event of replay.events) {
              cursor.hostEventId = event.id;
              write(event.eventName, event.payload);
            }
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
                Effect.catchAll((cause) => Effect.sync(() => fail(cause))),
              ),
            );
            stopNotifications = () => {
              Effect.runFork(Fiber.interrupt(delivery));
            };
          },
          cancel: stop,
        },
        { highWaterMark: 515 },
      ); // Two 256-frame replays, readiness, a gap warning, and notification attachment.
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

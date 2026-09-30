import { Effect, Fiber, Stream } from "effect";
import type { z } from "zod";
import { notificationStreamSubscribeSchema } from "@openducktor/contracts";
import type { EffectNodeHostCommandRouter } from "@openducktor/host";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import {
  NOTIFICATION_STREAM_SUBSCRIBE,
  NOTIFICATION_STREAM_UNSUBSCRIBE,
  NOTIFICATION_STREAM_FRAME,
  NOTIFICATION_STREAM_ACKNOWLEDGE,
  notificationAcknowledgementSchema,
  NOTIFICATION_STREAM_FAILURE,
  notificationSubscriptionSchema,
} from "../shared/electron-notification-stream-contract";

// One attachment frame plus the host's 256 retained frames must fit before acknowledgements.
const MAX_UNACKNOWLEDGED_FRAMES = 257;

export const registerElectronNotificationStreamIpc = (
  ipcMain: IpcMain,
  stream: EffectNodeHostCommandRouter["notificationStream"],
  reportDeliveryFailure: (failure: { cause: unknown; subscriptionId: string }) => void,
) => {
  const subscriptions = new Map<
    string,
    { frame: Electron.WebFrameMain; stop(): void; acknowledge(deliveryId: number): void }
  >();
  ipcMain.handle(
    NOTIFICATION_STREAM_SUBSCRIBE,
    (event, raw: z.input<typeof notificationStreamSubscribeSchema>) => {
      const frame = trustedFrame(event);
      const input = notificationStreamSubscribeSchema.parse(raw);
      const subscriptionId = crypto.randomUUID();
      let closed = false;
      let sent = 0;
      let acknowledged = 0;
      const release = () => {
        closed = true;
        subscriptions.get(subscriptionId)?.stop();
        subscriptions.delete(subscriptionId);
      };
      const failDelivery = (cause: unknown) => {
        if (closed) return;
        reportDeliveryFailure({ cause, subscriptionId });
        try {
          if (!frame.isDestroyed())
            frame.send(NOTIFICATION_STREAM_FAILURE, {
              subscriptionId,
              message: (cause instanceof Error ? cause.message : String(cause)).slice(0, 1000),
            });
        } catch (terminalCause) {
          reportDeliveryFailure({ cause: terminalCause, subscriptionId });
        } finally {
          release();
        }
      };
      const delivery = Effect.runFork(
        stream.subscribe(input).pipe(
          Stream.runForEach((value) =>
            Effect.sync(() => {
              if (closed) return;
              if (
                frame.isDestroyed() ||
                event.sender.isDestroyed() ||
                frame !== event.sender.mainFrame
              ) {
                release();
                return;
              }
              if (sent - acknowledged >= MAX_UNACKNOWLEDGED_FRAMES) {
                failDelivery(
                  new Error("Notification renderer cannot keep up. Reload to reconnect."),
                );
                return;
              }
              sent += 1;
              try {
                frame.send(NOTIFICATION_STREAM_FRAME, {
                  subscriptionId,
                  deliveryId: sent,
                  frame: value,
                });
              } catch (cause) {
                failDelivery(cause);
              }
            }),
          ),
          Effect.catchAll((cause) => Effect.sync(() => failDelivery(cause))),
        ),
      );
      const navigation = (
        details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
      ) => {
        if (details.isMainFrame && !details.isSameDocument) release();
      };
      event.sender.once("destroyed", release);
      event.sender.once("render-process-gone", release);
      event.sender.on("did-start-navigation", navigation);
      subscriptions.set(subscriptionId, {
        frame,
        acknowledge(deliveryId) {
          if (deliveryId > sent)
            throw new Error("Notification acknowledgement exceeds sent delivery.");
          acknowledged = Math.max(acknowledged, deliveryId);
        },
        stop() {
          closed = true;
          Effect.runFork(Fiber.interrupt(delivery));
          event.sender.off("destroyed", release);
          event.sender.off("render-process-gone", release);
          event.sender.off("did-start-navigation", navigation);
        },
      });
      return { subscriptionId };
    },
  );
  ipcMain.handle(
    NOTIFICATION_STREAM_ACKNOWLEDGE,
    (event, raw: z.input<typeof notificationAcknowledgementSchema>) => {
      const frame = trustedFrame(event);
      const { subscriptionId, deliveryId } = notificationAcknowledgementSchema.parse(raw);
      const subscription = subscriptions.get(subscriptionId);
      // Queued acknowledgements can arrive after terminal failure or renderer cleanup.
      if (!subscription) return;
      if (subscription.frame !== frame)
        throw new Error("Notification subscription belongs to another renderer.");
      subscription.acknowledge(deliveryId);
    },
  );
  ipcMain.handle(
    NOTIFICATION_STREAM_UNSUBSCRIBE,
    (event, raw: z.input<typeof notificationSubscriptionSchema>) => {
      const frame = trustedFrame(event);
      const { subscriptionId } = notificationSubscriptionSchema.parse(raw);
      const subscription = subscriptions.get(subscriptionId);
      if (!subscription) return;
      if (subscription.frame !== frame)
        throw new Error("Notification subscription belongs to another renderer.");
      subscription.stop();
      subscriptions.delete(subscriptionId);
    },
  );
};

const trustedFrame = (event: IpcMainInvokeEvent) => {
  const frame = event.senderFrame;
  if (
    event.sender.isDestroyed() ||
    !frame ||
    frame.isDestroyed() ||
    frame !== event.sender.mainFrame
  ) {
    throw new Error("Notification stream IPC requires the active main frame.");
  }
  return frame;
};

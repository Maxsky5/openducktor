import type { z } from "zod";
import { notificationStreamSubscribeSchema } from "@openducktor/contracts";
import type { IpcRenderer, IpcRendererEvent } from "electron";
import type { OpenDucktorElectronApi } from "../shared/electron-bridge-contract";
import {
  NOTIFICATION_STREAM_DELIVERY_LIMIT,
  NOTIFICATION_STREAM_SUBSCRIBE,
  NOTIFICATION_STREAM_UNSUBSCRIBE,
  NOTIFICATION_STREAM_FRAME,
  NOTIFICATION_STREAM_ACKNOWLEDGE,
  notificationAcknowledgementSchema,
  NOTIFICATION_STREAM_FAILURE,
  notificationSubscriptionSchema,
  notificationFrameEnvelopeSchema,
  notificationFailureEnvelopeSchema,
} from "../shared/electron-notification-stream-contract";

export const createElectronNotificationStreamApi = (
  ipcRenderer: Pick<IpcRenderer, "invoke" | "on" | "off">,
): OpenDucktorElectronApi["notificationStream"] => ({
  async subscribe(input, onFrame, onFailure) {
    let subscriptionId: string | null = null;
    let disposed = false;
    const buffered: Array<() => void> = [];
    let attachmentFailure: Error | null = null;
    const stop = () => {
      if (disposed) return;
      disposed = true;
      ipcRenderer.off(NOTIFICATION_STREAM_FRAME, receive);
      ipcRenderer.off(NOTIFICATION_STREAM_FAILURE, fail);
      buffered.length = 0;
      if (subscriptionId)
        void ipcRenderer
          .invoke(NOTIFICATION_STREAM_UNSUBSCRIBE, { subscriptionId })
          .catch(onFailure);
    };
    const reportFailure = (cause: unknown) => {
      if (disposed) return;
      attachmentFailure = cause instanceof Error ? cause : new Error(String(cause));
      stop();
      onFailure(attachmentFailure);
    };
    // Main can send one terminal failure after its delivery window fills.
    const receiveOrBuffer = (deliver: () => void) => {
      if (disposed) return;
      if (subscriptionId) deliver();
      else if (buffered.length < NOTIFICATION_STREAM_DELIVERY_LIMIT + 1) buffered.push(deliver);
      else reportFailure(new Error("Notification attachment buffer is full. Reload to reconnect."));
    };
    const receive = (
      _event: IpcRendererEvent,
      raw: z.input<typeof notificationFrameEnvelopeSchema>,
    ) => {
      const parsed = notificationFrameEnvelopeSchema.safeParse(raw);
      if (!parsed.success) {
        reportFailure(new Error("Invalid notification frame. Reload to reconnect."));
        return;
      }
      const envelope = parsed.data;
      receiveOrBuffer(() => {
        if (disposed || envelope.subscriptionId !== subscriptionId) return;
        try {
          onFrame(envelope.frame);
          void ipcRenderer
            .invoke(
              NOTIFICATION_STREAM_ACKNOWLEDGE,
              notificationAcknowledgementSchema.parse({
                subscriptionId,
                deliveryId: envelope.deliveryId,
              }),
            )
            .catch(reportFailure);
        } catch (cause) {
          reportFailure(cause);
        }
      });
    };
    const fail = (
      _event: IpcRendererEvent,
      raw: z.input<typeof notificationFailureEnvelopeSchema>,
    ) => {
      const parsed = notificationFailureEnvelopeSchema.safeParse(raw);
      if (!parsed.success) {
        reportFailure(new Error("Invalid notification failure. Reload to reconnect."));
        return;
      }
      const envelope = parsed.data;
      receiveOrBuffer(() => {
        if (!disposed && envelope.subscriptionId === subscriptionId)
          reportFailure(new Error(envelope.message));
      });
    };
    ipcRenderer.on(NOTIFICATION_STREAM_FRAME, receive);
    ipcRenderer.on(NOTIFICATION_STREAM_FAILURE, fail);
    try {
      const response = notificationSubscriptionSchema.parse(
        await ipcRenderer.invoke(
          NOTIFICATION_STREAM_SUBSCRIBE,
          notificationStreamSubscribeSchema.parse(input),
        ),
      );
      subscriptionId = response.subscriptionId;
      if (attachmentFailure) {
        await ipcRenderer.invoke(NOTIFICATION_STREAM_UNSUBSCRIBE, response);
        throw attachmentFailure;
      }
      for (const deliver of buffered) deliver();
      buffered.length = 0;
      return stop;
    } catch (cause) {
      stop();
      throw cause;
    }
  },
});

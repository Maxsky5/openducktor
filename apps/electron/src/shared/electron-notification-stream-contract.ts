import { z } from "zod";
import { notificationStreamFrameSchema } from "@openducktor/contracts";
// Allow attachment, 256 replay frames, and 257 queued live frames before acknowledgements.
export const NOTIFICATION_STREAM_DELIVERY_LIMIT = 514;
export const NOTIFICATION_STREAM_SUBSCRIBE = "openducktor:notification-stream:subscribe";
export const NOTIFICATION_STREAM_UNSUBSCRIBE = "openducktor:notification-stream:unsubscribe";
export const NOTIFICATION_STREAM_ACKNOWLEDGE = "openducktor:notification-stream:acknowledge";
export const NOTIFICATION_STREAM_FRAME = "openducktor:notification-stream:frame";
export const NOTIFICATION_STREAM_FAILURE = "openducktor:notification-stream:failure";
export const notificationSubscriptionSchema = z.strictObject({ subscriptionId: z.string().uuid() });
export const notificationFrameEnvelopeSchema = notificationSubscriptionSchema.extend({
  deliveryId: z.number().int().positive(),
  frame: notificationStreamFrameSchema,
});
export const notificationFailureEnvelopeSchema = notificationSubscriptionSchema.extend({
  message: z.string().min(1),
});

export const notificationAcknowledgementSchema = notificationSubscriptionSchema.extend({
  deliveryId: z.number().int().positive(),
});

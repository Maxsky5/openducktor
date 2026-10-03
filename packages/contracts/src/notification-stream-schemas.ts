import { z } from "zod";
import { notificationOccurrenceSchema, notificationSettingsSchema } from "./notification-schemas";

export const notificationCursorSchema = z.strictObject({
  epoch: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
});
export type NotificationCursor = z.infer<typeof notificationCursorSchema>;
export const selectedNotificationSchema = z.strictObject({
  occurrence: notificationOccurrenceSchema,
  settings: notificationSettingsSchema.removeDefault(),
  preferenceRevision: z.number().int().nonnegative(),
});
export type SelectedNotification = z.infer<typeof selectedNotificationSchema>;
export const notificationStreamSubscribeSchema = z.strictObject({
  cursor: notificationCursorSchema.nullable(),
});
export const notificationHealthSchema = z.strictObject({
  scope: z.string().min(1),
  source: z.enum(["initialization", "task", "session", "settings"]),
  message: z.string().min(1).max(1000).nullable(),
});
export type NotificationHealth = z.infer<typeof notificationHealthSchema>;
export const notificationStreamFrameSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("attached"),
    cursor: notificationCursorSchema,
    reason: z.enum(["new", "replay", "gap", "epoch_changed"]),
    health: z.array(notificationHealthSchema),
  }),
  z.strictObject({
    type: z.literal("occurrence"),
    cursor: notificationCursorSchema,
    selected: selectedNotificationSchema,
  }),
  z.strictObject({
    type: z.literal("health"),
    cursor: notificationCursorSchema,
    health: notificationHealthSchema,
  }),
]);
export type NotificationStreamFrame = z.infer<typeof notificationStreamFrameSchema>;
export const notificationActionOccurrenceSchema = notificationOccurrenceSchema.extend({
  kind: z.enum(["agent.session_started", "agent.session_error"]),
});

export type NotificationActionOccurrence = z.infer<typeof notificationActionOccurrenceSchema>;

import { z } from "zod";
import { notificationCursorSchema } from "./notification-stream-schemas";

// This cursor belongs to a live SSE connection. It is not a durable task record.
export const browserEventCursorSchema = z.strictObject({
  hostEpoch: z.uuid(),
  hostEventId: z.number().int().nonnegative(),
  notificationCursor: notificationCursorSchema.nullable(),
});
export type BrowserEventCursor = z.infer<typeof browserEventCursorSchema>;

import { z } from "zod";
import { notificationCursorSchema } from "./notification-stream-schemas";

// This cursor belongs to a live SSE connection. It is not a durable task record.
export const browserEventCursorSchema = z.strictObject({
  // Event IDs are valid only for the host process that issued them.
  hostEpoch: z.string().min(1),
  hostEventId: z.number().int().nonnegative(),
  notificationCursor: notificationCursorSchema.nullable(),
});
export type BrowserEventCursor = z.infer<typeof browserEventCursorSchema>;

/**
 * Ends the replay of each SSE connection. `gaps` names the SSE event names whose missed events
 * the host no longer retains. `hostChanged` means the cursor came from another host process.
 */
export const browserReplayCompleteSchema = z.strictObject({
  hostChanged: z.boolean(),
  gaps: z.array(z.string().min(1)),
});
export type BrowserReplayComplete = z.infer<typeof browserReplayCompleteSchema>;

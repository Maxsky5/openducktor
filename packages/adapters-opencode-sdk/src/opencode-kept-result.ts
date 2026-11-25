import type { JsonValue, SessionMessageSynthetic } from "@opencode/client";
import { z } from "zod";

/**
 * Stop session queues the result of a stopped task again with no wake, and OpenCode delivers it
 * with the next input of the session. OpenCode records only the time of that delivery, so the
 * queued copy keeps the time of the original notice in `metadata.openducktor.endedAt`.
 */
const keptResultSchema = z.object({ endedAt: z.number().int().nonnegative() }).strict();

/** The metadata of a kept result: the metadata of its notice and the time of that notice. */
export const keptResultMetadata = (
  metadata: Readonly<Record<string, JsonValue>> | undefined,
  endedAt: number,
) => ({ ...metadata, openducktor: { endedAt } });

/** The time at which the task of a result notice ended: the kept time, or the notice time. */
export const resultEndedAt = (message: SessionMessageSynthetic): number => {
  const kept = message.metadata?.openducktor;
  if (kept === undefined) return message.time.created;
  const parsed = keptResultSchema.safeParse(kept);
  if (!parsed.success)
    throw new Error(
      `The task result '${message.id}' has invalid OpenDucktor metadata: ${z.prettifyError(parsed.error)} Reload this conversation.`,
    );
  return parsed.data.endedAt;
};

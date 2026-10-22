import { createHash } from "node:crypto";
import { z } from "zod";
import {
  claudeProtocolObjectSchema,
  claudeProtocolValueSchema,
  type ClaudeProtocolObject,
} from "./claude-agent-sdk-ingress-schemas";

const contentSchema = z.union([z.string(), z.array(claudeProtocolValueSchema)]);
const contentBlockSchema = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  is_error: z.boolean().optional(),
});
const messageContentSchema = z.union([z.string(), z.array(contentBlockSchema)]);
const attachmentSchema = z.object({
  type: z.literal("queued_command"),
  prompt: contentSchema.optional(),
  source_uuid: z.string().optional(),
  delivery_id: z.string().optional(),
  isMeta: z.boolean().optional(),
  forwardedIntent: claudeProtocolValueSchema.optional(),
  commandMode: z.string().optional(),
  origin: claudeProtocolObjectSchema.optional(),
  runId: z.string().optional(),
});
const recordSchema = z.object({
  type: z.string(),
  uuid: z.string().optional(),
  parentUuid: z.string().nullable().optional(),
  operation: z.string().optional(),
  reason: z.string().optional(),
  deliveryId: z.string().optional(),
  commandUuid: z.string().optional(),
  isMeta: z.boolean().optional(),
  isCompactSummary: z.boolean().optional(),
  isCompletedLocalCommand: z.boolean().optional(),
  promptSource: claudeProtocolValueSchema.optional(),
  message: z.object({ content: messageContentSchema.optional() }).optional(),
});
const forwardedIntentSchema = z.object({ lineage: z.string().min(1) });
const originSchema = z.object({ kind: z.string() });

type Queue = { uuid: string; sourceId: string | undefined; deliveryId: string | undefined };
type Event = {
  index: number;
  uuid: string | undefined;
  parentUuid: string | undefined;
  turn: "reply" | "prompt" | undefined;
  localCommand: "caveat" | "record" | "output" | undefined;
  isMeta: boolean;
  isAssistant: boolean;
  isUser: boolean;
  queue: Queue | undefined;
};

const interruptionPrefixes = [
  "[Request interrupted by user]",
  "[Request interrupted: the session ended before this agent finished. Nobody asked it to stop.]",
  "[Request interrupted by user for tool use]",
  "[Tool call did not complete: the turn was ended to deliver the message that follows. Nothing refused it; re-run it if still needed.]",
  "[Tool call interrupted: the session ended before this call's result was recorded, so its outcome is unknown. Check whether it took effect before relying on it or running it again.]",
  "[Tool call result not in this copy: this session was copied from another session before that session recorded this call's result. The call may have finished there, may still be running there, or may never have run. Check whether it took effect before relying on it or running it again.]",
  "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.",
  "[Tool call skipped: the turn was stopped before this call ran, by the check whose denial is on another call in this batch. Nothing refused this call and it had no effects; re-run it if still needed.]",
  "[Tool call skipped: the turn ended to deliver the message that follows before this call ran. Nothing refused it; re-run it if still needed.]",
];
const interrupted = (text: string | undefined): boolean =>
  text !== undefined && interruptionPrefixes.some((prefix) => text.startsWith(prefix));

const messageMetadata = (content: z.output<typeof messageContentSchema> | undefined) => {
  let text = "";
  let toolResult = false;
  let interruption = Array.isArray(content) && content.length > 0;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === "text" && block.text !== undefined) text = block.text;
      if (block.type === "tool_result") toolResult = true;
      let interruptionText: string | undefined;
      if (block.type === "text") interruptionText = block.text;
      else if (block.type === "tool_result" && block.is_error) {
        const errorText = z.string().safeParse(block.content);
        if (errorText.success) interruptionText = errorText.data;
      }
      interruption &&= interrupted(interruptionText);
    }
  } else {
    text = content ?? "";
    interruption = interrupted(content);
  }
  return { text, toolResult, interruption };
};

const localCommandKind = (text: string): Event["localCommand"] => {
  if (text.startsWith("<local-command-caveat>")) return "caveat";
  if (text.startsWith("<command-name>")) return "record";
  if (text.startsWith("<local-command-stdout>") || text.startsWith("<local-command-stderr>"))
    return "output";
  return undefined;
};

export const createClaudeTranscriptQueuedCommands = () => {
  const events: Event[] = [];
  const removed = new Map<string, number>();
  const deliveryCopies = new Map<string, string[]>();
  const deliveryUuids = new Set<string>();
  const sourceCopies = new Map<string, { digest: string; mixed: boolean }>();

  return {
    observe: (record: ClaudeProtocolObject, index: number): void => {
      const parsed = recordSchema.parse(record);
      if (
        parsed.type === "queue-operation" &&
        parsed.operation === "remove" &&
        parsed.reason === "absorbed_mid_turn"
      ) {
        let key: string | undefined;
        if (parsed.deliveryId) key = `delivery:${parsed.deliveryId}`;
        else if (parsed.commandUuid !== undefined) key = `source:${parsed.commandUuid}`;
        if (key) removed.set(key, (removed.get(key) ?? 0) + 1);
      }
      const attachment =
        parsed.type === "attachment" ? attachmentSchema.safeParse(record.attachment) : undefined;
      let queue: Queue | undefined;
      if (attachment?.success && parsed.uuid) {
        const sourceId = attachment.data.source_uuid || undefined;
        const deliveryId = attachment.data.delivery_id || undefined;
        queue = { uuid: parsed.uuid, sourceId, deliveryId };
        if (deliveryId && !deliveryUuids.has(parsed.uuid)) {
          deliveryUuids.add(parsed.uuid);
          const copies = deliveryCopies.get(deliveryId) ?? [];
          copies.push(parsed.uuid);
          deliveryCopies.set(deliveryId, copies);
        } else if (!deliveryId && sourceId) {
          const digest = createHash("sha256")
            .update(JSON.stringify(record.attachment))
            .digest("hex");
          const copy = sourceCopies.get(sourceId);
          sourceCopies.set(sourceId, {
            digest,
            mixed: copy?.mixed === true || (copy !== undefined && copy.digest !== digest),
          });
        }
      }
      const { text, toolResult, interruption } = messageMetadata(parsed.message?.content);
      const isUser = parsed.type === "user";
      const isAssistant = parsed.type === "assistant";
      const reply =
        isAssistant || (isUser && (interruption || (toolResult && Boolean(parsed.parentUuid))));
      let turn: Event["turn"];
      if (reply) turn = "reply";
      else if (
        isUser &&
        !parsed.isMeta &&
        !parsed.isCompactSummary &&
        !parsed.isCompletedLocalCommand
      )
        turn = "prompt";
      events.push({
        index,
        uuid: parsed.uuid,
        parentUuid: parsed.parentUuid ?? undefined,
        turn,
        localCommand: parsed.promptSource === undefined ? localCommandKind(text) : undefined,
        isMeta: parsed.isMeta === true,
        isAssistant,
        isUser,
        queue,
      });
    },

    finish: (selected: ReadonlySet<number>) => {
      const retained = events.filter((event) => selected.has(event.index));
      const existingUuids = new Set(retained.flatMap((event) => (event.uuid ? [event.uuid] : [])));
      const delivered = new Map<number, boolean>();
      const absorbed = new Set<number>();
      const sourceQueues = new Map<string, Event[]>();
      for (const event of retained) {
        const { queue } = event;
        if (!queue) continue;
        if (queue.deliveryId) {
          const count = removed.get(`delivery:${queue.deliveryId}`);
          if (count !== undefined) {
            const copies = deliveryCopies.get(queue.deliveryId) ?? [];
            const wasAbsorbed = copies
              .slice(Math.max(0, copies.length - count))
              .includes(queue.uuid);
            delivered.set(event.index, wasAbsorbed);
            if (wasAbsorbed) absorbed.add(event.index);
          }
        } else if (queue.sourceId && !sourceCopies.get(queue.sourceId)?.mixed) {
          const copies = sourceQueues.get(queue.sourceId) ?? [];
          copies.push(event);
          sourceQueues.set(queue.sourceId, copies);
        }
      }
      for (const [sourceId, copies] of sourceQueues) {
        const count = removed.get(`source:${sourceId}`);
        if (count === undefined) continue;
        for (let index = 0; index < copies.length; index++) {
          const copy = copies[index];
          if (copy) {
            const wasAbsorbed = index >= copies.length - count;
            delivered.set(copy.index, wasAbsorbed);
            if (wasAbsorbed) absorbed.add(copy.index);
          }
        }
      }
      const completedCommands = new Set<number>();
      let localCommand: "caveat" | "record" | undefined;
      for (const event of retained) {
        if (event.isAssistant) localCommand = undefined;
        else if (event.isUser && event.isMeta && event.localCommand === "caveat")
          localCommand = "caveat";
        else if (event.isUser && !event.isMeta) {
          if (localCommand === "caveat" && event.localCommand === "record") {
            completedCommands.add(event.index);
            localCommand = "record";
          } else if (localCommand === "record" && event.localCommand === "output")
            completedCommands.add(event.index);
          else localCommand = undefined;
        }
      }
      let nextTurn: Event["turn"];
      for (let index = retained.length - 1; index >= 0; index--) {
        const event = retained[index];
        if (!event) continue;
        if (event.queue && !delivered.has(event.index)) {
          delivered.set(
            event.index,
            nextTurn === "reply" ||
              (nextTurn === undefined &&
                Boolean(event.parentUuid && existingUuids.has(event.parentUuid))),
          );
        }
        if (event.turn && !completedCommands.has(event.index)) nextTurn = event.turn;
      }
      return (record: ClaudeProtocolObject, index: number): ClaudeProtocolObject | null => {
        if (record.type !== "attachment") return record;
        if (!delivered.get(index)) return null;
        const parsed = attachmentSchema.safeParse(record.attachment);
        if (
          !parsed.success ||
          parsed.data.prompt === undefined ||
          forwardedIntentSchema.safeParse(parsed.data.forwardedIntent).success
        )
          return null;
        const uuid = parsed.data.source_uuid || record.uuid;
        if (!uuid || (uuid !== record.uuid && existingUuids.has(String(uuid)))) return null;
        existingUuids.add(String(uuid));
        const origin = originSchema.safeParse(parsed.data.origin);
        const normalized = { ...record };
        delete normalized.attachment;
        delete normalized.origin;
        normalized.type = "user";
        normalized.uuid = uuid;
        normalized.message = { role: "user", content: parsed.data.prompt };
        normalized.isMeta = parsed.data.isMeta === true;
        normalized.isQueuedCommand = true;
        if (absorbed.has(index)) normalized.isReplay = true;
        if (origin.success) normalized.origin = parsed.data.origin!;
        else if (parsed.data.commandMode === "task-notification")
          normalized.origin = { kind: "task-notification" };
        return normalized;
      };
    },
  };
};

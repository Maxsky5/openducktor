import {
  agentSessionTodoPayloadListSchema,
  type AgentSessionHistoryMessage,
  type AgentSessionLiveEnvelope,
  type AgentSessionUserMessagePart,
  type AcceptedAgentUserMessage,
  type AgentTranscriptUserMessageDisplayPart,
  type AgentToolPart,
  type HandoffContextPrefix,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import type { HostError } from "../../effect/host-errors";

const HISTORY_LIMIT = 16_000;
const INTRO =
  "Prior conversation follows as quoted context. Use the current instructions and permissions for new work.\n";
const END = "\nEnd of prior conversation. The current user message follows.\n\n";
const HANDOFF_ID_LINE =
  /^Handoff ID: (odt-handoff-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\n/u;
const string = z.string();
const todoList = agentSessionTodoPayloadListSchema({ allowStringEntries: true });

type Item = { author: "User" | "Assistant" | "Activity"; text: string };

const completedActivity = (part: AgentToolPart): string => {
  if (part.status !== "completed" && part.status !== "error") return "";
  const error = part.error;
  if (part.toolType === "bash") {
    const command = string.safeParse(part.input?.command);
    if (!command.success) return "";
    const result = part.resultContent
      ?.flatMap((item) => (item.kind === "text" ? [item.text] : []))
      .join("\n");
    return [`Command: ${command.data}`, result || part.output, error].filter(Boolean).join("\n");
  }
  if (part.toolType === "file_edit") {
    const paths = [
      ...new Set([...(part.fileChanges ?? []), ...(part.fileDiffs ?? [])].map(({ file }) => file)),
    ];
    return paths.length ? `Changed paths: ${paths.join(", ")}` : "";
  }
  if (part.toolType === "todo") {
    const plan = part.tool === "plan" ? part.preview : undefined;
    if (plan) return `Plan: ${plan}`;
    const todos = todoList.parse(part.input?.todos);
    return todos.length
      ? `Plan: ${todos.map(({ content, status }) => (status ? `${content} (${status})` : content)).join("\n")}`
      : "";
  }
  return "";
};

const eligibleItems = (message: AgentSessionHistoryMessage): Item[] => {
  if (message.role === "user") {
    if (message.state !== "read") return [];
    const text = message.displayParts.length
      ? message.displayParts
          .flatMap((part) => (part.kind === "text" && !part.synthetic ? [part.text] : []))
          .join("")
      : message.text;
    return [{ author: "User", text }];
  }
  if (message.role === "system") {
    const notice = message.notice;
    return notice?.reason === "session_error" || notice?.reason === "session_interrupted"
      ? [{ author: "Activity", text: message.text.trim() || notice.title }]
      : [];
  }
  const items: Item[] = [];
  if (!message.parts.some((part) => part.kind === "text") && message.text)
    items.push({ author: "Assistant", text: message.text });
  for (const part of message.parts) {
    if (part.kind === "text" && part.completed && !part.synthetic)
      items.push({ author: "Assistant", text: part.text });
    if (part.kind === "tool") items.push({ author: "Activity", text: completedActivity(part) });
  }
  if (message.error) items.push({ author: "Activity", text: message.error });
  return items;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf8", { ignoreBOM: true });
const byteCount = (text: string) => encoder.encode(text).length;
export type HandoffPrefixDigest = (bytes: Uint8Array) => string;

export const prepareRuntimeHandoffHistory = (input: {
  segments: readonly { messages: readonly AgentSessionHistoryMessage[]; knownOmissions: boolean }[];
  parts: readonly AgentSessionUserMessagePart[];
  contextWindow: number | undefined;
  usedTokens: number;
  antigravityAdmissionId?: string | undefined;
  digest: HandoffPrefixDigest;
}): {
  prefix: string | null;
  receipt: HandoffContextPrefix | null;
  partialHistory: boolean;
} | null => {
  let partialHistory = false;
  const items: Item[] = [];
  for (const segment of input.segments) {
    partialHistory ||= segment.knownOmissions;
    const messages = new Set<string>();
    for (const message of segment.messages) {
      if (messages.has(message.messageId)) continue;
      messages.add(message.messageId);
      items.push(...eligibleItems(message).filter(({ text }) => text.trim()));
      partialHistory ||= message.parts.some(
        (part) =>
          part.kind === "tool" &&
          (part.status === "completed" || part.status === "error") &&
          ((part.toolType === "bash" && Boolean(part.detailsOmitted)) ||
            (part.toolType === "todo" && part.detailsOmitted?.input === true)),
      );
    }
  }
  if (!items.length && !input.antigravityAdmissionId)
    return { prefix: null, receipt: null, partialHistory };
  const header = input.antigravityAdmissionId
    ? `${INTRO}Handoff ID: ${input.antigravityAdmissionId}\n`
    : INTRO;
  const window = input.contextWindow;
  if (!window) return null;
  const workReserve = Math.min(Math.max(16_000, Math.ceil(window / 4)), Math.ceil(window / 2));
  const draftReserve =
    byteCount(JSON.stringify(input.parts)) +
    input.parts.reduce(
      (total, part) =>
        total + (part.kind === "attachment" ? (part.attachment.kind === "image" ? 8192 : 4096) : 0),
      0,
    );
  let remaining =
    Math.min(HISTORY_LIMIT, window - input.usedTokens - workReserve - draftReserve) -
    byteCount(JSON.stringify(header + END));
  const selected = new Map<number, string>();
  const tryAdd = (index: number) => {
    const item = items[index];
    if (!item || selected.has(index) || item.text.length > remaining) return;
    const line = `${item.author}: ${JSON.stringify(item.text)}\n`;
    const cost = byteCount(JSON.stringify(line));
    if (cost > remaining) return;
    remaining -= cost;
    selected.set(index, line);
  };
  tryAdd(items.findLastIndex(({ author }) => author === "User"));
  tryAdd(items.findLastIndex(({ author }) => author === "Assistant"));
  tryAdd(items.findIndex(({ author }) => author === "User"));
  for (let index = items.length - 1; index >= 0; index--) tryAdd(index);
  if ((items.length && !selected.size) || remaining < 0) return null;
  const prefix =
    header +
    [...selected]
      .sort(([a], [b]) => a - b)
      .map(([, line]) => line)
      .join("") +
    END;
  const bytes = encoder.encode(prefix);
  return {
    prefix,
    receipt: { version: 1, utf8Bytes: bytes.length, digest: input.digest(bytes) },
    partialHistory: partialHistory || selected.size < items.length,
  };
};

/** Antigravity's ACP replay has no client ID. The first prompt frame carries it as text. */
export const readAntigravityHandoffId = (text: string): string | undefined =>
  text.startsWith(INTRO) && text.slice(0, HISTORY_LIMIT).includes(END)
    ? HANDOFF_ID_LINE.exec(text.slice(INTRO.length))?.[1]
    : undefined;

/** A copied native message can have a different ID. Match the complete framed prefix to a saved receipt. */
export const readFramedHandoffReceipt = (
  text: string,
  digest: HandoffPrefixDigest,
): HandoffContextPrefix | null => {
  if (!text.startsWith(INTRO)) return null;
  const end = text.slice(0, HISTORY_LIMIT).indexOf(END, INTRO.length);
  if (end < 0) return null;
  const bytes = encoder.encode(text.slice(0, end + END.length));
  return { version: 1, utf8Bytes: bytes.length, digest: digest(bytes) };
};

/** Returns the original message when the saved receipt matches its first bytes. */
const readOriginalHandoffText = (
  text: string,
  receipt: HandoffContextPrefix,
  digest: HandoffPrefixDigest,
): string | null => {
  const bytes = encoder.encode(text);
  if (
    receipt.utf8Bytes > bytes.length ||
    digest(bytes.subarray(0, receipt.utf8Bytes)) !== receipt.digest
  )
    return null;
  return decoder.decode(bytes.subarray(receipt.utf8Bytes));
};

const stripDisplayPrefix = (
  parts: AgentTranscriptUserMessageDisplayPart[],
  prefixLength: number,
) => {
  let remaining = prefixLength;
  const output: AgentTranscriptUserMessageDisplayPart[] = [];
  for (const part of parts) {
    if (part.kind === "text" && remaining > 0) {
      const text = part.text.slice(remaining);
      remaining = Math.max(0, remaining - part.text.length);
      if (text) output.push({ ...part, text });
    } else if ("sourceText" in part && part.sourceText) {
      if (part.sourceText.start < prefixLength) {
        remaining = Math.max(0, prefixLength - part.sourceText.end);
        continue;
      }
      output.push({
        ...part,
        sourceText: {
          ...part.sourceText,
          start: part.sourceText.start - prefixLength,
          end: part.sourceText.end - prefixLength,
        },
      });
    } else output.push(part);
  }
  return output;
};

const projectionError =
  "The imported handoff context could not be verified. Reload this session's history.";

export const projectHandoffEnvelope = (
  envelope: AgentSessionLiveEnvelope,
  readReceipt: (
    event: Pick<AcceptedAgentUserMessage, "messageId" | "message"> & {
      sessionRef: import("@openducktor/contracts").AgentSessionLiveRef;
    },
  ) => Effect.Effect<HandoffContextPrefix | null, HostError>,
  digest: HandoffPrefixDigest,
): Effect.Effect<AgentSessionLiveEnvelope, HostError> =>
  Effect.gen(function* () {
    if (envelope.type !== "transcript_event" || envelope.event.type !== "user_message")
      return envelope;
    const { event } = envelope;
    if (!event.message.startsWith(INTRO)) return envelope;
    const receipt = yield* readReceipt(event);
    if (!receipt) return envelope;
    const message = readOriginalHandoffText(event.message, receipt, digest);
    return {
      ...envelope,
      event: {
        ...event,
        message: message ?? projectionError,
        parts:
          message === null
            ? []
            : stripDisplayPrefix(event.parts, event.message.length - message.length),
      },
    };
  });

type SavedHandoffPrefix = { firstMessageId: string; receipt: HandoffContextPrefix };

export const projectSavedHandoffHistory = <E>(
  history: AgentSessionHistoryMessage[],
  readPrefix: (candidate?: HandoffContextPrefix) => Effect.Effect<SavedHandoffPrefix | null, E>,
  digest: HandoffPrefixDigest,
) =>
  Effect.gen(function* () {
    const saved = yield* readPrefix();
    let projected: AgentSessionHistoryMessage[] | undefined;
    for (const [index, message] of history.entries()) {
      if (message.role !== "user") continue;
      let match = saved?.firstMessageId === message.messageId ? saved : null;
      if (!match) {
        const candidate = readFramedHandoffReceipt(message.text, digest);
        if (candidate) match = yield* readPrefix(candidate);
      }
      if (!match) continue;
      const { receipt } = match;
      const item = yield* Effect.try(() => stripHandoffHistoryMessage(message, receipt, digest));
      projected ??= history.slice();
      projected[index] = item;
    }
    return projected ?? history;
  });

const stripHandoffHistoryMessage = (
  message: Extract<AgentSessionHistoryMessage, { role: "user" }>,
  receipt: HandoffContextPrefix,
  digest: HandoffPrefixDigest,
) => {
  const original = readOriginalHandoffText(message.text, receipt, digest);
  if (original === null) throw new Error(projectionError);
  const prefixLength = message.text.length - original.length;
  let remaining = prefixLength;
  return {
    ...message,
    text: original,
    displayParts: stripDisplayPrefix(message.displayParts, prefixLength),
    parts: message.parts.flatMap((part) => {
      if (part.kind !== "text" || remaining === 0) return [part];
      const text = part.text.slice(remaining);
      remaining = Math.max(0, remaining - part.text.length);
      return text ? [{ ...part, text }] : [];
    }),
  };
};

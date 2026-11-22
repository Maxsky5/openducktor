import type { UsageLineFilter } from "./usage-jsonl-reader";

/*
 * Reads the kind of a Codex rollout line from its first bytes, so the parser can skip large lines
 * before it decodes them. All assumptions about the byte layout of a rollout line live here:
 *
 * - A line starts with `{"timestamp":"...",` and, from newer CLI versions, `"ordinal":N,`.
 * - The record type, and the payload type of an event or a response item, come in the first
 *   200 bytes, before any content.
 * - A message item has its ID and role in its first 400 bytes, before its content.
 * - A completed item event has the type of its item, its first `item` key, in the first 400 bytes.
 *
 * `usage-codex-rollouts.test.ts` reads excerpts of real rollouts of each format era to keep these
 * assumptions true.
 */

/**
 * Response items that only a model writes. A message item is model output when it is an
 * assistant message with an item ID.
 */
const MODEL_ITEMS = new Set([
  "reasoning",
  "function_call",
  "custom_tool_call",
  "local_shell_call",
  "web_search_call",
  "tool_search_call",
  "image_generation_call",
]);
/** Response items that a model reads: tool output. User and developer messages also count. */
const INPUT_ITEMS = new Set([
  "function_call_output",
  "custom_tool_call_output",
  "tool_search_output",
]);
const RESPONSE_ITEMS = new Set([...MODEL_ITEMS, ...INPUT_ITEMS, "message"]);

export const READ_RECORDS = new Set([
  "session_meta",
  "turn_context",
  "token_usage_record",
  "compacted",
]);
export const READ_EVENTS = new Set([
  "thread_settings_applied",
  "token_count",
  "task_started",
  "task_complete",
  "turn_aborted",
]);

const TYPE_KEY = Buffer.from('"type":"');
const QUOTE = 0x22;
/** A line starts with its timestamp and type. An event or an item starts its payload with its type. */
const TYPE_WITHIN = 200;

/** The value of the first `"type"` key at or after `from`, in the first bytes of the line. */
const typeAt = (line: Buffer, from: number): { value: string; end: number } | null => {
  const key = line.indexOf(TYPE_KEY, from);
  if (key < 0 || key > TYPE_WITHIN) return null;
  const start = key + TYPE_KEY.length;
  const end = line.indexOf(QUOTE, start);
  return end < 0 ? null : { value: line.toString("latin1", start, end), end };
};

export type LineKind = { record: string; item: string | null };

/** The record type of a line and, for an event or a response item, its payload type. */
export const lineKindOf = (line: Buffer): LineKind | null => {
  const record = typeAt(line, 0);
  if (record === null) return null;
  const nested = record.value === "event_msg" || record.value === "response_item";
  return { record: record.value, item: nested ? (typeAt(line, record.end)?.value ?? null) : null };
};

/**
 * Accepts the lines that the parser reads. It reads the types from the start of the line, so
 * tool output that quotes a type name never matches. Response items stay undecoded.
 */
export const CODEX_USAGE_LINE_FILTER: UsageLineFilter = (line) => {
  const kind = lineKindOf(line);
  if (kind === null) return false;
  if (kind.record === "event_msg")
    return READ_EVENTS.has(kind.item ?? "") || isReviewExit(line, kind);
  if (kind.record === "response_item") return RESPONSE_ITEMS.has(kind.item ?? "");
  return READ_RECORDS.has(kind.record);
};

const ITEM_KEY = Buffer.from('"item":{"type":"');
/** A completed item event has its thread ID, turn ID, and item type before the item content. */
const ITEM_TYPE_WITHIN = 400;

/** The type of the item of a completed item event: the first `item` key, before the item's own data. */
const completedItemTypeOf = (line: Buffer): string | null => {
  const key = line.indexOf(ITEM_KEY);
  if (key < 0 || key > ITEM_TYPE_WITHIN) return null;
  const start = key + ITEM_KEY.length;
  const end = line.indexOf(QUOTE, start);
  return end < 0 ? null : line.toString("latin1", start, end);
};

/**
 * True for the end of a `/review`. Codex then writes a note of its own as an assistant message
 * (`codex-rs/core/src/tasks/review.rs`, `exit_review_mode`), with no model request. Legacy
 * rollouts keep an `exited_review_mode` event; paginated ones an `ExitedReviewMode` item.
 */
export const isReviewExit = (line: Buffer, kind: LineKind): boolean =>
  kind.record === "event_msg" &&
  (kind.item === "exited_review_mode" ||
    (kind.item === "item_completed" && completedItemTypeOf(line) === "ExitedReviewMode"));

const ROLE = Buffer.from('"role":"');
const ASSISTANT_ROLE = Buffer.from('"role":"assistant"');
const ID_KEY = Buffer.from('"id":"');
/** A message item has its ID and role before its content. */
const ROLE_WITHIN = 400;
/** A rollout line starts with its timestamp and, from newer CLI versions, its ordinal. */
const LINE_PREFIX = /^\{"timestamp":"([^"]{1,40})"(?:,"ordinal":(\d+))?/;

export type LinePrefix = { timestamp: string | null; ordinal: number | null };

export const linePrefixOf = (line: Buffer): LinePrefix => {
  const match = LINE_PREFIX.exec(line.toString("latin1", 0, 80));
  return {
    timestamp: match?.[1] ?? null,
    ordinal: match?.[2] === undefined ? null : Number(match[2]),
  };
};

export type ItemRole = "output" | "input" | "other";

/**
 * The role of a response item in a model request: output that only a model writes, input that
 * a model reads, or neither. Codex writes notes, such as an interrupted review, as assistant
 * messages without an item ID, so they are neither.
 */
export const itemRoleOf = (line: Buffer, item: string | null): ItemRole => {
  if (MODEL_ITEMS.has(item ?? "")) return "output";
  if (INPUT_ITEMS.has(item ?? "")) return "input";
  if (item !== "message") return "other";
  const start = line.subarray(0, ROLE_WITHIN);
  const role = start.indexOf(ROLE);
  if (role < 0) return "other";
  if (role !== start.indexOf(ASSISTANT_ROLE)) return "input";
  const id = start.indexOf(ID_KEY);
  return id >= 0 && id < role ? "output" : "other";
};

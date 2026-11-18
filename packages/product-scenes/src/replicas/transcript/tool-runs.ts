// The words of a tool run, as tool-runs.ts of packages/frontend-core gives them: the kind of each
// call, the title and the counts of the header of a run, and the bar of the earlier calls of a long
// run. The view and the controller of a run share them.
import type { Call } from "./model";

/** The kinds of calls in a tool run, in the order that a header counts them. */
export const CALL_KINDS = ["command", "read", "list", "search", "edit", "web", "tool"] as const;

export type CallKind = (typeof CALL_KINDS)[number];

/** The kind that `value` names, such as the `data-kind` of a call. */
export function asCallKind(value: string): CallKind {
  const kind = CALL_KINDS.find((item) => item === value);
  if (!kind) throw new Error(`A tool run has no call kind ${value}.`);
  return kind;
}

const KIND_NOUNS = {
  command: ["command", "commands"],
  read: ["read", "reads"],
  list: ["list", "lists"],
  search: ["search", "searches"],
  edit: ["edit", "edits"],
  web: ["web search", "web searches"],
  tool: ["tool call", "tool calls"],
} as const satisfies Record<CallKind, readonly [string, string]>;

/**
 * The kind of a call. A shell command is a command, also when Codex reads or searches files with
 * it. Each file edit of the samples changes one file.
 */
export function callKind(call: Pick<Call, "tool" | "command">): CallKind {
  if (call.command !== undefined) return "command";
  if (call.tool === "read" || call.tool === "list" || call.tool === "search") return call.tool;
  if (call.tool === "web") return "web";
  if (call.tool === "file_edit") return "edit";
  return "tool";
}

/** The name of a run in its header, from the kinds of its calls. */
export type RunTitle = "Shell" | "Files" | "Web" | "Tools";

export function runTitle(kinds: readonly CallKind[]): RunTitle {
  const count = (...of: CallKind[]): number => kinds.filter((kind) => of.includes(kind)).length;
  const lookups = count("read", "list", "search");
  if (lookups + count("edit") === kinds.length) return "Files";
  if (count("command") + lookups === kinds.length) return "Shell";
  if (count("web") === kinds.length) return "Web";
  return "Tools";
}

/** The calls of a run by kind, such as `3 commands · 2 edits`. */
export function runCounts(kinds: readonly CallKind[]): string {
  return CALL_KINDS.flatMap((kind) => {
    const count = kinds.filter((item) => item === kind).length;
    return count > 0 ? [`${count} ${KIND_NOUNS[kind][count === 1 ? 0 : 1]}`] : [];
  }).join(" · ");
}

/** A long open run shows this many of its latest calls, under the bar of its earlier calls. */
export const LATEST_CALL_COUNT = 5;

/** The calls that an open run hides under its bar. A run of six calls or fewer hides none. */
export function earlierCallCount(callCount: number): number {
  return callCount <= LATEST_CALL_COUNT + 1 ? 0 : callCount - LATEST_CALL_COUNT;
}

/** The bar shows earlier calls a page at a time. */
const EARLIER_CALL_PAGE_SIZE = 25;

/**
 * The label of the bar of the earlier calls, such as `Show 3 earlier calls`, or `Show 25 of 180
 * earlier calls` when a page leaves more than a few.
 */
export function showEarlierLabel(earlier: number): string {
  const step =
    earlier <= EARLIER_CALL_PAGE_SIZE + LATEST_CALL_COUNT ? earlier : EARLIER_CALL_PAGE_SIZE;
  const calls = `${earlier} earlier call${earlier === 1 ? "" : "s"}`;
  return step < earlier ? `Show ${step} of ${calls}` : `Show ${calls}`;
}

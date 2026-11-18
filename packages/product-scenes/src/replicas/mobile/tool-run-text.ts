// The words of the header of a tool run in the mobile transcript, as tool-runs.ts in
// packages/frontend-core/src/sessions/transcript gives them: the name of the run from the kinds of
// its calls, and the count of the calls of each kind. The view and the steps of the runs use them.

/** The kinds of calls in a tool run, in the order that a run header counts them. */
export const RUN_CALL_KINDS = ["command", "read", "list", "search", "edit", "web", "tool"] as const;

export type RunCallKind = (typeof RUN_CALL_KINDS)[number];

const KIND_NOUNS = {
  command: ["command", "commands"],
  read: ["read", "reads"],
  list: ["list", "lists"],
  search: ["search", "searches"],
  edit: ["edit", "edits"],
  web: ["web search", "web searches"],
  tool: ["tool call", "tool calls"],
} as const satisfies Record<RunCallKind, readonly [string, string]>;

/** The name of a run in its header, from the kinds of its calls. */
export type RunTitle = "Shell" | "Files" | "Web" | "Tools";

/** The count of the calls of each kind of a run. */
type KindCounts = { [Kind in RunCallKind]: number };

function kindCounts(kinds: readonly RunCallKind[]): KindCounts {
  const counts = { command: 0, read: 0, list: 0, search: 0, edit: 0, web: 0, tool: 0 };
  for (const kind of kinds) counts[kind] += 1;
  return counts;
}

/** The name of a run: Files for file lookups and edits, Shell for commands and lookups. */
export function runTitle(kinds: readonly RunCallKind[]): RunTitle {
  const counts = kindCounts(kinds);
  const lookups = counts.read + counts.list + counts.search;
  if (lookups + counts.edit === kinds.length) return "Files";
  if (counts.command + lookups === kinds.length) return "Shell";
  if (counts.web === kinds.length) return "Web";
  return "Tools";
}

/**
 * The calls of a run by kind, such as `3 commands`. Each edit of the samples changes one file, so
 * an edit counts as one.
 */
export function runCountLabels(kinds: readonly RunCallKind[]): string[] {
  const counts = kindCounts(kinds);
  return RUN_CALL_KINDS.flatMap((kind) => {
    const count = counts[kind];
    return count > 0 ? [`${count} ${KIND_NOUNS[kind][count === 1 ? 0 : 1]}`] : [];
  });
}

/** The counts of a run as its header shows them, such as `3 commands · 2 reads`. */
export function runCountText(kinds: readonly RunCallKind[]): string {
  return runCountLabels(kinds).join(" · ");
}

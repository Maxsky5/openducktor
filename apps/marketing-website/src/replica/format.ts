// Formats of the product UI, shared by the replica markup and the scene scripts.

/** The context use of a session: the part of the window in use, and the tokens. */
export type ContextUse = { percent: number; tokens: number };

/** A lane count in the header of a Kanban lane: kanban-column.tsx. */
export function laneCountLabel(count: number): string {
  return `${count} ${count === 1 ? "task" : "tasks"}`;
}

/** A token count in the composer format of format-token-count.ts, such as 18.4K or 112K. */
export function compactTokens(tokens: number): string {
  const thousands = tokens / 1000;
  const text = thousands >= 100 ? `${Math.round(thousands)}` : thousands.toFixed(1);
  return `${text.replace(/\.0$/, "")}K`;
}

/** The file count of the Git tab: git-info-header.tsx. */
export function filesLabel(count: number): string {
  return `${count} changed file${count === 1 ? "" : "s"}`;
}

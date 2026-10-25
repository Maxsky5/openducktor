import type { GitFileDiff } from "@openducktor/contracts";
import {
  buildFileDiffRows,
  type DiffRow,
  diffNumberDigits,
} from "@/rich-content/diff/diff-row-model";
import { createDiffSyntax, type DiffSyntax } from "@/rich-content/diff/diff-syntax";
import { createHostContentCache } from "@/rich-content/lru-cache";
import type { ChangedFileGroup } from "./changes-model";

/** The parsed diff of one changed file, ready for a virtualized list. */
export type PreparedFileDiff = {
  /** The hunk, line, and note rows. The file row header shows the file, so it is left out. */
  rows: readonly DiffRow[];
  /** The old path of a renamed file, or null. */
  renamedFrom: string | null;
  syntax: DiffSyntax | null;
  numberDigits: number;
  /** True when Git reports text lines for the change. */
  hasText: boolean;
  /** The change of a file without content, which Git lists with no line, or null. */
  emptyFile: "added" | "deleted" | null;
};

const emptyFileChange = (
  diff: GitFileDiff,
  rows: readonly DiffRow[],
): PreparedFileDiff["emptyFile"] => {
  if (diff.type !== "added" && diff.type !== "deleted") return null;
  // Git writes only the file header of an empty file. A binary file gets a note row.
  const headerOnly = diff.diff.trim().length > 0 && rows.length === 0;
  return headerOnly && diff.additions + diff.deletions === 0 ? diff.type : null;
};

const MAX_CACHED_DIFFS = 32;
const preparedDiffs = createHostContentCache<string, { text: string; prepared: PreparedFileDiff }>(
  MAX_CACHED_DIFFS,
);

/**
 * The prepared diff of a changed file in its group. Parsing runs once for each diff text, so a
 * refresh with the same text, a comment change, or a second view of the file reuses the rows. A
 * partly staged file has a diff in two groups, so each group keeps its own entry.
 */
export const prepareFileDiff = (diff: GitFileDiff, group: ChangedFileGroup): PreparedFileDiff => {
  const key = JSON.stringify([group, diff.type, diff.file]);
  const cached = preparedDiffs.get(key);
  if (cached?.text === diff.diff) return cached.prepared;
  const parsed = buildFileDiffRows(diff.diff, diff.file, { changeType: diff.type }) ?? [];
  const file = parsed.find((row) => row.kind === "file");
  const rows = parsed.filter((row) => row.kind !== "file");
  const prepared: PreparedFileDiff = {
    rows,
    renamedFrom:
      file?.kind === "file" && file.oldPath !== null && file.oldPath !== diff.file
        ? file.oldPath
        : null,
    syntax: createDiffSyntax(rows, diff.file),
    numberDigits: diffNumberDigits(rows),
    hasText: diff.diff.trim().length > 0,
    emptyFile: emptyFileChange(diff, rows),
  };
  preparedDiffs.set(key, { text: diff.diff, prepared });
  return prepared;
};

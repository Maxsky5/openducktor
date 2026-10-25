/**
 * Turns unified diffs into list rows for a virtualized diff view. File splitting and patch
 * normalization come from the `@openducktor/core` helpers that desktop uses, so Git, classic,
 * unified, and apply-patch texts give the same files on both platforms.
 */
import {
  decodeGitQuotedPath,
  normalizeRenderableFileDiffCandidate,
  type SelectRenderableFileDiffOptions,
  selectRenderableFileDiff,
  splitFileDiffCandidates,
} from "@openducktor/core";
import { type CharRange, changedRanges } from "./code-segments";

type DiffFileStatus = "added" | "deleted" | "modified" | "renamed";
type DiffLineChange = "context" | "add" | "delete";

export type DiffFileRow = {
  readonly kind: "file";
  readonly key: string;
  readonly fileIndex: number;
  /** The new path, or the old path of a deleted file. */
  readonly path: string;
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly status: DiffFileStatus;
  readonly additions: number;
  readonly deletions: number;
};

export type DiffHunkRow = {
  readonly kind: "hunk";
  readonly key: string;
  readonly fileIndex: number;
  readonly hunkIndex: number;
  readonly header: string;
  /** The section text after the second `@@`, such as a function name. */
  readonly section: string;
  /** The unchanged lines that the diff skips before this hunk, or null without line numbers. */
  readonly hiddenBefore: number | null;
};

export type DiffLineRow = {
  readonly kind: "line";
  readonly key: string;
  readonly fileIndex: number;
  readonly hunkIndex: number;
  readonly path: string;
  readonly change: DiffLineChange;
  readonly text: string;
  /** `null` on an added line, or when the hunk header has no line numbers. */
  readonly oldLine: number | null;
  /** `null` on a deleted line, or when the hunk header has no line numbers. */
  readonly newLine: number | null;
  /** The changed words of a removed or added line that pairs with a line of the other side. */
  readonly emphasis: CharRange | null;
};

/** A diff line that is not a change, such as `\ No newline at end of file` or a binary file. */
export type DiffNoteRow = {
  readonly kind: "note";
  readonly key: string;
  readonly fileIndex: number;
  readonly text: string;
};

export type DiffRow = DiffFileRow | DiffHunkRow | DiffLineRow | DiffNoteRow;

/**
 * For `FlashList` `getItemType`. Line rows of each change share recycled views, so a recycled row
 * keeps its wash, its gutter bar, and its number color.
 */
export const diffRowType = (row: DiffRow): string =>
  row.kind === "line" ? `line:${row.change}` : row.kind;

/** The side and line that an inline comment on a diff line refers to. */
export type DiffLineTarget = { readonly side: "old" | "new"; readonly line: number };

/** Rows for every file in `diff`. A text without diff markers gives one note row. */
export const buildDiffRows = (diff: string): DiffRow[] =>
  splitFileDiffCandidates(diff).flatMap((candidate, fileIndex) => {
    const path = candidatePath(candidate);
    const patch = normalizeRenderableFileDiffCandidate(candidate, path);
    if (patch === null) {
      return [
        {
          kind: "note",
          key: `${fileIndex}:0`,
          fileIndex,
          text: "This text has no diff changes to show.",
        },
      ];
    }
    return parseFilePatch(patch, fileIndex, path);
  });

/**
 * Rows for one file of `diff`, selected like desktop does. Returns `null` when the diff has no
 * part for the file, or when that part cannot be told apart from another file.
 */
export const buildFileDiffRows = (
  diff: string,
  filePath: string,
  options?: SelectRenderableFileDiffOptions,
): DiffRow[] | null => {
  const patch = selectRenderableFileDiff(diff, filePath, options);
  return patch === null ? null : parseFilePatch(patch, 0, filePath);
};

const contentLines = (content: string): string[] =>
  content.length === 0 ? [] : content.replace(/\n$/, "").split("\n");

/**
 * Rows for an edit fragment: the text that an edit replaced and its new text, as the desktop file
 * pair diff. The fragment has no place in the file, so its lines have no numbers. The lines that
 * both texts share at the start and at the end show as context.
 */
export const buildReplacementDiffRows = (
  oldContent: string,
  newContent: string,
  path: string,
): DiffRow[] => {
  const oldLines = contentLines(oldContent);
  const newLines = contentLines(newContent);
  const shortest = Math.min(oldLines.length, newLines.length);
  let start = 0;
  while (start < shortest && oldLines[start] === newLines[start]) start += 1;
  let end = 0;
  while (
    end < shortest - start &&
    oldLines[oldLines.length - 1 - end] === newLines[newLines.length - 1 - end]
  ) {
    end += 1;
  }
  const body: DiffRow[] = [];
  const push = (change: DiffLineChange, lines: readonly string[]): void => {
    for (const text of lines) {
      body.push({
        kind: "line",
        key: `0:${body.length + 1}`,
        fileIndex: 0,
        hunkIndex: 0,
        path,
        change,
        text,
        oldLine: null,
        newLine: null,
        emphasis: null,
      });
    }
  };
  push("context", oldLines.slice(0, start));
  push("delete", oldLines.slice(start, oldLines.length - end));
  push("add", newLines.slice(start, newLines.length - end));
  push("context", oldLines.slice(oldLines.length - end));
  markChangedWords(body);
  const fileRow: DiffFileRow = {
    kind: "file",
    key: "0:0",
    fileIndex: 0,
    path,
    oldPath: path,
    newPath: path,
    status: "modified",
    additions: newLines.length - start - end,
    deletions: oldLines.length - start - end,
  };
  return [fileRow, ...body];
};

/** The desktop gutter fits three digits before it grows. */
export const DEFAULT_NUMBER_DIGITS = 3;

/** The digits of the largest line number in `rows`, so every row of a file has one gutter width. */
export const diffNumberDigits = (rows: readonly DiffRow[]): number => {
  let largest = 0;
  for (const row of rows) {
    if (row.kind !== "line") continue;
    largest = Math.max(largest, row.oldLine ?? 0, row.newLine ?? 0);
  }
  return Math.max(DEFAULT_NUMBER_DIGITS, String(largest).length);
};

/** The comment target of a line row: deleted lines use the old side, other lines the new side. */
export const diffLineTarget = (row: DiffLineRow): DiffLineTarget | null => {
  if (row.change === "delete")
    return row.oldLine === null ? null : { side: "old", line: row.oldLine };
  return row.newLine === null ? null : { side: "new", line: row.newLine };
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;
// File header lines that the file row already shows.
const FILE_HEADER =
  /^(?:diff --git |index |--- |\+\+\+ |new file mode |deleted file mode |similarity index |dissimilarity index |rename (?:from|to) |copy (?:from|to) )/;

const headerPath = (line: string, prefix: string): string | null => {
  const raw = line.slice(prefix.length).split("\t", 1)[0] ?? "";
  if (raw === "/dev/null") return null;
  const decoded = decodeGitQuotedPath(raw) ?? raw;
  return decoded.replace(/^[ab]\//, "");
};

/** The path that a file candidate names in its headers, for patch normalization. */
const candidatePath = (candidate: string): string => {
  for (const line of candidate.split("\n")) {
    if (line.startsWith("@@")) break;
    const applyPatch = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/.exec(line)?.[1];
    if (applyPatch !== undefined) return applyPatch;
    const unified = line.startsWith("+++ ")
      ? headerPath(line, "+++ ")
      : line.startsWith("--- ")
        ? headerPath(line, "--- ")
        : null;
    if (unified !== null) return unified;
    const git = /^diff --git a\/(.+) b\/(.+)$/.exec(line)?.[2];
    if (git !== undefined) return git;
  }
  return "file";
};

type FileHeader = {
  oldPath: string | null | undefined;
  newPath: string | null | undefined;
  status: DiffFileStatus;
};

const readFileHeader = (lines: readonly string[]): FileHeader => {
  let oldPath: string | null | undefined;
  let newPath: string | null | undefined;
  let renamed = false;
  let mode: "added" | "deleted" | null = null;
  for (const line of lines) {
    if (line.startsWith("@@")) break;
    if (line.startsWith("--- ")) oldPath = headerPath(line, "--- ");
    if (line.startsWith("+++ ")) newPath = headerPath(line, "+++ ");
    if (line.startsWith("rename from ") || line.startsWith("rename to ")) renamed = true;
    if (line.startsWith("new file mode ")) mode = "added";
    if (line.startsWith("deleted file mode ")) mode = "deleted";
  }
  const moved = oldPath !== undefined && newPath !== undefined && oldPath !== newPath;
  let status: DiffFileStatus = "modified";
  if (mode !== null) status = mode;
  else if (oldPath === null) status = "added";
  else if (newPath === null) status = "deleted";
  else if (renamed || moved) status = "renamed";
  return { oldPath, newPath, status };
};

const lineChange = (line: string): DiffLineChange | null => {
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "delete";
  return line.startsWith(" ") || line === "" ? "context" : null;
};

type HunkState = {
  index: number;
  oldLine: number | null;
  newLine: number | null;
  /** Lines left on each side, or `null` when the header has no counts. */
  oldLeft: number | null;
  newLeft: number | null;
};

const hunkIsOpen = (hunk: HunkState | null): hunk is HunkState =>
  hunk !== null && (hunk.oldLeft === null || hunk.oldLeft > 0 || (hunk.newLeft ?? 0) > 0);

const parseFilePatch = (patch: string, fileIndex: number, requestedPath: string): DiffRow[] => {
  const lines = patch.replace(/\n$/, "").split("\n");
  const header = readFileHeader(lines);
  const path = header.newPath ?? header.oldPath ?? requestedPath;
  const body: DiffRow[] = [];
  const nextKey = (): string => `${fileIndex}:${body.length + 1}`;
  const note = (text: string): void => {
    body.push({ kind: "note", key: nextKey(), fileIndex, text });
  };
  let hunk: HunkState | null = null;
  let hunkCount = 0;
  let additions = 0;
  let deletions = 0;
  /** The first old line after the previous hunk, or null before the first hunk. */
  let oldEnd: number | null = null;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = HUNK_HEADER.exec(line);
      const oldStart = match ? Number(match[1]) : null;
      const oldCount = match ? Number(match[2] ?? 1) : null;
      hunk = {
        index: hunkCount,
        oldLine: oldStart,
        newLine: match ? Number(match[3]) : null,
        oldLeft: oldCount,
        newLeft: match ? Number(match[4] ?? 1) : null,
      };
      hunkCount += 1;
      body.push({
        kind: "hunk",
        key: nextKey(),
        fileIndex,
        hunkIndex: hunk.index,
        header: line,
        section: (match?.[5] ?? line.replace(/^@@/, "")).trim(),
        hiddenBefore: oldStart === null ? null : Math.max(0, oldStart - (oldEnd ?? 1)),
      });
      // An empty side, such as the old side of a new file, starts at line 0.
      oldEnd = oldStart === null || oldCount === null ? null : Math.max(oldStart, 1) + oldCount;
      continue;
    }
    if (line === "GIT binary patch") {
      note("Binary file data is not shown.");
      break;
    }
    const change = hunkIsOpen(hunk) && !line.startsWith("\\") ? lineChange(line) : null;
    if (!hunkIsOpen(hunk) || change === null) {
      if (line.length > 0 && !FILE_HEADER.test(line)) note(line);
      continue;
    }
    body.push({
      kind: "line",
      key: nextKey(),
      fileIndex,
      hunkIndex: hunk.index,
      path,
      change,
      text: line.slice(1),
      oldLine: change === "add" ? null : hunk.oldLine,
      newLine: change === "delete" ? null : hunk.newLine,
      emphasis: null,
    });
    if (change !== "add") {
      if (hunk.oldLine !== null) hunk.oldLine += 1;
      if (hunk.oldLeft !== null) hunk.oldLeft -= 1;
    }
    if (change !== "delete") {
      if (hunk.newLine !== null) hunk.newLine += 1;
      if (hunk.newLeft !== null) hunk.newLeft -= 1;
    }
    if (change === "add") additions += 1;
    if (change === "delete") deletions += 1;
  }

  const fileRow: DiffFileRow = {
    kind: "file",
    key: `${fileIndex}:0`,
    fileIndex,
    path,
    oldPath:
      header.oldPath === undefined ? (header.status === "added" ? null : path) : header.oldPath,
    newPath:
      header.newPath === undefined ? (header.status === "deleted" ? null : path) : header.newPath,
    status: header.status,
    additions,
    deletions,
  };
  markChangedWords(body);
  return [fileRow, ...body];
};

/**
 * Marks the changed words of each removed line and the added line that replaces it. A run of
 * removed lines pairs, line by line, with the run of added lines right after it.
 */
const markChangedWords = (body: DiffRow[]): void => {
  let removed: number[] = [];
  let paired = 0;
  let previous: DiffLineChange | null = null;
  for (const [index, row] of body.entries()) {
    if (row.kind !== "line" || row.change === "context") {
      removed = [];
      paired = 0;
      previous = null;
      continue;
    }
    if (row.change === "delete") {
      if (previous === "add") {
        removed = [];
        paired = 0;
      }
      removed.push(index);
    } else {
      const removedIndex = removed[paired];
      const removedRow = removedIndex === undefined ? undefined : body[removedIndex];
      paired += 1;
      if (removedIndex !== undefined && removedRow?.kind === "line") {
        const ranges = changedRanges(removedRow.text, row.text);
        if (ranges) {
          body[removedIndex] = { ...removedRow, emphasis: ranges.removed };
          body[index] = { ...row, emphasis: ranges.added };
        }
      }
    }
    previous = row.change;
  }
};

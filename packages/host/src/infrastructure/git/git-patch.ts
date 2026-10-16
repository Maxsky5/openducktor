import { type HostErrorDetails, HostValidationError } from "../../effect/host-errors";
import { parseDiffGitHeaderToken } from "./git-diff";

export type HunkSpec = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
};

export type ParsedHunk = {
  text: string;
  spec: HunkSpec;
};

export type RenamePaths = {
  oldPath: string;
  newPath: string;
};

export type ParsedPatch = {
  header: string;
  hunks: ParsedHunk[];
  renamePaths?: RenamePaths;
};

const invalidPatch = <Details extends object>(
  message: string,
  details?: HostErrorDetails<Details>,
): HostValidationError<Details> => {
  if (details !== undefined) {
    return new HostValidationError({ message, details });
  }
  return new HostValidationError({ message });
};

const parseHunkRange = (input: string) => {
  const trimmed = input.trim();
  const [startRaw, countRaw = "1"] = trimmed.split(",", 2);
  const start = Number.parseInt(startRaw ?? "", 10);
  const count = Number.parseInt(countRaw, 10);
  if (!Number.isFinite(start)) {
    throw invalidPatch(`Invalid hunk range start: ${trimmed}`, { range: trimmed });
  }
  if (!Number.isFinite(count)) {
    throw invalidPatch(`Invalid hunk range count: ${trimmed}`, { range: trimmed });
  }

  return { start, count } satisfies { start: number; count: number };
};

const parseHunkSpec = (line: string): HunkSpec => {
  const rest = line.startsWith("@@ -") ? line.slice("@@ -".length) : undefined;
  if (rest === undefined) {
    throw invalidPatch(`Invalid hunk header: ${line}`, { line });
  }

  const splitIndex = rest.indexOf(" +");
  if (splitIndex < 0) {
    throw invalidPatch(`Invalid hunk header: ${line}`, { line });
  }
  const oldPart = rest.slice(0, splitIndex);
  const remaining = rest.slice(splitIndex + " +".length);
  const newEndIndex = remaining.indexOf(" @@");
  if (newEndIndex < 0) {
    throw invalidPatch(`Invalid hunk header: ${line}`, { line });
  }

  const oldRange = parseHunkRange(oldPart);
  const newRange = parseHunkRange(remaining.slice(0, newEndIndex));
  return {
    oldStart: oldRange.start,
    oldCount: oldRange.count,
    newStart: newRange.start,
    newCount: newRange.count,
  };
};

const parseRenamePaths = (header: string): RenamePaths | undefined => {
  let oldPath: string | undefined;
  let newPath: string | undefined;

  for (const line of header.split(/\r?\n/)) {
    if (line.startsWith("rename from ")) {
      oldPath = line.slice("rename from ".length).trim();
    } else if (line.startsWith("rename to ")) {
      newPath = line.slice("rename to ".length).trim();
    }
  }

  return oldPath && newPath ? { oldPath, newPath } : undefined;
};

const parseRenamePathsFromDiffHeader = (header: string): RenamePaths | undefined => {
  const diffLine = header.split(/\r?\n/).find((line) => line.startsWith("diff --git "));
  if (!diffLine) {
    return undefined;
  }

  const oldPath = parseDiffGitHeaderToken(diffLine.slice("diff --git ".length));
  const newPath = oldPath ? parseDiffGitHeaderToken(oldPath.remaining) : undefined;
  const normalizedOldPath = oldPath?.token.startsWith("a/") ? oldPath.token.slice(2) : undefined;
  const normalizedNewPath = newPath?.token.startsWith("b/") ? newPath.token.slice(2) : undefined;

  if (!normalizedOldPath || !normalizedNewPath || normalizedOldPath === normalizedNewPath) {
    return undefined;
  }

  return { oldPath: normalizedOldPath, newPath: normalizedNewPath };
};

export const parsePatchHunks = (patch: string): ParsedPatch => {
  let header = "";
  const hunks: ParsedHunk[] = [];
  let currentHunk = "";
  let currentSpec: HunkSpec | undefined;
  let inHunk = false;

  for (const line of patch.match(/[^\n]*\n|[^\n]+/g) ?? []) {
    if (line.startsWith("@@ ")) {
      if (inHunk && currentHunk.length > 0) {
        if (!currentSpec) {
          throw invalidPatch("Patch hunk is missing parsed hunk metadata");
        }
        hunks.push({ text: currentHunk, spec: currentSpec });
        currentHunk = "";
      }

      currentSpec = parseHunkSpec(line);
      inHunk = true;
    }

    if (inHunk) {
      currentHunk += line;
    } else {
      header += line;
    }
  }

  if (inHunk && currentHunk.length > 0) {
    if (!currentSpec) {
      throw invalidPatch("Patch hunk is missing parsed hunk metadata");
    }
    hunks.push({ text: currentHunk, spec: currentSpec });
  }

  const renamePaths = parseRenamePaths(header) ?? parseRenamePathsFromDiffHeader(header);
  const parsedPatch = { header, hunks };
  return renamePaths ? { ...parsedPatch, renamePaths } : parsedPatch;
};

const FILE_MODE_LINE = /^(?:old|new) mode /;

/**
 * Builds the patch of one hunk. It leaves out a file-mode change, so a chunk action changes only
 * the selected text. Whole-file actions change the mode.
 */
export const combinePatchHunk = (header: string, hunk: ParsedHunk): string => {
  const textHeader = header
    .split(/(?<=\n)/)
    .filter((line) => !FILE_MODE_LINE.test(line))
    .join("");
  return `${textHeader}${hunk.text}`;
};

const hunkSpecsEqual = (left: HunkSpec, right: HunkSpec): boolean =>
  left.oldStart === right.oldStart &&
  left.oldCount === right.oldCount &&
  left.newStart === right.newStart &&
  left.newCount === right.newCount;

/** Hunk lines as a display diff holds them: no carriage return before a line end. */
const displayedLines = (text: string): string[] => {
  const lines = text.split(/\r?\n/);
  // A display diff ends with a blank line. No hunk line is empty.
  while (lines.at(-1) === "") lines.pop();
  return lines;
};

/** True when both hunks have the same ranges and the same lines, as a display diff shows them. */
export const hunksMatch = (reviewed: ParsedHunk, applied: ParsedHunk): boolean => {
  if (!hunkSpecsEqual(reviewed.spec, applied.spec)) return false;
  const reviewedLines = displayedLines(reviewed.text);
  const appliedLines = displayedLines(applied.text);
  return (
    reviewedLines.length === appliedLines.length &&
    reviewedLines.every((line, index) => line === appliedLines[index])
  );
};

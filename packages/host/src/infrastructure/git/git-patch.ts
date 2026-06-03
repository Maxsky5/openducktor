import { HostValidationError } from "../../effect/host-errors";
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

const invalidPatch = (message: string, details?: Record<string, unknown>): HostValidationError =>
  new HostValidationError({
    message,
    details,
  });

const parseHunkRange = (input: string): { start: number; count: number } => {
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

  return { start, count };
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
  return {
    header,
    hunks,
    ...(renamePaths ? { renamePaths } : {}),
  };
};

export const combinePatchHunk = (header: string, hunk: ParsedHunk): string =>
  `${header}${hunk.text}`;

const rangesOverlap = (
  leftStart: number,
  leftCount: number,
  rightStart: number,
  rightCount: number,
): boolean => {
  const leftEnd = leftStart + Math.max(leftCount, 1) - 1;
  const rightEnd = rightStart + Math.max(rightCount, 1) - 1;
  return !(leftEnd < rightStart || rightEnd < leftStart);
};

const hunkSpecsOverlap = (left: HunkSpec, right: HunkSpec): boolean =>
  rangesOverlap(left.oldStart, left.oldCount, right.oldStart, right.oldCount) ||
  rangesOverlap(left.newStart, left.newCount, right.newStart, right.newCount);

const hunkBody = (text: string): string => {
  const index = text.indexOf("\n");
  return index >= 0 ? text.slice(index + 1) : text;
};

const hunkSpecsEqual = (left: HunkSpec, right: HunkSpec): boolean =>
  left.oldStart === right.oldStart &&
  left.oldCount === right.oldCount &&
  left.newStart === right.newStart &&
  left.newCount === right.newCount;

export const findMatchingCachedHunk = (
  cachedPatch: ParsedPatch,
  selectedHunk: ParsedHunk,
): ParsedHunk | undefined => {
  const exactMatch = cachedPatch.hunks.find(
    (candidate) =>
      hunkSpecsEqual(candidate.spec, selectedHunk.spec) &&
      hunkBody(candidate.text) === hunkBody(selectedHunk.text),
  );
  if (exactMatch) {
    return exactMatch;
  }

  if (cachedPatch.hunks.some((candidate) => hunkSpecsOverlap(candidate.spec, selectedHunk.spec))) {
    throw invalidPatch(
      "Cannot reset a hunk that mixes staged and unstaged changes. Unstage it or reset the whole file instead.",
    );
  }

  return undefined;
};

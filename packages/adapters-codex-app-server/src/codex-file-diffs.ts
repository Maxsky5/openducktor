import type { FileDiff } from "@openducktor/contracts";
import { countRenderableFileDiffLines, selectRenderableFileDiff } from "@openducktor/core";
import { arrayFromUnknown, extractStringField, isPlainObject } from "./codex-app-server-shared";

export class CodexFileDiffParseError extends Error {
  constructor(message: string) {
    super(`Malformed Codex file change: ${message}`);
    this.name = "CodexFileDiffParseError";
  }
}

export const codexFileChangeEntries = (value: Record<string, unknown>): unknown[] => {
  const changes = arrayFromUnknown(value.changes);
  const diffs = arrayFromUnknown(value.diffs);
  return changes.length > 0 ? changes : diffs;
};

const normalizeExplicitDiffType = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim().length > 0) {
    const normalized = value.trim();
    if (normalized === "add") {
      return "added";
    }
    if (normalized === "delete") {
      return "deleted";
    }
    if (normalized === "update") {
      return "modified";
    }
    return normalized;
  }

  if (isPlainObject(value)) {
    return normalizeExplicitDiffType(value.type);
  }

  return null;
};

const inferDiffType = (entry: Record<string, unknown>, diff: string): string => {
  const explicitType =
    normalizeExplicitDiffType(entry.type) ??
    normalizeExplicitDiffType(entry.status) ??
    normalizeExplicitDiffType(entry.kind);
  if (explicitType) {
    return explicitType;
  }

  if (/^---\s+\/dev\/null\r?$/m.test(diff)) {
    return "added";
  }
  if (/^\+\+\+\s+\/dev\/null\r?$/m.test(diff)) {
    return "deleted";
  }
  return "modified";
};

const movePathFromKind = (value: unknown): string | null => {
  if (!isPlainObject(value)) {
    return null;
  }

  const movePath = value.movePath ?? value.move_path;
  return typeof movePath === "string" && movePath.trim().length > 0 ? movePath.trim() : null;
};

const stripMoveTrailer = (diff: string, movePath: string | null): string => {
  if (!movePath) {
    return diff;
  }

  const trailer = `\n\nMoved to: ${movePath}`;
  return diff.endsWith(trailer) ? diff.slice(0, -trailer.length) : diff;
};

const parseFileDiffEntry = (entry: unknown, location: string): FileDiff => {
  if (!isPlainObject(entry)) {
    throw new CodexFileDiffParseError(`entry ${location} must be an object.`);
  }

  const rawFile = entry.file ?? entry.path;
  const diff = entry.diff ?? entry.patch;
  if (typeof rawFile !== "string" || typeof diff !== "string") {
    throw new CodexFileDiffParseError(
      `entry ${location} is missing string file/path or diff/patch fields.`,
    );
  }

  const movePath = movePathFromKind(entry.kind);
  const file = movePath ?? rawFile;
  const type = inferDiffType(entry, diff);
  const renderableDiff =
    selectRenderableFileDiff(stripMoveTrailer(diff, movePath), file, {
      changeType: type,
    }) ?? "";
  const counts = countRenderableFileDiffLines(renderableDiff);
  return {
    file,
    type,
    additions: typeof entry.additions === "number" ? entry.additions : counts.additions,
    deletions: typeof entry.deletions === "number" ? entry.deletions : counts.deletions,
    diff: renderableDiff,
  };
};

export const toFileDiffs = (value: unknown): FileDiff[] => {
  return arrayFromUnknown(value).flatMap((entry, entryIndex): FileDiff[] => {
    if (!isPlainObject(entry)) {
      throw new CodexFileDiffParseError(`entry ${entryIndex} must be an object.`);
    }

    const nested = arrayFromUnknown(entry.fileChanges ?? entry.changes ?? entry.files);
    if (nested.length > 0) {
      return nested.map((nestedEntry, nestedIndex) =>
        parseFileDiffEntry(nestedEntry, `${entryIndex}.${nestedIndex}`),
      );
    }

    return [parseFileDiffEntry(entry, String(entryIndex))];
  });
};

export const fileDiffsPatchOutput = (fileDiffs: ReadonlyArray<{ diff: string }>): string | null => {
  const diffs = fileDiffs.map((fileDiff) => fileDiff.diff.trim()).filter((diff) => diff.length > 0);
  return diffs.length > 0 ? diffs.join("\n") : null;
};

const APPLY_PATCH_FILE_TYPES = {
  Add: "added",
  Delete: "deleted",
  Update: "modified",
} as const;

type ApplyPatchFileType = keyof typeof APPLY_PATCH_FILE_TYPES;

type ApplyPatchFileEntry = {
  file: string;
  operation: ApplyPatchFileType;
  lines: string[];
};

const applyPatchFileHeader = (
  line: string,
): { operation: ApplyPatchFileType; file: string } | null => {
  const match = /^\*\*\* (Add|Delete|Update) File: (.+)$/.exec(line);
  const operation = match?.[1];
  const file = match?.[2];
  if (!operation || !file) {
    return null;
  }

  return {
    operation: operation as ApplyPatchFileType,
    file: file.trim(),
  };
};

const finishApplyPatchEntry = (entry: ApplyPatchFileEntry): FileDiff | null => {
  if (entry.file.length === 0) {
    return null;
  }

  const rawDiff = [`*** ${entry.operation} File: ${entry.file}`, ...entry.lines]
    .join("\n")
    .trimEnd();
  const type = APPLY_PATCH_FILE_TYPES[entry.operation];
  const diff = selectRenderableFileDiff(rawDiff, entry.file, { changeType: type }) ?? "";
  const counts = countRenderableFileDiffLines(diff);
  return {
    file: entry.file,
    type,
    additions: counts.additions,
    deletions: counts.deletions,
    diff,
  };
};

export const codexApplyPatchFileDiffs = (patch: string): FileDiff[] => {
  const diffs: FileDiff[] = [];
  let current: ApplyPatchFileEntry | null = null;

  for (const rawLine of patch.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const header = applyPatchFileHeader(line);
    if (header) {
      if (current) {
        const diff = finishApplyPatchEntry(current);
        if (diff) {
          diffs.push(diff);
        }
      }
      current = { ...header, lines: [] };
      continue;
    }

    if (!current || line === "*** Begin Patch" || line === "*** End Patch") {
      continue;
    }

    const moveMatch = /^\*\*\* Move to: (.+)$/.exec(line);
    const movedFile = moveMatch?.[1];
    if (movedFile) {
      current.file = movedFile.trim();
      continue;
    }
    current.lines.push(line);
  }

  if (current) {
    const diff = finishApplyPatchEntry(current);
    if (diff) {
      diffs.push(diff);
    }
  }

  return diffs;
};

const patchInputFromObject = (value: Record<string, unknown> | null | undefined): string | null =>
  value
    ? (extractStringField(value, ["patch"]) ??
      extractStringField(value, ["patchText", "patch_text"]) ??
      null)
    : null;

export const codexPatchInputFromToolPayload = (
  value: Record<string, unknown>,
  input: Record<string, unknown> | null | undefined,
): string | null => {
  if (typeof value.input === "string") {
    return value.input;
  }
  return patchInputFromObject(input);
};

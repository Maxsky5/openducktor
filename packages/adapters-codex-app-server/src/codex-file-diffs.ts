import type { FileDiff } from "@openducktor/contracts";
import { arrayFromUnknown, extractStringField, isPlainObject } from "./codex-app-server-shared";

export class CodexFileDiffParseError extends Error {
  constructor(message: string) {
    super(`Malformed Codex file change: ${message}`);
    this.name = "CodexFileDiffParseError";
  }
}

export const codexFileChangeDiff = (changes: unknown[]): string | null => {
  const diffs = changes
    .filter(isPlainObject)
    .map((change) => extractStringField(change, ["diff", "patch"]))
    .filter((diff): diff is string => Boolean(diff));
  return diffs.length > 0 ? diffs.join("\n") : null;
};

export const codexFileChangeEntries = (value: Record<string, unknown>): unknown[] => {
  const changes = arrayFromUnknown(value.changes);
  const diffs = arrayFromUnknown(value.diffs);
  return changes.length > 0 ? changes : diffs;
};

const countDiffLines = (diff: string): Pick<FileDiff, "additions" | "deletions"> => {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions++;
      continue;
    }
    if (line.startsWith("-")) {
      deletions++;
    }
  }

  return { additions, deletions };
};

const inferDiffType = (entry: Record<string, unknown>, diff: string): string => {
  const explicitType = entry.type ?? entry.status ?? entry.kind;
  if (typeof explicitType === "string" && explicitType.trim().length > 0) {
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

const parseFileDiffEntry = (entry: unknown, location: string): FileDiff => {
  if (!isPlainObject(entry)) {
    throw new CodexFileDiffParseError(`entry ${location} must be an object.`);
  }

  const file = entry.file ?? entry.path;
  const diff = entry.diff ?? entry.patch;
  if (typeof file !== "string" || typeof diff !== "string") {
    throw new CodexFileDiffParseError(
      `entry ${location} is missing string file/path or diff/patch fields.`,
    );
  }

  const counts = countDiffLines(diff);
  return {
    file,
    type: inferDiffType(entry, diff),
    additions: typeof entry.additions === "number" ? entry.additions : counts.additions,
    deletions: typeof entry.deletions === "number" ? entry.deletions : counts.deletions,
    diff,
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

  const diff = [`*** ${entry.operation} File: ${entry.file}`, ...entry.lines].join("\n").trimEnd();
  const counts = countDiffLines(diff);
  return {
    file: entry.file,
    type: APPLY_PATCH_FILE_TYPES[entry.operation],
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

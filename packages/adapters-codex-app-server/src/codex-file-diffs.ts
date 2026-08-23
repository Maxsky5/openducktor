import type {
  CodexAppServerFileUpdateChange,
  CodexAppServerJsonValue,
  CodexAppServerThreadItem,
  FileDiff,
} from "@openducktor/contracts";
import {
  countRenderableFileDiffLines,
  selectRenderableFileDiff,
  splitFileDiffCandidates,
} from "@openducktor/core";
import { extractStringField } from "./codex-app-server-shared";

export class CodexFileDiffParseError extends Error {
  constructor(message: string) {
    super(`Malformed Codex file change: ${message}`);
    this.name = "CodexFileDiffParseError";
  }
}

type CodexFileChangeItem = Extract<CodexAppServerThreadItem, { type: "fileChange" }>;

export const codexFileChangeEntries = (
  value: CodexFileChangeItem,
): CodexAppServerFileUpdateChange[] => value.changes;

const CODEX_DIFF_TYPES = {
  add: "added",
  delete: "deleted",
  update: "modified",
} as const satisfies Record<CodexAppServerFileUpdateChange["kind"]["type"], FileDiff["type"]>;

const stripMoveTrailer = (diff: string, movePath: string | null): string => {
  if (!movePath) {
    return diff;
  }

  const trailer = `\n\nMoved to: ${movePath}`;
  return diff.endsWith(trailer) ? diff.slice(0, -trailer.length) : diff;
};

const selectCodexRenderableDiff = (
  diff: string,
  displayedFile: string,
  sourceFile: string,
  type: string,
): string => {
  const fileCandidates =
    sourceFile === displayedFile ? [displayedFile] : [sourceFile, displayedFile];
  for (const fileCandidate of fileCandidates) {
    const renderableDiff = selectRenderableFileDiff(diff, fileCandidate, { changeType: type });
    if (renderableDiff) {
      return renderableDiff;
    }
  }

  return "";
};

const parseFileDiffEntry = (entry: CodexAppServerFileUpdateChange, index: number): FileDiff => {
  const sourceFile = entry.path.trim();
  const movePath = entry.kind.type === "update" ? (entry.kind.move_path?.trim() ?? null) : null;
  const file = movePath ?? sourceFile;
  if (file.length === 0) {
    throw new CodexFileDiffParseError(`entry ${index} has empty file path.`);
  }
  const type = CODEX_DIFF_TYPES[entry.kind.type];
  const renderableDiff = selectCodexRenderableDiff(
    stripMoveTrailer(entry.diff, movePath),
    file,
    sourceFile,
    type,
  );
  const counts = countRenderableFileDiffLines(renderableDiff);
  return {
    file,
    type,
    additions: counts.additions,
    deletions: counts.deletions,
    diff: renderableDiff,
  };
};

export const toFileDiffs = (changes: CodexAppServerFileUpdateChange[]): FileDiff[] =>
  changes.map(parseFileDiffEntry);

const unifiedDiffHeaderPath = (candidate: string, prefix: "--- " | "+++ "): string | null => {
  const line = candidate.split("\n").find((candidateLine) => candidateLine.startsWith(prefix));
  if (!line) {
    return null;
  }
  const path = line.slice(prefix.length).split("\t", 1)[0]?.trim();
  if (!path || path === "/dev/null") {
    return null;
  }
  return path.replace(/^"|"$/g, "").replace(/^(?:a|b)\//, "");
};

export const fileDiffsFromUnifiedDiff = (unifiedDiff: string): FileDiff[] =>
  splitFileDiffCandidates(unifiedDiff).map((candidate, index) => {
    const previousPath = unifiedDiffHeaderPath(candidate, "--- ");
    const nextPath = unifiedDiffHeaderPath(candidate, "+++ ");
    const file = nextPath ?? previousPath;
    if (!file) {
      throw new CodexFileDiffParseError(
        `unified diff entry ${index} is missing a non-null file header.`,
      );
    }
    const type = previousPath === null ? "added" : nextPath === null ? "deleted" : "modified";
    const diff = selectRenderableFileDiff(candidate, file, { changeType: type });
    if (!diff) {
      throw new CodexFileDiffParseError(
        `unified diff entry ${index} for '${file}' is not renderable.`,
      );
    }
    const counts = countRenderableFileDiffLines(diff);
    return {
      file,
      type,
      additions: counts.additions,
      deletions: counts.deletions,
      diff,
    };
  });

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

  // SAFETY: The runtime adapter builds this value from the contract fields required by `ApplyPatchFileType`.
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

const patchInputFromObject = (
  value: Record<string, CodexAppServerJsonValue> | null | undefined,
): string | null =>
  value
    ? (extractStringField(value, ["patch"]) ??
      extractStringField(value, ["patchText", "patch_text"]) ??
      null)
    : null;

export const codexPatchInputFromToolPayload = (
  input: Record<string, CodexAppServerJsonValue> | null | undefined,
): string | null => patchInputFromObject(input);

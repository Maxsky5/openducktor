import type { FileDiff } from "@openducktor/contracts";
import { countRenderableFileDiffLines, selectRenderableFileDiff } from "@openducktor/core";
import { isRecord, readStringProp } from "./claude-agent-sdk-utils";

type ClaudeFileEditPayload = {
  fileDiffs?: FileDiff[];
};

const normalizeToolName = (tool: string): string => tool.trim().toLowerCase();

export const isClaudeFileEditTool = (tool: string): boolean =>
  new Set(["edit", "multiedit", "write"]).has(normalizeToolName(tool));

const readRecordProp = (
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null => {
  const value = record[key];
  return isRecord(value) ? value : null;
};

const readNumberProp = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const diffHeaderPath = (file: string): string =>
  file.replaceAll("\\", "/").replace(/^\/+/, "").replace(/^\.\//, "");

const structuredPatchRange = (start: number, lines: number): string => `${start},${lines}`;

const readStructuredPatchHunk = (value: unknown): string | null => {
  if (!isRecord(value)) {
    return null;
  }
  const oldStart = readNumberProp(value, "oldStart");
  const oldLines = readNumberProp(value, "oldLines");
  const newStart = readNumberProp(value, "newStart");
  const newLines = readNumberProp(value, "newLines");
  const lines = value.lines;
  if (
    oldStart === undefined ||
    oldLines === undefined ||
    newStart === undefined ||
    newLines === undefined ||
    !Array.isArray(lines)
  ) {
    return null;
  }
  const hunkLines = lines.filter(
    (line): line is string => typeof line === "string" && line.length > 0,
  );
  return [
    `@@ -${structuredPatchRange(oldStart, oldLines)} +${structuredPatchRange(newStart, newLines)} @@`,
    ...hunkLines,
  ].join("\n");
};

const readStructuredPatch = (value: unknown, file: string | undefined): string | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const hunks = value.map(readStructuredPatchHunk).filter((hunk): hunk is string => hunk !== null);
  const normalizedFile = file?.trim();
  if (hunks.length === 0 || !normalizedFile) {
    return null;
  }
  const fileHeaderPath = diffHeaderPath(normalizedFile);
  return [
    `diff --git a/${fileHeaderPath} b/${fileHeaderPath}`,
    `--- a/${fileHeaderPath}`,
    `+++ b/${fileHeaderPath}`,
    ...hunks,
  ].join("\n");
};

const readInputFilePath = (input: Record<string, unknown> | undefined): string | undefined => {
  if (!input) {
    return undefined;
  }
  return (
    readStringProp(input, "file_path") ??
    readStringProp(input, "filePath") ??
    readStringProp(input, "path") ??
    readStringProp(input, "file")
  );
};

const readFilePath = (
  record: Record<string, unknown>,
  input: Record<string, unknown> | undefined,
): string | undefined =>
  readStringProp(record, "file") ??
  readStringProp(record, "file_path") ??
  readStringProp(record, "filePath") ??
  readStringProp(record, "filepath") ??
  readStringProp(record, "relativePath") ??
  readInputFilePath(input);

const readPatchFromRecord = (
  record: Record<string, unknown>,
  file: string | undefined,
): string | null => {
  const directPatch = readStringProp(record, "patch") ?? readStringProp(record, "diff");
  if (directPatch) {
    return directPatch;
  }

  for (const key of ["gitDiff", "structuredPatch", "fileDiff", "filediff"] as const) {
    const nested = record[key];
    if (typeof nested === "string" && nested.trim().length > 0) {
      return nested;
    }
    const structuredPatch = readStructuredPatch(nested, file);
    if (structuredPatch) {
      return structuredPatch;
    }
    if (isRecord(nested)) {
      const nestedPatch = readStringProp(nested, "patch") ?? readStringProp(nested, "diff");
      if (nestedPatch) {
        return nestedPatch;
      }
    }
  }

  return null;
};

const readResultRecords = (raw: Record<string, unknown>): Record<string, unknown>[] => {
  const records = [raw];
  for (const key of ["structuredContent", "result", "output", "toolUseResult", "file"] as const) {
    const value = raw[key];
    if (isRecord(value)) {
      records.push(value);
    }
  }
  const content = raw.content;
  if (isRecord(content)) {
    records.push(content);
  }
  if (Array.isArray(content)) {
    for (const entry of content) {
      if (isRecord(entry)) {
        records.push(entry);
        const structuredContent = entry.structuredContent;
        if (isRecord(structuredContent)) {
          records.push(structuredContent);
        }
      }
    }
  }
  return records;
};

const fileRecordsFromResult = (raw: Record<string, unknown>): Record<string, unknown>[] => {
  const records = readResultRecords(raw);
  const result: Record<string, unknown>[] = [];
  for (const record of records) {
    result.push(record);
    for (const key of ["files", "fileDiffs", "changes", "edits"] as const) {
      const files = record[key];
      if (!Array.isArray(files)) {
        continue;
      }
      result.push(...files.filter(isRecord));
    }
    const gitDiff = readRecordProp(record, "gitDiff");
    const structuredPatch = readRecordProp(record, "structuredPatch");
    if (gitDiff) {
      result.push(gitDiff);
      const files = gitDiff.files;
      if (Array.isArray(files)) {
        result.push(...files.filter(isRecord));
      }
    }
    if (structuredPatch) {
      result.push(structuredPatch);
    }
  }
  return result;
};

const changeTypeFromToolInput = (
  tool: string,
  input: Record<string, unknown> | undefined,
): FileDiff["type"] => {
  if (normalizeToolName(tool) === "write") {
    return "modified";
  }
  const oldString = input?.old_string ?? input?.oldString;
  return typeof oldString === "string" && oldString.length === 0 ? "added" : "modified";
};

const normalizeClaudeFileDiff = ({
  file,
  patch,
  type,
  additions,
  deletions,
}: {
  additions?: number;
  deletions?: number;
  file: string | undefined;
  patch: string | null;
  type: FileDiff["type"];
}): FileDiff | null => {
  const normalizedFile = file?.trim();
  if (!normalizedFile || !patch) {
    return null;
  }
  const diff = selectRenderableFileDiff(patch, normalizedFile, { changeType: type });
  if (!diff) {
    return null;
  }
  const counts = countRenderableFileDiffLines(diff);
  return {
    file: normalizedFile,
    type,
    additions: additions ?? counts.additions,
    deletions: deletions ?? counts.deletions,
    diff,
  };
};

const readClaudeFileDiffs = ({
  input,
  raw,
  tool,
}: {
  input: Record<string, unknown> | undefined;
  raw: Record<string, unknown>;
  tool: string;
}): FileDiff[] => {
  const diffs: FileDiff[] = [];
  const seen = new Set<string>();
  for (const record of fileRecordsFromResult(raw)) {
    const type = changeTypeFromToolInput(tool, input);
    const additions = readNumberProp(record, "additions");
    const deletions = readNumberProp(record, "deletions");
    const file = readFilePath(record, input);
    const diffInput: Parameters<typeof normalizeClaudeFileDiff>[0] = {
      file,
      patch: readPatchFromRecord(record, file),
      type,
    };
    if (additions !== undefined) {
      diffInput.additions = additions;
    }
    if (deletions !== undefined) {
      diffInput.deletions = deletions;
    }
    const diff = normalizeClaudeFileDiff(diffInput);
    if (!diff) {
      continue;
    }
    const key = `${diff.file}\n${diff.diff}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    diffs.push(diff);
  }
  return diffs;
};

export const readClaudeFileEditPayload = ({
  input,
  raw,
  tool,
}: {
  input: Record<string, unknown> | undefined;
  raw: Record<string, unknown>;
  tool: string;
}): ClaudeFileEditPayload => {
  if (!isClaudeFileEditTool(tool)) {
    return {};
  }

  const fileDiffs = readClaudeFileDiffs({ input, raw, tool });
  if (fileDiffs.length > 0) {
    return { fileDiffs };
  }

  return {};
};

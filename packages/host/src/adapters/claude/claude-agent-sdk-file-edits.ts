import type { FileDiff } from "@openducktor/contracts";
import { countRenderableFileDiffLines, selectRenderableFileDiff } from "@openducktor/core";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import type { ClaudeDecodedToolResult, ClaudeDecodedToolUse } from "./claude-agent-sdk-tool-shapes";
import {
  claudeProtocolObjectSchema,
  type ClaudeProtocolObject,
} from "./claude-agent-sdk-ingress-schemas";
import { readStringProp } from "./claude-agent-sdk-utils";

type ClaudeFileEditPayload = {
  fileDiffs?: FileDiff[];
};

const structuredPatchHunkSchema = z.looseObject({
  lines: z.array(z.unknown()),
  newLines: z.number().finite(),
  newStart: z.number().finite(),
  oldLines: z.number().finite(),
  oldStart: z.number().finite(),
});

const normalizeToolName = (tool: string): string => tool.trim().toLowerCase();

export const isClaudeFileEditTool = (tool: string): boolean =>
  new Set(["edit", "multiedit", "notebookedit", "write"]).has(normalizeToolName(tool));

const readRecordProp = (record: ClaudeProtocolObject, key: string): ClaudeProtocolObject | null => {
  const parsed = claudeProtocolObjectSchema.safeParse(record[key]);
  return parsed.success ? parsed.data : null;
};

const readNumberProp = (record: ClaudeProtocolObject, key: string): number | undefined => {
  const parsed = z.number().finite().safeParse(record[key]);
  return parsed.success ? parsed.data : undefined;
};

const readStringValue = (record: ClaudeProtocolObject, key: string): string | undefined => {
  const parsed = z.string().safeParse(record[key]);
  return parsed.success ? parsed.data : undefined;
};

const diffHeaderPath = (file: string): string =>
  file.replaceAll("\\", "/").replace(/^\/+/, "").replace(/^\.\//, "");

const structuredPatchRange = (start: number, lines: number): string => `${start},${lines}`;

const readStructuredPatchHunk = (value: ClaudeProtocolObject[string]): string | null => {
  const parsed = structuredPatchHunkSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const { oldStart, oldLines, newStart, newLines, lines } = parsed.data;
  const hunkLines = lines.flatMap((line) => {
    const text = z.string().safeParse(line);
    return text.success && text.data.length > 0 ? [text.data] : [];
  });
  return [
    `@@ -${structuredPatchRange(oldStart, oldLines)} +${structuredPatchRange(newStart, newLines)} @@`,
    ...hunkLines,
  ].join("\n");
};

const readStructuredPatch = (
  value: ClaudeProtocolObject[string] | undefined,
  file: string | undefined,
): string | null => {
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

const readInputFilePath = (input: ClaudeDecodedToolUse["input"]): string | undefined => {
  if (!input) {
    return undefined;
  }
  return (
    readStringProp(input, "file_path") ??
    readStringProp(input, "notebook_path") ??
    readStringProp(input, "filePath") ??
    readStringProp(input, "path") ??
    readStringProp(input, "file")
  );
};

const readFilePath = (
  record: ClaudeProtocolObject,
  input: ClaudeDecodedToolUse["input"],
): string | undefined =>
  readStringProp(record, "file") ??
  readStringProp(record, "file_path") ??
  readStringProp(record, "filePath") ??
  readStringProp(record, "filepath") ??
  readStringProp(record, "relativePath") ??
  readInputFilePath(input);

const readPatchFromRecord = (
  record: ClaudeProtocolObject,
  file: string | undefined,
  tool: string,
): string | null => {
  const directPatch = readStringProp(record, "patch") ?? readStringProp(record, "diff");
  if (directPatch) {
    return directPatch;
  }
  const originalFile = readStringProp(record, "original_file");
  const updatedFile = readStringProp(record, "updated_file");
  if (file && originalFile !== undefined && updatedFile !== undefined) {
    return createTwoFilesPatch(file, file, originalFile, updatedFile, "", "", { context: 3 });
  }

  for (const key of ["gitDiff", "structuredPatch", "fileDiff", "filediff"] as const) {
    const nested = record[key];
    const nestedText = z.string().safeParse(nested);
    if (nestedText.success && nestedText.data.trim().length > 0) {
      return nestedText.data;
    }
    const structuredPatch = readStructuredPatch(nested, file);
    if (structuredPatch) {
      return structuredPatch;
    }
    const nestedRecord = claudeProtocolObjectSchema.safeParse(nested);
    if (nestedRecord.success) {
      const nestedPatch =
        readStringProp(nestedRecord.data, "patch") ?? readStringProp(nestedRecord.data, "diff");
      if (nestedPatch) {
        return nestedPatch;
      }
    }
  }

  if (normalizeToolName(tool) === "write" && file) {
    const resultType = readStringProp(record, "type")?.toLowerCase();
    const content = readStringValue(record, "content");
    if (resultType === "create" && content !== undefined) {
      return createTwoFilesPatch(file, file, "", content, "", "", { context: 3 });
    }
    const originalFile = readStringValue(record, "originalFile");
    if (resultType === "update" && originalFile !== undefined && content !== undefined) {
      return createTwoFilesPatch(file, file, originalFile, content, "", "", { context: 3 });
    }
  }

  return null;
};

const readResultRecords = (raw: ClaudeDecodedToolResult["raw"]): ClaudeProtocolObject[] => {
  const records: ClaudeProtocolObject[] = [raw];
  for (const key of ["structuredContent", "result", "output", "toolUseResult", "file"] as const) {
    const value = claudeProtocolObjectSchema.safeParse(raw[key]);
    if (value.success) {
      records.push(value.data);
    }
  }
  const content = raw.content;
  const contentRecord = claudeProtocolObjectSchema.safeParse(content);
  if (contentRecord.success) {
    records.push(contentRecord.data);
  }
  if (Array.isArray(content)) {
    for (const entry of content) {
      const entryRecord = claudeProtocolObjectSchema.safeParse(entry);
      if (entryRecord.success) {
        records.push(entryRecord.data);
        const structuredContent = claudeProtocolObjectSchema.safeParse(
          entryRecord.data.structuredContent,
        );
        if (structuredContent.success) {
          records.push(structuredContent.data);
        }
      }
    }
  }
  return records;
};

const fileRecordsFromResult = (raw: ClaudeDecodedToolResult["raw"]): ClaudeProtocolObject[] => {
  const records = readResultRecords(raw);
  const result: ClaudeProtocolObject[] = [];
  for (const record of records) {
    result.push(record);
    for (const key of ["files", "fileDiffs", "changes", "edits"] as const) {
      const files = record[key];
      if (!Array.isArray(files)) {
        continue;
      }
      result.push(
        ...files.flatMap((file) => {
          const parsed = claudeProtocolObjectSchema.safeParse(file);
          return parsed.success ? [parsed.data] : [];
        }),
      );
    }
    const gitDiff = readRecordProp(record, "gitDiff");
    const structuredPatch = readRecordProp(record, "structuredPatch");
    if (gitDiff) {
      result.push(gitDiff);
      const files = gitDiff.files;
      if (Array.isArray(files)) {
        result.push(
          ...files.flatMap((file) => {
            const parsed = claudeProtocolObjectSchema.safeParse(file);
            return parsed.success ? [parsed.data] : [];
          }),
        );
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
  input: ClaudeDecodedToolUse["input"],
  record: ClaudeProtocolObject,
): FileDiff["type"] => {
  if (normalizeToolName(tool) === "write") {
    return readStringProp(record, "type")?.toLowerCase() === "create" ? "added" : "modified";
  }
  const oldString = input?.old_string ?? input?.oldString;
  const parsedOldString = z.string().safeParse(oldString);
  return parsedOldString.success && parsedOldString.data.length === 0 ? "added" : "modified";
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
  input: ClaudeDecodedToolUse["input"];
  raw: ClaudeDecodedToolResult["raw"];
  tool: string;
}): FileDiff[] => {
  const diffs: FileDiff[] = [];
  const seen = new Set<string>();
  for (const record of fileRecordsFromResult(raw)) {
    const type = changeTypeFromToolInput(tool, input, record);
    const additions = readNumberProp(record, "additions");
    const deletions = readNumberProp(record, "deletions");
    const file = readFilePath(record, input);
    const diffInput: Parameters<typeof normalizeClaudeFileDiff>[0] = {
      file,
      patch: readPatchFromRecord(record, file, tool),
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
  input: ClaudeDecodedToolUse["input"];
  raw: ClaudeDecodedToolResult["raw"];
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

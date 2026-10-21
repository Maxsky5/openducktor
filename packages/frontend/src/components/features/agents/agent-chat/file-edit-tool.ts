import type { FileContent, FileDiff } from "@openducktor/contracts";
import { z } from "zod";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { extractPathFromInput } from "./tool-input-utils";
import { relativizeDisplayPath } from "./tool-path-utils";

const FILE_EDIT_TOOLS = new Set([
  "edit",
  "multiedit",
  "write",
  "create",
  "file_write",
  "apply_patch",
  "str_replace",
  "str_replace_based_edit_tool",
  "patch",
  "insert",
  "replace",
]);

export const isFileEditTool = (toolName: string): boolean => {
  return FILE_EDIT_TOOLS.has(toolName.toLowerCase());
};

type FileEditDataBase = {
  filePath: string;
  additions: number;
  deletions: number;
  changeType?: string;
};

export type FileEditData =
  | (FileEditDataBase & {
      kind: "replacement";
      oldContent: string;
      newContent: string;
    })
  | (FileEditDataBase & {
      kind: "diff";
      diff: string;
    })
  | (FileEditDataBase & {
      kind: "content";
      content: string;
      changeType: string;
    })
  | (FileEditDataBase & {
      kind: "path";
    });

const buildPathOnlyFileEditData = (
  filePath: string,
  workingDirectory?: string | null,
): FileEditData => ({
  kind: "path",
  filePath: relativizeDisplayPath(filePath, workingDirectory),
  additions: 0,
  deletions: 0,
});

const buildFileDiffEditData = (
  fileDiff: FileDiff,
  workingDirectory?: string | null,
): FileEditData => {
  const filePath = relativizeDisplayPath(fileDiff.file, workingDirectory);
  if (fileDiff.diff.trim().length === 0) {
    return {
      kind: "path",
      filePath,
      additions: fileDiff.additions,
      deletions: fileDiff.deletions,
      changeType: fileDiff.type,
    };
  }

  return {
    kind: "diff",
    filePath,
    diff: fileDiff.diff,
    additions: fileDiff.additions,
    deletions: fileDiff.deletions,
    changeType: fileDiff.type,
  };
};

const buildFileContentEditData = (
  fileContent: FileContent,
  workingDirectory?: string | null,
): FileEditData => ({
  kind: "content",
  filePath: relativizeDisplayPath(fileContent.file, workingDirectory),
  content: fileContent.content,
  changeType: fileContent.type,
  additions: 0,
  deletions: 0,
});

export const extractAllFileEditData = (
  meta: ToolMeta,
  workingDirectory?: string | null,
): FileEditData[] => {
  if (meta.fileDiffs && meta.fileDiffs.length > 0) {
    return meta.fileDiffs.map((fileDiff) => buildFileDiffEditData(fileDiff, workingDirectory));
  }

  if (meta.fileChanges && meta.fileChanges.length > 0) {
    return meta.fileChanges.map((fileChange) =>
      buildFileDiffEditData(fileChange, workingDirectory),
    );
  }

  if (meta.fileContent && meta.fileContent.length > 0) {
    return meta.fileContent.map((fileContent) =>
      buildFileContentEditData(fileContent, workingDirectory),
    );
  }

  const fileEditData = extractFileEditData(meta, workingDirectory);
  return fileEditData ? [fileEditData] : [];
};

export const extractFileEditData = (
  meta: ToolMeta,
  workingDirectory?: string | null,
): FileEditData | null => {
  const filePath = extractPathFromInput(meta.input);
  if (!filePath) {
    return null;
  }

  if (meta.tool.toLowerCase() === "write" && meta.status !== "error") {
    const write = claudeWriteContentSchema.safeParse(meta.input);
    if (write.success) {
      return buildFileContentEditData(
        { file: filePath, content: write.data.content, type: "modified" },
        workingDirectory,
      );
    }
  }

  if (meta.tool.toLowerCase() === "edit" && meta.status !== "error") {
    const replacement = claudeEditReplacementSchema.safeParse(meta.input);
    if (replacement.success) {
      return {
        kind: "replacement",
        filePath: relativizeDisplayPath(filePath, workingDirectory),
        oldContent: replacement.data.old_string,
        newContent: replacement.data.new_string,
        changeType: "modified",
        additions: 0,
        deletions: 0,
      };
    }
  }

  return buildPathOnlyFileEditData(filePath, workingDirectory);
};

const claudeEditReplacementSchema = z.object({ old_string: z.string(), new_string: z.string() });
const claudeWriteContentSchema = z.object({ content: z.string() });

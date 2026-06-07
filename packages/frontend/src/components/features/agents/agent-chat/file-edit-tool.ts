import type { FileContent, FileDiff } from "@openducktor/contracts";
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
};

export type FileEditData =
  | (FileEditDataBase & {
      kind: "diff";
      diff: string;
    })
  | (FileEditDataBase & {
      kind: "content";
      content: string;
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
    };
  }

  return {
    kind: "diff",
    filePath,
    diff: fileDiff.diff,
    additions: fileDiff.additions,
    deletions: fileDiff.deletions,
  };
};

const buildFileContentEditData = (
  fileContent: FileContent,
  workingDirectory?: string | null,
): FileEditData => ({
  kind: "content",
  filePath: relativizeDisplayPath(fileContent.file, workingDirectory),
  content: fileContent.content,
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

  return buildPathOnlyFileEditData(filePath, workingDirectory);
};

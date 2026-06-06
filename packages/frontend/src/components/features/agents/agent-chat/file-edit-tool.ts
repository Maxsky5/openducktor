import type { FileDiff } from "@openducktor/contracts";
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

export type FileEditData = {
  filePath: string;
  diff: string | null;
  additions: number;
  deletions: number;
};

const buildPathOnlyFileEditData = (
  filePath: string,
  workingDirectory?: string | null,
): FileEditData => ({
  filePath: relativizeDisplayPath(filePath, workingDirectory),
  diff: null,
  additions: 0,
  deletions: 0,
});

const buildStructuredFileEditData = (
  fileChange: FileDiff,
  workingDirectory?: string | null,
): FileEditData => ({
  filePath: relativizeDisplayPath(fileChange.file, workingDirectory),
  diff: fileChange.diff.trim().length > 0 ? fileChange.diff : null,
  additions: fileChange.additions,
  deletions: fileChange.deletions,
});

export const extractAllFileEditData = (
  meta: ToolMeta,
  workingDirectory?: string | null,
): FileEditData[] => {
  if (meta.fileChanges && meta.fileChanges.length > 0) {
    return meta.fileChanges.map((fileChange) =>
      buildStructuredFileEditData(fileChange, workingDirectory),
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

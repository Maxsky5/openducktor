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

export const extractFileEditData = (
  meta: ToolMeta,
  workingDirectory?: string | null,
): FileEditData | null => {
  let filePath = extractPathFromInput(meta.input);

  if (!filePath && typeof meta.input?.patch === "string") {
    const patchContent = meta.input.patch as string;
    const diffMatch = /^---\s+a\/(.+)$/m.exec(patchContent);
    if (diffMatch?.[1]) {
      filePath = diffMatch[1];
    }
  }

  if (!filePath && typeof meta.output === "string") {
    const outputFileMatch =
      /(?:Updated|Modified|Created|Changed)[^:]*:\s*(?:[MADRCU]\s+)?(.+?)$/m.exec(meta.output);
    if (outputFileMatch?.[1]) {
      filePath = outputFileMatch[1].trim();
    }
  }

  if (!filePath) {
    return null;
  }

  filePath = relativizeDisplayPath(filePath, workingDirectory);

  const diff =
    typeof meta.metadata?.diff === "string"
      ? meta.metadata.diff
      : typeof meta.input?.patch === "string"
        ? (meta.input.patch as string)
        : typeof meta.output === "string" && meta.output.includes("@@")
          ? meta.output
          : null;

  let additions = 0;
  let deletions = 0;
  if (diff) {
    for (const line of diff.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        additions++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deletions++;
      }
    }
  }

  return { filePath, diff, additions, deletions };
};

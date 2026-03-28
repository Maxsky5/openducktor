import { patchMatchesFile, selectRenderableDiff, splitPatchCandidates } from "../renderable-patch";
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

const extractRawDiff = (meta: ToolMeta): string | null => {
  return typeof meta.metadata?.diff === "string"
    ? meta.metadata.diff
    : typeof meta.input?.patch === "string"
      ? (meta.input.patch as string)
      : typeof meta.output === "string" && meta.output.includes("@@")
        ? meta.output
        : null;
};

const countDiffChanges = (diff: string | null): Pick<FileEditData, "additions" | "deletions"> => {
  let additions = 0;
  let deletions = 0;

  if (!diff) {
    return { additions, deletions };
  }

  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions++;
    }
  }

  return { additions, deletions };
};

const buildFileEditData = (
  filePath: string,
  rawDiff: string | null,
  workingDirectory?: string | null,
): FileEditData => {
  const displayPath = relativizeDisplayPath(filePath, workingDirectory);
  const diff = rawDiff
    ? (selectRenderableDiff(rawDiff, displayPath) ??
      (displayPath !== filePath ? selectRenderableDiff(rawDiff, filePath) : null))
    : null;
  const { additions, deletions } = countDiffChanges(diff);

  return {
    filePath: displayPath,
    diff,
    additions,
    deletions,
  };
};

const normalizePatchPath = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "/dev/null") {
    return null;
  }

  return trimmed.replace(/^[ab]\//, "");
};

const extractPatchFilePath = (candidate: string): string | null => {
  const nextPath = normalizePatchPath(/^\+\+\+\s+(.+)$/m.exec(candidate)?.[1]);
  if (nextPath) {
    return nextPath;
  }

  const previousPath = normalizePatchPath(/^---\s+(.+)$/m.exec(candidate)?.[1]);
  if (previousPath) {
    return previousPath;
  }

  const indexPath = normalizePatchPath(/^Index:\s+(.+)$/m.exec(candidate)?.[1]);
  if (indexPath) {
    return indexPath;
  }

  return normalizePatchPath(/^diff --git a\/(.+?) b\//m.exec(candidate)?.[1]);
};

export const extractAllFileEditData = (
  meta: ToolMeta,
  workingDirectory?: string | null,
): FileEditData[] => {
  const rawDiff = extractRawDiff(meta);
  if (rawDiff) {
    const fileEditData: FileEditData[] = [];
    const seenPaths = new Set<string>();

    for (const candidate of splitPatchCandidates(rawDiff)) {
      const filePath = extractPatchFilePath(candidate);
      if (!filePath || seenPaths.has(filePath) || !patchMatchesFile(candidate, filePath)) {
        continue;
      }

      fileEditData.push(buildFileEditData(filePath, candidate, workingDirectory));
      seenPaths.add(filePath);
    }

    if (fileEditData.length > 0) {
      return fileEditData;
    }
  }

  const fileEditData = extractFileEditData(meta, workingDirectory);
  return fileEditData ? [fileEditData] : [];
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

  return buildFileEditData(filePath, extractRawDiff(meta), workingDirectory);
};

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

const HEADER_ADDITION_PREFIX = "+++ ";
const HEADER_DELETION_PREFIX = "--- ";

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
    if (line.startsWith(HEADER_ADDITION_PREFIX) || line.startsWith(HEADER_DELETION_PREFIX)) {
      continue;
    }

    if (line.startsWith("+")) {
      additions++;
    } else if (line.startsWith("-")) {
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

  let trimmed = value.trim().replace(/\t.*$/, "");
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    trimmed = trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  if (trimmed.length === 0 || trimmed === "/dev/null") {
    return null;
  }

  return trimmed.replace(/^[ab]\//, "");
};

const extractDiffGitPaths = (
  candidate: string,
): { previousPath: string; nextPath: string } | null => {
  const line = /^diff --git\s+(.+)$/m.exec(candidate)?.[1];
  if (!line) {
    return null;
  }

  const match = /^(?:"((?:[^"\\]|\\.)*)"|(\S+))\s+(?:"((?:[^"\\]|\\.)*)"|(\S+))$/.exec(line.trim());
  if (!match) {
    return null;
  }

  const previousPath = normalizePatchPath(match[1] ?? match[2]);
  const nextPath = normalizePatchPath(match[3] ?? match[4]);
  if (!previousPath || !nextPath) {
    return null;
  }

  return { previousPath, nextPath };
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

  return extractDiffGitPaths(candidate)?.nextPath ?? null;
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
      if (!filePath || !patchMatchesFile(candidate, filePath)) {
        continue;
      }

      const data = buildFileEditData(filePath, candidate, workingDirectory);
      if (seenPaths.has(data.filePath)) {
        continue;
      }

      fileEditData.push(data);
      seenPaths.add(data.filePath);
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
    const patchFilePath = extractPatchFilePath(patchContent);
    if (patchFilePath) {
      filePath = patchFilePath;
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

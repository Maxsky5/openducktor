import type { FileDiff } from "@openducktor/contracts";

type DiffPreloadEntry = {
  file: string;
  diff: string;
};

export const buildDiffPreloadEntries = (
  fileDiffs: ReadonlyArray<FileDiff>,
  expandedFiles: ReadonlySet<string>,
  limit: number,
): DiffPreloadEntry[] => {
  if (limit <= 0) {
    return [];
  }

  if (expandedFiles.size > 0) {
    return [];
  }

  const next: DiffPreloadEntry[] = [];
  for (const fileDiff of fileDiffs) {
    if (next.length >= limit) {
      break;
    }
    if (fileDiff.diff.trim().length === 0) {
      continue;
    }
    next.push({ file: fileDiff.file, diff: fileDiff.diff });
  }
  return next;
};

import type { GitFileDiff } from "@openducktor/contracts";
import { PIERRE_HIGHLIGHT_LINE_LIMIT } from "@/lib/diff/pierre-config";

type DiffPreloadEntry = {
  file: string;
  diff: string;
};

export const buildDiffPreloadEntries = (
  fileDiffs: ReadonlyArray<GitFileDiff>,
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
    // Reject large changes before the preloader parses their patches on the UI thread.
    if (Math.max(fileDiff.additions, fileDiff.deletions) > PIERRE_HIGHLIGHT_LINE_LIMIT) {
      continue;
    }
    if (fileDiff.diff.trim().length === 0) {
      continue;
    }
    next.push({ file: fileDiff.file, diff: fileDiff.diff });
  }
  return next;
};

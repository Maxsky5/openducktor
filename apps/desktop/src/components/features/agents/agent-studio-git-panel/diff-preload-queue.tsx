import type { FileDiff } from "@openducktor/contracts";
import { memo, type ReactElement, useMemo } from "react";
import { PierreDiffPreloader } from "@/components/features/agents/pierre-diff-viewer";

type DiffPreloadEntry = {
  file: string;
  diff: string;
};

type DiffPreloadQueueProps = {
  fileDiffs: FileDiff[];
  expandedFiles: ReadonlySet<string>;
  limit: number;
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

export const DiffPreloadQueue = memo(function DiffPreloadQueue({
  fileDiffs,
  expandedFiles,
  limit,
}: DiffPreloadQueueProps): ReactElement | null {
  const preloadEntries = useMemo(
    () => buildDiffPreloadEntries(fileDiffs, expandedFiles, limit),
    [expandedFiles, fileDiffs, limit],
  );

  if (preloadEntries.length === 0) {
    return null;
  }

  return (
    <>
      {preloadEntries.map((entry) => (
        <PierreDiffPreloader
          key={`preload:${entry.file}`}
          patch={entry.diff}
          filePath={entry.file}
        />
      ))}
    </>
  );
});

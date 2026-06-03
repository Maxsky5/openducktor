import type { FileDiff } from "@openducktor/contracts";
import { memo, type ReactElement, useMemo } from "react";
import { PierreDiffPreloader } from "@/components/features/agents/pierre-diff-viewer";
import { buildDiffPreloadEntries } from "./diff-preload-queue-model";

type DiffPreloadQueueProps = {
  fileDiffs: FileDiff[];
  expandedFiles: ReadonlySet<string>;
  limit: number;
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

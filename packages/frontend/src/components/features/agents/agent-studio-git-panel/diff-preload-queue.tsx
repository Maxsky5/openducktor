import type { GitFileDiff } from "@openducktor/contracts";
import { memo, type ReactElement, useCallback, useMemo, useState } from "react";
import { PierreDiffPreloader } from "@/components/features/agents/pierre-diff-viewer";
import { buildDiffPreloadEntries } from "./diff-preload-queue-model";

type DiffPreloadQueueProps = {
  fileDiffs: GitFileDiff[];
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
  const [progress, setProgress] = useState(() => ({ entries: preloadEntries, index: 0 }));
  const index = progress.entries === preloadEntries ? progress.index : 0;
  if (progress.entries !== preloadEntries) {
    setProgress({ entries: preloadEntries, index: 0 });
  }
  const onComplete = useCallback(() => {
    setProgress((current) =>
      current.entries === preloadEntries && current.index === index
        ? { ...current, index: index + 1 }
        : current,
    );
  }, [index, preloadEntries]);
  const entry = preloadEntries[index];

  if (!entry) {
    return null;
  }

  return (
    <PierreDiffPreloader
      key={`preload:${entry.file}`}
      patch={entry.diff}
      filePath={entry.file}
      onComplete={onComplete}
    />
  );
});

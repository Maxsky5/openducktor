import type { FileDiff } from "@openducktor/contracts";
import { AlignJustify, SplitSquareHorizontal } from "lucide-react";
import { memo, type ReactElement, useMemo } from "react";
import type { PierreDiffStyle } from "@/components/features/agents/pierre-diff-viewer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PRELOAD_DIFF_LIMIT } from "./constants";
import { DiffPreloadQueue } from "./diff-preload-queue";
import { FileDiffEntryWithMemo } from "./file-diff-entry";

type FileDiffListProps = {
  fileDiffs: FileDiff[];
  conflictedFiles: ReadonlySet<string>;
  diffStyle: PierreDiffStyle;
  setDiffStyle: (style: PierreDiffStyle) => void;
  expandedFiles: ReadonlySet<string>;
  onToggleFile: (filePath: string) => void;
};

export const FileDiffList = memo(function FileDiffList({
  fileDiffs,
  conflictedFiles,
  diffStyle,
  setDiffStyle,
  expandedFiles,
  onToggleFile,
}: FileDiffListProps): ReactElement {
  const { totalAdditions, totalDeletions } = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const fileDiff of fileDiffs) {
      additions += fileDiff.additions;
      deletions += fileDiff.deletions;
    }
    return { totalAdditions: additions, totalDeletions: deletions };
  }, [fileDiffs]);
  const reserveConflictSlot = conflictedFiles.size > 0;

  return (
    <div className="divide-y divide-border/50">
      <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
        <span>
          {fileDiffs.length} changed file{fileDiffs.length > 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-2">
          <span className="font-mono">
            {totalAdditions > 0 ? (
              <span className="mr-1.5 text-green-400">+{totalAdditions}</span>
            ) : null}
            {totalDeletions > 0 ? <span className="text-red-400">-{totalDeletions}</span> : null}
          </span>
          <div className="flex items-center overflow-hidden rounded-md border border-border/50">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "p-1 transition-colors",
                    diffStyle === "split"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setDiffStyle("split")}
                >
                  <SplitSquareHorizontal className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Side-by-side</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "p-1 transition-colors",
                    diffStyle === "unified"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setDiffStyle("unified")}
                >
                  <AlignJustify className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Unified</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      <DiffPreloadQueue
        fileDiffs={fileDiffs}
        expandedFiles={expandedFiles}
        limit={PRELOAD_DIFF_LIMIT}
      />

      {fileDiffs.map((diff) => (
        <FileDiffEntryWithMemo
          key={diff.file}
          diff={diff}
          isConflicted={conflictedFiles.has(diff.file)}
          reserveConflictSlot={reserveConflictSlot}
          isExpanded={expandedFiles.has(diff.file)}
          onToggle={onToggleFile}
          diffStyle={diffStyle}
        />
      ))}
    </div>
  );
});

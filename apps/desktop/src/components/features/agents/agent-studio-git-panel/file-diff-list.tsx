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

type DiffStyleToggleButtonProps = {
  icon: typeof SplitSquareHorizontal;
  isActive: boolean;
  label: string;
  onClick: () => void;
};

function DiffStyleToggleButton({
  icon: Icon,
  isActive,
  label,
  onClick,
}: DiffStyleToggleButtonProps): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={isActive}
          className={cn(
            "p-1 transition-colors",
            isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          onClick={onClick}
        >
          <Icon className="size-3" />
          <span className="sr-only">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

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
            <DiffStyleToggleButton
              icon={SplitSquareHorizontal}
              isActive={diffStyle === "split"}
              label="Side-by-side"
              onClick={() => setDiffStyle("split")}
            />
            <DiffStyleToggleButton
              icon={AlignJustify}
              isActive={diffStyle === "unified"}
              label="Unified"
              onClick={() => setDiffStyle("unified")}
            />
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

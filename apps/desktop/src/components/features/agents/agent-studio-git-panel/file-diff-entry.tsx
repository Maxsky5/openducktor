import type { FileDiff } from "@openducktor/contracts";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { memo, type ReactElement } from "react";
import type { PierreDiffStyle } from "@/components/features/agents/pierre-diff-viewer";
import {
  PierreDiffPreloader,
  PierreDiffViewer,
} from "@/components/features/agents/pierre-diff-viewer";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FILE_STATUS_BADGE, FILE_STATUS_COLOR, FILE_STATUS_ICON } from "./constants";

const areFileDiffsEqual = (left: FileDiff, right: FileDiff): boolean =>
  left.file === right.file &&
  left.type === right.type &&
  left.additions === right.additions &&
  left.deletions === right.deletions &&
  left.diff === right.diff;

type FileDiffEntryProps = {
  diff: FileDiff;
  isExpanded: boolean;
  onToggle: (filePath: string) => void;
  diffStyle: PierreDiffStyle;
};

function FileDiffEntry({
  diff,
  isExpanded,
  onToggle,
  diffStyle,
}: FileDiffEntryProps): ReactElement {
  const StatusIcon = FILE_STATUS_ICON[diff.type] ?? FileText;
  const statusColor = FILE_STATUS_COLOR[diff.type] ?? "text-muted-foreground";
  const statusBadge = FILE_STATUS_BADGE[diff.type] ?? "?";

  const fileName = diff.file.split("/").pop() ?? diff.file;
  const dirName = diff.file.includes("/") ? diff.file.slice(0, diff.file.lastIndexOf("/")) : "";
  const hasDiffContent = diff.diff.trim().length > 0;

  return (
    <div>
      {isExpanded && hasDiffContent ? <PierreDiffPreloader patch={diff.diff} /> : null}

      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/50"
        onClick={() => onToggle(diff.file)}
      >
        {isExpanded ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        )}
        <StatusIcon className={cn("size-3.5 shrink-0", statusColor)} />
        <span className="flex-1 truncate">
          {dirName ? <span className="text-muted-foreground">{dirName}/</span> : null}
          <span className="font-medium">{fileName}</span>
        </span>
        <Badge
          variant="outline"
          className={cn("ml-auto px-1 py-0 text-[10px] font-mono", statusColor)}
        >
          {statusBadge}
        </Badge>
        <span className="flex items-center gap-1 text-[10px] font-mono">
          {diff.additions > 0 ? <span className="text-green-400">+{diff.additions}</span> : null}
          {diff.deletions > 0 ? <span className="text-red-400">-{diff.deletions}</span> : null}
        </span>
      </button>

      {isExpanded ? (
        <div className="border-t border-border/50">
          {hasDiffContent ? (
            <PierreDiffViewer patch={diff.diff} diffStyle={diffStyle} />
          ) : (
            <div className="p-3 text-xs italic text-muted-foreground">
              No diff content available for {diff.file}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export const FileDiffEntryWithMemo = memo(
  FileDiffEntry,
  (previous, next) =>
    previous.isExpanded === next.isExpanded &&
    previous.diffStyle === next.diffStyle &&
    previous.onToggle === next.onToggle &&
    areFileDiffsEqual(previous.diff, next.diff),
);

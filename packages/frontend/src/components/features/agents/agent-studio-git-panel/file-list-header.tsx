import { AlignJustify, List, ListTree, type LucideIcon, SplitSquareHorizontal } from "lucide-react";
import { type ReactElement, useId } from "react";
import type { PierreDiffStyle } from "@/components/features/agents/pierre-diff-viewer";
import { ToolbarSearchField } from "@/components/ui/search-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { FileListViewMode } from "./file-list-view-preference";

export function FileListHeader({
  fileCount,
  matchCount,
  totalAdditions,
  totalDeletions,
  viewMode,
  onViewModeChange,
  diffStyle,
  onDiffStyleChange,
  searchText,
  onSearchTextChange,
}: {
  fileCount: number;
  /** The count of files that match the search, or null while no search is active. */
  matchCount: number | null;
  totalAdditions: number;
  totalDeletions: number;
  viewMode: FileListViewMode;
  onViewModeChange: (viewMode: FileListViewMode) => void;
  diffStyle: PierreDiffStyle;
  onDiffStyleChange: (style: PierreDiffStyle) => void;
  searchText: string;
  onSearchTextChange: (text: string) => void;
}): ReactElement {
  const searchFieldId = useId();

  return (
    <div
      className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2 text-xs text-muted-foreground"
      data-testid="agent-studio-git-list-header"
    >
      <div className="min-w-0 flex-1">
        <ToolbarSearchField
          id={searchFieldId}
          label="Search files"
          value={searchText}
          placeholder="Search files"
          onValueChange={onSearchTextChange}
        />
      </div>
      {matchCount !== null ? (
        <span
          className="shrink-0 whitespace-nowrap tabular-nums"
          title={`${matchCount} of ${fileCount} changed files match the search`}
          data-testid="agent-studio-git-file-count"
        >
          {matchCount}/{fileCount}
        </span>
      ) : null}
      <span
        className="shrink-0 whitespace-nowrap font-mono"
        data-testid="agent-studio-git-line-totals"
      >
        {totalAdditions > 0 ? (
          <span className="mr-1.5 text-green-500">+{totalAdditions}</span>
        ) : null}
        {totalDeletions > 0 ? <span className="text-red-500">-{totalDeletions}</span> : null}
      </span>
      <ToggleIconGroup label="File list view">
        <ToggleIconButton
          icon={ListTree}
          isActive={viewMode === "tree"}
          label="Tree view"
          onClick={() => onViewModeChange("tree")}
        />
        <ToggleIconButton
          icon={List}
          isActive={viewMode === "list"}
          label="List view"
          onClick={() => onViewModeChange("list")}
        />
      </ToggleIconGroup>
      <ToggleIconGroup label="Diff style">
        <ToggleIconButton
          icon={SplitSquareHorizontal}
          isActive={diffStyle === "split"}
          label="Side-by-side"
          onClick={() => onDiffStyleChange("split")}
        />
        <ToggleIconButton
          icon={AlignJustify}
          isActive={diffStyle === "unified"}
          label="Unified"
          onClick={() => onDiffStyleChange("unified")}
        />
      </ToggleIconGroup>
    </div>
  );
}

type ToggleIconButtonProps = {
  icon: LucideIcon;
  isActive: boolean;
  label: string;
  onClick: () => void;
};

function ToggleIconButton({
  icon: Icon,
  isActive,
  label,
  onClick,
}: ToggleIconButtonProps): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={isActive}
          className={cn(
            "cursor-pointer p-1",
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

function ToggleIconGroup({
  label,
  children,
}: {
  label: string;
  children: ReactElement[];
}): ReactElement {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 items-center overflow-hidden rounded-md border border-border/50"
    >
      {children}
    </div>
  );
}

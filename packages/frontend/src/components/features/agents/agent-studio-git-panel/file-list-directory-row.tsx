import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { FILE_LIST_ROW_CLASS_NAME, fileListRowStyle } from "./constants";
import type { DirectoryRow } from "./file-list-rows";
import { HighlightedText } from "./highlighted-text";

export function FileListDirectoryRow({
  row,
  onToggle,
}: {
  row: DirectoryRow;
  onToggle: (directory: DirectoryRow) => void;
}): ReactElement {
  const Chevron = row.isOpen ? ChevronDown : ChevronRight;
  const fileCountLabel = `${row.fileCount} changed file${row.fileCount === 1 ? "" : "s"}`;
  return (
    <button
      type="button"
      className={cn(
        FILE_LIST_ROW_CLASS_NAME,
        "text-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
      // Directory rows show only in tree view.
      style={fileListRowStyle("tree", row.depth)}
      aria-label={row.path}
      aria-description={`${fileCountLabel}, ${row.additions} lines added, ${row.deletions} lines removed`}
      aria-expanded={row.isOpen}
      title={row.name.text}
      data-testid="agent-studio-git-directory-toggle-button"
      onClick={() => onToggle(row)}
    >
      <Chevron className="size-3 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">
        <HighlightedText label={row.name} />
      </span>
      <span
        className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums text-foreground/70"
        title={fileCountLabel}
        aria-hidden="true"
      >
        {row.fileCount}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[10px] whitespace-nowrap tabular-nums">
        {row.additions > 0 ? (
          <span className="text-green-700 dark:text-green-400">+{row.additions}</span>
        ) : null}
        {row.deletions > 0 ? (
          <span className="text-red-600 dark:text-red-400">-{row.deletions}</span>
        ) : null}
      </span>
    </button>
  );
}

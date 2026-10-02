import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { FILE_LIST_ROW_CLASS_NAME, fileListRowIndentStyle } from "./constants";
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
  return (
    <button
      type="button"
      className={cn(
        FILE_LIST_ROW_CLASS_NAME,
        "text-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
      style={fileListRowIndentStyle(row.depth)}
      aria-label={row.path}
      aria-expanded={row.isOpen}
      title={row.name.text}
      data-testid="agent-studio-git-directory-toggle-button"
      onClick={() => onToggle(row)}
    >
      <Chevron className="size-3 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">
        <HighlightedText label={row.name} />
      </span>
    </button>
  );
}

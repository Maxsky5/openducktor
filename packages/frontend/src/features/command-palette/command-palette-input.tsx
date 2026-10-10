import { ArrowLeft, LoaderCircle, Search } from "lucide-react";
import type { ReactElement, ReactNode, RefObject } from "react";
import { WorkspaceTile } from "@/components/layout/workspace-tile";
import type { PaletteHighlight, PaletteRowEntry } from "./use-command-palette-navigation";
import { useHighlightedOption } from "./use-highlighted-option";

/**
 * The search input, a combobox of the result list. The main list adds the loading sign and its
 * `children`, the workspace scope. A row action list puts its task or chat before the input.
 *
 * The input owns the link to the highlighted option, so a new link renders only the input row.
 */
export function CommandPaletteInput({
  inputRef,
  query,
  listRoot,
  highlight,
  highlightRequest,
  onQueryChange,
  row,
  onBack,
  isLoading,
  children,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  /** The element that holds the cmdk list. */
  listRoot: HTMLElement | null;
  highlight: Pick<PaletteHighlight, "value" | "needsScroll" | "enabledValues">;
  highlightRequest: number;
  onQueryChange: (query: string) => void;
  /** The task or chat of the open action list, or null in the main list. */
  row: PaletteRowEntry | null;
  onBack: () => void;
  isLoading: boolean;
  children: ReactNode;
}): ReactElement {
  const placeholder = placeholderOf(row);
  const listboxLink = useHighlightedOption(listRoot, highlight, highlightRequest);
  return (
    <div className="flex items-center gap-2 border-b border-border px-3">
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      {row ? <RowChip row={row} onBack={onBack} /> : null}
      <input
        ref={inputRef}
        role="combobox"
        aria-label={placeholder}
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls={listboxLink.listId}
        aria-activedescendant={listboxLink.optionId}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={query}
        placeholder={placeholder}
        onChange={(event) => onQueryChange(event.target.value)}
        className="h-14 w-full min-w-0 border-0 bg-transparent text-base text-foreground caret-primary outline-none placeholder:text-muted-foreground"
      />
      {row ? null : (
        <>
          {isLoading ? (
            <LoaderCircle
              className="size-4 shrink-0 animate-spin text-muted-foreground"
              aria-label="Loading tasks and chats"
            />
          ) : null}
          {children}
        </>
      )}
    </div>
  );
}

const placeholderOf = (row: PaletteRowEntry | null): string => {
  if (row === null) return "Search actions, tasks, and chats…";
  return row.kind === "task" ? "Search task actions…" : "Search chat actions…";
};

/** The task or chat of the action list, in the input row. Its button returns to the main list. */
export function RowChip({
  row,
  onBack,
}: {
  row: PaletteRowEntry;
  onBack: () => void;
}): ReactElement {
  return (
    <span className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-1.5 rounded-md bg-muted py-1 pl-1 pr-2 text-xs font-medium">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Back to all results"
        className="flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onBack}
      >
        <ArrowLeft className="size-3.5" />
      </button>
      <WorkspaceTile workspace={row.item.workspace} size="xs" className="size-4 shadow-none" />
      <span className="truncate">{row.kind === "task" ? row.item.task.title : row.item.title}</span>
    </span>
  );
}

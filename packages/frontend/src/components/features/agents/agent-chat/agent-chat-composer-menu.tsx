import { Search } from "lucide-react";
import { type ReactElement, type ReactNode, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type AgentChatComposerMenuProps = {
  listboxId: string;
  label: string;
  activeIndex: number;
  items: readonly unknown[];
  isBusy?: boolean | undefined;
  feedback: ReactNode;
  children: ReactNode;
};

export function AgentChatComposerMenu({
  listboxId,
  label,
  activeIndex,
  items,
  isBusy,
  feedback,
  children,
}: AgentChatComposerMenuProps): ReactElement {
  const listRef = useRef<HTMLDivElement>(null);
  const itemCount = items.length;

  useLayoutEffect(() => {
    const list = listRef.current;
    const activeRow = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !activeRow) {
      return;
    }

    // Scroll before paint; scrollIntoView can also move the chat or page.
    const viewport = list.getBoundingClientRect();
    const row = activeRow.getBoundingClientRect();
    const top = viewport.top + list.clientTop;
    const bottom = top + list.clientHeight;
    if (row.top < top || row.height > list.clientHeight) {
      list.scrollTop += row.top - top;
    } else if (row.bottom > bottom) {
      list.scrollTop += row.bottom - bottom;
    }
  }, [activeIndex, items]);

  return (
    <div className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-md overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium">{label}</span>
        {itemCount > 0 ? (
          <span>
            {activeIndex + 1} / {itemCount}
          </span>
        ) : null}
      </div>
      {feedback}
      <div
        ref={listRef}
        id={listboxId}
        role="listbox"
        aria-label={label}
        aria-busy={isBusy || undefined}
        className="hide-scrollbar flex max-h-[min(16rem,40vh)] flex-col overflow-y-auto overscroll-contain scroll-auto"
      >
        {children}
      </div>
    </div>
  );
}

export function AgentChatComposerMenuEmptyState({ title }: { title: string }): ReactElement {
  return (
    <div role="status" className="flex items-center gap-3 px-4 py-5">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      >
        <Search className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Try a different name or clear your search.
        </p>
      </div>
    </div>
  );
}

export function AgentChatComposerMenuRow({
  optionId,
  isActive,
  onSelect,
  children,
}: {
  optionId: string;
  isActive: boolean;
  onSelect: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      id={optionId}
      role="option"
      aria-selected={isActive}
      tabIndex={-1}
      type="button"
      className={cn(
        "flex w-full shrink-0 cursor-pointer gap-3 px-3 py-2 text-left",
        isActive ? "bg-selected-surface" : "hover:bg-muted/80",
      )}
      onPointerDown={(event) => {
        event.preventDefault();
        onSelect();
      }}
    >
      {children}
    </button>
  );
}

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { humanDate } from "@/lib/task-display";
import { cn } from "@/lib/utils";
import { ChevronDown, CircleHelp } from "lucide-react";
import type { ReactElement } from "react";

type TaskDetailsDocumentSectionProps = {
  title: string;
  description?: string;
  icon: ReactElement;
  markdown: string;
  updatedAt: string | null;
  isLoading: boolean;
  error: string | null;
  empty: string;
  isExpanded: boolean;
  onToggle: () => void;
};

export function TaskDetailsDocumentSection({
  title,
  description,
  icon,
  markdown,
  updatedAt,
  isLoading,
  error,
  empty,
  isExpanded,
  onToggle,
}: TaskDetailsDocumentSectionProps): ReactElement {
  const content = markdown.trim();
  const hasContent = content.length > 0;

  return (
    <section className="space-y-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={onToggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-0.5 text-left outline-none transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500/40"
        >
          <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            {icon}
            {title}
          </h4>
          <span className="inline-flex items-center gap-2">
            {hasContent && updatedAt && isExpanded ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">
                {humanDate(updatedAt)}
              </span>
            ) : null}
            <ChevronDown
              className={cn(
                "size-3.5 text-slate-500 transition-transform duration-150",
                isExpanded ? "rotate-180" : "rotate-0",
              )}
            />
          </span>
        </button>
        {description ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 rounded-full p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                aria-label={`More info about ${title}`}
              >
                <CircleHelp className="size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-600">
              {description}
            </PopoverContent>
          </Popover>
        ) : null}
      </div>

      {isExpanded && isLoading ? (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="h-3 w-4/5 animate-pulse rounded bg-slate-200" />
          <div className="h-3 w-full animate-pulse rounded bg-slate-200" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-slate-200" />
        </div>
      ) : null}

      {isExpanded && !isLoading && error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {isExpanded && !isLoading && !error ? (
        content ? (
          <pre
            className={cn(
              "max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50/90 p-3",
              "font-mono text-xs leading-relaxed text-slate-700",
            )}
          >
            {content}
          </pre>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
            {empty}
          </p>
        )
      ) : null}
    </section>
  );
}

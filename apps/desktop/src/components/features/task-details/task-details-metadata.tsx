import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { TaskCard } from "@openblueprint/contracts";
import { ChevronDown, Layers3 } from "lucide-react";
import { type ReactElement, memo, useEffect, useState } from "react";

type TaskDetailsMetadataProps = {
  task: TaskCard;
  defaultExpanded?: boolean;
};

export const TaskDetailsMetadata = memo(function TaskDetailsMetadata({
  task,
  defaultExpanded = false,
}: TaskDetailsMetadataProps): ReactElement {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  useEffect(() => {
    setIsExpanded(defaultExpanded);
  }, [defaultExpanded]);

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={setIsExpanded}
      className="rounded-xl border border-slate-200/90 bg-white shadow-sm"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md p-4 text-left outline-none transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500/40"
        >
          <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            <Layers3 className="size-3.5" />
            Metadata
          </h4>
          <ChevronDown
            className={cn(
              "size-3.5 text-slate-500 transition-transform duration-150",
              isExpanded ? "rotate-180" : "rotate-0",
            )}
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent forceMount className="overflow-hidden data-[state=closed]:hidden px-4 pb-4">
        <div className="pt-3">
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {task.parentId ? (
              <div className="grid gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Parent
                </span>
                <span className="font-mono text-xs text-slate-700">{task.parentId}</span>
              </div>
            ) : (
              <span className="text-slate-500">No metadata to display.</span>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

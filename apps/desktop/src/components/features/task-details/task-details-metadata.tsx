import { cn } from "@/lib/utils";
import type { TaskCard } from "@openblueprint/contracts";
import { ChevronDown, Layers3 } from "lucide-react";
import type { ReactElement } from "react";

type TaskDetailsMetadataProps = {
  task: TaskCard;
  isExpanded: boolean;
  onToggle: () => void;
};

export function TaskDetailsMetadata({
  task,
  isExpanded,
  onToggle,
}: TaskDetailsMetadataProps): ReactElement {
  return (
    <section className="space-y-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-0.5 text-left outline-none transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-sky-500/40"
        onClick={onToggle}
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

      {isExpanded ? (
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
      ) : null}
    </section>
  );
}

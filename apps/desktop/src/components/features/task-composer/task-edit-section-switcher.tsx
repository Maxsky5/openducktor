import { cn } from "@/lib/utils";
import type { EditTaskSection } from "@/types/task-composer";
import { ClipboardList, FileCode, ScrollText } from "lucide-react";
import type { ReactElement } from "react";

type TaskEditSectionSwitcherProps = {
  section: EditTaskSection;
  hasUnsavedSpec: boolean;
  hasUnsavedPlan: boolean;
  disabled?: boolean;
  onSectionChange: (section: EditTaskSection) => void;
};

type SectionItem = {
  id: EditTaskSection;
  label: string;
  icon: typeof ClipboardList;
  hasUnsaved: boolean;
};

export function TaskEditSectionSwitcher({
  section,
  hasUnsavedSpec,
  hasUnsavedPlan,
  disabled = false,
  onSectionChange,
}: TaskEditSectionSwitcherProps): ReactElement {
  const sections: SectionItem[] = [
    {
      id: "details",
      label: "Details",
      icon: ClipboardList,
      hasUnsaved: false,
    },
    {
      id: "spec",
      label: "Spec",
      icon: FileCode,
      hasUnsaved: hasUnsavedSpec,
    },
    {
      id: "plan",
      label: "Plan",
      icon: ScrollText,
      hasUnsaved: hasUnsavedPlan,
    },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-1.5">
      <div className="flex flex-wrap gap-1">
        {sections.map((item) => {
          const isActive = item.id === section;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() => onSectionChange(item.id)}
              className={cn(
                "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
                isActive
                  ? "border-sky-300 bg-sky-100 text-sky-900 shadow-sm"
                  : "border-transparent bg-white/80 text-slate-700 hover:border-slate-300 hover:bg-white",
                disabled ? "cursor-not-allowed opacity-60" : "",
              )}
              aria-pressed={isActive}
            >
              <Icon className="size-4" />
              <span>{item.label}</span>
              {item.hasUnsaved ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    isActive ? "bg-sky-200 text-sky-800" : "bg-amber-100 text-amber-700",
                  )}
                >
                  Unsaved
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

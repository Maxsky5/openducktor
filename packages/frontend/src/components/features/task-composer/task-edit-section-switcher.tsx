import { ClipboardList, FileCode, ScrollText } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import type { EditTaskSection } from "@/types/task-composer";

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
    <div className="inline-flex h-10 w-full items-center gap-2 rounded-lg bg-muted p-1">
      {sections.map((item) => {
        const isActive = item.id === section;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={isActive}
            disabled={disabled}
            onClick={() => onSectionChange(item.id)}
            className={cn(
              "inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background hover:text-foreground",
              disabled ? "pointer-events-none opacity-60" : "",
            )}
          >
            <Icon className="size-4" />
            <span>{item.label}</span>
            {item.hasUnsaved ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  isActive
                    ? "bg-primary-foreground text-primary"
                    : "bg-warning-surface text-warning-muted",
                )}
              >
                Unsaved
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

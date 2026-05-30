import { ClipboardList, FileCode, ScrollText } from "lucide-react";
import type { ReactElement } from "react";
import { SegmentedControlItem, SegmentedControlRoot } from "@/components/ui/segmented-control";
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
    <SegmentedControlRoot size="md" className="w-full">
      {sections.map((item) => {
        const isActive = item.id === section;
        const Icon = item.icon;
        return (
          <SegmentedControlItem
            key={item.id}
            active={isActive}
            size="md"
            disabled={disabled}
            onClick={() => onSectionChange(item.id)}
            className="gap-2"
          >
            <Icon className="size-4" />
            <span>{item.label}</span>
            {item.hasUnsaved ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  isActive
                    ? "bg-selected-control-foreground text-selected-control"
                    : "bg-warning-surface text-warning-muted",
                )}
              >
                Unsaved
              </span>
            ) : null}
          </SegmentedControlItem>
        );
      })}
    </SegmentedControlRoot>
  );
}

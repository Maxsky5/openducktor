import {
  type WorkflowDocumentCode,
  workflowArtifactRole,
  workflowArtifactShortLabel,
  workflowRoleIcon,
} from "@openducktor/workflows";
import { ClipboardList, FileText, type LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import { roleIconForHint } from "@/lib/agent-role-presentation";
import { SegmentedControlItem, SegmentedControlRoot } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import type { EditTaskSection } from "@openducktor/frontend-core/tasks/create/task-composer-types";

type TaskEditSectionSwitcherProps = {
  taskWorkflow: import("@openducktor/workflows").TaskWorkflow;
  section: EditTaskSection;
  dirtyDocuments: Record<WorkflowDocumentCode, boolean>;
  disabled?: boolean;
  onSectionChange: (section: EditTaskSection) => void;
};

type SectionItem = {
  id: EditTaskSection;
  label: string;
  icon: LucideIcon;
  hasUnsaved: boolean;
};

export function TaskEditSectionSwitcher({
  taskWorkflow,
  section,
  dirtyDocuments,
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
    // Each document shows the icon of the role that writes it.
    ...taskWorkflow.definition.artifacts
      .filter((artifact) => artifact.kind === "document")
      .map(({ id: code }): SectionItem => {
        const role = workflowArtifactRole(code, taskWorkflow);
        return {
          id: { artifactCode: code },
          label: workflowArtifactShortLabel(code, taskWorkflow),
          icon: role ? roleIconForHint(workflowRoleIcon(taskWorkflow, role)) : FileText,
          hasUnsaved: dirtyDocuments[code] === true,
        };
      }),
  ];

  return (
    <SegmentedControlRoot size="md" className="w-full">
      {sections.map((item) => {
        const isActive =
          item.id === "details"
            ? section === "details"
            : section !== "details" && item.id.artifactCode === section.artifactCode;
        const Icon = item.icon;
        return (
          <SegmentedControlItem
            key={item.id === "details" ? "details" : `artifact:${item.id.artifactCode}`}
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

import {
  BUILTIN_DOCUMENT_CODES,
  type BuiltinDocumentCode,
  workflowArtifactRole,
  workflowArtifactShortLabel,
} from "@openducktor/workflows";
import { ClipboardList, FileText } from "lucide-react";
import type { ReactElement } from "react";
import { AGENT_ROLE_ICONS } from "@/lib/agent-role-presentation";
import { SegmentedControlItem, SegmentedControlRoot } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import type { EditTaskSection } from "@openducktor/frontend-core/tasks/create/task-composer-types";

type TaskEditSectionSwitcherProps = {
  section: EditTaskSection;
  dirtyDocuments: Record<BuiltinDocumentCode, boolean>;
  disabled?: boolean;
  onSectionChange: (section: EditTaskSection) => void;
};

type SectionItem = {
  id: EditTaskSection;
  label: string;
  icon: typeof ClipboardList | (typeof AGENT_ROLE_ICONS)[keyof typeof AGENT_ROLE_ICONS];
  hasUnsaved: boolean;
};

export function TaskEditSectionSwitcher({
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
    ...BUILTIN_DOCUMENT_CODES.map((code): SectionItem => {
      const role = workflowArtifactRole(code);
      return {
        id: code,
        label: workflowArtifactShortLabel(code),
        icon: role ? AGENT_ROLE_ICONS[role] : FileText,
        hasUnsaved: dirtyDocuments[code],
      };
    }),
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

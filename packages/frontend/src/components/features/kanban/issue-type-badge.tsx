import { memo, type ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { issueTypeStyle } from "./kanban-task-badge-model";
import type { WorkflowIssueTypeDefinition } from "@openducktor/contracts";

export const IssueTypeBadge = memo(function IssueTypeBadge({
  issueType,
}: {
  issueType: WorkflowIssueTypeDefinition;
}): ReactElement {
  const style = issueTypeStyle(issueType);
  const Icon = style.icon;
  return (
    <Badge
      variant="outline"
      className={`h-6 rounded-full gap-1.5 px-2.5 text-[11px] font-semibold ${style.className}`}
    >
      <Icon className="size-3" />
      {style.label}
    </Badge>
  );
});

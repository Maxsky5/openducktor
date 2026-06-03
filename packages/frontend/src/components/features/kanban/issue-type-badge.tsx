import type { IssueType } from "@openducktor/contracts";
import { memo, type ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { ISSUE_TYPE_STYLES } from "./kanban-task-badge-model";

export const IssueTypeBadge = memo(function IssueTypeBadge({
  issueType,
}: {
  issueType: IssueType;
}): ReactElement {
  const style = ISSUE_TYPE_STYLES[issueType] ?? ISSUE_TYPE_STYLES.task;
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

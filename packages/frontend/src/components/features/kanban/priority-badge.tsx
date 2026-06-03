import { memo, type ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { getPriorityStyle } from "./kanban-task-badge-model";

export const PriorityBadge = memo(function PriorityBadge({
  priority,
}: {
  priority: number;
}): ReactElement {
  const style = getPriorityStyle(priority);
  return (
    <Badge
      variant="outline"
      className={`h-6 rounded-full gap-1.5 px-2.5 text-[11px] font-semibold ${style.badgeClassName}`}
      title={style.hint}
    >
      <span className={`size-1.5 rounded-full ${style.dotClassName}`} />
      {style.label}
    </Badge>
  );
});

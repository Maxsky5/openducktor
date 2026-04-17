import { Tag } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type TaskLabelChipProps = {
  label: string;
  className?: string;
  labelClassName?: string;
  endAdornment?: ReactNode;
  truncateLabel?: boolean;
};

export function TaskLabelChip({
  label,
  className,
  labelClassName,
  endAdornment,
  truncateLabel = false,
}: TaskLabelChipProps): ReactElement {
  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border-border bg-muted px-2.5 py-0.5 text-[11px] font-medium text-foreground",
        className,
      )}
      title={label}
    >
      <Tag className="size-3 shrink-0 text-muted-foreground" />
      <span
        className={cn(truncateLabel ? "min-w-0 truncate" : "whitespace-nowrap", labelClassName)}
      >
        {label}
      </span>
      {endAdornment}
    </Badge>
  );
}

import { ArrowRight, type LucideIcon, TriangleAlert } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** One scope choice of a palette run, such as one workspace or all open workspaces. */
export function ScopeChoiceButton({
  icon: Icon,
  label,
  detail,
  labelId,
  detailId,
  describedBy,
  detailTitle,
  disabled,
  onChoose,
}: {
  icon: LucideIcon;
  label: string;
  detail: string;
  labelId: string;
  detailId: string;
  /** The IDs that describe the choice, the detail first. */
  describedBy: string;
  detailTitle?: string | undefined;
  disabled: boolean;
  onChoose: () => void;
}): ReactElement {
  return (
    <Button
      variant="outline"
      className="h-auto w-full justify-start gap-3 p-3 text-left"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={onChoose}
    >
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span id={labelId} className="block whitespace-normal break-words font-medium">
          {label}
        </span>
        <span
          id={detailId}
          className="block truncate text-xs font-normal text-muted-foreground"
          title={detailTitle}
        >
          {detail}
        </span>
      </span>
      <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
    </Button>
  );
}

/** Why a scope choice cannot run, or why a workspace read failed. */
export function ScopeWarning({ id, children }: { id?: string; children: ReactNode }): ReactElement {
  return (
    <div
      id={id}
      role="status"
      className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-xs leading-relaxed text-warning-surface-foreground"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-muted" aria-hidden="true" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

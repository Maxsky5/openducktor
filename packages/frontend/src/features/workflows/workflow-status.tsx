import { Lock } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import type { StatusText, StatusTone } from "./workflow-status-text";

const DOT_CLASS = {
  draft: "bg-amber-500",
  published: "bg-emerald-500",
} satisfies Record<Exclude<StatusTone, "locked">, string>;

/** The look of the status pill. The version picker of the editor uses it for its button. */
export const STATUS_PILL_CLASS =
  "inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium text-muted-foreground";

/** A coloured dot for a draft or a live version, a lock otherwise. */
export function StatusMark({ tone }: { tone: StatusTone }): ReactElement {
  return tone === "locked" ? (
    <Lock aria-hidden="true" className="size-3 shrink-0" />
  ) : (
    <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASS[tone])} />
  );
}

/** The status as a quiet pill: a coloured dot for a draft or a live version, a lock otherwise. */
export function StatusPill({
  status,
  className,
}: {
  status: StatusText;
  className?: string;
}): ReactElement {
  return (
    <span className={cn(STATUS_PILL_CLASS, className)}>
      <StatusMark tone={status.tone} />
      <span className="truncate">{status.label}</span>
    </span>
  );
}

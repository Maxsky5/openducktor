import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DiagnosticsHealth, DiagnosticsStatus } from "./diagnostics-panel-model";

const HEALTH_BADGE_VARIANTS = {
  ok: "success",
  loading: "secondary",
  busy: "secondary",
  warning: "warning",
  failed: "danger",
  neutral: "secondary",
} satisfies Record<DiagnosticsHealth, "success" | "warning" | "danger" | "secondary">;

const HEALTH_DOT_CLASSES = {
  ok: "bg-success-accent",
  warning: "bg-warning-accent",
  failed: "bg-destructive-accent",
  neutral: "bg-muted-foreground/60",
} satisfies Record<Exclude<DiagnosticsHealth, "loading" | "busy">, string>;

const isInProgress = (health: DiagnosticsHealth): health is "loading" | "busy" =>
  health === "loading" || health === "busy";

/** A compact status label with a colored dot, or a spinner while work is in progress. */
export function DiagnosticsStatusPill({ status }: { status: DiagnosticsStatus }): ReactElement {
  const { health } = status;
  return (
    <Badge variant={HEALTH_BADGE_VARIANTS[health]} className="shrink-0 gap-1.5 whitespace-nowrap">
      {isInProgress(health) ? (
        <LoaderCircle className="size-3 animate-spin" aria-hidden />
      ) : (
        <span className={cn("size-1.5 rounded-full", HEALTH_DOT_CLASSES[health])} aria-hidden />
      )}
      {status.label}
    </Badge>
  );
}

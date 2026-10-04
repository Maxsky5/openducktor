import type { ReactElement, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { DiagnosticsHealth, DiagnosticsStatus } from "./diagnostics-panel-model";

const HEALTH_BADGE_VARIANTS = {
  ok: "success",
  loading: "secondary",
  busy: "warning",
  warning: "warning",
  failed: "danger",
  neutral: "secondary",
} satisfies Record<DiagnosticsHealth, "success" | "warning" | "danger" | "secondary">;

export function DiagnosticsStatusBadge({ status }: { status: DiagnosticsStatus }): ReactElement {
  return <Badge variant={HEALTH_BADGE_VARIANTS[status.health]}>{status.label}</Badge>;
}

type DiagnosticsSectionProps = {
  title: string;
  status: DiagnosticsStatus;
  children: ReactNode;
};

export function DiagnosticsSection({
  title,
  status,
  children,
}: DiagnosticsSectionProps): ReactElement {
  return (
    <section className="space-y-2 rounded-lg border border-border bg-muted/80 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <DiagnosticsStatusBadge status={status} />
      </div>
      {children}
    </section>
  );
}

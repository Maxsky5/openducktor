import type { ReactElement, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

type DiagnosticsSectionProps = {
  title: string;
  badge: {
    label: string;
    variant: "success" | "warning" | "danger" | "secondary";
  };
  children: ReactNode;
};

export function DiagnosticsSection({
  title,
  badge,
  children,
}: DiagnosticsSectionProps): ReactElement {
  return (
    <section className="space-y-2 rounded-lg border border-border bg-muted/80 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      {children}
    </section>
  );
}

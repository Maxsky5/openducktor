import { CircleAlert, CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import type { DiagnosticsOverviewModel } from "./diagnostics-panel-model";

const TONE_CLASSES = {
  healthy: {
    card: "border-success-border/60 bg-success-surface text-success-surface-foreground",
    icon: "bg-success-accent/15 text-success-accent",
  },
  checking: {
    card: "border-border bg-muted/40 text-foreground",
    icon: "bg-muted text-muted-foreground",
  },
  warning: {
    card: "border-warning-border/60 bg-warning-surface text-warning-surface-foreground",
    icon: "bg-warning-accent/15 text-warning-accent",
  },
  critical: {
    card: "border-destructive-border/60 bg-destructive-surface text-destructive-surface-foreground",
    icon: "bg-destructive-accent/15 text-destructive-accent",
  },
} satisfies Record<DiagnosticsOverviewModel["tone"], { card: string; icon: string }>;

const SCOPE_LABELS = { host: "Host", workspace: "Workspace" } as const;

function OverviewIcon({ tone }: { tone: DiagnosticsOverviewModel["tone"] }): ReactElement {
  switch (tone) {
    case "healthy":
      return <CircleCheck className="size-5" aria-hidden />;
    case "checking":
      return <LoaderCircle className="size-5 animate-spin" aria-hidden />;
    case "warning":
      return <TriangleAlert className="size-5" aria-hidden />;
    case "critical":
      return <CircleAlert className="size-5" aria-hidden />;
  }
}

/** The verdict at the top of the panel, with every issue that needs attention. */
export function DiagnosticsOverview({
  overview,
}: {
  overview: DiagnosticsOverviewModel;
}): ReactElement {
  const tone = TONE_CLASSES[overview.tone];
  return (
    <div
      className={cn("flex gap-3 rounded-xl border p-4", tone.card)}
      role="status"
      data-testid="diagnostics-overview"
    >
      <div
        className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", tone.icon)}
      >
        <OverviewIcon tone={overview.tone} />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-semibold">{overview.title}</p>
        <p className="text-xs opacity-80">{overview.description}</p>
        {overview.issues.length > 0 ? (
          <ul className="mt-2.5 space-y-1.5">
            {overview.issues.map((issue) => (
              <li
                key={`${issue.scope}:${issue.message}`}
                className="flex items-start gap-2 text-xs"
              >
                <span className="mt-px shrink-0 rounded-md bg-destructive-accent/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide">
                  {SCOPE_LABELS[issue.scope]}
                </span>
                <span className="min-w-0 break-words">{issue.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

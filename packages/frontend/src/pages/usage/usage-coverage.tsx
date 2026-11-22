import type { UsageReport, UsageRuntimeCoverage } from "@openducktor/contracts";
import { CircleCheck, CircleDashed, TriangleAlert } from "lucide-react";
import type { ReactElement } from "react";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
import { cn } from "@/lib/utils";
import { formatDateTime, USAGE_RUNTIME_LABELS, USAGE_RUNTIMES } from "./usage-format";
import { SectionHeading } from "./usage-parts";

const COVERAGE_STATE = {
  complete: { label: "All history read", icon: CircleCheck, className: "text-success-muted" },
  partial: { label: "Some history unread", icon: TriangleAlert, className: "text-warning-muted" },
  no_history: { label: "No history", icon: CircleDashed, className: "text-muted-foreground" },
} satisfies Record<
  UsageRuntimeCoverage["state"],
  { label: string; icon: typeof CircleCheck; className: string }
>;

/** What each runtime's history covers, and what the estimated cost means. */
export function UsageCoverage({ report }: { report: UsageReport }): ReactElement {
  const coverage = USAGE_RUNTIMES.flatMap((runtime) =>
    report.coverage.filter((entry) => entry.runtime === runtime),
  );
  const issues = coverage.flatMap((entry) =>
    entry.issues.map((issue) => ({ runtime: entry.runtime, ...issue })),
  );
  const allRead = coverage.every((entry) => entry.state === "complete");
  return (
    <section aria-labelledby="usage-sources" className="flex flex-col gap-2">
      <SectionHeading id="usage-sources" title="Sources" />
      {allRead ? (
        // One quiet line when every runtime's history was read.
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-muted" aria-hidden="true" />
          All history read:{" "}
          {coverage.map((entry) => USAGE_RUNTIME_LABELS[entry.runtime]).join(", ")}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {coverage.map((entry) => {
            const state = COVERAGE_STATE[entry.state];
            const Icon = state.icon;
            return (
              <li key={entry.runtime} className="flex items-center gap-2">
                <AgentRuntimeIcon runtimeKind={entry.runtime} className="size-4" />
                <span className="font-medium">{USAGE_RUNTIME_LABELS[entry.runtime]}</span>
                <span className={cn("inline-flex items-center gap-1 text-xs", state.className)}>
                  <Icon className="size-3.5" aria-hidden="true" />
                  {state.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {issues.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {issues.map((issue) => (
            <li
              key={`${issue.runtime}-${issue.code}-${issue.message}`}
              className="text-xs text-muted-foreground"
            >
              {issue.message}
              {issue.nextAction ? ` ${issue.nextAction}` : null}
            </li>
          ))}
        </ul>
      ) : null}
      <PricingNote pricing={report.pricing} />
    </section>
  );
}

/** Where the rates of the cost estimate come from, and any problem with them. */
function PricingNote({ pricing }: { pricing: UsageReport["pricing"] }): ReactElement {
  return (
    <div className="flex max-w-3xl flex-col gap-1 text-xs text-muted-foreground">
      {pricing.issue ? (
        <p className="flex items-start gap-1.5 text-warning-muted">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {pricing.issue}
        </p>
      ) : null}
      {/* The tables show a cost column in both metrics, so the note always explains it. */}
      <p>
        {pricing.updatedAt
          ? `Cost estimates use the API rates of ${pricing.source}, updated ${formatDateTime(pricing.updatedAt)}. A dash means that ${pricing.source} lists no rate.`
          : "Without API rates, costs show a dash."}{" "}
        Not a bill: subscriptions and quota use are not included.
      </p>
    </div>
  );
}

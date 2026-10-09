import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { formatTokenCompact, formatTokenExact } from "../format-token-count";

type AgentContextUsageIndicatorProps = {
  totalTokens: number;
  contextWindow: number;
  outputLimit?: number;
  className?: string;
};

type ContextUsageColorClasses = {
  text: string;
  bar: string;
  ring: string;
};

const usageColorClasses = (usagePercent: number): ContextUsageColorClasses => {
  if (usagePercent >= 90) {
    return {
      text: "text-destructive-muted",
      bar: "bg-destructive-accent",
      ring: "stroke-destructive-accent",
    };
  }
  if (usagePercent >= 75) {
    return { text: "text-warning-muted", bar: "bg-warning-accent", ring: "stroke-warning-accent" };
  }
  return { text: "text-success-muted", bar: "bg-success-accent", ring: "stroke-success-accent" };
};

// The ring draws its arc with pathLength 100, so the dash length is the usage percent.
const RING_RADIUS = 6;
const RING_STROKE_WIDTH = 2;

export function AgentContextUsageIndicator({
  totalTokens,
  contextWindow,
  outputLimit,
  className,
}: AgentContextUsageIndicatorProps): ReactElement {
  const safeTotalTokens = Math.max(0, Math.round(totalTokens));
  const safeContextWindow = Math.max(1, Math.round(contextWindow));
  const rawUsagePercent = (safeTotalTokens / safeContextWindow) * 100;
  const textUsagePercent = Math.min(Math.max(rawUsagePercent, 0), 999);
  const barUsagePercent = Math.min(Math.max(rawUsagePercent, 0), 100);
  const colors = usageColorClasses(rawUsagePercent);
  const usageLabel = `${
    textUsagePercent >= 100 ? Math.round(textUsagePercent) : textUsagePercent.toFixed(1)
  }%`;

  const compactTotal = formatTokenCompact(safeTotalTokens) ?? "0";
  const exactTotal = formatTokenExact(safeTotalTokens) ?? "0";
  const exactWindow = formatTokenExact(safeContextWindow) ?? "0";
  const exactOutput = formatTokenExact(outputLimit);

  return (
    <div className={cn("group relative", className)}>
      <div className="flex items-center gap-1.5 px-1 py-1">
        {/* The ring hides the percent, so a hidden native meter gives it to screen readers. */}
        <meter
          className="sr-only"
          aria-label="Session context"
          min={0}
          max={100}
          value={barUsagePercent}
        >
          {usageLabel}
        </meter>
        <svg viewBox="0 0 16 16" className="size-4 shrink-0 -rotate-90" aria-hidden="true">
          <circle
            cx={8}
            cy={8}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE_WIDTH}
            className="stroke-foreground/15"
          />
          <circle
            cx={8}
            cy={8}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE_WIDTH}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${barUsagePercent} 100`}
            className={cn("transition-[stroke-dasharray] duration-200", colors.ring)}
          />
        </svg>
        <span className={cn("text-[11px] font-medium tabular-nums", colors.text)}>
          {compactTotal}
        </span>
      </div>

      <div className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 hidden w-64 rounded-md border border-border bg-card p-2 text-[11px] text-foreground shadow-lg group-hover:block">
        <p className="font-semibold text-foreground">Session Context</p>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
            <div className={cn("h-full", colors.bar)} style={{ width: `${barUsagePercent}%` }} />
          </div>
          <span className={cn("font-medium tabular-nums", colors.text)}>{usageLabel}</span>
        </div>
        <p className="mt-1.5">Used: {exactTotal} tokens</p>
        <p>Max context: {exactWindow} tokens</p>
        {exactOutput ? <p>Output limit: {exactOutput} tokens</p> : null}
      </div>
    </div>
  );
}

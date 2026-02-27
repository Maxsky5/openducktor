import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { formatTokenCompact, formatTokenExact } from "./format-token-count";

type AgentContextUsageIndicatorProps = {
  totalTokens: number;
  contextWindow: number;
  outputLimit?: number;
  className?: string;
};

const usageColorClasses = (usagePercent: number): { text: string; bar: string } => {
  if (usagePercent >= 90) {
    return { text: "text-rose-700", bar: "bg-rose-500" };
  }
  if (usagePercent >= 75) {
    return { text: "text-amber-700", bar: "bg-amber-500" };
  }
  return { text: "text-emerald-700", bar: "bg-emerald-500" };
};

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

  const compactTotal = formatTokenCompact(safeTotalTokens) ?? "0";
  const exactTotal = formatTokenExact(safeTotalTokens) ?? "0";
  const exactWindow = formatTokenExact(safeContextWindow) ?? "0";
  const exactOutput = formatTokenExact(outputLimit);

  return (
    <div className={cn("group relative", className)}>
      <div className="flex items-center gap-2 rounded-full border border-input bg-card px-2.5 py-1">
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
          <div
            className={cn("h-full transition-[width] duration-200", colors.bar)}
            style={{ width: `${barUsagePercent}%` }}
          />
        </div>
        <span className={cn("text-[11px] font-medium", colors.text)}>
          {textUsagePercent >= 100 ? Math.round(textUsagePercent) : textUsagePercent.toFixed(1)}%
        </span>
        <span className="text-[11px] text-muted-foreground">{compactTotal}</span>
      </div>

      <div className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 hidden w-64 rounded-md border border-border bg-card p-2 text-[11px] text-foreground shadow-lg group-hover:block">
        <p className="font-semibold text-foreground">Session Context</p>
        <p className="mt-1">Used: {exactTotal} tokens</p>
        <p>Max context: {exactWindow} tokens</p>
        {exactOutput ? <p>Output limit: {exactOutput} tokens</p> : null}
      </div>
    </div>
  );
}

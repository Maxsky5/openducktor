import { formatTokenCompact, formatTokenExact } from "../../../lib/format-token-count";

/** How full the context window is: normal below 75%, warning from 75%, critical from 90%. */
export type ContextUsageSeverity = "normal" | "warning" | "critical";

/** The Session Context Usage that both clients show. Colors and shapes stay in each client. */
export type ContextUsagePresentation = {
  /** Used share of the window, such as "42.5%" or "120%". */
  usageLabel: string;
  /** The share for a meter, from 0 to 100. */
  meterPercent: number;
  severity: ContextUsageSeverity;
  compactTotal: string;
  exactTotal: string;
  exactWindow: string;
  exactOutput: string | null;
  accessibleLabel: string;
};

export const buildContextUsagePresentation = ({
  totalTokens,
  contextWindow,
  outputLimit,
}: {
  totalTokens: number;
  contextWindow: number;
  outputLimit?: number | undefined;
}): ContextUsagePresentation => {
  const safeTotalTokens = Math.max(0, Math.round(totalTokens));
  const safeContextWindow = Math.max(1, Math.round(contextWindow));
  const rawUsagePercent = (safeTotalTokens / safeContextWindow) * 100;
  const textUsagePercent = Math.min(Math.max(rawUsagePercent, 0), 999);
  const usageLabel = `${
    textUsagePercent >= 100 ? Math.round(textUsagePercent) : textUsagePercent.toFixed(1)
  }%`;
  const compactTotal = formatTokenCompact(safeTotalTokens) ?? "0";
  let severity: ContextUsageSeverity = "normal";
  if (rawUsagePercent >= 90) severity = "critical";
  else if (rawUsagePercent >= 75) severity = "warning";
  return {
    usageLabel,
    meterPercent: Math.min(Math.max(rawUsagePercent, 0), 100),
    severity,
    compactTotal,
    exactTotal: formatTokenExact(safeTotalTokens) ?? "0",
    exactWindow: formatTokenExact(safeContextWindow) ?? "0",
    exactOutput: formatTokenExact(outputLimit),
    accessibleLabel: `Session context: ${usageLabel} used, ${compactTotal} tokens`,
  };
};

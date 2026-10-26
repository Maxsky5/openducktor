import type { DiagnosticsSummaryTone } from "@openducktor/frontend-core/diagnostics/diagnostics-summary";

/** Icon colors of the diagnostics trigger for each summary tone. */
export const DIAGNOSTICS_SUMMARY_ICON_CLASSES = {
  critical: "text-destructive-accent",
  checking: "text-muted-foreground",
  setup: "text-warning-accent",
  healthy: "text-success-accent",
} satisfies Record<DiagnosticsSummaryTone, string>;

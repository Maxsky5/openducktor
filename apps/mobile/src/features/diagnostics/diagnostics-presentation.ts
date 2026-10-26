import type {
  DiagnosticsCheckModel,
  DiagnosticsHealth,
  DiagnosticsIssueModel,
  DiagnosticsOverviewModel,
  DiagnosticsRuntimeEntryModel,
  DiagnosticsStatus,
} from "@openducktor/frontend-core/diagnostics/diagnostics-panel-model";
import type { DiagnosticsSummaryTone } from "@openducktor/frontend-core/diagnostics/diagnostics-summary";
import type { CalloutTone } from "@/ui/callout-colors";
import type { StatusPillVariant } from "@/ui/status-pill";

/** A glyph name. The screen maps it to an icon, so this module stays free of native code. */
export type DiagnosticsGlyph = "ok" | "progress" | "warning" | "failed";

export type DiagnosticsStatusPresentation = {
  variant: StatusPillVariant;
  /** True while a check or a runtime change runs. The label then says what runs. */
  inProgress: boolean;
};

/** The desktop `HEALTH_BADGE_VARIANTS` (`diagnostics-status.tsx`). The label carries the state. */
const HEALTH_PRESENTATION = {
  ok: { variant: "success", inProgress: false },
  loading: { variant: "secondary", inProgress: true },
  busy: { variant: "secondary", inProgress: true },
  warning: { variant: "warning", inProgress: false },
  failed: { variant: "danger", inProgress: false },
  neutral: { variant: "secondary", inProgress: false },
} satisfies Record<DiagnosticsHealth, DiagnosticsStatusPresentation>;

export const diagnosticsStatusPresentation = (
  health: DiagnosticsHealth,
): DiagnosticsStatusPresentation => HEALTH_PRESENTATION[health];

/** The desktop status family of the overview card. `neutral` is the muted card of a check. */
export type DiagnosticsOverviewFamily = "success" | "neutral" | "warning" | "destructive";

export type DiagnosticsOverviewPresentation = {
  family: DiagnosticsOverviewFamily;
  glyph: DiagnosticsGlyph;
  inProgress: boolean;
};

/** The desktop `TONE_CLASSES` and icons of `diagnostics-overview.tsx`. */
const OVERVIEW_PRESENTATION = {
  healthy: { family: "success", glyph: "ok", inProgress: false },
  checking: { family: "neutral", glyph: "progress", inProgress: true },
  warning: { family: "warning", glyph: "warning", inProgress: false },
  critical: { family: "destructive", glyph: "failed", inProgress: false },
} satisfies Record<DiagnosticsOverviewModel["tone"], DiagnosticsOverviewPresentation>;

export const diagnosticsOverviewPresentation = (
  tone: DiagnosticsOverviewModel["tone"],
): DiagnosticsOverviewPresentation => OVERVIEW_PRESENTATION[tone];

/** The one-line verdict, in the colors of the desktop diagnostics trigger. */
const SUMMARY_PRESENTATION = {
  healthy: { variant: "success", inProgress: false },
  checking: { variant: "secondary", inProgress: true },
  setup: { variant: "warning", inProgress: false },
  critical: { variant: "danger", inProgress: false },
} satisfies Record<DiagnosticsSummaryTone, DiagnosticsStatusPresentation>;

export const diagnosticsSummaryPresentation = (
  tone: DiagnosticsSummaryTone,
): DiagnosticsStatusPresentation => SUMMARY_PRESENTATION[tone];

/** A setup warning stays a warning. Every other check error is a failure. */
export const diagnosticsCheckErrorTone = (
  check: Pick<DiagnosticsCheckModel, "status">,
): Extract<CalloutTone, "warning" | "destructive"> =>
  check.status.health === "warning" ? "warning" : "destructive";

export const DIAGNOSTICS_ISSUE_SCOPE_LABELS = {
  host: "Host",
  workspace: "Workspace",
} satisfies Record<DiagnosticsIssueModel["scope"], string>;

/** The configured executable in a monospace font, or the default executable as plain text. */
export const runtimeExecutableText = (
  entry: Pick<DiagnosticsRuntimeEntryModel, "executablePath">,
): { text: string; isPath: boolean } =>
  entry.executablePath === null
    ? { text: "Default executable", isPath: false }
    : { text: entry.executablePath, isPath: true };

/** A screen reader name that ties a status to the check or runtime that it describes. */
export const diagnosticsStatusAccessibilityLabel = (
  subject: string,
  status: DiagnosticsStatus,
): string => `${subject}: ${status.label}`;

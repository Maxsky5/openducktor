import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { DiagnosticsFailureKind } from "@/types/diagnostics";
import type {
  DiagnosticKeyValueRowModel,
  DiagnosticsSectionModel,
  DiagnosticsStatus,
} from "./diagnostics-panel-model";

export const LOADING_STATUS: DiagnosticsStatus = { health: "loading", label: "Loading" };
export const MUTED_VALUE = "text-muted-foreground";

export type RefreshFailure = { error: string; failureKind: DiagnosticsFailureKind };

/** A failed refresh controls the section. Retained rows show only as an earlier result. */
export const buildRefreshFailedSection = (
  base: { key: string; title: string },
  failure: RefreshFailure,
  earlierResult: { observedAt: string; rows: DiagnosticKeyValueRowModel[] } | null,
  otherErrors: string[] = [],
): DiagnosticsSectionModel => {
  const section: DiagnosticsSectionModel = {
    ...base,
    status: refreshFailureStatus(failure.failureKind),
    rows: earlierResult?.rows ?? [],
    errors: [refreshFailureMessage(base.title, failure.error), ...otherErrors],
  };
  if (earlierResult !== null) {
    section.notice = earlierResultNotice(earlierResult.observedAt);
  }
  return section;
};

export const refreshFailureStatus = (failureKind: DiagnosticsFailureKind): DiagnosticsStatus => ({
  health: "failed",
  label: failureKind === "timeout" ? "Timed out" : "Check failed",
});

export const refreshFailureMessage = (checkTitle: string, error: string): string =>
  `${checkTitle} check failed: ${error} Select Refresh Checks to try again.`;

export const earlierResultNotice = (observedAt: string): string =>
  `Earlier result from ${observedAt}. It may not be current.`;

export const runtimeLabel = (runtimeDefinitions: RuntimeDescriptor[], kind: RuntimeKind): string =>
  runtimeDefinitions.find((definition) => definition.kind === kind)?.label ?? kind;

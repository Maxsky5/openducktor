import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { DiagnosticsFailureKind } from "@/types/diagnostics";
import type {
  DiagnosticsCheckBase,
  DiagnosticsCheckModel,
  DiagnosticsStatus,
} from "./diagnostics-panel-model";

export const LOADING_STATUS: DiagnosticsStatus = { health: "loading", label: "Checking" };

export type RefreshFailure = { error: string; failureKind: DiagnosticsFailureKind };

/** A failed refresh controls the check. A retained result shows only as an earlier result. */
export const buildRefreshFailedCheck = (
  check: DiagnosticsCheckBase,
  failure: RefreshFailure,
  observedAt: string | null,
): DiagnosticsCheckModel => ({
  ...check,
  status: refreshFailureStatus(failure.failureKind),
  notice: observedAt === null ? null : earlierResultNotice(observedAt),
  errors: [refreshFailureMessage(check.title, failure.error)],
});

const refreshFailureStatus = (failureKind: DiagnosticsFailureKind): DiagnosticsStatus => ({
  health: "failed",
  label: failureKind === "timeout" ? "Timed out" : "Check unavailable",
});

export const refreshFailureMessage = (checkTitle: string, error: string): string =>
  `${checkTitle} check could not be read: ${error} Select Refresh to try again.`;

const CHECK_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const formatCheckTime = (isoTime: string): string => CHECK_TIME_FORMAT.format(new Date(isoTime));

const earlierResultNotice = (observedAt: string): string =>
  `Showing the result from ${formatCheckTime(observedAt)}. It may be out of date.`;

export const runtimeLabel = (runtimeDefinitions: RuntimeDescriptor[], kind: RuntimeKind): string =>
  runtimeDefinitions.find((definition) => definition.kind === kind)?.label ?? kind;

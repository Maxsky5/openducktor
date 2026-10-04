import type { FailureKind, HostRuntimeStatus, RuntimeKind } from "@openducktor/contracts";

export type DiagnosticsFailureKind = FailureKind | null;

export type HostRuntimeStatusMap = Partial<Record<RuntimeKind, HostRuntimeStatus>>;

/** The latest read of one check. A read failure takes priority over a retained `data`. */
export type CheckRead<T> = {
  /** The latest observed result. Null when no result was observed. */
  data: T | null;
  /** The latest read failure. A retained `data` is then an earlier result. */
  error: string | null;
};

/** A check read that also records the failure kind and the observation time. */
export type ObservedCheck<T> = CheckRead<T> & {
  /** The latest observed result, or a failure placeholder when no result was observed. */
  data: T | null;
  failureKind: DiagnosticsFailureKind;
  /** ISO time of the observed `data`. Null for a failure placeholder. */
  observedAt: string | null;
};

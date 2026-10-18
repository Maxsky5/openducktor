import type {
  FailureKind,
  HostMcpBridgeStatus,
  HostRuntimeSnapshot,
  HostRuntimeStatus,
  RuntimeKind,
} from "@openducktor/contracts";

export type DiagnosticsFailureKind = FailureKind | null;

export type HostRuntimeStatusMap = Partial<Record<RuntimeKind, HostRuntimeStatus>>;

/**
 * The cached host status. An event can arrive before the baseline read, so the cache can hold the
 * runtimes of that event without an MCP bridge status. The baseline read then completes it.
 */
export type HostStatusSnapshot = Omit<HostRuntimeSnapshot, "mcpBridge"> & {
  mcpBridge: HostMcpBridgeStatus | null;
};

/** The latest read of one check. A read failure takes priority over a retained `data`. */
export type CheckRead<T> = {
  /** The latest observed result. Null when no result was observed. */
  data: T | null;
  /** The latest read failure. A retained `data` is then an earlier result. */
  error: string | null;
};

/** A check read that also records the failure kind and the observation time. */
export type ObservedCheck<T> = CheckRead<T> & {
  /** The latest observed result. Null when no result was observed. */
  data: T | null;
  failureKind: DiagnosticsFailureKind;
  /** ISO time of the observed `data`. Null when no result was observed. */
  observedAt: string | null;
};

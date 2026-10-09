import type {
  HostMcpBridgeChangedEvent,
  HostMcpBridgeStatus,
  HostRuntimeChangedEvent,
  HostRuntimeSnapshot,
  HostRuntimeStatus,
} from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import { scheduleTask, type ScheduleTask } from "@/lib/scheduling";
import { withRuntimeStatusTimeout } from "@/state/host-runtime/host-runtime-status-timeout";
import type { HostStatusSnapshot } from "@/types/diagnostics";

export const hostRuntimeStatusQueryKeys = {
  snapshot: ["host-runtime-status"] as const,
};

export const applyHostStatusEvent = (
  current: HostStatusSnapshot | undefined,
  event: HostRuntimeChangedEvent | HostMcpBridgeChangedEvent,
): HostStatusSnapshot =>
  mergeHostStatusSnapshots(
    current,
    event.type === "runtime_changed"
      ? { hostInstanceId: event.hostInstanceId, runtimes: [event.status], mcpBridge: null }
      : { hostInstanceId: event.hostInstanceId, runtimes: [], mcpBridge: event.status },
  );

/**
 * The host runtime status owner reads the baseline only after it subscribes to runtime changes.
 * Observers use `enabled: false` and never start this read.
 */
export const hostRuntimeStatusQueryOptions = (
  runtimeStatus: () => Promise<HostRuntimeSnapshot>,
  scheduler: ScheduleTask = scheduleTask,
) =>
  queryOptions({
    queryKey: hostRuntimeStatusQueryKeys.snapshot,
    queryFn: ({ signal }): Promise<HostStatusSnapshot> =>
      withRuntimeStatusTimeout(runtimeStatus, "reading runtime status", signal, scheduler),
    staleTime: Infinity,
    gcTime: Infinity,
    // Merge every write with the cached snapshot by host instance and revision.
    // SAFETY: this query key holds only HostStatusSnapshot values.
    structuralSharing: (oldData, newData) =>
      mergeHostStatusSnapshots(
        oldData as HostStatusSnapshot | undefined,
        newData as HostStatusSnapshot,
      ),
  });

const newerStatus = <Status extends HostRuntimeStatus | HostMcpBridgeStatus>(
  current: Status | null | undefined,
  incoming: Status,
): Status => (current != null && current.revision > incoming.revision ? current : incoming);

/**
 * Merges a host status into the cached one. A status from another host instance replaces the
 * cache. Within one host instance, each runtime kind and the MCP bridge keep the entry with the
 * higher revision, so a late baseline read cannot restore older state.
 */
const mergeHostStatusSnapshots = (
  current: HostStatusSnapshot | undefined,
  incoming: HostStatusSnapshot,
): HostStatusSnapshot => {
  if (current === undefined || current.hostInstanceId !== incoming.hostInstanceId) {
    return incoming;
  }
  const currentByKind = new Map(current.runtimes.map((status) => [status.kind, status]));
  const incomingKinds = new Set(incoming.runtimes.map((status) => status.kind));
  return {
    hostInstanceId: incoming.hostInstanceId,
    runtimes: [
      ...incoming.runtimes.map((status) => newerStatus(currentByKind.get(status.kind), status)),
      ...current.runtimes.filter((status) => !incomingKinds.has(status.kind)),
    ],
    mcpBridge:
      incoming.mcpBridge === null
        ? current.mcpBridge
        : newerStatus(current.mcpBridge, incoming.mcpBridge),
  };
};

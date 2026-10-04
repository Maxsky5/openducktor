import type {
  HostRuntimeChangedEvent,
  HostRuntimeSnapshot,
  HostRuntimeStatus,
} from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";

export const hostRuntimeStatusQueryKeys = {
  snapshot: ["host-runtime-status"] as const,
};

const newerStatus = (
  current: HostRuntimeStatus | undefined,
  incoming: HostRuntimeStatus,
): HostRuntimeStatus =>
  current !== undefined && current.revision > incoming.revision ? current : incoming;

/**
 * Merges a host snapshot into the cached one. A snapshot from another host instance replaces the
 * cache. Within one host instance, each kind keeps the entry with the higher revision, so a late
 * baseline read cannot restore older state.
 */
const mergeHostRuntimeSnapshots = (
  current: HostRuntimeSnapshot | undefined,
  incoming: HostRuntimeSnapshot,
): HostRuntimeSnapshot => {
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
  };
};

export const applyHostRuntimeChangedEvent = (
  current: HostRuntimeSnapshot | undefined,
  event: HostRuntimeChangedEvent,
): HostRuntimeSnapshot =>
  mergeHostRuntimeSnapshots(current, {
    hostInstanceId: event.hostInstanceId,
    runtimes: [event.status],
  });

/**
 * The host runtime status owner reads the baseline only after it subscribes to runtime changes.
 * Observers use `enabled: false` and never start this read.
 */
export const hostRuntimeStatusQueryOptions = (runtimeStatus: () => Promise<HostRuntimeSnapshot>) =>
  queryOptions({
    queryKey: hostRuntimeStatusQueryKeys.snapshot,
    queryFn: runtimeStatus,
    staleTime: Infinity,
    gcTime: Infinity,
    // Merge every write with the cached snapshot by host instance and revision.
    // SAFETY: this query key holds only HostRuntimeSnapshot values.
    structuralSharing: (oldData, newData) =>
      mergeHostRuntimeSnapshots(
        oldData as HostRuntimeSnapshot | undefined,
        newData as HostRuntimeSnapshot,
      ),
  });

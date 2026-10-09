import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type PropsWithChildren,
  type ReactElement,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { hostBridge, hostClient } from "@/lib/host-client";
import {
  createHostRuntimeStatusOwner,
  type HostRuntimeStatusOwnerPorts,
  type RuntimeGenerationChangeHandler,
} from "@/state/host-runtime/host-runtime-status-owner";
import { hostRuntimeStatusQueryOptions } from "@/state/queries/host-runtime-status";
import type { HostRuntimeStatusMap, HostStatusSnapshot } from "@/types/diagnostics";
import type { HostRuntimeStatusContextValue } from "@/types/state-slices";
import { HostRuntimeStatusContext } from "../app-state-contexts";

const productionPorts: HostRuntimeStatusOwnerPorts = {
  subscribeRuntimeChanges: (listener) => hostBridge.subscribeRuntimeChanges(listener),
  runtimeStatus: () => hostClient.runtimeStatus(),
};

type HostRuntimeStatusProviderProps = PropsWithChildren<{
  ports?: HostRuntimeStatusOwnerPorts;
  onRuntimeGenerationChange?: RuntimeGenerationChangeHandler;
}>;

/**
 * Owns host runtime status for the app session: one subscription, one baseline, one cache.
 * Lifecycle reviews receive host runtime events and stream health through `runtimeEvents`.
 */
export function HostRuntimeStatusProvider({
  children,
  ports = productionPorts,
  onRuntimeGenerationChange,
}: HostRuntimeStatusProviderProps): ReactElement {
  const queryClient = useQueryClient();
  const [owner] = useState(() =>
    createHostRuntimeStatusOwner(
      onRuntimeGenerationChange === undefined
        ? { queryClient, ports }
        : { queryClient, ports, onRuntimeGenerationChange },
    ),
  );
  useEffect(() => {
    owner.start();
    return owner.stop;
  }, [owner]);
  const connection = useSyncExternalStore(
    owner.subscribeConnection,
    owner.getConnection,
    owner.getConnection,
  );
  const snapshotQuery = useQuery({
    ...hostRuntimeStatusQueryOptions(ports.runtimeStatus),
    enabled: false,
  });
  const snapshot = snapshotQuery.data;
  const readError = connection.readError;

  const value = useMemo(
    (): HostRuntimeStatusContextValue => ({
      snapshot: snapshot ?? null,
      statusByKind: toStatusByKind(snapshot),
      isCurrent: connection.streamError === null && connection.hasBaseline && readError === null,
      isLoading:
        readError === null &&
        connection.streamError === null &&
        (!connection.hasBaseline || snapshot === undefined),
      readError,
      streamError: connection.streamError,
      isRefreshing: connection.isRefreshing,
      refresh: owner.refresh,
      runtimeEvents: owner,
    }),
    [connection, owner, readError, snapshot],
  );

  return (
    <HostRuntimeStatusContext.Provider value={value}>{children}</HostRuntimeStatusContext.Provider>
  );
}

const toStatusByKind = (snapshot: HostStatusSnapshot | undefined): HostRuntimeStatusMap => {
  const statusByKind: HostRuntimeStatusMap = {};
  for (const status of snapshot?.runtimes ?? []) {
    statusByKind[status.kind] = status;
  }
  return statusByKind;
};

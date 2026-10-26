import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createElement,
  type PropsWithChildren,
  type ReactElement,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createHostRuntimeStatusOwner,
  type HostRuntimeStatusOwnerPorts,
  type RuntimeGenerationChangeHandler,
} from "../../runtime/host-runtime-status-owner";
import { hostRuntimeStatusQueryOptions } from "../../queries/host-runtime-status";
import type { HostRuntimeStatusMap, HostStatusSnapshot } from "../../types/diagnostics";
import type { HostRuntimeStatusContextValue } from "../../types/session-slices";
import { HostRuntimeStatusContext } from "../../sessions/session-contexts";
import { useHostConnection } from "../../connection/client-connection-react";

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
  ports: suppliedPorts,
  onRuntimeGenerationChange,
}: HostRuntimeStatusProviderProps): ReactElement {
  const queryClient = useQueryClient();
  const host = useHostConnection();
  const [ports] = useState<HostRuntimeStatusOwnerPorts>(
    () =>
      suppliedPorts ?? {
        subscribeRuntimeChanges: host.subscribeRuntimeChanges,
        runtimeStatus: host.client.runtimeStatus,
      },
  );
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

  return createElement(HostRuntimeStatusContext.Provider, { value }, children);
}

const toStatusByKind = (snapshot: HostStatusSnapshot | undefined): HostRuntimeStatusMap => {
  const statusByKind: HostRuntimeStatusMap = {};
  for (const status of snapshot?.runtimes ?? []) {
    statusByKind[status.kind] = status;
  }
  return statusByKind;
};

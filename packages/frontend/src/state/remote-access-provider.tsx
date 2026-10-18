import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useQuery } from "@tanstack/react-query";
import type { RemoteAccessBridge, RemoteAccessState } from "@openducktor/contracts";
import { remoteAccessStateQueryOptions } from "@openducktor/frontend-core/queries/remote-access";

const RemoteAccessContext = createContext<{
  bridge: RemoteAccessBridge | undefined;
  state: RemoteAccessState | undefined;
  error: string | undefined;
}>({ bridge: undefined, state: undefined, error: undefined });

/** Keeps the local shell's sharing status live while Settings is closed. */
export function RemoteAccessProvider({
  bridge,
  children,
}: PropsWithChildren<{ bridge: RemoteAccessBridge | undefined }>) {
  const [liveState, setLiveState] = useState<RemoteAccessState>();
  const [error, setError] = useState<string>();
  const query = useQuery(remoteAccessStateQueryOptions(bridge));
  useEffect(() => {
    if (!bridge) return;
    let closed = false;
    let stop: (() => void) | undefined;
    bridge
      .subscribeState((state) => {
        if (!closed) setLiveState(state);
      })
      .then((unsubscribe) => {
        if (closed) unsubscribe();
        else stop = unsubscribe;
      })
      .catch((cause) => {
        if (!closed) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      closed = true;
      stop?.();
    };
  }, [bridge]);
  const state = liveState ?? query.data;
  const failure = error ?? (liveState ? undefined : query.error?.message);
  const value = useMemo(() => ({ bridge, state, error: failure }), [bridge, state, failure]);
  return <RemoteAccessContext value={value}>{children}</RemoteAccessContext>;
}

export const useRemoteAccess = () => useContext(RemoteAccessContext);

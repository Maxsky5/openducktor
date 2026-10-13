import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { resourceSourceQueryOptions } from "@/state/queries/resource-sources";
import type { ResourceRead } from "@/types/resource-source";
import { getShellBridge } from "./shell-bridge";

type ResourceSourceState = { src: string | null; error: Error | null; isLoading: boolean };
const noSubscription = (): (() => void) => () => {};

/** Query shares resource data; each view creates and releases its own Blob URL. */
export const useResourceSource = (
  key: readonly string[],
  read: ResourceRead | undefined,
): ResourceSourceState => {
  const connection = getShellBridge().remoteConnection;
  const generation = useSyncExternalStore(
    connection?.subscribeState ?? noSubscription,
    () => connection?.readState().generation ?? 0,
    () => 0,
  );
  const query = useQuery(resourceSourceQueryOptions(key, generation, read));
  const [source, setSource] = useState<{ blob: Blob; src: string } | null>(null);
  useEffect(() => {
    if (query.data?.kind !== "blob") {
      setSource(null);
      return;
    }
    const blob = query.data.blob;
    const src = URL.createObjectURL(blob);
    setSource({ blob, src });
    return () => URL.revokeObjectURL(src);
  }, [query.data]);
  let src: string | null = null;
  if (query.data?.kind === "url") src = query.data.src;
  else if (query.data?.kind === "blob" && source?.blob === query.data.blob) src = source.src;
  return {
    src,
    error: query.error,
    isLoading: read !== undefined && (query.isPending || (src === null && query.error === null)),
  };
};

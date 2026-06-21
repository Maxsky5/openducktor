import { type QueryKey, queryOptions, skipToken } from "@tanstack/react-query";

type SkippedQueryOptionsArgs = {
  queryKey: QueryKey;
  staleTime: number;
  refetchOnWindowFocus?: boolean;
};

export const skippedQueryOptions = <TData>({
  queryKey,
  staleTime,
  refetchOnWindowFocus,
}: SkippedQueryOptionsArgs) =>
  queryOptions<TData, Error, TData, QueryKey>({
    queryKey,
    queryFn: skipToken,
    staleTime,
    ...(refetchOnWindowFocus === undefined ? {} : { refetchOnWindowFocus }),
  });

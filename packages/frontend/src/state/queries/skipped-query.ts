import { type QueryKey, queryOptions, skipToken } from "@tanstack/react-query";

type SkippedQueryOptionsArgs<TQueryKey extends QueryKey> = {
  queryKey: TQueryKey;
  staleTime: number;
  refetchOnWindowFocus?: boolean;
};

export const skippedQueryOptions = <TData, TQueryKey extends QueryKey = QueryKey>({
  queryKey,
  staleTime,
  refetchOnWindowFocus,
}: SkippedQueryOptionsArgs<TQueryKey>) => {
  const options: Parameters<typeof queryOptions<TData, Error, TData, TQueryKey>>[0] = {
    queryKey,
    queryFn: skipToken,
    staleTime,
  };
  if (refetchOnWindowFocus !== undefined) {
    options.refetchOnWindowFocus = refetchOnWindowFocus;
  }
  return queryOptions<TData, Error, TData, TQueryKey>(options);
};

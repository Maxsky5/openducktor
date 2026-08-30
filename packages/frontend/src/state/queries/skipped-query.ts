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
}: SkippedQueryOptionsArgs) => {
  const options: Parameters<typeof queryOptions<TData, Error, TData, QueryKey>>[0] = {
    queryKey,
    queryFn: skipToken,
    staleTime,
  };
  if (refetchOnWindowFocus !== undefined) options.refetchOnWindowFocus = refetchOnWindowFocus;
  return queryOptions<TData, Error, TData, QueryKey>(options);
};

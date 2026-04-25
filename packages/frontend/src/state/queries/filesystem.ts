import type { DirectoryListing } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { host } from "@/state/operations/host";

type FilesystemQueryHost = Pick<typeof host, "filesystemListDirectory">;

const DIRECTORY_LISTING_STALE_TIME_MS = 1_000;
const DEFAULT_PATH_QUERY_KEY = "__default__";

export const filesystemQueryKeys = {
  all: ["filesystem"] as const,
  directory: (path?: string) =>
    [...filesystemQueryKeys.all, "directory", path ?? DEFAULT_PATH_QUERY_KEY] as const,
};

export const directoryListingQueryOptions = (
  path?: string,
  hostClient: FilesystemQueryHost = host,
) =>
  queryOptions({
    queryKey: filesystemQueryKeys.directory(path),
    queryFn: (): Promise<DirectoryListing> => hostClient.filesystemListDirectory(path),
    staleTime: DIRECTORY_LISTING_STALE_TIME_MS,
  });

export const loadDirectoryListingFromQuery = (
  queryClient: QueryClient,
  path?: string,
  hostClient?: FilesystemQueryHost,
): Promise<DirectoryListing> =>
  queryClient.fetchQuery(directoryListingQueryOptions(path, hostClient));

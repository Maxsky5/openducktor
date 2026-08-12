import type {
  DirectoryListing,
  WorkspaceFileTree,
  WorkspaceTextFileReadResult,
  WorkspaceTextFileWriteInput,
  WorkspaceTextFileWriteResult,
} from "@openducktor/contracts";
import { mutationOptions, type QueryClient, queryOptions } from "@tanstack/react-query";
import { host } from "@/state/operations/host";

type FilesystemQueryHost = Pick<
  typeof host,
  | "filesystemListDirectory"
  | "filesystemListTree"
  | "filesystemReadTextFile"
  | "filesystemWriteTextFile"
>;

const DIRECTORY_LISTING_STALE_TIME_MS = 1_000;
const DEFAULT_PATH_QUERY_KEY = "__default__";
const NO_TARGET_BRANCH_QUERY_KEY = "__no_target_branch__";

export const filesystemQueryKeys = {
  all: ["filesystem"] as const,
  directory: (path?: string, includeFiles = false) =>
    [
      ...filesystemQueryKeys.all,
      "directory",
      path ?? DEFAULT_PATH_QUERY_KEY,
      includeFiles,
    ] as const,
  treeRoot: (rootPath: string) => [...filesystemQueryKeys.all, "tree", rootPath] as const,
  tree: (rootPath: string, targetBranch?: string | null) =>
    [
      ...filesystemQueryKeys.treeRoot(rootPath),
      targetBranch ?? NO_TARGET_BRANCH_QUERY_KEY,
    ] as const,
  textFileRoot: (rootPath: string) => [...filesystemQueryKeys.all, "text-file", rootPath] as const,
  textFile: (rootPath: string, relativePath: string) =>
    [...filesystemQueryKeys.textFileRoot(rootPath), relativePath] as const,
};

export const invalidateWorkspaceFileQueries = async (
  queryClient: QueryClient,
  rootPath: string,
): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: filesystemQueryKeys.treeRoot(rootPath) }),
    queryClient.invalidateQueries({ queryKey: filesystemQueryKeys.textFileRoot(rootPath) }),
  ]);
};

export const directoryListingQueryOptions = (
  path?: string,
  hostClient: FilesystemQueryHost = host,
  includeFiles = false,
) =>
  queryOptions({
    queryKey: filesystemQueryKeys.directory(path, includeFiles),
    queryFn: (): Promise<DirectoryListing> =>
      includeFiles
        ? hostClient.filesystemListDirectory({ ...(path ? { path } : {}), includeFiles: true })
        : hostClient.filesystemListDirectory(path),
    staleTime: DIRECTORY_LISTING_STALE_TIME_MS,
  });

export const workspaceFileTreeQueryOptions = (
  rootPath: string,
  targetBranch?: string | null,
  hostClient: FilesystemQueryHost = host,
) =>
  queryOptions({
    queryKey: filesystemQueryKeys.tree(rootPath, targetBranch),
    queryFn: (): Promise<WorkspaceFileTree> =>
      hostClient.filesystemListTree({
        rootPath,
        ...(targetBranch ? { targetBranch } : {}),
      }),
    staleTime: DIRECTORY_LISTING_STALE_TIME_MS,
  });

export const workspaceTextFileQueryOptions = (
  rootPath: string,
  relativePath: string,
  hostClient: FilesystemQueryHost = host,
) =>
  queryOptions({
    queryKey: filesystemQueryKeys.textFile(rootPath, relativePath),
    queryFn: (): Promise<WorkspaceTextFileReadResult> =>
      hostClient.filesystemReadTextFile({ rootPath, relativePath }),
    staleTime: DIRECTORY_LISTING_STALE_TIME_MS,
  });

export const workspaceTextFileWriteMutationOptions = (
  queryClient: QueryClient,
  hostClient: FilesystemQueryHost = host,
) =>
  mutationOptions({
    mutationFn: (input: WorkspaceTextFileWriteInput): Promise<WorkspaceTextFileWriteResult> =>
      hostClient.filesystemWriteTextFile(input),
    onSuccess: async (result) => {
      queryClient.setQueryData(
        filesystemQueryKeys.textFile(result.rootPath, result.relativePath),
        result,
      );
      await queryClient.invalidateQueries({
        queryKey: filesystemQueryKeys.treeRoot(result.rootPath),
      });
    },
  });

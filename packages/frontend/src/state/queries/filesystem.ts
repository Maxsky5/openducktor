import type {
  WorkspaceFileTreeContext,
  WorkspaceFileTreeCursor,
  WorkspaceFileTreeRefreshInput,
  WorkspaceFileTreeRefreshResult,
  DirectoryListing,
  FilesystemListDirectoryInput,
  WorkspaceFileTree,
  WorkspaceTextFileReadResult,
  WorkspaceTextFileReadInput,
  WorkspaceTextFileWriteInput,
  WorkspaceTextFileWriteResult,
} from "@openducktor/contracts";
import { imagePreviewMime } from "@openducktor/contracts";
import { mutationOptions, type QueryClient, queryOptions } from "@tanstack/react-query";
import {
  type WorkspaceGitRefresh,
  scheduleWorkspaceRefresh,
  workspaceReadContext,
  workspaceRefreshMode,
} from "./workspace-refresh";
import { host } from "@/state/operations/host";
import { runImagePreview } from "@/lib/generated-images/image-preview-queue";

type FilesystemQueryHost = Pick<
  typeof host,
  | "filesystemListDirectory"
  | "filesystemRefreshTree"
  | "filesystemReadTextFile"
  | "filesystemWriteTextFile"
>;

const DIRECTORY_LISTING_STALE_TIME_MS = 1_000;
const DEFAULT_PATH_QUERY_KEY = "__default__";
const NO_TARGET_BRANCH_QUERY_KEY = "__no_target_branch__";

export const filesystemQueryKeys = {
  all: ["filesystem"] as const,
  resolvedPath: (path: string) => [...filesystemQueryKeys.all, "resolved-path", path] as const,
  directory: (path?: string, includeFiles = false) =>
    [
      ...filesystemQueryKeys.all,
      "directory",
      path ?? DEFAULT_PATH_QUERY_KEY,
      includeFiles,
    ] as const,
  treeRoot: (rootPath: string) => [...filesystemQueryKeys.all, "tree", rootPath] as const,
  tree: (rootPath: string, targetBranch?: string | null, branchKey?: string) =>
    [
      ...filesystemQueryKeys.treeRoot(rootPath),
      targetBranch ?? NO_TARGET_BRANCH_QUERY_KEY,
      ...(branchKey === undefined ? [] : [branchKey]),
    ] as const,
  textFileRoot: (rootPath: string) => [...filesystemQueryKeys.all, "text-file", rootPath] as const,
  textFile: (rootPath: string, relativePath: string, access?: "local") =>
    [
      ...filesystemQueryKeys.textFileRoot(rootPath),
      relativePath,
      ...(access ? [access] : []),
    ] as const,
  image: (rootPath: string, relativePath: string, access?: "local") =>
    [...filesystemQueryKeys.textFile(rootPath, relativePath, access), "image-preview"] as const,
};

export const resolvedPathQueryOptions = (
  path: string,
  hostClient: Pick<typeof host, "filesystemResolvePath"> = host,
) =>
  queryOptions({
    queryKey: filesystemQueryKeys.resolvedPath(path),
    queryFn: () => hostClient.filesystemResolvePath(path),
    staleTime: 0,
    retry: false,
  });

export const refreshWorkspaceFileQueries = (
  queryClient: QueryClient,
  rootPath: string,
  mode: "full" | "incremental" = "incremental",
  refreshGit?: WorkspaceGitRefresh,
): Promise<void> => {
  if (mode === "full") {
    // Stop old reads now, even while the previous refresh waits for Git.
    void queryClient.cancelQueries({ queryKey: filesystemQueryKeys.treeRoot(rootPath) });
    void queryClient.cancelQueries({ queryKey: filesystemQueryKeys.textFileRoot(rootPath) });
  }
  return scheduleWorkspaceRefresh(
    queryClient,
    rootPath,
    mode,
    async () => {
      const treeKey = filesystemQueryKeys.treeRoot(rootPath);
      const textKey = filesystemQueryKeys.textFileRoot(rootPath);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: treeKey }),
        queryClient.cancelQueries({ queryKey: textKey }),
      ]);
      if (workspaceRefreshMode(queryClient, rootPath) === "full") {
        // Inactive trees cannot read during this refresh. Drop their cursors for the next read.
        queryClient.removeQueries({ queryKey: treeKey, type: "inactive" });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: treeKey }, { throwOnError: true }),
        queryClient.invalidateQueries({ queryKey: textKey }, { throwOnError: true }),
      ]);
    },
    refreshGit,
  );
};

export const invalidateWorkspaceFileQueries = (
  queryClient: QueryClient,
  rootPath: string,
): Promise<void> => refreshWorkspaceFileQueries(queryClient, rootPath, "full");

export type WorkspaceFileTreeView = WorkspaceFileTree & {
  cursor?: WorkspaceFileTreeCursor;
  context?: WorkspaceFileTreeContext;
};
type RefreshFields = Pick<WorkspaceFileTreeRefreshInput, "rootPath" | "refreshId" | "targetBranch">;
export const directoryListingQueryOptions = (
  path?: string,
  hostClient: FilesystemQueryHost = host,
  includeFiles = false,
) => {
  let listDirectoryInput: string | FilesystemListDirectoryInput | undefined = path;
  if (includeFiles) {
    const input: FilesystemListDirectoryInput = { includeFiles: true };
    if (path) {
      input.path = path;
    }
    listDirectoryInput = input;
  }
  return queryOptions({
    queryKey: filesystemQueryKeys.directory(path, includeFiles),
    queryFn: (): Promise<DirectoryListing> =>
      hostClient.filesystemListDirectory(listDirectoryInput),
    staleTime: DIRECTORY_LISTING_STALE_TIME_MS,
  });
};

export const workspaceFileTreeQueryOptions = (
  rootPath: string,
  targetBranch?: string | null,
  hostClient: FilesystemQueryHost = host,
  branchKey?: string,
) => {
  const queryKey = filesystemQueryKeys.tree(rootPath, targetBranch, branchKey);
  return queryOptions({
    queryKey,
    queryFn: async ({ client, signal }): Promise<WorkspaceFileTreeView> => {
      const prior = client.getQueryData<WorkspaceFileTreeView>(queryKey);
      const refreshId = workspaceReadContext(client, rootPath)?.refreshId ?? crypto.randomUUID();
      const common: RefreshFields = {
        rootPath,
        refreshId,
      };
      if (targetBranch) common.targetBranch = targetBranch;
      const input: WorkspaceFileTreeRefreshInput =
        prior?.cursor && workspaceRefreshMode(client, rootPath) !== "full"
          ? { ...common, mode: "incremental", base: prior.cursor }
          : { ...common, mode: "full" };
      const result = await hostClient.filesystemRefreshTree(input);
      signal.throwIfAborted();
      let view = applyRefresh(prior, result);
      if (view === null) {
        const resetResult = await hostClient.filesystemRefreshTree({
          ...common,
          refreshId: crypto.randomUUID(),
          mode: "full",
        });
        signal.throwIfAborted();
        view = applyRefresh(undefined, resetResult);
        if (view === null)
          throw new Error("Workspace context changed during refresh. Refresh again.");
      }
      assertSelectedBranch(view.context, branchKey);
      return view;
    },
    staleTime: 0,
    retry: false,
  });
};

export const workspaceTextFileQueryOptions = (
  rootPath: string,
  relativePath: string,
  hostClient: FilesystemQueryHost = host,
  access?: "local",
) =>
  queryOptions({
    queryKey: filesystemQueryKeys.textFile(rootPath, relativePath, access),
    ...fileReadOptions(rootPath, relativePath, hostClient, access),
  });

export const workspaceImageFileQueryOptions = (
  rootPath: string,
  relativePath: string,
  access?: "local",
) => queryOptions(imageReadOptions(rootPath, relativePath, access));

export const workspaceFilePreviewQueryOptions = (
  rootPath: string,
  relativePath: string,
  access?: "local",
) => {
  const filename = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  const dot = filename.lastIndexOf(".");
  const mime = dot > 0 ? imagePreviewMime(filename.slice(dot)) : undefined;
  return queryOptions<WorkspaceTextFileReadResult>({
    ...(mime
      ? imageReadOptions(rootPath, relativePath, access)
      : {
          queryKey: filesystemQueryKeys.textFile(rootPath, relativePath, access),
          ...fileReadOptions(rootPath, relativePath, host, access),
        }),
  });
};

export const workspaceTextFileWriteMutationOptions = (
  queryClient: QueryClient,
  hostClient: FilesystemQueryHost = host,
) =>
  mutationOptions({
    mutationFn: (input: WorkspaceTextFileWriteInput): Promise<WorkspaceTextFileWriteResult> =>
      hostClient.filesystemWriteTextFile(input),
    onSuccess: async (result, input) => {
      await queryClient.cancelQueries({
        queryKey: filesystemQueryKeys.textFile(result.rootPath, result.relativePath, input.access),
        exact: true,
      });
      queryClient.setQueryData(
        filesystemQueryKeys.textFile(result.rootPath, result.relativePath, input.access),
        result,
      );
      // Keep tree read errors in the explorer so a completed write still counts as saved.
      await queryClient.invalidateQueries({
        queryKey: filesystemQueryKeys.treeRoot(result.rootPath),
        refetchType: "none",
      });
    },
  });

const imageReadOptions = (rootPath: string, relativePath: string, access?: "local") => {
  const read = fileReadOptions(rootPath, relativePath, host, access);
  return {
    ...read,
    queryKey: filesystemQueryKeys.image(rootPath, relativePath, access),
    queryFn: (context: { signal: AbortSignal }) =>
      runImagePreview(context.signal, () => read.queryFn(context)),
    // Large image data must leave the cache when its last preview closes.
    gcTime: 0,
  };
};

const fileReadOptions = (
  rootPath: string,
  relativePath: string,
  hostClient: FilesystemQueryHost,
  access?: "local",
) => ({
  queryFn: async ({ signal }: { signal: AbortSignal }): Promise<WorkspaceTextFileReadResult> => {
    const input: WorkspaceTextFileReadInput = { rootPath, relativePath };
    if (access) input.access = access;
    const result = await hostClient.filesystemReadTextFile(input);
    signal.throwIfAborted();
    return result;
  },
  retry: false,
  staleTime: DIRECTORY_LISTING_STALE_TIME_MS,
});

const assertSelectedBranch = (
  context: WorkspaceFileTreeContext | undefined,
  branchKey?: string,
) => {
  if (!branchKey || branchKey === "unknown" || branchKey === "__unknown_branch__") return;
  let matches = context?.branch === branchKey;
  if (branchKey.startsWith("branch:")) matches = context?.branch === branchKey.slice(7);
  if (branchKey.startsWith("detached:"))
    matches = context?.branch === null && context.head === branchKey.slice(9);
  if (branchKey === "detached") matches ||= context?.branch === null;
  if (!matches) throw new Error("Workspace branch changed during file refresh. Refresh again.");
};
const sameCursor = (a: WorkspaceFileTreeCursor, b: WorkspaceFileTreeCursor) =>
  a.viewId === b.viewId && a.revision === b.revision;
/** A patch needs its exact base; null tells the caller to start a full read. */
const applyRefresh = (
  prior: WorkspaceFileTreeView | undefined,
  result: WorkspaceFileTreeRefreshResult,
): WorkspaceFileTreeView | null => {
  if (result.kind === "reset_required") return null;
  if (result.kind === "snapshot") return result;
  if (result.cursor.viewId !== result.base.viewId || result.cursor.revision < result.base.revision)
    throw new Error("File refresh returned an invalid cursor.");
  if (!prior?.cursor || !sameCursor(prior.cursor, result.base)) return null;
  if (
    result.rootPath !== prior.rootPath ||
    JSON.stringify(result.context) !== JSON.stringify(prior.context)
  )
    throw new Error("File refresh context does not match its base view.");
  if (result.kind === "unchanged") return { ...prior, cursor: result.cursor };
  const removals = new Set(result.removals);
  const upserts = new Map(result.upserts.map((entry) => [entry.path, entry]));
  if (
    removals.size !== result.removals.length ||
    upserts.size !== result.upserts.length ||
    result.upserts.some((entry) => removals.has(entry.path))
  )
    throw new Error("File refresh contains duplicate or conflicting paths.");
  const entries = prior.entries
    .filter((entry) => !removals.has(entry.path))
    .map((entry) => {
      const replacement = upserts.get(entry.path);
      upserts.delete(entry.path);
      return replacement ?? entry;
    });
  entries.push(...upserts.values());
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.path.toLowerCase().localeCompare(b.path.toLowerCase()) || a.path.localeCompare(b.path);
  });
  return { rootPath: result.rootPath, context: result.context, cursor: result.cursor, entries };
};

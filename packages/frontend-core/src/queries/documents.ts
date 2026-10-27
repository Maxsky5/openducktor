import {
  type Query,
  type QueryClient,
  queryOptions,
  replaceEqualDeep,
} from "@tanstack/react-query";
import { z } from "zod";
import type { TaskArtifactSaveResult, TaskEventCursor } from "@openducktor/contracts";
import type { TaskDocumentPayload } from "../types/task-documents";
import { connectionHost } from "../connection/client-connection";
import { resolveLatestDocumentPayload } from "./document-utils";

export const TASK_DOCUMENT_STALE_TIME_MS = 60_000;

const queryKeyStringSchema = z.string();

// Keep read ownership when an observer replaces the query's options before acceptance.
const reads = new WeakMap<
  object,
  { result: TaskDocumentPayload; query: Query | undefined; dataUpdateCount: number | undefined }
>();

// Absence has no document timestamp. Keep committed section progress with its query.
const versions = new WeakMap<object, number>();
const commits = new WeakMap<object, TaskEventCursor>();
const saveEpochs = new WeakMap<object, symbol>();

export type TaskDocument = {
  markdown: string;
  updatedAt: string | null;
  error?: string | null;
};

/** Reads one workflow artifact of a task by its code. */
export type TaskDocumentReader = (
  repoPath: string,
  taskId: string,
  code: string,
) => Promise<TaskDocument>;

export const documentQueryKeys = {
  all: ["task-documents"] as const,
  document: (repoPath: string, taskId: string, code: string) =>
    [...documentQueryKeys.all, code, repoPath, taskId] as const,
};

export const taskDocumentQueryOptions = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  code: string,
  readDocument: TaskDocumentReader = connectionHost(queryClient).workflowArtifactGet,
) => {
  const queryKey = documentQueryKeys.document(repoPath, taskId, code);
  return queryOptions({
    queryKey,
    queryFn: async (): Promise<TaskDocumentPayload> => {
      if (!repoPath) {
        throw new Error("Select a repository before loading task artifacts.");
      }
      const query = queryClient.getQueryCache().find({ queryKey, exact: true });
      const dataUpdateCount = query?.state.dataUpdateCount;
      const incoming = await readDocument(repoPath, taskId, code);
      if (queryClient.getQueryCache().find({ queryKey, exact: true }) !== query) {
        throw new Error(
          "The task artifact changed while loading. Open it again to load the current artifact.",
        );
      }
      const current = queryClient.getQueryData<TaskDocumentPayload>(queryKey);
      // A reset or save accepted during this read also owns its imperative result.
      const result = {
        ...(current !== undefined && query?.state.dataUpdateCount !== dataUpdateCount
          ? current
          : resolveLatestDocumentPayload(current, incoming)),
      };
      reads.set(result, {
        result,
        query,
        dataUpdateCount: query?.state.dataUpdateCount,
      });
      return result;
    },
    structuralSharing: (previous, incoming) => {
      // SAFETY: WeakMap.get accepts primitives. A hit holds the typed copy made by this read.
      const read = reads.get(incoming as object);
      if (read) {
        reads.delete(read.result);
        if (queryClient.getQueryCache().find({ queryKey, exact: true }) !== read.query) {
          throw new Error(
            "The task artifact changed while loading. Open it again to load the current artifact.",
          );
        }
        const current = queryClient.getQueryData<TaskDocumentPayload>(queryKey);
        if (current !== undefined && read.query?.state.dataUpdateCount !== read.dataUpdateCount) {
          // Query.fetch returns this copy to joined readers. Update it before Query accepts
          // it so those readers also receive the save or reset. Keep cached and host objects intact.
          const result = read.result;
          result.markdown = current.markdown;
          result.updatedAt = current.updatedAt;
          if (current.error === undefined) delete result.error;
          else result.error = current.error;
        }
      }
      return replaceEqualDeep(previous, incoming);
    },
    staleTime: TASK_DOCUMENT_STALE_TIME_MS,
  });
};

export const recordDocumentVersion = (
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  updatedAt: string,
): void => {
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  if (query) {
    versions.set(query, Math.max(versions.get(query) ?? 0, Date.parse(updatedAt)));
  }
};

export const resetDocumentSaveOwners = (queries: readonly Query[]): void => {
  for (const query of queries) {
    saveEpochs.set(query, Symbol());
    commits.delete(query);
  }
};

/** A save response can reach the cache before its event or an older card projection. */
export const recordDocumentCommit = (
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  cursor: TaskEventCursor,
  changed: boolean,
): boolean => {
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  if (!query) return false;
  const current = commits.get(query);
  if (current && (current.epoch !== cursor.epoch || current.sequence >= cursor.sequence))
    return false;
  if (changed) commits.set(query, cursor);
  return true;
};

/** Capture the query and its save owner before the host write starts. */
export const createDocumentSaveGuard = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  code: string,
): ((incoming: TaskArtifactSaveResult & { markdown: string }) => void) => {
  const options = taskDocumentQueryOptions(queryClient, repoPath, taskId, code);
  // Query's tagged key needs its plain key type at this cache boundary.
  const queryKey: ReturnType<typeof documentQueryKeys.document> = options.queryKey;
  // Create the query without fetching so a reset can also block a first save.
  const query: object = queryClient.getQueryCache().build(queryClient, { ...options, queryKey });
  const saveEpoch = saveEpochs.get(query);
  return (incoming: TaskArtifactSaveResult & { markdown: string }): void => {
    const current = queryClient.getQueryData<TaskDocumentPayload>(options.queryKey);
    const commit = commits.get(query);
    if (
      queryClient.getQueryCache().find({ queryKey: options.queryKey, exact: true }) !== query ||
      saveEpochs.get(query) !== saveEpoch ||
      (commit &&
        (commit.epoch !== incoming.cursor.epoch || commit.sequence > incoming.cursor.sequence)) ||
      (versions.get(query) ?? 0) > Date.parse(incoming.updatedAt) ||
      resolveLatestDocumentPayload(current, incoming) !== incoming
    ) {
      throw new Error(
        "The task artifact changed after this save. Open it again to review the current artifact.",
      );
    }
    commits.set(query, incoming.cursor);
    queryClient.setQueryData(options.queryKey, {
      markdown: incoming.markdown,
      updatedAt: incoming.updatedAt,
    });
  };
};

export const fetchFreshTaskDocumentFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  code: string,
  readDocument?: TaskDocumentReader,
): Promise<TaskDocumentPayload> => {
  return queryClient.fetchQuery({
    ...taskDocumentQueryOptions(queryClient, repoPath, taskId, code, readDocument),
    staleTime: 0,
  });
};

export const removeCachedTaskDocumentQueries = (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
): void => {
  const taskIdSet = new Set(taskIds);
  for (const query of queryClient.getQueryCache().findAll({
    queryKey: documentQueryKeys.all,
    exact: false,
  })) {
    const [scope, _section, cachedRepoPath, cachedTaskId] = query.queryKey;
    const cachedTaskIdResult = queryKeyStringSchema.safeParse(cachedTaskId);
    if (
      scope !== documentQueryKeys.all[0] ||
      cachedRepoPath !== repoPath ||
      !cachedTaskIdResult.success ||
      !taskIdSet.has(cachedTaskIdResult.data)
    ) {
      continue;
    }

    queryClient.removeQueries({
      queryKey: query.queryKey,
      exact: true,
    });
  }
};

export const invalidateCachedTaskDocumentQueries = async (
  queryClient: QueryClient,
  repoPath: string,
  taskIds: string[],
): Promise<void> => {
  const taskIdSet = new Set(taskIds);
  await queryClient.invalidateQueries({
    queryKey: documentQueryKeys.all,
    exact: false,
    predicate: (query) => {
      const [scope, _section, cachedRepoPath, cachedTaskId] = query.queryKey;
      const cachedTaskIdResult = queryKeyStringSchema.safeParse(cachedTaskId);
      return (
        scope === documentQueryKeys.all[0] &&
        cachedRepoPath === repoPath &&
        cachedTaskIdResult.success &&
        taskIdSet.has(cachedTaskIdResult.data)
      );
    },
    refetchType: "none",
  });
};

export const loadTaskDocumentFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  code: string,
): Promise<TaskDocument> =>
  queryClient.fetchQuery(taskDocumentQueryOptions(queryClient, repoPath, taskId, code));

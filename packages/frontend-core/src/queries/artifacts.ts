import { workspaceScopeValue } from "./workspace-scope";
import { queryMatchesWorkspace } from "./workspace-scope";
import { type WorkspaceRef } from "@openducktor/contracts";
import type {
  ArtifactSaveResult,
  ArtifactDeleteResult,
  TaskArtifact,
  ArtifactReadResult,
  TaskArtifactChange,
  TaskArtifactCollection,
  TaskEventCursor,
} from "@openducktor/contracts";
import {
  CancelledError,
  type QueryClient,
  queryOptions,
  replaceEqualDeep,
} from "@tanstack/react-query";
import { roleFocusArtifact, type BuiltinRoleId as AgentRole } from "@openducktor/workflows";
import { connectionHost } from "../connection/client-connection";
import { taskDocumentQueryOptions } from "./documents";

export const artifactQueryKeys = {
  all: ["task-artifacts"] as const,
  collection: (repoPath: WorkspaceRef, taskId: string) =>
    ["task-artifacts", "collection", workspaceScopeValue(repoPath), taskId] as const,
  content: (repoPath: WorkspaceRef, taskId: string, artifactId: string) =>
    ["task-artifacts", "content", workspaceScopeValue(repoPath), taskId, artifactId] as const,
  /** A read that keeps the bytes outside the query cache, such as in a device file. */
  file: (repoPath: WorkspaceRef, taskId: string, artifactId: string) =>
    ["task-artifacts", "file", workspaceScopeValue(repoPath), taskId, artifactId] as const,
};

export type TaskArtifactContent = { artifact: TaskArtifact; bytes: Uint8Array };
const commits = new WeakMap<object, TaskEventCursor>();
const saveOwners = new WeakMap<object, symbol>();

export const taskArtifactsQueryOptions = (
  queryClient: QueryClient,
  repoPath: WorkspaceRef,
  taskId: string,
) =>
  queryOptions({
    queryKey: artifactQueryKeys.collection(repoPath, taskId),
    queryFn: () => connectionHost(queryClient).taskArtifactsList({ ...repoPath, taskId }),
  });

/** Start the selected workflow read before navigation renders the session. */
export const prefetchTaskArtifacts = async (
  queryClient: QueryClient,
  repoPath: WorkspaceRef,
  taskId: string,
  role: AgentRole | null,
): Promise<void> => {
  const refresh = queryClient.prefetchQuery(
    taskArtifactsQueryOptions(queryClient, repoPath, taskId),
  );
  const code = role ? roleFocusArtifact(role) : undefined;
  const read = code
    ? queryClient.prefetchQuery(taskDocumentQueryOptions(queryClient, repoPath, taskId, code))
    : undefined;
  await Promise.all([refresh, read]);
};

/** Keep a shared read alive across preview remounts; explicit cancellation still drops it. */
export const readTaskArtifact = async (
  queryClient: QueryClient,
  scope: WorkspaceRef & { taskId: string; artifactId: string },
  context: { readonly signal: AbortSignal },
): Promise<ArtifactReadResult> => {
  const result = await connectionHost(queryClient).taskArtifactRead(scope);
  if (context.signal.aborted) throw new CancelledError();
  return result;
};

export const taskArtifactContentQueryOptions = (
  queryClient: QueryClient,
  repoPath: WorkspaceRef,
  taskId: string,
  artifactId: string,
) =>
  queryOptions({
    queryKey: artifactQueryKeys.content(repoPath, taskId, artifactId),
    queryFn: async (context): Promise<TaskArtifactContent> => {
      const result = await readTaskArtifact(
        queryClient,
        { ...repoPath, taskId, artifactId },
        context,
      );
      return { artifact: result.artifact, bytes: decodeBase64(result.dataBase64) };
    },
    structuralSharing: (previous, incoming) => {
      // SAFETY: this query key holds only TaskArtifactContent values.
      const current = previous as TaskArtifactContent | undefined;
      // SAFETY: completed reads return TaskArtifactContent for this query key.
      const next = incoming as TaskArtifactContent;
      const shared =
        current && equalBytes(current.bytes, next.bytes) ? { ...next, bytes: current.bytes } : next;
      return replaceEqualDeep(current, shared);
    },
  });

const equalBytes = (first: Uint8Array, second: Uint8Array): boolean => {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index++) {
    if (first[index] !== second[index]) return false;
  }
  return true;
};

export const refreshArtifactQueries = async (
  queryClient: QueryClient,
  repoPath: WorkspaceRef,
  changes?: readonly TaskArtifactChange[],
  permissionTaskIds: readonly string[] = [],
  cursor?: TaskEventCursor,
): Promise<void> => {
  const queries = queryClient.getQueryCache().findAll(scopeFilter(repoPath));
  const changesByTask = new Map(changes?.map((change) => [change.taskId, change]));
  const permissionTasks = new Set(permissionTaskIds);
  await Promise.all(
    queries.map(async (query) => {
      const taskId = String(query.queryKey[3]);
      const change = changesByTask.get(taskId);
      const selected =
        query.queryKey[1] === "collection"
          ? changes === undefined || Boolean(change) || permissionTasks.has(taskId)
          : changes === undefined ||
            Boolean(change?.artifactIds.includes(String(query.queryKey[4])));
      if (!selected) return;
      const previous = commits.get(query);
      if (
        cursor &&
        previous &&
        (previous.epoch !== cursor.epoch || previous.sequence >= cursor.sequence)
      )
        return;
      if (cursor) commits.set(query, cursor);
      else {
        saveOwners.set(query, Symbol());
        commits.delete(query);
      }
      const cancelled = queryClient.cancelQueries(
        { queryKey: query.queryKey, exact: true },
        { silent: true, revert: false },
      );
      if (
        query.queryKey[1] !== "collection" &&
        change?.removedArtifactIds.includes(String(query.queryKey[4]))
      ) {
        queryClient.getQueryCache().remove(query);
        await cancelled;
        return;
      }
      await cancelled;
      try {
        await queryClient.invalidateQueries(
          { queryKey: query.queryKey, exact: true, refetchType: "active" },
          { throwOnError: true },
        );
      } catch (error) {
        if (!(error instanceof CancelledError)) throw error;
      }
    }),
  );
};

export const resetArtifactSaveOwners = (queryClient: QueryClient): void => {
  for (const query of queryClient.getQueryCache().findAll({ queryKey: artifactQueryKeys.all })) {
    saveOwners.set(query, Symbol());
    commits.delete(query);
  }
};

export const removeArtifactQueries = async (
  queryClient: QueryClient,
  repoPath: WorkspaceRef,
  taskIds?: readonly string[],
): Promise<void> => {
  const filter = scopeFilter(repoPath, taskIds);
  const cancelled = queryClient.cancelQueries(filter, { silent: true });
  queryClient.removeQueries(filter);
  await cancelled;
};

/** A receipt cannot restore metadata after a newer event, snapshot, or workspace release. */
export const createArtifactSaveGuard = (
  queryClient: QueryClient,
  repoPath: WorkspaceRef,
  taskId: string,
) => {
  const queryKey = artifactQueryKeys.collection(repoPath, taskId);
  const query: object = queryClient.getQueryCache().build(queryClient, { queryKey });
  const owner = saveOwners.get(query);
  return async (receipt: ArtifactSaveResult | ArtifactDeleteResult): Promise<void> => {
    const assertCurrent = () => {
      const commit = commits.get(query);
      if (
        queryClient.getQueryCache().find({ queryKey, exact: true }) !== query ||
        saveOwners.get(query) !== owner ||
        (commit &&
          (commit.epoch !== receipt.cursor.epoch || commit.sequence > receipt.cursor.sequence))
      ) {
        throw new Error(
          "The artifacts changed after this save. Open the collection again to review them.",
        );
      }
    };
    assertCurrent();
    await queryClient.cancelQueries({ queryKey, exact: true }, { silent: true, revert: false });
    assertCurrent();
    // A receipt covers one artifact, so the complete collection still needs a fresh read.
    commits.delete(query);
    const artifactId = "artifact" in receipt ? receipt.artifact.artifactId : receipt.artifactId;
    queryClient.setQueryData<TaskArtifactCollection>(queryKey, (current) => {
      if (!current) return current;
      const artifacts = current.artifacts.filter((item) => item.artifactId !== artifactId);
      if ("artifact" in receipt) artifacts.push(receipt.artifact);
      return { ...current, artifacts };
    });
    await refreshArtifactQueries(
      queryClient,
      repoPath,
      [
        {
          taskId,
          artifactIds: [artifactId],
          removedArtifactIds: "artifact" in receipt ? [] : [artifactId],
        },
      ],
      [],
      receipt.cursor,
    );
  };
};

const scopeFilter = (repoPath: WorkspaceRef, taskIds?: readonly string[]) => ({
  queryKey: artifactQueryKeys.all,
  predicate: (query: { queryKey: readonly unknown[] }) =>
    queryMatchesWorkspace(query, repoPath) &&
    (!taskIds || taskIds.includes(String(query.queryKey[3]))),
});

const decodedByteSize = (value: string): number =>
  (value.length / 4) * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);

const decodeBase64 = (value: string): Uint8Array => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const output = new Uint8Array(decodedByteSize(value));
  for (let index = 0, offset = 0; index < value.length; index += 4) {
    const bits =
      (alphabet.indexOf(value[index]!) << 18) |
      (alphabet.indexOf(value[index + 1]!) << 12) |
      ((alphabet.indexOf(value[index + 2]!) & 63) << 6) |
      (alphabet.indexOf(value[index + 3]!) & 63);
    for (const shift of [16, 8, 0])
      if (offset < output.length) output[offset++] = (bits >> shift) & 255;
  }
  return output;
};

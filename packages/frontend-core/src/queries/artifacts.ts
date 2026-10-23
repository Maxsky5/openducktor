import type {
  ArtifactSaveResult,
  ArtifactDeleteResult,
  ArtifactReadRequest,
  TaskArtifact,
  TaskArtifactChange,
  TaskArtifactCollection,
  TaskEventCursor,
  WorkflowTaskArtifact,
} from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import {
  CancelledError,
  type QueryClient,
  queryOptions,
  replaceEqualDeep,
} from "@tanstack/react-query";
import { connectionHost } from "../connection/client-connection";
import { taskDocumentQueryOptions } from "./documents";

export const artifactQueryKeys = {
  all: ["task-artifacts"] as const,
  collection: (repoPath: string, taskId: string) =>
    ["task-artifacts", "collection", repoPath, taskId] as const,
  content: (repoPath: string, taskId: string, artifactId: string) =>
    ["task-artifacts", "content", repoPath, taskId, artifactId] as const,
};

export type TaskArtifactContent = { artifact: TaskArtifact; version: string; bytes: Uint8Array };
const commits = new WeakMap<object, TaskEventCursor>();
const saveOwners = new WeakMap<object, symbol>();

export const taskArtifactsQueryOptions = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
) =>
  queryOptions({
    queryKey: artifactQueryKeys.collection(repoPath, taskId),
    queryFn: () => connectionHost(queryClient).taskArtifactsList({ repoPath, taskId }),
  });

/** Start the selected workflow read before navigation renders the session. */
export const prefetchTaskArtifacts = async (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  role: AgentRole | null,
): Promise<void> => {
  const refresh = queryClient.prefetchQuery(
    taskArtifactsQueryOptions(queryClient, repoPath, taskId),
  );
  const kind = role ? workflowKindForRole(role) : null;
  const read = kind
    ? queryClient.prefetchQuery(
        taskDocumentQueryOptions(queryClient, repoPath, taskId, kind === "qaReport" ? "qa" : kind),
      )
    : undefined;
  await Promise.all([refresh, read]);
};

export const workflowKindForRole = (role: AgentRole): WorkflowTaskArtifact["workflowKind"] => {
  if (role === "spec") return "spec";
  if (role === "qa") return "qaReport";
  return "plan";
};

export const taskArtifactContentQueryOptions = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  artifactId: string,
) =>
  queryOptions({
    queryKey: artifactQueryKeys.content(repoPath, taskId, artifactId),
    queryFn: async (context): Promise<TaskArtifactContent> => {
      const host = connectionHost(queryClient);
      let offset = 0;
      let version: string | undefined;
      let bytes: Uint8Array | undefined;
      while (true) {
        const request: ArtifactReadRequest = {
          repoPath,
          taskId,
          artifactId,
          byteOffset: offset,
          maxBytes: 1_048_576,
        };
        if (version) request.expectedVersion = version;
        const chunk = await host.taskArtifactRead(request);
        // Let a shared first chunk finish when its preview unmounts; explicit cancellation still drops it.
        if (context.signal.aborted) throw new CancelledError();
        if (chunk.byteOffset !== offset || (version && chunk.version !== version)) {
          throw new Error(
            "The artifact changed while loading. Open it again to read its current content.",
          );
        }
        if (!bytes) bytes = new Uint8Array(chunk.totalBytes);
        const binary = decodeBase64(chunk.dataBase64);
        if (offset + binary.length > bytes.length || chunk.totalBytes !== bytes.length) {
          throw new Error("The artifact read returned an invalid size. Open it again.");
        }
        bytes.set(binary, offset);
        version = chunk.version;
        const next = offset + binary.length;
        if (chunk.nextByteOffset === null) {
          if (next !== bytes.length)
            throw new Error("The artifact read is incomplete. Open it again.");
          return { artifact: chunk.artifact, version, bytes };
        }
        if (chunk.nextByteOffset !== next || next <= offset) {
          throw new Error("The artifact read did not advance. Open it again.");
        }
        offset = next;
      }
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
  repoPath: string,
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
        query.queryKey[1] === "content" &&
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
  repoPath: string,
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
  repoPath: string,
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

const scopeFilter = (repoPath: string, taskIds?: readonly string[]) => ({
  queryKey: artifactQueryKeys.all,
  predicate: (query: { queryKey: readonly unknown[] }) =>
    query.queryKey[2] === repoPath && (!taskIds || taskIds.includes(String(query.queryKey[3]))),
});

const decodeBase64 = (value: string): Uint8Array => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const output = new Uint8Array(
    (value.length / 4) * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0),
  );
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

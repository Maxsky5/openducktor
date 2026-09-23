import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import type { TaskDocumentPayload } from "@/types/task-documents";
import { host } from "../operations/host";
import { resolveLatestDocumentPayload } from "./document-utils";

export const TASK_DOCUMENT_STALE_TIME_MS = 60_000;

const queryKeyStringSchema = z.string();

export type TaskDocument = {
  markdown: string;
  updatedAt: string | null;
  error?: string | null;
};

export type TaskDocumentSection = "spec" | "plan" | "qa";
export type TaskDocumentReader = (
  repoPath: string,
  taskId: string,
  section: TaskDocumentSection,
) => Promise<TaskDocument>;

export const documentQueryKeys = {
  all: ["task-documents"] as const,
  spec: (repoPath: string, taskId: string) =>
    [...documentQueryKeys.all, "spec", repoPath, taskId] as const,
  plan: (repoPath: string, taskId: string) =>
    [...documentQueryKeys.all, "plan", repoPath, taskId] as const,
  qaReport: (repoPath: string, taskId: string) =>
    [...documentQueryKeys.all, "qa-report", repoPath, taskId] as const,
};

export const documentQueryKeyForSection = (
  repoPath: string,
  taskId: string,
  section: TaskDocumentSection,
) => {
  if (section === "spec") {
    return documentQueryKeys.spec(repoPath, taskId);
  }

  if (section === "plan") {
    return documentQueryKeys.plan(repoPath, taskId);
  }

  return documentQueryKeys.qaReport(repoPath, taskId);
};

export const taskDocumentQueryOptions = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  section: TaskDocumentSection,
  readDocument: TaskDocumentReader = host.taskDocumentGet,
) => {
  const queryKey = documentQueryKeyForSection(repoPath, taskId, section);
  return queryOptions({
    queryKey,
    queryFn: async (): Promise<TaskDocumentPayload> => {
      if (!repoPath) {
        throw new Error("Select a repository before loading task documents.");
      }
      const incoming = await readDocument(repoPath, taskId, section);
      return resolveLatestDocumentPayload(queryClient.getQueryData(queryKey), incoming);
    },
    staleTime: TASK_DOCUMENT_STALE_TIME_MS,
  });
};

export const fetchFreshTaskDocumentFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  section: TaskDocumentSection,
  readDocument?: TaskDocumentReader,
): Promise<TaskDocumentPayload> => {
  return queryClient.fetchQuery({
    ...taskDocumentQueryOptions(queryClient, repoPath, taskId, section, readDocument),
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

export const loadSpecDocumentFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): Promise<TaskDocument> =>
  queryClient.fetchQuery(taskDocumentQueryOptions(queryClient, repoPath, taskId, "spec"));

export const loadPlanDocumentFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): Promise<TaskDocument> =>
  queryClient.fetchQuery(taskDocumentQueryOptions(queryClient, repoPath, taskId, "plan"));

export const loadQaReportDocumentFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): Promise<TaskDocument> =>
  queryClient.fetchQuery(taskDocumentQueryOptions(queryClient, repoPath, taskId, "qa"));

import { type QueryClient, queryOptions } from "@tanstack/react-query";
import type { TaskDocumentPayload } from "@/types/task-documents";
import { host } from "../operations/host";
import { resolveLatestDocumentPayload } from "./document-utils";

export const TASK_DOCUMENT_STALE_TIME_MS = 60_000;

export type TaskDocument = {
  markdown: string;
  updatedAt: string | null;
};

export type TaskDocumentSection = "spec" | "plan" | "qa";

type TaskDocumentReadMode = "default" | "forceFresh";

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

const loadTaskDocumentFromHost = async (
  repoPath: string,
  taskId: string,
  section: TaskDocumentSection,
  mode: TaskDocumentReadMode = "default",
): Promise<TaskDocument> => {
  const readDocument = mode === "forceFresh" ? host.taskDocumentGetFresh : host.taskDocumentGet;
  return readDocument(repoPath, taskId, section);
};

const taskDocumentQueryOptions = (repoPath: string, taskId: string, section: TaskDocumentSection) =>
  queryOptions({
    queryKey: documentQueryKeyForSection(repoPath, taskId, section),
    queryFn: async (): Promise<TaskDocument> =>
      loadTaskDocumentFromHost(repoPath, taskId, section, "default"),
    staleTime: TASK_DOCUMENT_STALE_TIME_MS,
  });

const fetchTaskDocumentWithMode = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  section: TaskDocumentSection,
  mode: TaskDocumentReadMode,
): Promise<TaskDocumentPayload> => {
  const queryKey = documentQueryKeyForSection(repoPath, taskId, section);
  return queryClient.fetchQuery({
    queryKey,
    queryFn: async (): Promise<TaskDocumentPayload> => {
      const incoming = await loadTaskDocumentFromHost(repoPath, taskId, section, mode);
      const current = queryClient.getQueryData<TaskDocumentPayload>(queryKey);
      return resolveLatestDocumentPayload(current, incoming);
    },
    staleTime: mode === "forceFresh" ? 0 : TASK_DOCUMENT_STALE_TIME_MS,
  });
};

export const fetchTaskDocumentFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  section: TaskDocumentSection,
): Promise<TaskDocumentPayload> => {
  return fetchTaskDocumentWithMode(queryClient, repoPath, taskId, section, "default");
};

export const fetchFreshTaskDocumentFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  section: TaskDocumentSection,
): Promise<TaskDocumentPayload> => {
  return fetchTaskDocumentWithMode(queryClient, repoPath, taskId, section, "forceFresh");
};

const cachedTaskDocumentSections = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): TaskDocumentSection[] => {
  const sections = new Set<TaskDocumentSection>();
  for (const query of queryClient.getQueryCache().findAll({
    queryKey: documentQueryKeys.all,
    exact: false,
  })) {
    const [scope, section, cachedRepoPath, cachedTaskId] = query.queryKey;
    if (
      scope !== documentQueryKeys.all[0] ||
      cachedRepoPath !== repoPath ||
      cachedTaskId !== taskId
    ) {
      continue;
    }
    if (section === "spec" || section === "plan") {
      sections.add(section);
      continue;
    }
    if (section === "qa-report") {
      sections.add("qa");
    }
  }
  return [...sections];
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
    if (
      scope !== documentQueryKeys.all[0] ||
      cachedRepoPath !== repoPath ||
      typeof cachedTaskId !== "string" ||
      !taskIdSet.has(cachedTaskId)
    ) {
      continue;
    }

    queryClient.removeQueries({
      queryKey: query.queryKey,
      exact: true,
    });
  }
};

export const refreshCachedTaskDocumentQueries = async (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): Promise<void> => {
  const cachedSections = cachedTaskDocumentSections(queryClient, repoPath, taskId);
  await Promise.all(
    cachedSections.map((section) =>
      fetchFreshTaskDocumentFromQuery(queryClient, repoPath, taskId, section),
    ),
  );
};

export const loadSpecDocumentFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): Promise<TaskDocument> =>
  queryClient.fetchQuery(taskDocumentQueryOptions(repoPath, taskId, "spec"));

export const loadPlanDocumentFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): Promise<TaskDocument> =>
  queryClient.fetchQuery(taskDocumentQueryOptions(repoPath, taskId, "plan"));

export const loadQaReportDocumentFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): Promise<TaskDocument> =>
  queryClient.fetchQuery(taskDocumentQueryOptions(repoPath, taskId, "qa"));

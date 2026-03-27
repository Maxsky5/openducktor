import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { host } from "../operations/host";

export const TASK_DOCUMENT_STALE_TIME_MS = 60_000;

export type TaskDocument = {
  markdown: string;
  updatedAt: string | null;
};

export type TaskDocumentSection = "spec" | "plan" | "qa";

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

const specDocumentQueryOptions = (repoPath: string, taskId: string) =>
  queryOptions({
    queryKey: documentQueryKeys.spec(repoPath, taskId),
    queryFn: async (): Promise<TaskDocument> => {
      const spec = await host.specGet(repoPath, taskId);
      return {
        markdown: spec.markdown,
        updatedAt: spec.updatedAt,
      };
    },
    staleTime: TASK_DOCUMENT_STALE_TIME_MS,
  });

const planDocumentQueryOptions = (repoPath: string, taskId: string) =>
  queryOptions({
    queryKey: documentQueryKeys.plan(repoPath, taskId),
    queryFn: async (): Promise<TaskDocument> => {
      const plan = await host.planGet(repoPath, taskId);
      return {
        markdown: plan.markdown,
        updatedAt: plan.updatedAt,
      };
    },
    staleTime: TASK_DOCUMENT_STALE_TIME_MS,
  });

const qaReportDocumentQueryOptions = (repoPath: string, taskId: string) =>
  queryOptions({
    queryKey: documentQueryKeys.qaReport(repoPath, taskId),
    queryFn: async (): Promise<TaskDocument> => {
      const report = await host.qaGetReport(repoPath, taskId);
      return {
        markdown: report.markdown,
        updatedAt: report.updatedAt,
      };
    },
    staleTime: TASK_DOCUMENT_STALE_TIME_MS,
  });

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
    if (section === "qa" || section === "qa-report") {
      sections.add("qa");
    }
  }
  return [...sections];
};

export const refreshCachedTaskDocumentQueries = async (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): Promise<void> => {
  const cachedSections = cachedTaskDocumentSections(queryClient, repoPath, taskId);
  await Promise.all(
    cachedSections.map((section) => {
      if (section === "spec") {
        return queryClient.fetchQuery({
          ...specDocumentQueryOptions(repoPath, taskId),
          staleTime: 0,
        });
      }
      if (section === "plan") {
        return queryClient.fetchQuery({
          ...planDocumentQueryOptions(repoPath, taskId),
          staleTime: 0,
        });
      }
      return queryClient.fetchQuery({
        ...qaReportDocumentQueryOptions(repoPath, taskId),
        staleTime: 0,
      });
    }),
  );
};

export const loadSpecDocumentFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): Promise<TaskDocument> => queryClient.fetchQuery(specDocumentQueryOptions(repoPath, taskId));

export const loadPlanDocumentFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): Promise<TaskDocument> => queryClient.fetchQuery(planDocumentQueryOptions(repoPath, taskId));

export const loadQaReportDocumentFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): Promise<TaskDocument> => queryClient.fetchQuery(qaReportDocumentQueryOptions(repoPath, taskId));

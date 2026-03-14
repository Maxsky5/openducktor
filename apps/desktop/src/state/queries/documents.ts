import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { host } from "../operations/host";

const TASK_DOCUMENT_STALE_TIME_MS = 60_000;

type TaskDocument = {
  markdown: string;
  updatedAt: string | null;
};

export const documentQueryKeys = {
  all: ["task-documents"] as const,
  spec: (repoPath: string, taskId: string) =>
    [...documentQueryKeys.all, "spec", repoPath, taskId] as const,
  plan: (repoPath: string, taskId: string) =>
    [...documentQueryKeys.all, "plan", repoPath, taskId] as const,
  qaReport: (repoPath: string, taskId: string) =>
    [...documentQueryKeys.all, "qa-report", repoPath, taskId] as const,
};

export const specDocumentQueryOptions = (repoPath: string, taskId: string) =>
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

export const planDocumentQueryOptions = (repoPath: string, taskId: string) =>
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

export const qaReportDocumentQueryOptions = (repoPath: string, taskId: string) =>
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

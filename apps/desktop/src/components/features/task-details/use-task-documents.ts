import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useSpecState } from "@/state";
import type { TaskDocumentPayload } from "@/types/task-documents";

export type DocumentSectionKey = "spec" | "plan" | "qa";

export type TaskDocumentState = {
  markdown: string;
  updatedAt: string | null;
  isLoading: boolean;
  error: string | null;
  loaded: boolean;
};

type TaskDocumentLoaders = {
  loadSpecDocument: (taskId: string) => Promise<TaskDocumentPayload>;
  loadPlanDocument: (taskId: string) => Promise<TaskDocumentPayload>;
  loadQaReportDocument: (taskId: string) => Promise<TaskDocumentPayload>;
};

const TASK_DOCUMENT_STALE_TIME_MS = 60_000;

const createTaskDocumentState = (input?: {
  markdown?: string;
  updatedAt?: string | null;
  isLoading?: boolean;
  error?: string | null;
  loaded?: boolean;
}): TaskDocumentState => ({
  markdown: input?.markdown ?? "",
  updatedAt: input?.updatedAt ?? null,
  isLoading: input?.isLoading ?? false,
  error: input?.error ?? null,
  loaded: input?.loaded ?? false,
});

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to load document.";

const createDocumentQueryKey = (cacheScope: string, taskId: string, section: DocumentSectionKey) =>
  ["task-documents", section, cacheScope, taskId] as const;

const createDocumentQueryOptions = ({
  cacheScope,
  taskId,
  section,
  loader,
}: {
  cacheScope: string;
  taskId: string;
  section: DocumentSectionKey;
  loader: (taskId: string) => Promise<TaskDocumentPayload>;
}) =>
  queryOptions({
    queryKey: createDocumentQueryKey(cacheScope, taskId, section),
    queryFn: (): Promise<TaskDocumentPayload> => loader(taskId),
    staleTime: TASK_DOCUMENT_STALE_TIME_MS,
  });

const toTaskDocumentState = (
  query: ReturnType<typeof useQuery<TaskDocumentPayload>>,
  enabled: boolean,
): TaskDocumentState => {
  const hasResolved = query.data !== undefined || query.isSuccess || query.isError;
  return createTaskDocumentState({
    markdown: query.data?.markdown ?? "",
    updatedAt: query.data?.updatedAt ?? null,
    isLoading: enabled && query.isFetching && query.data === undefined,
    error: query.error ? toErrorMessage(query.error) : null,
    loaded: hasResolved,
  });
};

export function useTaskDocuments(
  taskId: string | null,
  open: boolean,
  cacheScope = "",
  loadersOverride?: TaskDocumentLoaders,
): {
  specDoc: TaskDocumentState;
  planDoc: TaskDocumentState;
  qaDoc: TaskDocumentState;
  ensureDocumentLoaded: (section: DocumentSectionKey) => boolean;
  reloadDocument: (section: DocumentSectionKey) => boolean;
  applyDocumentUpdate: (section: DocumentSectionKey, payload: TaskDocumentPayload) => void;
} {
  const specState = useSpecState();
  const { loadSpecDocument, loadPlanDocument, loadQaReportDocument } = loadersOverride ?? specState;
  const queryClient = useQueryClient();

  const enabled = open && taskId !== null;
  const specQuery = useQuery({
    ...(taskId
      ? createDocumentQueryOptions({
          cacheScope,
          taskId,
          section: "spec",
          loader: loadSpecDocument,
        })
      : createDocumentQueryOptions({
          cacheScope,
          taskId: "__disabled__",
          section: "spec",
          loader: loadSpecDocument,
        })),
    enabled,
  });
  const planQuery = useQuery({
    ...(taskId
      ? createDocumentQueryOptions({
          cacheScope,
          taskId,
          section: "plan",
          loader: loadPlanDocument,
        })
      : createDocumentQueryOptions({
          cacheScope,
          taskId: "__disabled__",
          section: "plan",
          loader: loadPlanDocument,
        })),
    enabled,
  });
  const qaQuery = useQuery({
    ...(taskId
      ? createDocumentQueryOptions({
          cacheScope,
          taskId,
          section: "qa",
          loader: loadQaReportDocument,
        })
      : createDocumentQueryOptions({
          cacheScope,
          taskId: "__disabled__",
          section: "qa",
          loader: loadQaReportDocument,
        })),
    enabled,
  });

  const queryOptionsBySection = useMemo(
    () =>
      taskId
        ? {
            spec: createDocumentQueryOptions({
              cacheScope,
              taskId,
              section: "spec",
              loader: loadSpecDocument,
            }),
            plan: createDocumentQueryOptions({
              cacheScope,
              taskId,
              section: "plan",
              loader: loadPlanDocument,
            }),
            qa: createDocumentQueryOptions({
              cacheScope,
              taskId,
              section: "qa",
              loader: loadQaReportDocument,
            }),
          }
        : null,
    [cacheScope, loadPlanDocument, loadQaReportDocument, loadSpecDocument, taskId],
  );

  const ensureDocumentLoaded = useCallback(
    (section: DocumentSectionKey): boolean => {
      if (!open || !queryOptionsBySection) {
        return false;
      }

      void queryClient.ensureQueryData(queryOptionsBySection[section]).catch(() => undefined);
      return true;
    },
    [open, queryClient, queryOptionsBySection],
  );

  const reloadDocument = useCallback(
    (section: DocumentSectionKey): boolean => {
      if (!open || !queryOptionsBySection) {
        return false;
      }

      const options = queryOptionsBySection[section];
      void queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
      void queryClient
        .fetchQuery({
          ...options,
          staleTime: 0,
        })
        .catch(() => undefined);
      return true;
    },
    [open, queryClient, queryOptionsBySection],
  );

  const applyDocumentUpdate = useCallback(
    (section: DocumentSectionKey, payload: TaskDocumentPayload): void => {
      if (!queryOptionsBySection) {
        return;
      }

      const queryKey = queryOptionsBySection[section].queryKey;
      void queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData<TaskDocumentPayload>(queryKey, payload);
    },
    [queryClient, queryOptionsBySection],
  );

  return {
    specDoc: toTaskDocumentState(specQuery, enabled),
    planDoc: toTaskDocumentState(planQuery, enabled),
    qaDoc: toTaskDocumentState(qaQuery, enabled),
    ensureDocumentLoaded,
    reloadDocument,
    applyDocumentUpdate,
  };
}

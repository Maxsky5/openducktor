import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { resolveLatestDocumentPayload } from "@/state/queries/document-utils";
import {
  fetchFreshTaskDocumentFromQuery,
  taskDocumentQueryOptions,
} from "@/state/queries/documents";
import type { TaskDocumentPayload } from "@/types/task-documents";
import { ensureTaskDocumentQueryData } from "./task-document-query-data";

export type DocumentSectionKey = "spec" | "plan" | "qa";

export type TaskDocumentState = {
  markdown: string;
  updatedAt: string | null;
  isLoading: boolean;
  error: string | null;
  loaded: boolean;
};

const DISABLED_TASK_ID = "__disabled__";

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

const toErrorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Unable to load document.";

const toTaskDocumentState = (
  query: ReturnType<typeof useQuery<TaskDocumentPayload>>,
  enabled: boolean,
): TaskDocumentState => {
  const hasResolved = query.data !== undefined || query.isSuccess || query.isError;
  return createTaskDocumentState({
    markdown: query.data?.markdown ?? "",
    updatedAt: query.data?.updatedAt ?? null,
    isLoading: enabled && query.isFetching && query.data === undefined,
    error: query.error ? toErrorMessage(query.error) : (query.data?.error ?? null),
    loaded: hasResolved,
  });
};

export function useTaskDocuments(taskId: string | null, open: boolean, cacheScope = "") {
  const queryClient = useQueryClient();

  const enabled = open && taskId !== null;
  const activeTaskId = taskId ?? DISABLED_TASK_ID;
  const queryOptionsBySection = useMemo(
    () => ({
      spec: taskDocumentQueryOptions(queryClient, cacheScope, activeTaskId, "spec"),
      plan: taskDocumentQueryOptions(queryClient, cacheScope, activeTaskId, "plan"),
      qa: taskDocumentQueryOptions(queryClient, cacheScope, activeTaskId, "qa"),
    }),
    [activeTaskId, cacheScope, queryClient],
  );

  const specQuery = useQuery({
    ...queryOptionsBySection.spec,
    enabled,
  });
  const planQuery = useQuery({
    ...queryOptionsBySection.plan,
    enabled,
  });
  const qaQuery = useQuery({
    ...queryOptionsBySection.qa,
    enabled,
  });

  const ensureDocumentLoaded = useCallback(
    (section: DocumentSectionKey): boolean => {
      if (!enabled) {
        return false;
      }

      void ensureTaskDocumentQueryData(queryClient, queryOptionsBySection[section]).catch(
        () => undefined,
      );
      return true;
    },
    [enabled, queryClient, queryOptionsBySection],
  );

  const reloadDocument = useCallback(
    (section: DocumentSectionKey): boolean => {
      if (!enabled || !taskId) {
        return false;
      }

      const options = queryOptionsBySection[section];
      void queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
      void fetchFreshTaskDocumentFromQuery(queryClient, cacheScope, taskId, section).catch(
        () => undefined,
      );
      return true;
    },
    [cacheScope, enabled, queryClient, queryOptionsBySection, taskId],
  );

  const applyDocumentUpdate = useCallback(
    (section: DocumentSectionKey, payload: TaskDocumentPayload): void => {
      if (!taskId) {
        return;
      }

      const queryKey = queryOptionsBySection[section].queryKey;
      void queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData<TaskDocumentPayload>(queryKey, (current) =>
        resolveLatestDocumentPayload(current, payload),
      );
    },
    [queryClient, queryOptionsBySection, taskId],
  );

  return {
    specDoc: toTaskDocumentState(specQuery, enabled),
    planDoc: toTaskDocumentState(planQuery, enabled),
    qaDoc: toTaskDocumentState(qaQuery, enabled),
    ensureDocumentLoaded,
    reloadDocument,
    applyDocumentUpdate,
  } satisfies {
    specDoc: TaskDocumentState;
    planDoc: TaskDocumentState;
    qaDoc: TaskDocumentState;
    ensureDocumentLoaded: (section: DocumentSectionKey) => boolean;
    reloadDocument: (section: DocumentSectionKey) => boolean;
    applyDocumentUpdate: (section: DocumentSectionKey, payload: TaskDocumentPayload) => void;
  };
}

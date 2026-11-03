import type { WorkspaceRef } from "@openducktor/contracts";
import { useQueries, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { ResolvedTaskCard } from "@openducktor/workflows";
import { resolveLatestDocumentPayload } from "../../queries/document-utils";
import { fetchFreshTaskDocumentFromQuery, taskDocumentQueryOptions } from "../../queries/documents";
import type { TaskDocumentPayload } from "../../types/task-documents";
import { ensureTaskDocumentQueryData } from "./task-document-query-data";

export type TaskDocumentState = {
  markdown: string;
  updatedAt: string | null;
  isLoading: boolean;
  error: string | null;
  loaded: boolean;
};

const toTaskDocumentState = (query: UseQueryResult<TaskDocumentPayload>): TaskDocumentState => ({
  markdown: query.data?.markdown ?? "",
  updatedAt: query.data?.updatedAt ?? null,
  isLoading: query.isFetching && query.data === undefined,
  error: query.error?.message ?? query.data?.error ?? null,
  loaded: query.data !== undefined || query.isSuccess || query.isError,
});

export function useTaskDocuments(
  task: ResolvedTaskCard | null,
  open: boolean,
  repoPath: WorkspaceRef,
) {
  const queryClient = useQueryClient();
  const codes = useMemo(
    () => task?.taskWorkflow.definition.artifacts.map(({ id }) => id) ?? [],
    [task?.taskWorkflow],
  );
  const options = useMemo(
    () =>
      codes.map((code) => taskDocumentQueryOptions(queryClient, repoPath, task?.id ?? "", code)),
    [codes, queryClient, repoPath, task?.id],
  );
  const queries = useQueries({
    queries: options.map((option) => ({ ...option, enabled: open && task !== null })),
  });
  const requireDocument = useCallback(
    (code: string) => {
      const index = codes.indexOf(code);
      const option = options[index];
      if (!option)
        throw new Error(
          `Task "${task?.id}" has no workflow artifact "${code}". Reload its workflow.`,
        );
      return option;
    },
    [codes, options, task?.id],
  );
  const ensureDocumentLoaded = useCallback(
    (code: string) => {
      if (!open || !task) return false;
      void ensureTaskDocumentQueryData(queryClient, requireDocument(code)).catch(() => undefined);
      return true;
    },
    [open, task, queryClient, requireDocument],
  );
  const reloadDocument = useCallback(
    (code: string) => {
      if (!open || !task) return false;
      const option = requireDocument(code);
      void queryClient.cancelQueries({ queryKey: option.queryKey, exact: true });
      void fetchFreshTaskDocumentFromQuery(queryClient, repoPath, task.id, code).catch(
        () => undefined,
      );
      return true;
    },
    [open, task, requireDocument, queryClient, repoPath],
  );
  const applyDocumentUpdate = useCallback(
    (code: string, payload: TaskDocumentPayload) => {
      const option = requireDocument(code);
      void queryClient.cancelQueries({ queryKey: option.queryKey, exact: true });
      queryClient.setQueryData<TaskDocumentPayload>(option.queryKey, (current) =>
        resolveLatestDocumentPayload(current, payload),
      );
    },
    [requireDocument, queryClient],
  );
  return {
    documents: Object.fromEntries(
      codes.map((code, index) => [code, toTaskDocumentState(queries[index]!)]),
    ),
    ensureDocumentLoaded,
    reloadDocument,
    applyDocumentUpdate,
  };
}

import type { TaskMetadataReadOptions } from "@openducktor/adapters-tauri-host";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { host } from "@/state/operations/host";
import { resolveLatestDocumentPayload } from "@/state/queries/document-utils";
import {
  documentQueryKeyForSection,
  fetchTaskDocumentFromQueryWithLoader,
  TASK_DOCUMENT_STALE_TIME_MS,
} from "@/state/queries/documents";
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
  loadSpecDocument: (
    taskId: string,
    options?: TaskMetadataReadOptions,
  ) => Promise<TaskDocumentPayload>;
  loadPlanDocument: (
    taskId: string,
    options?: TaskMetadataReadOptions,
  ) => Promise<TaskDocumentPayload>;
  loadQaReportDocument: (
    taskId: string,
    options?: TaskMetadataReadOptions,
  ) => Promise<TaskDocumentPayload>;
};

type SectionLoaders = Record<
  DocumentSectionKey,
  (taskId: string, options?: TaskMetadataReadOptions) => Promise<TaskDocumentPayload>
>;

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

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to load document.";

const createHostDocumentLoader = <TResult extends { markdown: string; updatedAt: string | null }>(
  cacheScope: string,
  readDocument: (
    repoPath: string,
    taskId: string,
    options?: TaskMetadataReadOptions,
  ) => Promise<TResult>,
): ((taskId: string, options?: TaskMetadataReadOptions) => Promise<TaskDocumentPayload>) => {
  return async (
    nextTaskId: string,
    options?: TaskMetadataReadOptions,
  ): Promise<TaskDocumentPayload> => {
    if (!cacheScope) {
      throw new Error("Select a repository before loading task documents.");
    }

    const document = await readDocument(cacheScope, nextTaskId, options);
    return {
      markdown: document.markdown,
      updatedAt: document.updatedAt,
    };
  };
};

const createDocumentQueryOptions = ({
  queryClient,
  cacheScope,
  taskId,
  section,
  loader,
}: {
  queryClient: ReturnType<typeof useQueryClient>;
  cacheScope: string;
  taskId: string;
  section: DocumentSectionKey;
  loader: (taskId: string, options?: TaskMetadataReadOptions) => Promise<TaskDocumentPayload>;
}) => {
  const queryKey = documentQueryKeyForSection(cacheScope, taskId, section);
  return queryOptions({
    queryKey,
    queryFn: async (): Promise<TaskDocumentPayload> => {
      const incoming = await loader(taskId);
      const current = queryClient.getQueryData<TaskDocumentPayload>(queryKey);
      return resolveLatestDocumentPayload(current, incoming);
    },
    staleTime: TASK_DOCUMENT_STALE_TIME_MS,
  });
};

const createQueryOptionsBySection = (
  queryClient: ReturnType<typeof useQueryClient>,
  cacheScope: string,
  taskId: string,
  loaders: SectionLoaders,
) => ({
  spec: createDocumentQueryOptions({
    queryClient,
    cacheScope,
    taskId,
    section: "spec",
    loader: loaders.spec,
  }),
  plan: createDocumentQueryOptions({
    queryClient,
    cacheScope,
    taskId,
    section: "plan",
    loader: loaders.plan,
  }),
  qa: createDocumentQueryOptions({
    queryClient,
    cacheScope,
    taskId,
    section: "qa",
    loader: loaders.qa,
  }),
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
  const loadSpecDocumentFromHost = useMemo(
    () => createHostDocumentLoader(cacheScope, host.specGet),
    [cacheScope],
  );
  const loadPlanDocumentFromHost = useMemo(
    () => createHostDocumentLoader(cacheScope, host.planGet),
    [cacheScope],
  );
  const loadQaReportDocumentFromHost = useMemo(
    () => createHostDocumentLoader(cacheScope, host.qaGetReport),
    [cacheScope],
  );

  const sectionLoaders = useMemo<SectionLoaders>(() => {
    return {
      spec: loadersOverride?.loadSpecDocument ?? loadSpecDocumentFromHost,
      plan: loadersOverride?.loadPlanDocument ?? loadPlanDocumentFromHost,
      qa: loadersOverride?.loadQaReportDocument ?? loadQaReportDocumentFromHost,
    };
  }, [
    loadersOverride?.loadPlanDocument,
    loadersOverride?.loadQaReportDocument,
    loadersOverride?.loadSpecDocument,
    loadPlanDocumentFromHost,
    loadQaReportDocumentFromHost,
    loadSpecDocumentFromHost,
  ]);

  const queryClient = useQueryClient();

  const enabled = open && taskId !== null;
  const activeTaskId = taskId ?? DISABLED_TASK_ID;
  const queryOptionsBySection = useMemo(
    () => createQueryOptionsBySection(queryClient, cacheScope, activeTaskId, sectionLoaders),
    [activeTaskId, cacheScope, queryClient, sectionLoaders],
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

      void queryClient.ensureQueryData(queryOptionsBySection[section]).catch(() => undefined);
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
      const loadDocument = sectionLoaders[section];
      void queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
      void fetchTaskDocumentFromQueryWithLoader(
        queryClient,
        cacheScope,
        taskId,
        section,
        loadDocument,
        { forceFresh: true },
      ).catch(() => undefined);
      return true;
    },
    [cacheScope, enabled, queryClient, queryOptionsBySection, sectionLoaders, taskId],
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
  };
}

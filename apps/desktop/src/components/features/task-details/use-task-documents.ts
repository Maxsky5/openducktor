import { useCallback, useEffect, useRef, useState } from "react";
import { useSpecState } from "@/state";
import {
  createTaskDocumentLoadController,
  requestTaskDocumentLoad,
  resetTaskDocumentLoadController,
  settleTaskDocumentLoad,
  supersedeTaskDocumentLoad,
  type TaskDocumentSectionKey,
} from "./task-document-load-controller";
import { resolveLoadedDocumentState, type TaskDocumentPayload } from "./task-document-state";

export type DocumentSectionKey = TaskDocumentSectionKey;

export type TaskDocumentState = {
  markdown: string;
  updatedAt: string | null;
  isLoading: boolean;
  error: string | null;
  loaded: boolean;
};

type TaskDocumentsState = Record<DocumentSectionKey, TaskDocumentState>;

type TaskDocumentLoaders = {
  loadSpecDocument: (taskId: string) => Promise<TaskDocumentPayload>;
  loadPlanDocument: (taskId: string) => Promise<TaskDocumentPayload>;
  loadQaReportDocument: (taskId: string) => Promise<TaskDocumentPayload>;
};

const createInitialTaskDocumentState = (): TaskDocumentState => ({
  markdown: "",
  updatedAt: null,
  isLoading: false,
  error: null,
  loaded: false,
});

const createInitialDocumentsState = (): TaskDocumentsState => ({
  spec: createInitialTaskDocumentState(),
  plan: createInitialTaskDocumentState(),
  qa: createInitialTaskDocumentState(),
});

const cloneDocumentsState = (documents: TaskDocumentsState): TaskDocumentsState => ({
  spec: { ...documents.spec },
  plan: { ...documents.plan },
  qa: { ...documents.qa },
});

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to load document.";

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
  const [documents, setDocuments] = useState<TaskDocumentsState>(createInitialDocumentsState);
  const previousContext = useRef<{ taskCacheKey: string | null; open: boolean } | null>(null);
  const documentsRef = useRef<TaskDocumentsState>(documents);
  const cachedDocumentsByTaskCacheKey = useRef<Record<string, TaskDocumentsState>>({});
  const taskCacheKey = taskId ? `${cacheScope}::${taskId}` : null;
  const loadController = useRef(createTaskDocumentLoadController());

  const updateDocumentsSnapshot = useCallback(
    (snapshot: TaskDocumentsState): void => {
      documentsRef.current = snapshot;
      setDocuments(snapshot);
      if (!taskCacheKey) {
        return;
      }
      cachedDocumentsByTaskCacheKey.current[taskCacheKey] = cloneDocumentsState(snapshot);
    },
    [taskCacheKey],
  );

  documentsRef.current = documents;

  useEffect(() => {
    const contextDidChange =
      previousContext.current?.taskCacheKey !== taskCacheKey ||
      previousContext.current?.open !== open;
    if (!contextDidChange) {
      return;
    }

    previousContext.current = { taskCacheKey, open };
    resetTaskDocumentLoadController(loadController.current);
    const initialDocuments =
      taskCacheKey && cachedDocumentsByTaskCacheKey.current[taskCacheKey]
        ? cloneDocumentsState(cachedDocumentsByTaskCacheKey.current[taskCacheKey])
        : createInitialDocumentsState();
    documentsRef.current = initialDocuments;
    setDocuments(initialDocuments);
  }, [open, taskCacheKey]);

  const loadDocument = useCallback(
    function loadDocument(section: DocumentSectionKey, force: boolean): boolean {
      if (!taskId || !open) {
        return false;
      }

      const current = documentsRef.current[section];
      const loadRequest = requestTaskDocumentLoad(
        loadController.current,
        section,
        force,
        current.loaded,
      );
      if (!loadRequest.accepted) {
        return false;
      }
      if (loadRequest.contextVersion === null || loadRequest.requestVersion === null) {
        return true;
      }

      const loadingSnapshot: TaskDocumentsState = {
        ...documentsRef.current,
        [section]: {
          ...current,
          isLoading: true,
          error: null,
        },
      };
      updateDocumentsSnapshot(loadingSnapshot);

      const { contextVersion, requestVersion } = loadRequest;
      const loader: (id: string) => Promise<TaskDocumentPayload> =
        section === "spec"
          ? loadSpecDocument
          : section === "plan"
            ? loadPlanDocument
            : loadQaReportDocument;

      const replayPendingForcedReload = (shouldReplay: boolean): void => {
        if (!shouldReplay) {
          return;
        }

        globalThis.queueMicrotask(() => {
          loadDocument(section, true);
        });
      };

      void loader(taskId)
        .then((result) => {
          const settlement = settleTaskDocumentLoad(
            loadController.current,
            section,
            contextVersion,
            requestVersion,
          );
          if (!settlement.shouldApply) {
            replayPendingForcedReload(settlement.shouldReplay);
            return;
          }

          const successSnapshot: TaskDocumentsState = {
            ...documentsRef.current,
            [section]: resolveLoadedDocumentState(documentsRef.current[section], result),
          };
          updateDocumentsSnapshot(successSnapshot);
          replayPendingForcedReload(settlement.shouldReplay);
        })
        .catch((error: unknown) => {
          const settlement = settleTaskDocumentLoad(
            loadController.current,
            section,
            contextVersion,
            requestVersion,
          );
          if (!settlement.shouldApply) {
            replayPendingForcedReload(settlement.shouldReplay);
            return;
          }

          const errorSnapshot: TaskDocumentsState = {
            ...documentsRef.current,
            [section]: {
              ...documentsRef.current[section],
              isLoading: false,
              error: toErrorMessage(error),
              loaded: true,
            },
          };
          updateDocumentsSnapshot(errorSnapshot);
          replayPendingForcedReload(settlement.shouldReplay);
        });
      return true;
    },
    [
      loadPlanDocument,
      loadQaReportDocument,
      loadSpecDocument,
      open,
      taskId,
      updateDocumentsSnapshot,
    ],
  );

  const ensureDocumentLoaded = useCallback(
    (section: DocumentSectionKey): boolean => {
      return loadDocument(section, false);
    },
    [loadDocument],
  );

  const reloadDocument = useCallback(
    (section: DocumentSectionKey): boolean => {
      return loadDocument(section, true);
    },
    [loadDocument],
  );

  const applyDocumentUpdate = useCallback(
    (section: DocumentSectionKey, payload: TaskDocumentPayload): void => {
      supersedeTaskDocumentLoad(loadController.current, section);
      const snapshot: TaskDocumentsState = {
        ...documentsRef.current,
        [section]: {
          markdown: payload.markdown,
          updatedAt: payload.updatedAt,
          isLoading: false,
          error: null,
          loaded: true,
        },
      };
      updateDocumentsSnapshot(snapshot);
    },
    [updateDocumentsSnapshot],
  );

  return {
    specDoc: documents.spec,
    planDoc: documents.plan,
    qaDoc: documents.qa,
    ensureDocumentLoaded,
    reloadDocument,
    applyDocumentUpdate,
  };
}

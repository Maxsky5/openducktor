import { useCallback, useEffect, useRef, useState } from "react";
import { useSpecState } from "@/state";

export type DocumentSectionKey = "spec" | "plan" | "qa";

export type TaskDocumentState = {
  markdown: string;
  updatedAt: string | null;
  isLoading: boolean;
  error: string | null;
  loaded: boolean;
};

type TaskDocumentsState = Record<DocumentSectionKey, TaskDocumentState>;

type TaskDocumentPayload = {
  markdown: string;
  updatedAt: string | null;
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
): {
  specDoc: TaskDocumentState;
  planDoc: TaskDocumentState;
  qaDoc: TaskDocumentState;
  ensureDocumentLoaded: (section: DocumentSectionKey) => boolean;
  reloadDocument: (section: DocumentSectionKey) => boolean;
  applyDocumentUpdate: (section: DocumentSectionKey, payload: TaskDocumentPayload) => void;
} {
  const { loadSpecDocument, loadPlanDocument, loadQaReportDocument } = useSpecState();
  const [documents, setDocuments] = useState<TaskDocumentsState>(createInitialDocumentsState);
  const documentLoadSequence = useRef(0);
  const previousContext = useRef<{ taskId: string | null; open: boolean } | null>(null);
  const documentsRef = useRef<TaskDocumentsState>(documents);
  const cachedDocumentsByTaskId = useRef<Record<string, TaskDocumentsState>>({});
  const inFlightSections = useRef<Record<DocumentSectionKey, boolean>>({
    spec: false,
    plan: false,
    qa: false,
  });

  const updateDocumentsSnapshot = useCallback(
    (snapshot: TaskDocumentsState): void => {
      documentsRef.current = snapshot;
      setDocuments(snapshot);
      if (!taskId) {
        return;
      }
      cachedDocumentsByTaskId.current[taskId] = cloneDocumentsState(snapshot);
    },
    [taskId],
  );

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    const contextDidChange =
      previousContext.current?.taskId !== taskId || previousContext.current?.open !== open;
    if (!contextDidChange) {
      return;
    }

    previousContext.current = { taskId, open };
    documentLoadSequence.current += 1;
    const initialDocuments =
      taskId && cachedDocumentsByTaskId.current[taskId]
        ? cloneDocumentsState(cachedDocumentsByTaskId.current[taskId])
        : createInitialDocumentsState();
    documentsRef.current = initialDocuments;
    setDocuments(initialDocuments);
    inFlightSections.current = {
      spec: false,
      plan: false,
      qa: false,
    };
  }, [open, taskId]);

  const loadDocument = useCallback(
    (section: DocumentSectionKey, force: boolean): boolean => {
      if (!taskId || !open) {
        return false;
      }

      const current = documentsRef.current[section];
      if (inFlightSections.current[section] || (!force && current.loaded)) {
        return false;
      }
      inFlightSections.current[section] = true;

      const loadingSnapshot: TaskDocumentsState = {
        ...documentsRef.current,
        [section]: {
          ...current,
          isLoading: true,
          error: null,
        },
      };
      updateDocumentsSnapshot(loadingSnapshot);

      const sequence = documentLoadSequence.current;
      const loader: (id: string) => Promise<TaskDocumentPayload> =
        section === "spec"
          ? loadSpecDocument
          : section === "plan"
            ? loadPlanDocument
            : loadQaReportDocument;

      void loader(taskId)
        .then((result) => {
          if (sequence !== documentLoadSequence.current) {
            inFlightSections.current[section] = false;
            return;
          }

          inFlightSections.current[section] = false;
          const successSnapshot: TaskDocumentsState = {
            ...documentsRef.current,
            [section]: {
              markdown: result.markdown,
              updatedAt: result.updatedAt,
              isLoading: false,
              error: null,
              loaded: true,
            },
          };
          updateDocumentsSnapshot(successSnapshot);
        })
        .catch((error: unknown) => {
          if (sequence !== documentLoadSequence.current) {
            inFlightSections.current[section] = false;
            return;
          }

          inFlightSections.current[section] = false;
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

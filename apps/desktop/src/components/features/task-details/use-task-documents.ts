import { useSpecState } from "@/state";
import { useCallback, useEffect, useRef, useState } from "react";

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

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to load document.";

export function useTaskDocuments(
  taskId: string | null,
  open: boolean,
): {
  specDoc: TaskDocumentState;
  planDoc: TaskDocumentState;
  qaDoc: TaskDocumentState;
  ensureDocumentLoaded: (section: DocumentSectionKey) => void;
} {
  const { loadSpecDocument, loadPlanDocument, loadQaReportDocument } = useSpecState();
  const [documents, setDocuments] = useState<TaskDocumentsState>(createInitialDocumentsState);
  const documentLoadSequence = useRef(0);
  const previousContext = useRef<{ taskId: string | null; open: boolean } | null>(null);

  useEffect(() => {
    const contextDidChange =
      previousContext.current?.taskId !== taskId || previousContext.current?.open !== open;
    if (!contextDidChange) {
      return;
    }

    previousContext.current = { taskId, open };
    documentLoadSequence.current += 1;
    setDocuments(createInitialDocumentsState());
  }, [open, taskId]);

  const ensureDocumentLoaded = useCallback(
    (section: DocumentSectionKey): void => {
      if (!taskId || !open) {
        return;
      }

      let shouldLoad = false;
      setDocuments((previous) => {
        const current = previous[section];
        if (current.loaded || current.isLoading) {
          return previous;
        }

        shouldLoad = true;
        return {
          ...previous,
          [section]: { ...current, isLoading: true, error: null },
        };
      });

      if (!shouldLoad) {
        return;
      }

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
            return;
          }

          setDocuments((previous) => ({
            ...previous,
            [section]: {
              markdown: result.markdown,
              updatedAt: result.updatedAt,
              isLoading: false,
              error: null,
              loaded: true,
            },
          }));
        })
        .catch((error: unknown) => {
          if (sequence !== documentLoadSequence.current) {
            return;
          }

          setDocuments((previous) => ({
            ...previous,
            [section]: {
              markdown: "",
              updatedAt: null,
              isLoading: false,
              error: toErrorMessage(error),
              loaded: true,
            },
          }));
        });
    },
    [loadPlanDocument, loadQaReportDocument, loadSpecDocument, open, taskId],
  );

  return {
    specDoc: documents.spec,
    planDoc: documents.plan,
    qaDoc: documents.qa,
    ensureDocumentLoaded,
  };
}

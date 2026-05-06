import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentEditorView } from "@/types/task-composer";

export type TaskDocumentSection = "spec" | "plan";

type DocumentSectionState = {
  serverMarkdown: string;
  draftMarkdown: string;
  updatedAt: string | null;
  isLoading: boolean;
  loaded: boolean;
  error: string | null;
};

type TaskDocumentEditorState = Record<TaskDocumentSection, DocumentSectionState>;
type TaskDocumentViewState = Record<TaskDocumentSection, DocumentEditorView>;

type TaskDocumentPayload = {
  markdown: string;
  updatedAt: string | null;
  error?: string | null;
};

type UseTaskDocumentEditorStateArgs = {
  open: boolean;
  taskId: string | null;
  activeSection: TaskDocumentSection | null;
  loadSpecDocument: (taskId: string) => Promise<TaskDocumentPayload>;
  loadPlanDocument: (taskId: string) => Promise<TaskDocumentPayload>;
  loadTimeoutMs?: number;
};

type UseTaskDocumentEditorStateResult = {
  documents: TaskDocumentEditorState;
  views: TaskDocumentViewState;
  loadSection: (section: TaskDocumentSection, force?: boolean) => Promise<void>;
  setView: (section: TaskDocumentSection, view: DocumentEditorView) => void;
  updateDraft: (section: TaskDocumentSection, markdown: string) => void;
  discardDraft: (section: TaskDocumentSection) => void;
  applySaved: (section: TaskDocumentSection, markdown: string, updatedAt: string) => void;
};

const DOCUMENT_LOAD_TIMEOUT_MS = 15000;

const createInitialDocumentState = (): TaskDocumentEditorState => ({
  spec: {
    serverMarkdown: "",
    draftMarkdown: "",
    updatedAt: null,
    isLoading: false,
    loaded: false,
    error: null,
  },
  plan: {
    serverMarkdown: "",
    draftMarkdown: "",
    updatedAt: null,
    isLoading: false,
    loaded: false,
    error: null,
  },
});

const createInitialViewState = (): TaskDocumentViewState => ({
  spec: "split",
  plan: "split",
});

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("Timed out while loading the document."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
};

const toErrorMessage = (reason: unknown): string =>
  reason instanceof Error ? reason.message : "Unable to load document.";

export function useTaskDocumentEditorState({
  open,
  taskId,
  activeSection,
  loadSpecDocument,
  loadPlanDocument,
  loadTimeoutMs = DOCUMENT_LOAD_TIMEOUT_MS,
}: UseTaskDocumentEditorStateArgs): UseTaskDocumentEditorStateResult {
  const [documents, setDocuments] = useState<TaskDocumentEditorState>(createInitialDocumentState);
  const [views, setViews] = useState<TaskDocumentViewState>(createInitialViewState);
  const previousContext = useRef<{ open: boolean; taskId: string | null } | null>(null);
  const loadSequence = useRef(0);
  const documentsRef = useRef<TaskDocumentEditorState>(documents);
  const inFlightSections = useRef<Record<TaskDocumentSection, boolean>>({
    spec: false,
    plan: false,
  });
  const nextLoadRequestId = useRef(0);
  const activeLoadRequestIds = useRef<Record<TaskDocumentSection, number | null>>({
    spec: null,
    plan: null,
  });

  documentsRef.current = documents;

  const transitionDocumentSection = useCallback(
    (
      section: TaskDocumentSection,
      update: (current: DocumentSectionState) => DocumentSectionState,
    ): void => {
      const snapshot: TaskDocumentEditorState = {
        ...documentsRef.current,
        [section]: update(documentsRef.current[section]),
      };
      documentsRef.current = snapshot;
      setDocuments(snapshot);
    },
    [],
  );

  useEffect(() => {
    const contextChanged =
      previousContext.current?.open !== open || previousContext.current?.taskId !== taskId;
    if (!contextChanged) {
      return;
    }

    previousContext.current = { open, taskId };
    loadSequence.current += 1;
    if (!open) {
      return;
    }
    const initialDocuments = createInitialDocumentState();
    documentsRef.current = initialDocuments;
    setDocuments(initialDocuments);
    setViews(createInitialViewState());
    inFlightSections.current = {
      spec: false,
      plan: false,
    };
    activeLoadRequestIds.current = {
      spec: null,
      plan: null,
    };
  }, [open, taskId]);

  const loadSection = useCallback(
    async (section: TaskDocumentSection, force = false): Promise<void> => {
      if (!open || !taskId) {
        return;
      }

      const current = documentsRef.current[section];
      if (inFlightSections.current[section] || (!force && current.loaded)) {
        return;
      }

      inFlightSections.current[section] = true;
      nextLoadRequestId.current += 1;
      const requestId = nextLoadRequestId.current;
      activeLoadRequestIds.current[section] = requestId;
      transitionDocumentSection(section, (currentSection) => ({
        ...currentSection,
        isLoading: true,
        error: null,
      }));

      const isCurrentRequest = (): boolean => activeLoadRequestIds.current[section] === requestId;
      const clearCurrentRequest = (): void => {
        if (!isCurrentRequest()) {
          return;
        }
        activeLoadRequestIds.current[section] = null;
        inFlightSections.current[section] = false;
      };

      const sequence = loadSequence.current;
      try {
        const payload = await withTimeout(
          section === "spec" ? loadSpecDocument(taskId) : loadPlanDocument(taskId),
          loadTimeoutMs,
        );
        if (sequence !== loadSequence.current) {
          clearCurrentRequest();
          return;
        }

        if (!isCurrentRequest()) {
          return;
        }
        clearCurrentRequest();
        transitionDocumentSection(section, () => ({
          serverMarkdown: payload.markdown,
          draftMarkdown: payload.markdown,
          updatedAt: payload.updatedAt,
          isLoading: false,
          loaded: true,
          error: payload.error ?? null,
        }));
      } catch (reason) {
        if (sequence !== loadSequence.current) {
          clearCurrentRequest();
          return;
        }

        if (!isCurrentRequest()) {
          return;
        }
        clearCurrentRequest();
        transitionDocumentSection(section, (currentSection) => ({
          ...currentSection,
          isLoading: false,
          loaded: false,
          error: toErrorMessage(reason),
        }));
      }
    },
    [loadPlanDocument, loadSpecDocument, loadTimeoutMs, open, taskId, transitionDocumentSection],
  );

  useEffect(() => {
    if (!activeSection) {
      return;
    }
    void loadSection(activeSection);
  }, [activeSection, loadSection]);

  const setView = useCallback((section: TaskDocumentSection, view: DocumentEditorView): void => {
    setViews((state) => ({
      ...state,
      [section]: view,
    }));
  }, []);

  const updateDraft = useCallback((section: TaskDocumentSection, markdown: string): void => {
    const snapshot: TaskDocumentEditorState = {
      ...documentsRef.current,
      [section]: {
        ...documentsRef.current[section],
        draftMarkdown: markdown,
      },
    };
    documentsRef.current = snapshot;
    setDocuments(snapshot);
  }, []);

  const discardDraft = useCallback((section: TaskDocumentSection): void => {
    const snapshot: TaskDocumentEditorState = {
      ...documentsRef.current,
      [section]: {
        ...documentsRef.current[section],
        draftMarkdown: documentsRef.current[section].serverMarkdown,
      },
    };
    documentsRef.current = snapshot;
    setDocuments(snapshot);
  }, []);

  const applySaved = useCallback(
    (section: TaskDocumentSection, markdown: string, updatedAt: string): void => {
      const snapshot: TaskDocumentEditorState = {
        ...documentsRef.current,
        [section]: {
          ...documentsRef.current[section],
          serverMarkdown: markdown,
          draftMarkdown: markdown,
          updatedAt,
          loaded: true,
          isLoading: false,
          error: null,
        },
      };
      documentsRef.current = snapshot;
      setDocuments(snapshot);
    },
    [],
  );

  return {
    documents,
    views,
    loadSection,
    setView,
    updateDraft,
    discardDraft,
    applySaved,
  };
}

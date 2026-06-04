import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
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

type TaskDocumentEditorContext = {
  open: boolean;
  taskId: string | null;
};

type TaskDocumentEditorLocalState = {
  context: TaskDocumentEditorContext;
  documents: TaskDocumentEditorState;
  views: TaskDocumentViewState;
};

type TaskDocumentEditorAction =
  | {
      type: "sectionLoadStarted";
      context: TaskDocumentEditorContext;
      section: TaskDocumentSection;
    }
  | {
      type: "sectionLoadSucceeded";
      context: TaskDocumentEditorContext;
      payload: TaskDocumentPayload;
      section: TaskDocumentSection;
    }
  | {
      type: "sectionLoadFailed";
      context: TaskDocumentEditorContext;
      error: string;
      section: TaskDocumentSection;
    }
  | {
      type: "viewSet";
      context: TaskDocumentEditorContext;
      section: TaskDocumentSection;
      view: DocumentEditorView;
    }
  | {
      type: "draftUpdated";
      context: TaskDocumentEditorContext;
      markdown: string;
      section: TaskDocumentSection;
    }
  | {
      type: "draftDiscarded";
      context: TaskDocumentEditorContext;
      section: TaskDocumentSection;
    }
  | {
      type: "savedApplied";
      context: TaskDocumentEditorContext;
      markdown: string;
      section: TaskDocumentSection;
      updatedAt: string;
    };

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

const createTaskDocumentEditorLocalState = (
  context: TaskDocumentEditorContext,
): TaskDocumentEditorLocalState => ({
  context,
  documents: createInitialDocumentState(),
  views: createInitialViewState(),
});

const getTaskDocumentEditorStateForContext = (
  state: TaskDocumentEditorLocalState,
  context: TaskDocumentEditorContext,
): TaskDocumentEditorLocalState =>
  state.context === context ? state : createTaskDocumentEditorLocalState(context);

const updateDocumentSection = (
  documents: TaskDocumentEditorState,
  section: TaskDocumentSection,
  update: (current: DocumentSectionState) => DocumentSectionState,
): TaskDocumentEditorState => ({
  ...documents,
  [section]: update(documents[section]),
});

const taskDocumentEditorReducer = (
  state: TaskDocumentEditorLocalState,
  action: TaskDocumentEditorAction,
): TaskDocumentEditorLocalState => {
  const currentState = getTaskDocumentEditorStateForContext(state, action.context);

  switch (action.type) {
    case "sectionLoadStarted":
      return {
        ...currentState,
        documents: updateDocumentSection(currentState.documents, action.section, (section) => ({
          ...section,
          isLoading: true,
          error: null,
        })),
      };
    case "sectionLoadSucceeded":
      return {
        ...currentState,
        documents: updateDocumentSection(currentState.documents, action.section, () => ({
          serverMarkdown: action.payload.markdown,
          draftMarkdown: action.payload.markdown,
          updatedAt: action.payload.updatedAt,
          isLoading: false,
          loaded: true,
          error: action.payload.error ?? null,
        })),
      };
    case "sectionLoadFailed":
      return {
        ...currentState,
        documents: updateDocumentSection(currentState.documents, action.section, (section) => ({
          ...section,
          isLoading: false,
          loaded: false,
          error: action.error,
        })),
      };
    case "viewSet":
      return {
        ...currentState,
        views: {
          ...currentState.views,
          [action.section]: action.view,
        },
      };
    case "draftUpdated":
      return {
        ...currentState,
        documents: updateDocumentSection(currentState.documents, action.section, (section) => ({
          ...section,
          draftMarkdown: action.markdown,
        })),
      };
    case "draftDiscarded":
      return {
        ...currentState,
        documents: updateDocumentSection(currentState.documents, action.section, (section) => ({
          ...section,
          draftMarkdown: section.serverMarkdown,
        })),
      };
    case "savedApplied":
      return {
        ...currentState,
        documents: updateDocumentSection(currentState.documents, action.section, (section) => ({
          ...section,
          serverMarkdown: action.markdown,
          draftMarkdown: action.markdown,
          updatedAt: action.updatedAt,
          loaded: true,
          isLoading: false,
          error: null,
        })),
      };
  }
};

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
  const editorContext = useMemo<TaskDocumentEditorContext>(
    () => ({ open, taskId }),
    [open, taskId],
  );
  const [localState, dispatchLocalState] = useReducer(
    taskDocumentEditorReducer,
    editorContext,
    createTaskDocumentEditorLocalState,
  );
  const currentState = getTaskDocumentEditorStateForContext(localState, editorContext);
  const contextRef = useRef(editorContext);
  const documentsRef = useRef<TaskDocumentEditorState>(currentState.documents);
  const inFlightSectionsByContextRef = useRef<WeakMap<
    TaskDocumentEditorContext,
    Record<TaskDocumentSection, boolean>
  > | null>(null);
  if (inFlightSectionsByContextRef.current === null) {
    inFlightSectionsByContextRef.current = new WeakMap<
      TaskDocumentEditorContext,
      Record<TaskDocumentSection, boolean>
    >();
  }

  contextRef.current = editorContext;
  documentsRef.current = currentState.documents;

  const getInFlightSectionsForContext = useCallback(
    (context: TaskDocumentEditorContext): Record<TaskDocumentSection, boolean> => {
      const sectionsByContext = inFlightSectionsByContextRef.current;
      if (sectionsByContext === null) {
        throw new Error("Expected task document in-flight section map to be initialized.");
      }

      const currentSections = sectionsByContext.get(context);
      if (currentSections) {
        return currentSections;
      }

      const nextSections = {
        spec: false,
        plan: false,
      };
      sectionsByContext.set(context, nextSections);
      return nextSections;
    },
    [],
  );

  const loadSection = useCallback(
    (section: TaskDocumentSection, force = false): Promise<void> => {
      if (!open || !taskId) {
        return Promise.resolve();
      }

      const loadContext = contextRef.current;
      const inFlightSections = getInFlightSectionsForContext(loadContext);
      const current = documentsRef.current[section];
      if (inFlightSections[section] || (!force && current.loaded)) {
        return Promise.resolve();
      }

      inFlightSections[section] = true;
      dispatchLocalState({
        type: "sectionLoadStarted",
        context: loadContext,
        section,
      });

      return withTimeout(
        section === "spec" ? loadSpecDocument(taskId) : loadPlanDocument(taskId),
        loadTimeoutMs,
      )
        .then((payload) => {
          if (loadContext !== contextRef.current) {
            return;
          }
          getInFlightSectionsForContext(loadContext)[section] = false;
          dispatchLocalState({
            type: "sectionLoadSucceeded",
            context: loadContext,
            payload,
            section,
          });
        })
        .catch((reason) => {
          if (loadContext !== contextRef.current) {
            return;
          }
          getInFlightSectionsForContext(loadContext)[section] = false;
          dispatchLocalState({
            type: "sectionLoadFailed",
            context: loadContext,
            error: toErrorMessage(reason),
            section,
          });
        });
    },
    [
      getInFlightSectionsForContext,
      loadPlanDocument,
      loadSpecDocument,
      loadTimeoutMs,
      open,
      taskId,
    ],
  );

  useEffect(() => {
    if (!activeSection) {
      return;
    }
    void loadSection(activeSection);
  }, [activeSection, loadSection]);

  const setView = useCallback(
    (section: TaskDocumentSection, view: DocumentEditorView): void => {
      dispatchLocalState({
        type: "viewSet",
        context: editorContext,
        section,
        view,
      });
    },
    [editorContext],
  );

  const updateDraft = useCallback(
    (section: TaskDocumentSection, markdown: string): void => {
      dispatchLocalState({
        type: "draftUpdated",
        context: editorContext,
        markdown,
        section,
      });
    },
    [editorContext],
  );

  const discardDraft = useCallback(
    (section: TaskDocumentSection): void => {
      dispatchLocalState({
        type: "draftDiscarded",
        context: editorContext,
        section,
      });
    },
    [editorContext],
  );

  const applySaved = useCallback(
    (section: TaskDocumentSection, markdown: string, updatedAt: string): void => {
      dispatchLocalState({
        type: "savedApplied",
        context: editorContext,
        markdown,
        section,
        updatedAt,
      });
    },
    [editorContext],
  );

  return {
    documents: currentState.documents,
    views: currentState.views,
    loadSection,
    setView,
    updateDraft,
    discardDraft,
    applySaved,
  };
}

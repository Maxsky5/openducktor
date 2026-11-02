import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { TASK_DOCUMENT_STALE_TIME_MS, documentQueryKeys } from "../../queries/documents";
import { byDocumentCode, type BuiltinDocumentCode } from "@openducktor/workflows";
import { useCallback, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import type { DocumentEditorView } from "./task-composer-types";

/** The workflow documents that the composer edits. */
export type TaskDocumentSection = BuiltinDocumentCode;

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
  repoPath: string | null;
  activeSection: TaskDocumentSection | null;
  loadDocument: (taskId: string, code: TaskDocumentSection) => Promise<TaskDocumentPayload>;
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
  repoPath: string | null;
  queryClient: QueryClient;
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

const createInitialDocumentState = (context: TaskDocumentEditorContext): TaskDocumentEditorState =>
  byDocumentCode((code) => {
    const cached = freshDocument(context, code);
    return {
      serverMarkdown: cached?.markdown ?? "",
      draftMarkdown: cached?.markdown ?? "",
      updatedAt: cached?.updatedAt ?? null,
      isLoading: false,
      // Check freshness again when this section first opens.
      loaded: false,
      error: cached?.error ?? null,
    };
  });

const createInitialViewState = (): TaskDocumentViewState => byDocumentCode(() => "split");

const createTaskDocumentEditorLocalState = (
  context: TaskDocumentEditorContext,
): TaskDocumentEditorLocalState => ({
  context,
  documents: createInitialDocumentState(context),
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
) =>
  ({
    ...documents,
    [section]: update(documents[section]),
  }) satisfies TaskDocumentEditorState;

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
          reject(new Error("Timed out while loading the artifact."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
};

const toErrorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Unable to load artifact.";

export function useTaskDocumentEditorState({
  open,
  taskId,
  repoPath,
  activeSection,
  loadDocument,
  loadTimeoutMs = DOCUMENT_LOAD_TIMEOUT_MS,
}: UseTaskDocumentEditorStateArgs): UseTaskDocumentEditorStateResult {
  const queryClient = useQueryClient();
  const editorContext = useMemo<TaskDocumentEditorContext>(
    () => ({ open, taskId, repoPath, queryClient }),
    [open, taskId, repoPath, queryClient],
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

  // Update the context and documents before a section load starts.
  useLayoutEffect(() => {
    contextRef.current = editorContext;
    documentsRef.current = currentState.documents;
  }, [currentState.documents, editorContext]);

  const getInFlightSectionsForContext = useCallback((context: TaskDocumentEditorContext) => {
    const sectionsByContext = inFlightSectionsByContextRef.current;
    if (sectionsByContext === null) {
      throw new Error("Expected task document in-flight section map to be initialized.");
    }

    const currentSections = sectionsByContext.get(context);
    if (currentSections) {
      return currentSections satisfies Record<TaskDocumentSection, boolean>;
    }

    const nextSections = byDocumentCode(() => false);
    sectionsByContext.set(context, nextSections);
    return nextSections satisfies Record<TaskDocumentSection, boolean>;
  }, []);

  const loadSection = useCallback(
    (section: TaskDocumentSection, force = false): Promise<void> => {
      const loadContext = editorContext;
      if (!loadContext.open || !loadContext.taskId || loadContext !== contextRef.current) {
        return Promise.resolve();
      }

      const inFlightSections = getInFlightSectionsForContext(loadContext);
      const current = documentsRef.current[section];
      if (inFlightSections[section] || (!force && current.loaded)) {
        return Promise.resolve();
      }

      const cached = force ? undefined : freshDocument(loadContext, section);
      if (cached) {
        dispatchLocalState({
          type: "sectionLoadSucceeded",
          context: loadContext,
          payload: cached,
          section,
        });
        return Promise.resolve();
      }

      inFlightSections[section] = true;
      dispatchLocalState({
        type: "sectionLoadStarted",
        context: loadContext,
        section,
      });

      return withTimeout(loadDocument(loadContext.taskId, section), loadTimeoutMs)
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
    [getInFlightSectionsForContext, editorContext, loadDocument, loadTimeoutMs],
  );

  useLayoutEffect(() => {
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

/** Read only data that fetchQuery would treat as fresh. */
function freshDocument(
  context: TaskDocumentEditorContext,
  code: TaskDocumentSection,
): TaskDocumentPayload | undefined {
  if (!context.open || !context.repoPath || !context.taskId) return undefined;
  const query = context.queryClient.getQueryCache().find({
    queryKey: documentQueryKeys.document(context.repoPath, context.taskId, code),
    exact: true,
  });
  return query && !query.isStaleByTime(TASK_DOCUMENT_STALE_TIME_MS)
    ? context.queryClient.getQueryData<TaskDocumentPayload>(query.queryKey)
    : undefined;
}

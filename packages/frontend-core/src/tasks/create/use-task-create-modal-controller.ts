import {
  byDocumentCode,
  type BuiltinIssueTypeId as IssueType,
  type BuiltinTaskCard as TaskCard,
} from "@openducktor/workflows";
import type { TaskAssetFailure } from "@openducktor/contracts";
import {
  type Dispatch,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import {
  DocumentStateContext,
  TasksStateContext,
  useActiveWorkspaceContext,
  useRequiredContext,
} from "../../app-state/app-state-contexts";
import { useClientConnection } from "../../connection/client-connection-react";
import { isOutcomeUnknown } from "../../lib/command-outcome";
import { errorMessage } from "../../lib/errors";
import { useSingleFlight } from "../../lib/use-single-flight";
import type { TasksStateContextValue } from "../../types/state-slices";
import { selectSubmittedTaskDescriptionAssets } from "../description/task-description-assets";
import {
  type TaskDescriptionAssetDraftControls,
  useTaskDescriptionAssetDraft,
} from "../description/use-task-description-asset-draft";
import {
  formatTaskAssetFailure,
  taskAssetFailureFromError,
  taskAssetFailureRequiresLock,
} from "../operations/task-asset-failure-recovery";
import {
  type TaskDescriptionImageFile,
  useTaskDescriptionAssetOperations,
} from "../operations/use-task-description-asset-operations";
import {
  collectKnownLabels,
  toComposerState,
  toPrioritySelectOptions,
} from "./task-composer-options";
import type {
  ComposerMode,
  ComposerState,
  ComposerStep,
  EditTaskSection,
} from "./task-composer-types";
import {
  hasUnsavedDocumentChanges,
  isDocumentNewerOnHost,
  isDocumentSection,
  toTaskCreateInput,
  toTaskUpdatePatch,
} from "./task-create-modal-model";
import {
  type TaskDocumentSection,
  useTaskDocumentEditorState,
} from "./use-task-document-editor-state";

type DocumentSection = TaskDocumentSection;

type PendingDiscardIntent =
  | { type: "close-modal" }
  | { type: "switch-section"; next: EditTaskSection };

/** The workspace that was active when New task opened. A new task is created only there. */
export type TaskCreateDestination = { workspaceId: string; workspaceName: string };

export type TaskCreateModalControllerOptions<F extends TaskDescriptionImageFile> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: TaskCard[];
  task: TaskCard | null;
  destination?: TaskCreateDestination | null;
  /** The title of a new task when the modal opens. Edit mode ignores it. */
  initialTitle?: string;
  initialEditSection?: EditTaskSection;
  /** Reads a picked description image as base64. Pass a stable function. */
  readFileBase64: (file: F) => Promise<string>;
  /** A URL that shows a staged image before the save. */
  createPreviewUrl: (file: F) => string;
  revokePreviewUrl: (url: string) => void;
  /** The task asset IDs that the images of a Markdown description use. */
  collectAssetIds: (markdown: string) => Set<string>;
};

/** A save error. `outcomeUnknown` is true when the connection lost the result of the save. */
type TaskCreateModalError = { message: string; outcomeUnknown: boolean };

type TaskCreateModalState = {
  step: ComposerStep;
  editSection: EditTaskSection;
  composer: ComposerState;
  selectedCreateIssueType: IssueType | null;
  error: TaskCreateModalError | null;
  documentError: TaskCreateModalError | null;
  isSubmitting: boolean;
  isSavingDocument: DocumentSection | null;
  pendingDiscardIntent: PendingDiscardIntent | null;
  taskAssetFailure: TaskAssetFailure | null;
  hasExternalTaskConflict: boolean;
};

type TaskCreateModalAction =
  | {
      type: "resetForOpenTask";
      task: TaskCard | null;
      initialTitle: string;
      initialEditSection: EditTaskSection;
    }
  | { type: "externalTaskApplied"; composer: ComposerState }
  | { type: "externalTaskConflictDetected" }
  | { type: "composerPatched"; patch: Partial<ComposerState> }
  | { type: "issueTypeSelected"; issueType: IssueType }
  | { type: "stepChanged"; step: ComposerStep }
  | { type: "documentErrorCleared" }
  | { type: "discardIntentSet"; intent: PendingDiscardIntent }
  | { type: "sectionChanged"; section: EditTaskSection }
  | { type: "submitBlocked"; error: string }
  | { type: "submitStarted" }
  | {
      type: "submitFailed";
      error: TaskCreateModalError;
      taskAssetFailure: TaskAssetFailure | null;
    }
  | { type: "submitFinished" }
  | { type: "documentSaveStarted"; section: DocumentSection }
  | { type: "documentSaveFailed"; error: TaskCreateModalError }
  | { type: "documentSaveFinished" }
  | { type: "discardIntentCleared" };

/** The composer that an editor starts from: the saved task, or a new task with its title. */
const startComposer = (task: TaskCard | null, initialTitle: string): ComposerState =>
  task ? toComposerState(task) : { ...toComposerState(null), title: initialTitle };

const initialTaskCreateModalState = (
  task: TaskCard | null,
  initialTitle = "",
  initialEditSection: EditTaskSection = "details",
): TaskCreateModalState => ({
  step: task ? "details" : "type",
  editSection: task ? initialEditSection : "details",
  composer: startComposer(task, initialTitle),
  selectedCreateIssueType: task?.issueType ?? null,
  error: null,
  documentError: null,
  isSubmitting: false,
  isSavingDocument: null,
  pendingDiscardIntent: null,
  taskAssetFailure: null,
  hasExternalTaskConflict: false,
});

const areComposerStatesEqual = (left: ComposerState, right: ComposerState): boolean =>
  left.issueType === right.issueType &&
  left.title === right.title &&
  left.priority === right.priority &&
  left.description === right.description &&
  left.labels.length === right.labels.length &&
  left.labels.every((label, index) => label === right.labels[index]);

const EXTERNAL_TASK_CONFLICT_MESSAGE =
  "This task changed while you were editing. Close and reopen it to load the latest version before saving.";

const EXTERNAL_DOCUMENT_CONFLICT_MESSAGE =
  "This document changed on the host while you were editing. Your edits are kept. Copy what you need, then close and reopen the task to load the latest version.";

const taskCreateModalReducer = (
  state: TaskCreateModalState,
  action: TaskCreateModalAction,
): TaskCreateModalState => {
  switch (action.type) {
    case "resetForOpenTask":
      return initialTaskCreateModalState(
        action.task,
        action.initialTitle,
        action.initialEditSection,
      );
    case "externalTaskApplied":
      return {
        ...state,
        composer: action.composer,
        selectedCreateIssueType: action.composer.issueType,
        error: null,
        taskAssetFailure: null,
        hasExternalTaskConflict: false,
      };
    case "externalTaskConflictDetected":
      return { ...state, hasExternalTaskConflict: true };
    case "composerPatched":
      return { ...state, composer: { ...state.composer, ...action.patch } };
    case "issueTypeSelected":
      return {
        ...state,
        selectedCreateIssueType: action.issueType,
        composer: { ...state.composer, issueType: action.issueType },
        step: "details",
      };
    case "stepChanged":
      return { ...state, step: action.step };
    case "documentErrorCleared":
      return { ...state, documentError: null };
    case "discardIntentSet":
      return { ...state, pendingDiscardIntent: action.intent };
    case "sectionChanged":
      return { ...state, editSection: action.section, documentError: null };
    case "submitBlocked":
      return { ...state, error: { message: action.error, outcomeUnknown: false } };
    case "submitStarted":
      return {
        ...state,
        error: null,
        documentError: null,
        taskAssetFailure: null,
        isSubmitting: true,
      };
    case "submitFailed":
      return { ...state, error: action.error, taskAssetFailure: action.taskAssetFailure };
    case "submitFinished":
      return { ...state, isSubmitting: false };
    case "documentSaveStarted":
      return { ...state, error: null, documentError: null, isSavingDocument: action.section };
    case "documentSaveFailed":
      return { ...state, documentError: action.error };
    case "documentSaveFinished":
      return { ...state, isSavingDocument: null };
    case "discardIntentCleared":
      return { ...state, pendingDiscardIntent: null };
  }
};

function useExternalTaskSync({
  open,
  task,
  taskId,
  initialTitle,
  initialEditSection,
  composer,
  dispatch,
}: {
  open: boolean;
  task: TaskCard | null;
  taskId: string | null;
  initialTitle: string;
  initialEditSection: EditTaskSection;
  composer: ComposerState;
  dispatch: Dispatch<TaskCreateModalAction>;
}): void {
  const previousModalContext = useRef<{ open: boolean; taskId: string | null } | null>(null);
  const serverComposer = useRef<ComposerState | null>(null);

  useEffect(() => {
    const nextServerComposer = toComposerState(task);
    const contextChanged =
      previousModalContext.current?.open !== open ||
      previousModalContext.current?.taskId !== taskId;
    if (contextChanged) {
      previousModalContext.current = { open, taskId };
      serverComposer.current = nextServerComposer;
      if (open) dispatch({ type: "resetForOpenTask", task, initialTitle, initialEditSection });
      return;
    }
    if (!open) return;

    const previousServerComposer = serverComposer.current;
    if (
      previousServerComposer === null ||
      areComposerStatesEqual(previousServerComposer, nextServerComposer)
    )
      return;

    serverComposer.current = nextServerComposer;
    const draftWasUntouched = areComposerStatesEqual(composer, previousServerComposer);
    const draftMatchesReplacement = areComposerStatesEqual(composer, nextServerComposer);
    dispatch(
      draftWasUntouched || draftMatchesReplacement
        ? { type: "externalTaskApplied", composer: nextServerComposer }
        : { type: "externalTaskConflictDetected" },
    );
  }, [composer, dispatch, initialTitle, initialEditSection, open, task, taskId]);
}

function createTaskSubmit({
  collectAssetIds,
  composer,
  createTask,
  descriptionAssetDraft,
  destinationError,
  dispatch,
  hasExternalTaskConflict,
  isRecoveryBlocked,
  mode,
  onCleanupFailure,
  onOpenChange,
  task,
  updateTask,
  workspaceRepoPath,
}: {
  collectAssetIds: (markdown: string) => Set<string>;
  composer: ComposerState;
  createTask: TasksStateContextValue["createTask"];
  descriptionAssetDraft: TaskDescriptionAssetDraftControls;
  destinationError: string | null;
  dispatch: Dispatch<TaskCreateModalAction>;
  hasExternalTaskConflict: boolean;
  isRecoveryBlocked: boolean;
  mode: ComposerMode;
  onCleanupFailure: (description: string) => void;
  onOpenChange: (open: boolean) => void;
  task: TaskCard | null;
  updateTask: TasksStateContextValue["updateTask"];
  workspaceRepoPath: string | null;
}): () => Promise<void> {
  return async () => {
    if (isRecoveryBlocked || hasExternalTaskConflict) return;
    if (destinationError) {
      dispatch({ type: "submitBlocked", error: destinationError });
      return;
    }
    if (descriptionAssetDraft.isUploading) {
      dispatch({
        type: "submitBlocked",
        error: "Wait for description image uploads to finish before saving.",
      });
      return;
    }
    if (!workspaceRepoPath) {
      dispatch({ type: "submitBlocked", error: "Select a repository before creating tasks." });
      return;
    }
    if (!composer.title.trim()) {
      dispatch({ type: "submitBlocked", error: "Title is required." });
      return;
    }

    dispatch({ type: "submitStarted" });
    try {
      const referencedAssetIds = collectAssetIds(composer.description);
      const suppliedAssetIds = selectSubmittedTaskDescriptionAssets(
        referencedAssetIds,
        descriptionAssetDraft.stagedAssetIds(),
      );
      const descriptionAssets =
        suppliedAssetIds.length > 0 ? { stagedAssetIds: suppliedAssetIds } : undefined;
      if (mode === "create") {
        await createTask(toTaskCreateInput(composer), descriptionAssets);
      } else if (task) {
        await updateTask(task.id, toTaskUpdatePatch(composer), descriptionAssets);
      }
      try {
        await descriptionAssetDraft.reconcileSuccessfulSave(referencedAssetIds);
      } catch (reason) {
        onCleanupFailure(`${errorMessage(reason)} Refresh before continuing.`);
      }
      onOpenChange(false);
    } catch (reason) {
      const failure = taskAssetFailureFromError(reason);
      dispatch({
        type: "submitFailed",
        error: {
          message: failure ? formatTaskAssetFailure(failure) : errorMessage(reason),
          outcomeUnknown: isOutcomeUnknown(reason),
        },
        taskAssetFailure: failure,
      });
    } finally {
      dispatch({ type: "submitFinished" });
    }
  };
}

function createDocumentNavigationActions({
  activeDocumentSection,
  descriptionAssetDraft,
  discardDocumentDraft,
  dispatch,
  editSection,
  hasUnsavedActiveDocument,
  isBusy,
  loadDocumentSection,
  onDiscardFailure,
  onOpenChange,
  pendingDiscardIntent,
}: {
  activeDocumentSection: DocumentSection | null;
  descriptionAssetDraft: TaskDescriptionAssetDraftControls;
  discardDocumentDraft: ReturnType<typeof useTaskDocumentEditorState>["discardDraft"];
  dispatch: Dispatch<TaskCreateModalAction>;
  editSection: EditTaskSection;
  hasUnsavedActiveDocument: boolean;
  isBusy: boolean;
  loadDocumentSection: ReturnType<typeof useTaskDocumentEditorState>["loadSection"];
  onDiscardFailure: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  pendingDiscardIntent: PendingDiscardIntent | null;
}) {
  const discardCurrentDocumentDraft = (): void => {
    if (!activeDocumentSection) return;
    discardDocumentDraft(activeDocumentSection);
    dispatch({ type: "documentErrorCleared" });
  };

  const requestSectionChange = (next: EditTaskSection): void => {
    if (next === editSection || isBusy) return;
    if (hasUnsavedActiveDocument) {
      dispatch({ type: "discardIntentSet", intent: { type: "switch-section", next } });
      return;
    }
    dispatch({ type: "sectionChanged", section: next });
    if (isDocumentSection(next)) void loadDocumentSection(next);
  };

  const confirmDiscard = async (): Promise<void> => {
    if (!pendingDiscardIntent) return;
    discardCurrentDocumentDraft();
    if (pendingDiscardIntent.type === "close-modal") {
      try {
        await descriptionAssetDraft.discardAll();
        onOpenChange(false);
      } catch (reason) {
        onDiscardFailure(errorMessage(reason));
      }
    } else {
      dispatch({ type: "sectionChanged", section: pendingDiscardIntent.next });
      if (isDocumentSection(pendingDiscardIntent.next)) {
        void loadDocumentSection(pendingDiscardIntent.next);
      }
    }
    dispatch({ type: "discardIntentCleared" });
  };

  return { discardCurrentDocumentDraft, requestSectionChange, confirmDiscard };
}

function selectTaskCreateModalView({
  activeDocumentSection,
  documents,
  isUploading,
  modalState,
  mode,
}: {
  activeDocumentSection: DocumentSection | null;
  documents: ReturnType<typeof useTaskDocumentEditorState>["documents"];
  isUploading: boolean;
  modalState: TaskCreateModalState;
  mode: ComposerMode;
}) {
  const dirtyDocuments = byDocumentCode(
    (code) =>
      documents[code].loaded && documents[code].draftMarkdown !== documents[code].serverMarkdown,
  );
  const activeDocument = activeDocumentSection ? documents[activeDocumentSection] : null;
  const activeDraft = activeDocument?.draftMarkdown ?? "";
  const hasUnsavedActiveDocument = hasUnsavedDocumentChanges(activeDocumentSection, dirtyDocuments);
  const isSaving = modalState.isSubmitting || modalState.isSavingDocument !== null;
  const isBusy = isSaving || isUploading;
  const isRecoveryBlocked = taskAssetFailureRequiresLock(modalState.taskAssetFailure);
  const isSaveOrRecoveryLocked = isSaving || isRecoveryBlocked;
  const isFormDisabled = isSaveOrRecoveryLocked || isUploading;
  const isTypeStepVisible = mode === "create" && modalState.step === "type";
  const isEditingDocument = mode === "edit" && activeDocumentSection !== null;
  let footerError = modalState.error;
  if (isEditingDocument) {
    footerError = modalState.documentError;
  } else if (modalState.hasExternalTaskConflict) {
    footerError = { message: EXTERNAL_TASK_CONFLICT_MESSAGE, outcomeUnknown: false };
  }
  const isActiveDocumentDirty = hasUnsavedActiveDocument;
  return {
    dirtyDocuments,
    activeDocument,
    activeDraft,
    hasUnsavedActiveDocument,
    isBusy,
    isRecoveryBlocked,
    isSaveOrRecoveryLocked,
    isFormDisabled,
    isTypeStepVisible,
    isEditingDocument,
    footerError,
    isActiveDocumentDirty,
  };
}

/**
 * The New task and Edit task form: the task fields, the Spec and Plan documents, the staged
 * description images, and the saves. Each platform supplies its file and Markdown adapters.
 */
export function useTaskCreateModalController<F extends TaskDescriptionImageFile>({
  open,
  onOpenChange,
  tasks,
  task,
  destination = null,
  initialTitle = "",
  initialEditSection = "details",
  readFileBase64,
  createPreviewUrl,
  revokePreviewUrl,
  collectAssetIds,
}: TaskCreateModalControllerOptions<F>) {
  const { feedback } = useClientConnection();
  const { activeWorkspace } = useActiveWorkspaceContext();
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  // Images stage in the destination. Task creation runs in the active workspace, so another
  // active workspace blocks it.
  const workspaceId = destination?.workspaceId ?? activeWorkspace?.workspaceId ?? null;
  const destinationError =
    destination && destination.workspaceId !== activeWorkspace?.workspaceId
      ? `This task is for ${destination.workspaceName}. Open ${destination.workspaceName} again to create it.`
      : null;
  const { createTask, updateTask } = useRequiredContext(
    TasksStateContext,
    "useTaskCreateModalController",
  );
  const { loadDocument, saveDocument: saveTaskDocument } = useRequiredContext(
    DocumentStateContext,
    "useTaskCreateModalController",
  );
  const descriptionAssetOperations = useTaskDescriptionAssetOperations(workspaceId, readFileBase64);

  const mode: ComposerMode = task ? "edit" : "create";
  const taskId = task?.id ?? null;

  const [modalState, dispatch] = useReducer(
    taskCreateModalReducer,
    { task, initialTitle, initialEditSection },
    (initial) =>
      initialTaskCreateModalState(initial.task, initial.initialTitle, initial.initialEditSection),
  );
  const {
    step,
    editSection,
    composer,
    selectedCreateIssueType,
    isSubmitting,
    isSavingDocument,
    pendingDiscardIntent,
    hasExternalTaskConflict,
  } = modalState;

  const activeDocumentSection =
    mode === "edit" && isDocumentSection(editSection) ? editSection : null;

  const {
    documents,
    views,
    loadSection: loadDocumentSection,
    setView: setDocumentView,
    updateDraft: updateDocumentDraft,
    discardDraft: discardDocumentDraft,
    applySaved: applySavedDocument,
  } = useTaskDocumentEditorState({
    open,
    taskId,
    activeSection: activeDocumentSection,
    loadDocument,
  });

  useExternalTaskSync({ open, task, taskId, initialTitle, initialEditSection, composer, dispatch });
  // The task fields differ from the saved task, or from a new task: a type, priority, AI Review,
  // or label choice counts as an edit too.
  const isTaskDraftDirty = useMemo(
    () => !areComposerStatesEqual(composer, startComposer(task, initialTitle)),
    [composer, initialTitle, task],
  );

  const reportDescriptionAssetDiscardError = useCallback(
    (cause: unknown): void => {
      feedback.show("error", "Temporary image cleanup failed", {
        description: `${errorMessage(cause)} Refresh before continuing.`,
      });
    },
    [feedback],
  );

  // Only a new image upload counts the referenced assets, so a keystroke does not parse the
  // description.
  const descriptionRef = useRef(composer.description);
  useLayoutEffect(() => {
    descriptionRef.current = composer.description;
  }, [composer.description]);
  const readReferencedDescriptionAssetIds = useCallback(
    () => collectAssetIds(descriptionRef.current),
    [collectAssetIds],
  );

  const descriptionAssetDraft = useTaskDescriptionAssetDraft({
    active: open,
    draftKey: taskId ?? "new-task",
    workspaceId,
    readReferencedAssetIds: readReferencedDescriptionAssetIds,
    stageImage: descriptionAssetOperations.stageImage,
    discardStaged: descriptionAssetOperations.discardStaged,
    onDiscardError: reportDescriptionAssetDiscardError,
    createPreviewUrl,
    revokePreviewUrl,
  });

  const knownLabels = useMemo(() => collectKnownLabels(tasks), [tasks]);
  const priorityOptions = useMemo(() => toPrioritySelectOptions(), []);

  const {
    dirtyDocuments,
    activeDocument,
    activeDraft,
    hasUnsavedActiveDocument,
    isBusy,
    isRecoveryBlocked,
    isSaveOrRecoveryLocked,
    isFormDisabled,
    isTypeStepVisible,
    isEditingDocument,
    footerError,
    isActiveDocumentDirty,
  } = selectTaskCreateModalView({
    activeDocumentSection,
    documents,
    isUploading: descriptionAssetDraft.isUploading,
    modalState,
    mode,
  });

  // The field actions only dispatch, so they stay the same across renders and a memoized field
  // renders only when its own value changes.
  const updateState = useCallback((patch: Partial<ComposerState>): void => {
    dispatch({ type: "composerPatched", patch });
  }, []);

  const selectCreateIssueType = useCallback((issueType: IssueType): void => {
    dispatch({ type: "issueTypeSelected", issueType });
  }, []);

  // A toast shows the failure on each section. The footer shows only the error of the open one.
  const reportStagedImageDiscardFailure = (message: string): void => {
    feedback.show("error", "Could not discard staged images", { description: message });
  };

  const { discardCurrentDocumentDraft, requestSectionChange, confirmDiscard } =
    createDocumentNavigationActions({
      activeDocumentSection,
      descriptionAssetDraft,
      discardDocumentDraft,
      dispatch,
      editSection,
      hasUnsavedActiveDocument,
      isBusy,
      loadDocumentSection,
      onDiscardFailure: reportStagedImageDiscardFailure,
      onOpenChange,
      pendingDiscardIntent,
    });

  const close = async (): Promise<void> => {
    if (isBusy) {
      return;
    }
    if (hasUnsavedActiveDocument) {
      dispatch({ type: "discardIntentSet", intent: { type: "close-modal" } });
      return;
    }
    try {
      await descriptionAssetDraft.discardAll();
      onOpenChange(false);
    } catch (reason) {
      reportStagedImageDiscardFailure(errorMessage(reason));
    }
  };

  // The form saves one change at a time, so a double tap creates one task.
  const saveFlight = useSingleFlight();
  const submitTask = createTaskSubmit({
    collectAssetIds,
    composer,
    createTask,
    descriptionAssetDraft,
    destinationError,
    dispatch,
    hasExternalTaskConflict,
    isRecoveryBlocked,
    mode,
    onCleanupFailure: (description) => {
      feedback.show("error", "Task saved, but temporary image cleanup failed", { description });
    },
    onOpenChange,
    task,
    updateTask,
    workspaceRepoPath,
  });
  const submit = async (): Promise<void> => {
    await saveFlight.start(submitTask);
  };

  const saveDocument = async (): Promise<void> => {
    if (!task || !activeDocumentSection || !activeDocument) {
      return;
    }
    // The live task card carries the version of each document, so a save never overwrites a
    // newer document from an agent or another client.
    if (
      isDocumentNewerOnHost(
        activeDocument.updatedAt,
        task.artifactSummary[activeDocumentSection]?.updatedAt,
      )
    ) {
      dispatch({
        type: "documentSaveFailed",
        error: { message: EXTERNAL_DOCUMENT_CONFLICT_MESSAGE, outcomeUnknown: false },
      });
      return;
    }

    const markdown = activeDocument.draftMarkdown.trim();
    dispatch({ type: "documentSaveStarted", section: activeDocumentSection });
    try {
      const saved = await saveTaskDocument(task.id, activeDocumentSection, markdown);
      applySavedDocument(activeDocumentSection, markdown, saved.updatedAt);
    } catch (reason) {
      dispatch({
        type: "documentSaveFailed",
        error: { message: errorMessage(reason), outcomeUnknown: isOutcomeUnknown(reason) },
      });
    } finally {
      dispatch({ type: "documentSaveFinished" });
    }
  };
  const saveActiveDocument = async (): Promise<void> => {
    await saveFlight.start(saveDocument);
  };

  const onDialogOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      void close();
      return;
    }
    onOpenChange(true);
  };

  const clearPendingDiscardIntent = useCallback((): void => {
    dispatch({ type: "discardIntentCleared" });
  }, []);

  const setStep = useCallback((nextStep: ComposerStep): void => {
    dispatch({ type: "stepChanged", step: nextStep });
  }, []);

  return {
    mode,
    taskId,
    workspaceId,
    workspaceRepoPath,
    step,
    setStep,
    selectedCreateIssueType,
    editSection,
    state: composer,
    documents,
    views,
    activeDocumentSection,
    activeDocument,
    activeDraft,
    pendingDiscardIntent,
    knownLabels,
    priorityOptions,
    isTaskDraftDirty,
    dirtyDocuments,
    isSubmitting,
    isSavingDocument,
    isBusy,
    isFormDisabled,
    isRecoveryBlocked,
    isSaveOrRecoveryLocked,
    hasExternalTaskConflict,
    isTypeStepVisible,
    isEditingDocument,
    footerError: destinationError ?? footerError?.message ?? null,
    /** True when the footer error is a lost save result. The host may have saved the change. */
    footerErrorOutcomeUnknown: destinationError === null && footerError?.outcomeUnknown === true,
    destination,
    destinationError,
    isActiveDocumentDirty,
    updateState,
    stageDescriptionImage: descriptionAssetDraft.stage,
    descriptionAssetUploads: descriptionAssetDraft.uploads,
    descriptionAssetPreviews: descriptionAssetDraft.previews,
    selectCreateIssueType,
    setDocumentView,
    updateDocumentDraft,
    loadDocumentSection,
    requestSectionChange,
    close,
    submit,
    saveActiveDocument,
    discardCurrentDocumentDraft,
    clearPendingDiscardIntent,
    confirmDiscard,
    onDialogOpenChange,
  };
}

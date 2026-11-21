import { useTaskFormWorkflow } from "../../queries/use-task-form-workflow";
import { workflowQueryKeys, type WorkspaceWorkflows } from "../../queries/workflows";
import { issueTypeChoices } from "./task-composer-options";
import {
  rebaseTaskComposer,
  type RetainedTaskFields,
  type RetainedTaskWorkspace,
} from "./task-editor-drafts";
import {
  type WorkflowIssueTypeId as IssueType,
  type ResolvedTaskCard as TaskCard,
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
  useRequiredContext,
} from "../../app-state/app-state-contexts";
import { useClientConnection } from "../../connection/client-connection-react";
import { isOutcomeUnknown } from "../../lib/command-outcome";
import { errorMessage } from "../../lib/errors";
import { useSingleFlight } from "../../lib/use-single-flight";
import type { TaskCreateWorkspace, TasksStateContextValue } from "../../types/state-slices";
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
import { toComposerState, toPrioritySelectOptions } from "./task-composer-options";
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
  taskEditorFooter,
  type TaskCreateModalError,
  toTaskCreateInput,
  toTaskUpdatePatch,
} from "./task-create-modal-model";
import {
  type TaskDocumentSection,
  useTaskDocumentEditorState,
} from "./use-task-document-editor-state";
import {
  type TaskCreateDestination,
  useKnownTaskLabels,
  useTaskCreateWorkspacePicker,
  useTaskEditorWorkspace,
} from "./use-task-create-workspace";

type DocumentSection = TaskDocumentSection;

type PendingDiscardIntent =
  | { type: "close-modal" }
  | { type: "switch-section"; next: EditTaskSection };

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
  /** Removes the images of the assets that `collectAssetIds` finds. Pass a stable function. */
  removeAssetImages: (markdown: string, assetIds: ReadonlySet<string>) => string;
};

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
  /** The workspace that the user picked for a new task, or null for its destination. */
  workspacePick: RetainedTaskWorkspace | null;
};

type TaskCreateModalAction =
  | {
      type: "resetForOpenTask";
      task: TaskCard | null;
      initialTitle: string;
      initialEditSection: EditTaskSection;
      composer?: ComposerState;
      workspacePick: RetainedTaskWorkspace | null;
    }
  | { type: "externalTaskApplied"; composer: ComposerState }
  | { type: "composerPatched"; patch: Partial<ComposerState> }
  | { type: "issueTypeSelected"; issueType: IssueType }
  | {
      type: "createWorkspaceChanged";
      workspace: RetainedTaskWorkspace;
      /** True when the workflow of the next workspace offers the chosen issue type. */
      keepsIssueType: boolean;
    }
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
  workspacePick: null,
});

const areComposerStatesEqual = (left: ComposerState, right: ComposerState): boolean =>
  left.issueType === right.issueType &&
  left.removeWorktreeOnClose === right.removeWorktreeOnClose &&
  left.title === right.title &&
  left.priority === right.priority &&
  left.description === right.description &&
  left.labels.length === right.labels.length &&
  left.labels.every((label, index) => label === right.labels[index]);

const EXTERNAL_DOCUMENT_CONFLICT_MESSAGE =
  "This document changed on the host while you were editing. Your edits are kept. Copy what you need, then close and reopen the task to load the latest version.";

const taskCreateModalReducer = (
  state: TaskCreateModalState,
  action: TaskCreateModalAction,
): TaskCreateModalState => {
  switch (action.type) {
    case "resetForOpenTask":
      return {
        ...initialTaskCreateModalState(action.task, action.initialTitle, action.initialEditSection),
        composer: action.composer ?? startComposer(action.task, action.initialTitle),
        workspacePick: action.workspacePick,
      };
    case "externalTaskApplied":
      return {
        ...state,
        composer: action.composer,
        selectedCreateIssueType: action.composer.issueType,
        error: null,
        taskAssetFailure: null,
      };
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
    // Each workspace has its own workflow. When it does not offer the chosen issue type, the user
    // picks the issue type again.
    case "createWorkspaceChanged":
      if (action.keepsIssueType) return { ...state, workspacePick: action.workspace, error: null };
      return {
        ...state,
        workspacePick: action.workspace,
        step: "type",
        selectedCreateIssueType: null,
        error: null,
      };
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
  workspacePick,
  dispatch,
  draftKey,
  drafts,
}: {
  workspacePick: RetainedTaskWorkspace | null;
  draftKey: string | null;
  drafts: Map<string, RetainedTaskFields>;
  open: boolean;
  task: TaskCard | null;
  taskId: string | null;
  initialTitle: string;
  initialEditSection: EditTaskSection;
  composer: ComposerState;
  dispatch: Dispatch<TaskCreateModalAction>;
}): void {
  const previousModalContext = useRef<{
    open: boolean;
    taskId: string | null;
    draftKey: string | null;
  } | null>(null);
  const serverComposer = useRef<ComposerState | null>(null);

  useEffect(() => {
    const nextServerComposer = startComposer(task, initialTitle);
    const contextChanged =
      previousModalContext.current?.open !== open ||
      previousModalContext.current?.taskId !== taskId ||
      previousModalContext.current?.draftKey !== draftKey;
    if (contextChanged) {
      previousModalContext.current = { open, taskId, draftKey };
      serverComposer.current = nextServerComposer;
      const retained = draftKey === null ? undefined : drafts.get(draftKey);
      if (open)
        dispatch({
          type: "resetForOpenTask",
          task,
          initialTitle,
          initialEditSection,
          composer: retained
            ? rebaseTaskComposer(retained.composer, retained.baseline, nextServerComposer)
            : startComposer(task, initialTitle),
          workspacePick: retained?.workspacePick ?? null,
        });
      return;
    }
    if (!open) return;

    const previousServerComposer = serverComposer.current;
    const nextComposer =
      previousServerComposer === null
        ? composer
        : rebaseTaskComposer(composer, previousServerComposer, nextServerComposer);
    serverComposer.current = nextServerComposer;
    // A picked workspace is a change too, so a draft keeps its workspace before the user types.
    if (draftKey !== null) {
      if (areComposerStatesEqual(nextComposer, nextServerComposer) && workspacePick === null)
        drafts.delete(draftKey);
      else
        drafts.set(draftKey, {
          composer: nextComposer,
          baseline: nextServerComposer,
          workspacePick,
        });
    }
    if (!areComposerStatesEqual(composer, nextComposer))
      dispatch({ type: "externalTaskApplied", composer: nextComposer });
  }, [
    composer,
    dispatch,
    draftKey,
    drafts,
    initialTitle,
    initialEditSection,
    open,
    task,
    taskId,
    workspacePick,
  ]);
}

function createTaskSubmit({
  collectAssetIds,
  composer,
  createTask,
  descriptionAssetDraft,
  destinationError,
  dispatch,
  isRecoveryBlocked,
  mode,
  onCleanupFailure,
  onOpenChange,
  task,
  updateTask,
  workspace,
}: {
  collectAssetIds: (markdown: string) => Set<string>;
  composer: ComposerState;
  createTask: TasksStateContextValue["createTask"];
  descriptionAssetDraft: TaskDescriptionAssetDraftControls;
  destinationError: string | null;
  dispatch: Dispatch<TaskCreateModalAction>;
  isRecoveryBlocked: boolean;
  mode: ComposerMode;
  onCleanupFailure: (description: string) => void;
  onOpenChange: (open: boolean) => void;
  task: TaskCard | null;
  updateTask: TasksStateContextValue["updateTask"];
  workspace: TaskCreateWorkspace | null;
}): () => Promise<void> {
  return async () => {
    if (isRecoveryBlocked) return;
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
    if (!workspace) {
      dispatch({ type: "submitBlocked", error: "Select a workspace before saving the task." });
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
        await createTask(workspace, toTaskCreateInput(composer), descriptionAssets);
      } else if (task) {
        const patch = toTaskUpdatePatch(composer);
        const baseline = toTaskUpdatePatch(toComposerState(task));
        for (const field of [
          "title",
          "removeWorktreeOnClose",
          "priority",
          "description",
          "labels",
        ] as const) {
          if (JSON.stringify(patch[field]) === JSON.stringify(baseline[field])) delete patch[field];
        }
        await updateTask(task.id, patch, descriptionAssets);
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
    if (isDocumentSection(next)) void loadDocumentSection(next.artifactCode);
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
        void loadDocumentSection(pendingDiscardIntent.next.artifactCode);
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
  const dirtyDocuments = Object.fromEntries(
    Object.entries(documents).map(([code, document]) => [
      code,
      document.loaded && document.draftMarkdown !== document.serverMarkdown,
    ]),
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
  const footerError = isEditingDocument ? modalState.documentError : modalState.error;
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
  removeAssetImages,
}: TaskCreateModalControllerOptions<F>) {
  const connection = useClientConnection();
  const { feedback } = connection;
  const retainedDrafts = connection.drafts.taskEditors;
  const [modalState, dispatch] = useReducer(
    taskCreateModalReducer,
    { task, initialTitle, initialEditSection },
    (initial) =>
      initialTaskCreateModalState(initial.task, initial.initialTitle, initial.initialEditSection),
  );
  const {
    activeWorkspace,
    workspaces,
    workspaceRepoPath,
    workspaceId,
    workspaceScope,
    saveWorkspace,
    target,
    draftKey,
    imageWorkspaceId,
  } = useTaskEditorWorkspace({ task, destination, workspacePick: modalState.workspacePick });
  // Only Edit task loads and saves documents, so only its destination error blocks them.
  const editDestinationError = target.mode === "edit" ? target.destinationError : null;
  const workflowRead = useTaskFormWorkflow(task, workspaceScope, open);
  const taskWorkflow = workflowRead.taskWorkflow;
  const documentCodes = useMemo(
    () =>
      taskWorkflow?.definition.artifacts
        .filter(({ kind }) => kind === "document")
        .map(({ id }) => id) ?? [],
    [taskWorkflow],
  );
  const { createTask, updateTask } = useRequiredContext(
    TasksStateContext,
    "useTaskCreateModalController",
  );
  const { loadDocument, saveDocument: saveTaskDocument } = useRequiredContext(
    DocumentStateContext,
    "useTaskCreateModalController",
  );
  const descriptionAssetOperations = useTaskDescriptionAssetOperations(
    imageWorkspaceId,
    readFileBase64,
  );

  const mode: ComposerMode = task ? "edit" : "create";
  const taskId = task?.id ?? null;

  const {
    step,
    editSection,
    composer,
    selectedCreateIssueType,
    isSubmitting,
    isSavingDocument,
    pendingDiscardIntent,
    workspacePick,
  } = modalState;

  const activeDocumentSection = documentCodeForSection(mode, editSection);

  const loadScopedDocument = useCallback(
    (taskId: string, code: DocumentSection) => {
      if (editDestinationError !== null) return Promise.reject(new Error(editDestinationError));
      if (
        !taskWorkflow ||
        taskWorkflow.definition.artifacts.find(({ id }) => id === code)?.kind !== "document"
      )
        return Promise.reject(
          new Error(`Workflow document "${code}" is unavailable. Reload its workflow.`),
        );
      return loadDocument(taskId, code);
    },
    [editDestinationError, taskWorkflow, loadDocument],
  );

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
    repoPath: activeWorkspace?.repoPath ?? null,
    activeSection: activeDocumentSection,
    documentCodes,
    loadDocument: loadScopedDocument,
    workspaceId,
    retainedDrafts: retainedDrafts.documents,
  });

  useExternalTaskSync({
    open,
    task,
    taskId,
    initialTitle,
    initialEditSection,
    composer,
    workspacePick,
    dispatch,
    draftKey,
    drafts: retainedDrafts.fields,
  });
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

  const descriptionAssetRetention = useMemo(
    () => ({
      drafts: retainedDrafts.descriptionAssets,
      referencedAssetIds: (ownerKey: string): ReadonlySet<string> => {
        const draft = retainedDrafts.fields.get(ownerKey);
        return draft ? collectAssetIds(draft.composer.description) : new Set<string>();
      },
    }),
    [collectAssetIds, retainedDrafts],
  );

  const descriptionAssetDraft = useTaskDescriptionAssetDraft({
    active: open,
    draftKey: draftKey ?? "__inactive__",
    workspaceId: imageWorkspaceId,
    readReferencedAssetIds: readReferencedDescriptionAssetIds,
    stageImage: descriptionAssetOperations.stageImage,
    discardStaged: descriptionAssetOperations.discardStaged,
    onDiscardError: reportDescriptionAssetDiscardError,
    createPreviewUrl,
    revokePreviewUrl,
    retention: descriptionAssetRetention,
  });

  const knownLabels = useKnownTaskLabels({ open, task, tasks, workspaceScope });
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

  const { workspacePicker, destinationError } = useTaskCreateWorkspacePicker({
    target,
    workspaceId,
    workspaces,
    description: composer.description,
    stagedImages: descriptionAssetDraft.previews,
    collectAssetIds,
    removeAssetImages,
    isBusy,
    isRecoveryBlocked,
    onPick: ({ workspaceId: pickedId, workspaceName, repoPath }) => {
      // The workflows of the open workspaces are usually cached. Without one, the form asks for
      // the issue type again.
      const nextWorkflow = connection.queryClient.getQueryData<WorkspaceWorkflows>(
        workflowQueryKeys.workspace({ workspaceId: pickedId, repoPath }),
      )?.newTaskWorkflow;
      dispatch({
        type: "createWorkspaceChanged",
        workspace: { workspaceId: pickedId, workspaceName },
        keepsIssueType:
          nextWorkflow?.definition.issueTypes.some(({ id }) => id === composer.issueType) === true,
      });
    },
    onDescriptionChange: (description) =>
      dispatch({ type: "composerPatched", patch: { description } }),
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
      if (draftKey !== null) retainedDrafts.fields.delete(draftKey);
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
    isRecoveryBlocked,
    mode,
    onCleanupFailure: (description) => {
      feedback.show("error", "Task saved, but temporary image cleanup failed", { description });
    },
    onOpenChange: (nextOpen) => {
      if (!nextOpen && draftKey !== null) retainedDrafts.fields.delete(draftKey);
      onOpenChange(nextOpen);
    },
    task,
    updateTask,
    workspace: saveWorkspace,
  });
  const submit = async (): Promise<void> => {
    if (
      !taskWorkflow ||
      workflowRead.error ||
      !taskWorkflow.definition.issueTypes.some(({ id }) => id === composer.issueType)
    ) {
      dispatch({
        type: "submitBlocked",
        error: workflowRead.error ?? "Select an issue type from the task workflow.",
      });
      return;
    }
    await saveFlight.start(submitTask);
  };

  const saveDocument = async (): Promise<void> => {
    if (!task || !activeDocumentSection || !activeDocument) return;
    if (editDestinationError) {
      dispatch({
        type: "documentSaveFailed",
        error: { message: editDestinationError, outcomeUnknown: false },
      });
      return;
    }
    if (!taskWorkflow || workflowRead.error) {
      dispatch({
        type: "documentSaveFailed",
        error: {
          message: workflowRead.error ?? "Task workflow is loading.",
          outcomeUnknown: false,
        },
      });
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

  const footer = taskEditorFooter({
    isRecoveryBlocked,
    destinationError,
    workflowError: workflowRead.error,
    error: footerError,
  });

  return {
    taskWorkflow,
    issueTypeChoices: issueTypeChoices(taskWorkflow),
    workflowRead,
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
    isFormDisabled: isFormDisabled || workflowRead.pending || workflowRead.error !== null,
    isRecoveryBlocked,
    isSaveOrRecoveryLocked,
    isTypeStepVisible,
    isEditingDocument,
    footerError: footer.message,
    /** True when the footer error is a lost save result. The host may have saved the change. */
    footerErrorOutcomeUnknown: footer.outcomeUnknown,
    /** The workspace picker of New task. It is null in Edit task. */
    workspacePicker,
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

function documentCodeForSection(mode: ComposerMode, section: EditTaskSection) {
  return mode === "edit" && isDocumentSection(section) ? section.artifactCode : null;
}

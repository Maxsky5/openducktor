import type { IssueType, TaskAssetFailure, TaskCard } from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { toast } from "sonner";
import type { TaskDocumentSection } from "@/components/features/task-composer";
import {
  collectKnownLabels,
  ISSUE_TYPE_DEFAULTS,
  toComposerState,
  toPriorityComboboxOptions,
  useTaskDocumentEditorState,
} from "@/components/features/task-composer";
import { collectTaskDescriptionAssetIds } from "@/components/features/task-description-editor/task-description-assets";
import { stageTaskDescriptionImage } from "@/components/features/task-description-editor/task-description-upload";
import { useTaskDescriptionAssetDraft } from "@/components/features/task-description-editor/use-task-description-asset-draft";
import { errorMessage } from "@/lib/errors";
import { hostClient } from "@/lib/host-client";
import { useSpecState, useTasksState, useWorkspaceState } from "@/state";
import {
  formatTaskAssetFailure,
  taskAssetFailureFromError,
  taskAssetFailureRequiresLock,
} from "@/state/operations/tasks/task-asset-failure-recovery";
import type {
  ComposerMode,
  ComposerState,
  ComposerStep,
  EditTaskSection,
} from "@/types/task-composer";
import {
  hasUnsavedDocumentChanges,
  isDocumentSection,
  toTaskCreateInput,
  toTaskUpdatePatch,
} from "./task-create-modal-model";

type DocumentSection = TaskDocumentSection;

type PendingDiscardIntent =
  | { type: "close-modal" }
  | { type: "switch-section"; next: EditTaskSection };

type UseTaskCreateModalControllerOptions = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: TaskCard[];
  task: TaskCard | null;
};

type TaskCreateModalState = {
  step: ComposerStep;
  editSection: EditTaskSection;
  composer: ComposerState;
  selectedCreateIssueType: IssueType | null;
  error: string | null;
  documentError: string | null;
  isSubmitting: boolean;
  isSavingDocument: DocumentSection | null;
  pendingDiscardIntent: PendingDiscardIntent | null;
  taskAssetFailure: TaskAssetFailure | null;
};

type TaskCreateModalAction =
  | { type: "resetForOpenTask"; task: TaskCard | null }
  | { type: "composerPatched"; patch: Partial<ComposerState> }
  | { type: "issueTypeSelected"; issueType: IssueType }
  | { type: "stepChanged"; step: ComposerStep }
  | { type: "documentErrorCleared" }
  | { type: "discardIntentSet"; intent: PendingDiscardIntent }
  | { type: "sectionChanged"; section: EditTaskSection }
  | { type: "submitBlocked"; error: string }
  | { type: "submitStarted" }
  | { type: "submitFailed"; error: string; taskAssetFailure: TaskAssetFailure | null }
  | { type: "submitFinished" }
  | { type: "documentSaveStarted"; section: DocumentSection }
  | { type: "documentSaveFailed"; error: string }
  | { type: "documentSaveFinished" }
  | { type: "discardIntentCleared" };

const initialTaskCreateModalState = (task: TaskCard | null): TaskCreateModalState => ({
  step: task ? "details" : "type",
  editSection: "details",
  composer: toComposerState(task),
  selectedCreateIssueType: task?.issueType ?? null,
  error: null,
  documentError: null,
  isSubmitting: false,
  isSavingDocument: null,
  pendingDiscardIntent: null,
  taskAssetFailure: null,
});

const taskCreateModalReducer = (
  state: TaskCreateModalState,
  action: TaskCreateModalAction,
): TaskCreateModalState => {
  switch (action.type) {
    case "resetForOpenTask":
      return initialTaskCreateModalState(action.task);
    case "composerPatched":
      return { ...state, composer: { ...state.composer, ...action.patch } };
    case "issueTypeSelected":
      return {
        ...state,
        selectedCreateIssueType: action.issueType,
        composer: {
          ...state.composer,
          issueType: action.issueType,
          aiReviewEnabled: ISSUE_TYPE_DEFAULTS[action.issueType].aiReviewEnabled,
        },
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
      return { ...state, error: action.error };
    case "submitStarted":
      return {
        ...state,
        error: null,
        documentError: null,
        taskAssetFailure: null,
        isSubmitting: true,
      };
    case "submitFailed":
      return {
        ...state,
        error: action.error,
        taskAssetFailure: action.taskAssetFailure,
      };
    case "submitFinished":
      return { ...state, isSubmitting: false };
    case "documentSaveStarted":
      return {
        ...state,
        error: null,
        documentError: null,
        isSavingDocument: action.section,
      };
    case "documentSaveFailed":
      return { ...state, documentError: action.error };
    case "documentSaveFinished":
      return { ...state, isSavingDocument: null };
    case "discardIntentCleared":
      return { ...state, pendingDiscardIntent: null };
  }
};

export function useTaskCreateModalController({
  open,
  onOpenChange,
  tasks,
  task,
}: UseTaskCreateModalControllerOptions) {
  const { activeWorkspace } = useWorkspaceState();
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const workspaceId = activeWorkspace?.workspaceId ?? null;
  const { createTask, updateTask } = useTasksState();
  const { loadSpecDocument, loadPlanDocument, saveSpecDocument, savePlanDocument } = useSpecState();

  const mode: ComposerMode = task ? "edit" : "create";
  const taskId = task?.id ?? null;

  const [modalState, dispatch] = useReducer(
    taskCreateModalReducer,
    task,
    initialTaskCreateModalState,
  );
  const {
    step,
    editSection,
    composer,
    selectedCreateIssueType,
    error,
    documentError,
    isSubmitting,
    isSavingDocument,
    pendingDiscardIntent,
    taskAssetFailure,
  } = modalState;

  const previousModalContext = useRef<{ open: boolean; taskId: string | null } | null>(null);
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
    loadSpecDocument,
    loadPlanDocument,
  });

  useEffect(() => {
    const contextChanged =
      previousModalContext.current?.open !== open ||
      previousModalContext.current?.taskId !== taskId;
    if (!contextChanged) {
      return;
    }

    previousModalContext.current = { open, taskId };
    if (!open) {
      return;
    }

    dispatch({ type: "resetForOpenTask", task });
  }, [open, task, taskId]);

  const stageDescriptionImageForDraft = useCallback(
    async (file: File) => {
      if (!workspaceId) {
        throw new Error("Select a workspace before adding task images.");
      }
      return stageTaskDescriptionImage(hostClient, workspaceId, file);
    },
    [workspaceId],
  );

  const discardDescriptionAssets = useCallback(
    async (assetWorkspaceId: string, assetIds: string[]): Promise<void> => {
      await hostClient.taskAssetDiscardStaged({ workspaceId: assetWorkspaceId, assetIds });
    },
    [],
  );

  const reportDescriptionAssetDiscardError = useCallback((cause: unknown): void => {
    toast.error("Temporary image cleanup failed", {
      description: `${errorMessage(cause)} Refresh before continuing.`,
    });
  }, []);

  const descriptionAssetDraft = useTaskDescriptionAssetDraft({
    active: open,
    draftKey: taskId ?? "new-task",
    workspaceId,
    stageImage: stageDescriptionImageForDraft,
    discardStaged: discardDescriptionAssets,
    onDiscardError: reportDescriptionAssetDiscardError,
  });

  const knownLabels = useMemo(() => collectKnownLabels(tasks), [tasks]);
  const priorityComboboxOptions = useMemo(() => toPriorityComboboxOptions(), []);

  const isSpecDirty =
    documents.spec.loaded && documents.spec.draftMarkdown !== documents.spec.serverMarkdown;
  const isPlanDirty =
    documents.plan.loaded && documents.plan.draftMarkdown !== documents.plan.serverMarkdown;
  const activeDocument = activeDocumentSection ? documents[activeDocumentSection] : null;
  const activeDraft = activeDocument?.draftMarkdown ?? "";
  const hasUnsavedActiveDocument = hasUnsavedDocumentChanges(activeDocumentSection, {
    isSpecDirty,
    isPlanDirty,
  });

  const isBusy = isSubmitting || isSavingDocument !== null || descriptionAssetDraft.isUploading;
  const isRecoveryBlocked = taskAssetFailureRequiresLock(taskAssetFailure);
  const isFormDisabled = isBusy || isRecoveryBlocked;
  const isTypeStepVisible = mode === "create" && step === "type";
  const isEditingDocument = mode === "edit" && activeDocumentSection !== null;
  const footerError = isEditingDocument ? documentError : error;
  const isActiveDocumentDirty =
    activeDocumentSection === "spec"
      ? isSpecDirty
      : activeDocumentSection === "plan"
        ? isPlanDirty
        : false;

  const updateState = (patch: Partial<ComposerState>): void => {
    dispatch({ type: "composerPatched", patch });
  };

  const selectCreateIssueType = (issueType: IssueType): void => {
    dispatch({ type: "issueTypeSelected", issueType });
  };

  const discardCurrentDocumentDraft = (): void => {
    if (!activeDocumentSection) {
      return;
    }
    discardDocumentDraft(activeDocumentSection);
    dispatch({ type: "documentErrorCleared" });
  };

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
      dispatch({
        type: "submitBlocked",
        error: `Could not discard staged images: ${errorMessage(reason)}`,
      });
    }
  };

  const requestSectionChange = (next: EditTaskSection): void => {
    if (next === editSection || isBusy) {
      return;
    }
    if (hasUnsavedActiveDocument) {
      dispatch({ type: "discardIntentSet", intent: { type: "switch-section", next } });
      return;
    }

    dispatch({ type: "sectionChanged", section: next });
    if (isDocumentSection(next)) {
      void loadDocumentSection(next);
    }
  };

  const submit = async (): Promise<void> => {
    if (isRecoveryBlocked) {
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
      const referencedAssetIds = collectTaskDescriptionAssetIds(composer.description);
      const suppliedAssetIds = descriptionAssetDraft
        .stagedAssetIds()
        .filter((assetId) => referencedAssetIds.has(assetId));
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
        toast.error("Task saved, but temporary image cleanup failed", {
          description: `${errorMessage(reason)} Refresh before continuing.`,
        });
      }
      onOpenChange(false);
    } catch (reason) {
      const failure = taskAssetFailureFromError(reason);
      dispatch({
        type: "submitFailed",
        error: failure ? formatTaskAssetFailure(failure) : errorMessage(reason),
        taskAssetFailure: failure,
      });
    } finally {
      dispatch({ type: "submitFinished" });
    }
  };

  const saveActiveDocument = async (): Promise<void> => {
    if (!taskId || !activeDocumentSection || !activeDocument) {
      return;
    }

    const markdown = activeDocument.draftMarkdown.trim();
    dispatch({ type: "documentSaveStarted", section: activeDocumentSection });
    try {
      const saved =
        activeDocumentSection === "spec"
          ? await saveSpecDocument(taskId, markdown)
          : await savePlanDocument(taskId, markdown);
      applySavedDocument(activeDocumentSection, markdown, saved.updatedAt);
    } catch (reason) {
      dispatch({ type: "documentSaveFailed", error: errorMessage(reason) });
    } finally {
      dispatch({ type: "documentSaveFinished" });
    }
  };

  const confirmDiscard = async (): Promise<void> => {
    if (!pendingDiscardIntent) {
      return;
    }

    discardCurrentDocumentDraft();
    if (pendingDiscardIntent.type === "close-modal") {
      try {
        await descriptionAssetDraft.discardAll();
        onOpenChange(false);
      } catch (reason) {
        dispatch({
          type: "submitBlocked",
          error: `Could not discard staged images: ${errorMessage(reason)}`,
        });
        return;
      }
    } else {
      dispatch({ type: "sectionChanged", section: pendingDiscardIntent.next });
      if (isDocumentSection(pendingDiscardIntent.next)) {
        void loadDocumentSection(pendingDiscardIntent.next);
      }
    }

    dispatch({ type: "discardIntentCleared" });
  };

  const onDialogOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      void close();
      return;
    }
    onOpenChange(true);
  };

  const clearPendingDiscardIntent = (): void => {
    dispatch({ type: "discardIntentCleared" });
  };

  const setStep = (nextStep: ComposerStep): void => {
    dispatch({ type: "stepChanged", step: nextStep });
  };

  return {
    mode,
    taskId,
    workspaceId,
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
    priorityComboboxOptions,
    isSpecDirty,
    isPlanDirty,
    isSubmitting,
    isSavingDocument,
    isBusy,
    isFormDisabled,
    isRecoveryBlocked,
    isTypeStepVisible,
    isEditingDocument,
    footerError,
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

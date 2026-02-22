import {
  ISSUE_TYPE_OPTIONS,
  collectKnownLabels,
  toComposerState,
  toParentComboboxOptions,
  toPriorityComboboxOptions,
  useTaskDocumentEditorState,
} from "@/components/features/task-composer";
import type { TaskDocumentSection } from "@/components/features/task-composer";
import {
  hasUnsavedDocumentChanges,
  isDocumentSection,
  toTaskCreateInput,
  toTaskUpdatePatch,
} from "@/components/features/task-create-modal-model";
import { errorMessage } from "@/lib/errors";
import { useSpecState, useTasksState, useWorkspaceState } from "@/state";
import type {
  ComposerMode,
  ComposerState,
  ComposerStep,
  EditTaskSection,
} from "@/types/task-composer";
import type { TaskCard } from "@openducktor/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

type DocumentSection = TaskDocumentSection;

export type PendingDiscardIntent =
  | { type: "close-modal" }
  | { type: "switch-section"; next: EditTaskSection };

type UseTaskCreateModalControllerOptions = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: TaskCard[];
  task: TaskCard | null;
};

export function useTaskCreateModalController({
  open,
  onOpenChange,
  tasks,
  task,
}: UseTaskCreateModalControllerOptions) {
  const { activeRepo } = useWorkspaceState();
  const { createTask, updateTask } = useTasksState();
  const { loadSpecDocument, loadPlanDocument, saveSpecDocument, savePlanDocument } = useSpecState();

  const mode: ComposerMode = task ? "edit" : "create";
  const taskId = task?.id ?? null;

  const [step, setStep] = useState<ComposerStep>("type");
  const [editSection, setEditSection] = useState<EditTaskSection>("details");
  const [state, setState] = useState<ComposerState>(() => toComposerState(task));
  const [error, setError] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDocument, setIsSavingDocument] = useState<DocumentSection | null>(null);
  const [pendingDiscardIntent, setPendingDiscardIntent] = useState<PendingDiscardIntent | null>(
    null,
  );

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

    setState(toComposerState(task));
    setStep(task ? "details" : "type");
    setEditSection("details");
    setError(null);
    setDocumentError(null);
    setIsSubmitting(false);
    setIsSavingDocument(null);
    setPendingDiscardIntent(null);
  }, [open, task, taskId]);

  const selectedType = useMemo(
    () => ISSUE_TYPE_OPTIONS.find((option) => option.value === state.issueType),
    [state.issueType],
  );
  const canSelectParent = selectedType?.supportsParent ?? true;

  useEffect(() => {
    if (!canSelectParent && state.parentId.length > 0) {
      setState((current) => ({ ...current, parentId: "" }));
    }
  }, [canSelectParent, state.parentId]);

  const parentCandidates = useMemo(
    () =>
      tasks
        .filter((entry) => entry.id !== task?.id)
        .filter((entry) => entry.issueType === "epic")
        .sort((left, right) => left.id.localeCompare(right.id)),
    [task?.id, tasks],
  );

  const knownLabels = useMemo(() => collectKnownLabels(tasks), [tasks]);
  const priorityComboboxOptions = useMemo(() => toPriorityComboboxOptions(), []);
  const parentComboboxOptions = useMemo(
    () => toParentComboboxOptions(parentCandidates),
    [parentCandidates],
  );

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

  const isBusy = isSubmitting || isSavingDocument !== null;
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
    setState((current) => ({ ...current, ...patch }));
  };

  const discardCurrentDocumentDraft = (): void => {
    if (!activeDocumentSection) {
      return;
    }
    discardDocumentDraft(activeDocumentSection);
    setDocumentError(null);
  };

  const close = (): void => {
    if (isSubmitting || isSavingDocument) {
      return;
    }
    if (hasUnsavedActiveDocument) {
      setPendingDiscardIntent({ type: "close-modal" });
      return;
    }
    onOpenChange(false);
  };

  const requestSectionChange = (next: EditTaskSection): void => {
    if (next === editSection || isSubmitting || isSavingDocument) {
      return;
    }
    if (hasUnsavedActiveDocument) {
      setPendingDiscardIntent({ type: "switch-section", next });
      return;
    }

    setEditSection(next);
    setDocumentError(null);
    if (isDocumentSection(next)) {
      void loadDocumentSection(next);
    }
  };

  const submit = async (): Promise<void> => {
    if (!activeRepo) {
      setError("Select a repository before creating tasks.");
      return;
    }
    if (!state.title.trim()) {
      setError("Title is required.");
      return;
    }

    setError(null);
    setDocumentError(null);
    setIsSubmitting(true);
    try {
      if (mode === "create") {
        await createTask(toTaskCreateInput(state, canSelectParent));
      } else if (task) {
        await updateTask(task.id, toTaskUpdatePatch(state, canSelectParent));
      }
      onOpenChange(false);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setIsSubmitting(false);
    }
  };

  const saveActiveDocument = async (): Promise<void> => {
    if (!taskId || !activeDocumentSection || !activeDocument) {
      return;
    }

    const markdown = activeDocument.draftMarkdown.trim();
    setError(null);
    setDocumentError(null);
    setIsSavingDocument(activeDocumentSection);
    try {
      const saved =
        activeDocumentSection === "spec"
          ? await saveSpecDocument(taskId, markdown)
          : await savePlanDocument(taskId, markdown);
      applySavedDocument(activeDocumentSection, markdown, saved.updatedAt);
    } catch (reason) {
      setDocumentError(errorMessage(reason));
    } finally {
      setIsSavingDocument(null);
    }
  };

  const confirmDiscard = (): void => {
    if (!pendingDiscardIntent) {
      return;
    }

    discardCurrentDocumentDraft();
    if (pendingDiscardIntent.type === "close-modal") {
      onOpenChange(false);
    } else {
      setEditSection(pendingDiscardIntent.next);
      setDocumentError(null);
      if (isDocumentSection(pendingDiscardIntent.next)) {
        void loadDocumentSection(pendingDiscardIntent.next);
      }
    }

    setPendingDiscardIntent(null);
  };

  const onDialogOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      close();
      return;
    }
    onOpenChange(true);
  };

  const clearPendingDiscardIntent = (): void => {
    setPendingDiscardIntent(null);
  };

  return {
    mode,
    taskId,
    step,
    setStep,
    editSection,
    state,
    documents,
    views,
    activeDocumentSection,
    activeDocument,
    activeDraft,
    pendingDiscardIntent,
    canSelectParent,
    knownLabels,
    priorityComboboxOptions,
    parentComboboxOptions,
    isSpecDirty,
    isPlanDirty,
    isSubmitting,
    isSavingDocument,
    isBusy,
    isTypeStepVisible,
    isEditingDocument,
    footerError,
    isActiveDocumentDirty,
    updateState,
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

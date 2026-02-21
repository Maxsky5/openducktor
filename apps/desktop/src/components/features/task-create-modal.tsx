import {
  ISSUE_TYPE_OPTIONS,
  IssueTypeGrid,
  TaskComposerStepper,
  TaskDetailsForm,
  TaskDocumentEditor,
  TaskEditSectionSwitcher,
  collectKnownLabels,
  normalizeLines,
  toComposerState,
  toParentComboboxOptions,
  toPriorityComboboxOptions,
  useTaskDocumentEditorState,
} from "@/components/features/task-composer";
import type { TaskDocumentSection } from "@/components/features/task-composer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useSpecState, useTasksState, useWorkspaceState } from "@/state";
import type {
  ComposerMode,
  ComposerState,
  ComposerStep,
  EditTaskSection,
} from "@/types/task-composer";
import type { TaskCard, TaskCreateInput, TaskUpdatePatch } from "@openducktor/contracts";
import { ArrowLeft, Flag, Loader2, RotateCcw, Sparkles, WandSparkles } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";

type TaskCreateModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: TaskCard[];
  task?: TaskCard | null;
};

type DocumentSection = TaskDocumentSection;

type PendingDiscardIntent =
  | { type: "close-modal" }
  | { type: "switch-section"; next: EditTaskSection };

const isDocumentSection = (section: EditTaskSection): section is DocumentSection =>
  section === "spec" || section === "plan";

export function TaskCreateModal({
  open,
  onOpenChange,
  tasks,
  task = null,
}: TaskCreateModalProps): ReactElement {
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
  const hasUnsavedActiveDocument =
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
        const input: TaskCreateInput = {
          title: state.title.trim(),
          issueType: state.issueType,
          aiReviewEnabled: state.aiReviewEnabled,
          priority: state.priority,
          description: normalizeLines(state.description),
          acceptanceCriteria: normalizeLines(state.acceptanceCriteria),
          labels: state.labels,
          parentId: !canSelectParent || state.parentId.length === 0 ? undefined : state.parentId,
        };
        await createTask(input);
      } else if (task) {
        const patch: TaskUpdatePatch = {
          title: state.title.trim(),
          aiReviewEnabled: state.aiReviewEnabled,
          priority: state.priority,
          description: state.description.trim(),
          acceptanceCriteria: state.acceptanceCriteria.trim(),
          labels: state.labels,
          parentId: !canSelectParent ? "" : state.parentId === "__none__" ? "" : state.parentId,
        };
        await updateTask(task.id, patch);
      }

      onOpenChange(false);
    } catch (reason) {
      setError((reason as Error).message);
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
      setDocumentError(reason instanceof Error ? reason.message : "Unable to save document.");
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

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            close();
            return;
          }
          onOpenChange(true);
        }}
      >
        <DialogContent className="flex max-h-[92vh] max-w-6xl flex-col overflow-hidden p-0">
          <DialogHeader className="border-b border-slate-200 px-5 py-4">
            <DialogTitle className="flex items-center gap-2 text-2xl">
              <Sparkles className="size-5 text-sky-600" />
              {mode === "create" ? "Create Task" : "Edit Task"}
            </DialogTitle>
            <DialogDescription>
              {mode === "create"
                ? "Create a structured Beads issue with the fields Planner and Builder rely on."
                : `Update ${task?.id ?? "task"} metadata and long-form markdown documents.`}
            </DialogDescription>
          </DialogHeader>

          <fieldset disabled={isBusy} className="flex min-h-0 flex-1 flex-col border-0 p-0">
            <div
              className={cn(
                "min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 transition-opacity",
                isBusy ? "cursor-wait opacity-55" : "opacity-100",
              )}
            >
              {mode === "create" ? (
                <TaskComposerStepper
                  step={step}
                  onStepChange={(nextStep) => {
                    if (nextStep === "details" && step !== "details") {
                      return;
                    }
                    setStep(nextStep);
                  }}
                />
              ) : (
                <TaskEditSectionSwitcher
                  section={editSection}
                  hasUnsavedSpec={isSpecDirty}
                  hasUnsavedPlan={isPlanDirty}
                  disabled={isBusy}
                  onSectionChange={requestSectionChange}
                />
              )}

              {isTypeStepVisible ? (
                <IssueTypeGrid state={state} onStateChange={updateState} />
              ) : mode === "edit" && activeDocumentSection ? (
                <TaskDocumentEditor
                  key={activeDocumentSection}
                  title={activeDocumentSection === "spec" ? "Specification" : "Implementation Plan"}
                  subtitle={
                    activeDocumentSection === "spec"
                      ? "Edit the canonical specification markdown for this task."
                      : "Edit the implementation plan markdown for this task."
                  }
                  placeholder={
                    activeDocumentSection === "spec"
                      ? "# Purpose\n\nDescribe expected outcome..."
                      : "## Milestones\n\n- ..."
                  }
                  markdown={activeDraft}
                  view={views[activeDocumentSection]}
                  onViewChange={(nextView) => setDocumentView(activeDocumentSection, nextView)}
                  updatedAt={activeDocument?.updatedAt ?? null}
                  isLoading={activeDocument?.isLoading ?? false}
                  isSaving={isSavingDocument === activeDocumentSection}
                  error={activeDocument?.error ?? null}
                  hasUnsavedChanges={isActiveDocumentDirty}
                  onMarkdownChange={(value) => updateDocumentDraft(activeDocumentSection, value)}
                  onRetryLoad={() => {
                    void loadDocumentSection(activeDocumentSection, true);
                  }}
                />
              ) : (
                <TaskDetailsForm
                  mode={mode}
                  state={state}
                  canSelectParent={canSelectParent}
                  priorityOptions={priorityComboboxOptions}
                  parentOptions={parentComboboxOptions}
                  knownLabels={knownLabels}
                  onStateChange={updateState}
                  onRequestTypeChange={() => setStep("type")}
                />
              )}
            </div>

            <DialogFooter className="mt-0 justify-between border-t border-slate-200 px-5 py-4">
              {mode === "create" && step === "details" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="cursor-pointer"
                  onClick={() => setStep("type")}
                  disabled={isBusy}
                >
                  <ArrowLeft className="size-4" />
                  Back
                </Button>
              ) : mode === "edit" && activeDocumentSection ? (
                <Button
                  type="button"
                  variant="outline"
                  className="cursor-pointer"
                  onClick={discardCurrentDocumentDraft}
                  disabled={isBusy || !isActiveDocumentDirty}
                >
                  <RotateCcw className="size-4" />
                  Revert
                </Button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                {footerError ? <p className="text-sm text-rose-600">{footerError}</p> : null}
                <Button
                  type="button"
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={close}
                  disabled={isBusy}
                >
                  Cancel
                </Button>

                {mode === "create" && step === "type" ? (
                  <Button
                    type="button"
                    className="cursor-pointer"
                    onClick={() => setStep("details")}
                    disabled={isBusy}
                  >
                    Continue
                  </Button>
                ) : isEditingDocument ? (
                  <Button
                    type="button"
                    className="cursor-pointer"
                    onClick={() => void saveActiveDocument()}
                    disabled={
                      isBusy ||
                      !taskId ||
                      !activeDocument ||
                      !activeDocument.loaded ||
                      activeDocument.isLoading ||
                      activeDraft.trim().length === 0 ||
                      !isActiveDocumentDirty
                    }
                  >
                    {isSavingDocument === activeDocumentSection ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <WandSparkles className="size-4" />
                    )}
                    {isSavingDocument === activeDocumentSection
                      ? "Saving..."
                      : activeDocumentSection === "spec"
                        ? "Save Spec"
                        : "Save Plan"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    className="cursor-pointer"
                    onClick={() => void submit()}
                    disabled={isBusy || !state.title.trim()}
                  >
                    {isSubmitting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : mode === "create" ? (
                      <Flag className="size-4" />
                    ) : (
                      <WandSparkles className="size-4" />
                    )}
                    {isSubmitting
                      ? mode === "create"
                        ? "Creating..."
                        : "Saving..."
                      : mode === "create"
                        ? "Create Task"
                        : "Save Changes"}
                  </Button>
                )}
              </div>
            </DialogFooter>
          </fieldset>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDiscardIntent !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setPendingDiscardIntent(null);
          }
        }}
      >
        <DialogContent className="max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Discard unsaved markdown changes?</DialogTitle>
            <DialogDescription>
              You have unsaved document edits. Discard them before leaving this section?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6 flex-row justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              onClick={() => setPendingDiscardIntent(null)}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="cursor-pointer"
              onClick={confirmDiscard}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

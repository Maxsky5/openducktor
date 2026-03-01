import type { TaskCard } from "@openducktor/contracts";
import { ArrowLeft, Flag, Loader2, RotateCcw, Sparkles, WandSparkles } from "lucide-react";
import type { ReactElement } from "react";
import {
  IssueTypeGrid,
  TaskComposerStepper,
  TaskDetailsForm,
  TaskDocumentEditor,
  TaskEditSectionSwitcher,
} from "@/components/features/task-composer";
import {
  TaskCreateDiscardDialog,
  useTaskCreateModalController,
} from "@/components/features/task-create";
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

type TaskCreateModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: TaskCard[];
  task?: TaskCard | null;
};

export function TaskCreateModal({
  open,
  onOpenChange,
  tasks,
  task = null,
}: TaskCreateModalProps): ReactElement {
  const controller = useTaskCreateModalController({
    open,
    onOpenChange,
    tasks,
    task,
  });
  const activeDocumentSection = controller.activeDocumentSection;

  return (
    <>
      <Dialog open={open} onOpenChange={controller.onDialogOpenChange}>
        <DialogContent className="flex max-h-[92vh] max-w-6xl flex-col overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle className="flex items-center gap-2 text-2xl">
              <Sparkles className="size-5 text-primary" />
              {controller.mode === "create" ? "Create Task" : "Edit Task"}
            </DialogTitle>
            <DialogDescription>
              {controller.mode === "create"
                ? "Create a structured Beads issue with the fields Planner and Builder rely on."
                : `Update ${task?.id ?? "task"} metadata and long-form markdown documents.`}
            </DialogDescription>
          </DialogHeader>

          <fieldset
            disabled={controller.isBusy}
            className="flex min-h-0 flex-1 flex-col border-0 p-0"
          >
            <div
              className={cn(
                "min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 transition-opacity",
                controller.isBusy ? "cursor-wait opacity-55" : "opacity-100",
              )}
            >
              {controller.mode === "create" ? (
                <TaskComposerStepper
                  step={controller.step}
                  onStepChange={(nextStep) => {
                    if (nextStep === "details" && controller.step !== "details") {
                      return;
                    }
                    controller.setStep(nextStep);
                  }}
                />
              ) : (
                <TaskEditSectionSwitcher
                  section={controller.editSection}
                  hasUnsavedSpec={controller.isSpecDirty}
                  hasUnsavedPlan={controller.isPlanDirty}
                  disabled={controller.isBusy}
                  onSectionChange={controller.requestSectionChange}
                />
              )}

              {controller.isTypeStepVisible ? (
                <IssueTypeGrid state={controller.state} onStateChange={controller.updateState} />
              ) : controller.mode === "edit" && activeDocumentSection ? (
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
                  markdown={controller.activeDraft}
                  view={controller.views[activeDocumentSection]}
                  onViewChange={(nextView) =>
                    controller.setDocumentView(activeDocumentSection, nextView)
                  }
                  updatedAt={controller.activeDocument?.updatedAt ?? null}
                  isLoading={controller.activeDocument?.isLoading ?? false}
                  isSaving={controller.isSavingDocument === activeDocumentSection}
                  error={controller.activeDocument?.error ?? null}
                  hasUnsavedChanges={controller.isActiveDocumentDirty}
                  onMarkdownChange={(value) =>
                    controller.updateDocumentDraft(activeDocumentSection, value)
                  }
                  onRetryLoad={() => {
                    void controller.loadDocumentSection(activeDocumentSection, true);
                  }}
                />
              ) : (
                <TaskDetailsForm
                  mode={controller.mode}
                  state={controller.state}
                  canSelectParent={controller.canSelectParent}
                  priorityOptions={controller.priorityComboboxOptions}
                  parentOptions={controller.parentComboboxOptions}
                  knownLabels={controller.knownLabels}
                  onStateChange={controller.updateState}
                  onRequestTypeChange={() => controller.setStep("type")}
                />
              )}
            </div>

            <DialogFooter className="mt-0 justify-between border-t border-border px-5 py-4">
              {controller.mode === "create" && controller.step === "details" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="cursor-pointer"
                  onClick={() => controller.setStep("type")}
                  disabled={controller.isBusy}
                >
                  <ArrowLeft className="size-4" />
                  Back
                </Button>
              ) : controller.mode === "edit" && controller.activeDocumentSection ? (
                <Button
                  type="button"
                  variant="outline"
                  className="cursor-pointer"
                  onClick={controller.discardCurrentDocumentDraft}
                  disabled={controller.isBusy || !controller.isActiveDocumentDirty}
                >
                  <RotateCcw className="size-4" />
                  Revert
                </Button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                {controller.footerError ? (
                  <p className="text-sm text-destructive-muted">{controller.footerError}</p>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={controller.close}
                  disabled={controller.isBusy}
                >
                  Cancel
                </Button>

                {controller.mode === "create" && controller.step === "type" ? (
                  <Button
                    type="button"
                    className="cursor-pointer"
                    onClick={() => controller.setStep("details")}
                    disabled={controller.isBusy}
                  >
                    Continue
                  </Button>
                ) : controller.isEditingDocument ? (
                  <Button
                    type="button"
                    className="cursor-pointer"
                    onClick={() => void controller.saveActiveDocument()}
                    disabled={
                      controller.isBusy ||
                      !controller.taskId ||
                      !controller.activeDocument ||
                      !controller.activeDocument.loaded ||
                      controller.activeDocument.isLoading ||
                      controller.activeDraft.trim().length === 0 ||
                      !controller.isActiveDocumentDirty
                    }
                  >
                    {controller.isSavingDocument === controller.activeDocumentSection ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <WandSparkles className="size-4" />
                    )}
                    {controller.isSavingDocument === controller.activeDocumentSection
                      ? "Saving..."
                      : controller.activeDocumentSection === "spec"
                        ? "Save Spec"
                        : "Save Plan"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    className="cursor-pointer"
                    onClick={() => void controller.submit()}
                    disabled={controller.isBusy || !controller.state.title.trim()}
                  >
                    {controller.isSubmitting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : controller.mode === "create" ? (
                      <Flag className="size-4" />
                    ) : (
                      <WandSparkles className="size-4" />
                    )}
                    {controller.isSubmitting
                      ? controller.mode === "create"
                        ? "Creating..."
                        : "Saving..."
                      : controller.mode === "create"
                        ? "Create Task"
                        : "Save Changes"}
                  </Button>
                )}
              </div>
            </DialogFooter>
          </fieldset>
        </DialogContent>
      </Dialog>

      <TaskCreateDiscardDialog
        open={controller.pendingDiscardIntent !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            controller.clearPendingDiscardIntent();
          }
        }}
        onKeepEditing={controller.clearPendingDiscardIntent}
        onDiscardChanges={controller.confirmDiscard}
      />
    </>
  );
}

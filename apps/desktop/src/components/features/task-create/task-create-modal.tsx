import type { TaskCard } from "@openducktor/contracts";
import { ArrowLeft, Flag, Loader2, RotateCcw, Sparkles, WandSparkles } from "lucide-react";
import { lazy, type ReactElement, Suspense } from "react";
import { IssueTypeGrid } from "@/components/features/task-composer/issue-type-grid";
import { TaskComposerStepper } from "@/components/features/task-composer/task-composer-stepper";
import { TaskDetailsForm } from "@/components/features/task-composer/task-details-form";
import { TaskEditSectionSwitcher } from "@/components/features/task-composer/task-edit-section-switcher";
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

const TaskDocumentEditor = lazy(async () => {
  const module = await import("@/components/features/task-composer/task-document-editor");
  return { default: module.TaskDocumentEditor };
});

export type TaskCreateModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: TaskCard[];
  task?: TaskCard | null;
};

function TaskDocumentEditorFallback(): ReactElement {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-muted/70 px-4 py-3">
        <div className="space-y-2">
          <div className="h-4 w-32 animate-pulse rounded bg-card" />
          <div className="h-3 w-64 animate-pulse rounded bg-card" />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Markdown
          </p>
          <div className="min-h-[52vh] space-y-3 rounded-md border border-border bg-muted p-3">
            <div className="h-3 w-2/5 animate-pulse rounded bg-card" />
            <div className="h-3 w-full animate-pulse rounded bg-card" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-card" />
          </div>
        </div>
        <div className="space-y-2 max-md:hidden">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Preview
          </p>
          <div className="min-h-[52vh] space-y-3 rounded-md border border-border bg-muted p-3">
            <div className="h-3 w-1/3 animate-pulse rounded bg-card" />
            <div className="h-3 w-full animate-pulse rounded bg-card" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-card" />
          </div>
        </div>
      </div>
    </div>
  );
}

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
        <DialogContent className="grid max-h-[92vh] max-w-6xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0">
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
                "min-h-0 flex-1 overflow-y-auto space-y-4 px-5 py-4 transition-opacity",
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
                <IssueTypeGrid
                  selectedIssueType={controller.selectedCreateIssueType}
                  onSelectIssueType={controller.selectCreateIssueType}
                />
              ) : controller.mode === "edit" && activeDocumentSection ? (
                <Suspense fallback={<TaskDocumentEditorFallback />}>
                  <TaskDocumentEditor
                    key={activeDocumentSection}
                    title={
                      activeDocumentSection === "spec" ? "Specification" : "Implementation Plan"
                    }
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
                </Suspense>
              ) : (
                <TaskDetailsForm
                  mode={controller.mode}
                  state={controller.state}
                  priorityOptions={controller.priorityComboboxOptions}
                  knownLabels={controller.knownLabels}
                  onStateChange={controller.updateState}
                  onRequestTypeChange={() => controller.setStep("type")}
                />
              )}
            </div>

            <DialogFooter className="mt-0 justify-between border-t border-border px-5 py-4">
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                onClick={controller.close}
                disabled={controller.isBusy}
              >
                Close
              </Button>

              <div className="flex items-center gap-2">
                {controller.footerError ? (
                  <p className="text-sm text-destructive-muted">{controller.footerError}</p>
                ) : null}

                {controller.mode === "create" && controller.step === "type" ? (
                  <span />
                ) : controller.isEditingDocument ? (
                  <>
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
                  </>
                ) : (
                  <>
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
                    ) : null}
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
                  </>
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

import {
  ISSUE_TYPE_OPTIONS,
  IssueTypeGrid,
  TaskComposerStepper,
  TaskDetailsForm,
  collectKnownLabels,
  normalizeLines,
  toComposerState,
  toParentComboboxOptions,
  toPriorityComboboxOptions,
} from "@/components/features/task-composer";
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
import { useTasksState, useWorkspaceState } from "@/state";
import type { ComposerMode, ComposerState, ComposerStep } from "@/types/task-composer";
import type { TaskCard, TaskCreateInput, TaskUpdatePatch } from "@openblueprint/contracts";
import { ArrowLeft, Flag, Loader2, Sparkles, WandSparkles } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";

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
  const { activeRepo } = useWorkspaceState();
  const { createTask, updateTask } = useTasksState();
  const mode: ComposerMode = task ? "edit" : "create";

  const [step, setStep] = useState<ComposerStep>("type");
  const [state, setState] = useState<ComposerState>(() => toComposerState(task));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setState(toComposerState(task));
    setStep(task ? "details" : "type");
    setError(null);
    setIsSubmitting(false);
  }, [open, task]);

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
        .filter((entry) => entry.issueType === "epic" || entry.issueType === "feature")
        .sort((left, right) => left.id.localeCompare(right.id)),
    [task?.id, tasks],
  );
  const knownLabels = useMemo(() => collectKnownLabels(tasks), [tasks]);
  const priorityComboboxOptions = useMemo(() => toPriorityComboboxOptions(), []);
  const parentComboboxOptions = useMemo(
    () => toParentComboboxOptions(parentCandidates),
    [parentCandidates],
  );

  const updateState = (patch: Partial<ComposerState>): void => {
    setState((current) => ({ ...current, ...patch }));
  };

  const close = (): void => {
    onOpenChange(false);
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
    setIsSubmitting(true);
    try {
      if (mode === "create") {
        const input: TaskCreateInput = {
          title: state.title.trim(),
          issueType: state.issueType,
          priority: state.priority,
          description: normalizeLines(state.description),
          design: normalizeLines(state.design),
          acceptanceCriteria: normalizeLines(state.acceptanceCriteria),
          labels: state.labels,
          parentId: !canSelectParent || state.parentId.length === 0 ? undefined : state.parentId,
        };
        await createTask(input);
      } else if (task) {
        const patch: TaskUpdatePatch = {
          title: state.title.trim(),
          priority: state.priority,
          description: state.description.trim(),
          design: state.design.trim(),
          acceptanceCriteria: state.acceptanceCriteria.trim(),
          labels: state.labels,
          parentId: !canSelectParent ? "" : state.parentId === "__none__" ? "" : state.parentId,
        };
        await updateTask(task.id, patch);
      }

      close();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isTypeStepVisible = mode === "create" && step === "type";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isSubmitting && !nextOpen) {
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-slate-200 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Sparkles className="size-5 text-sky-600" />
            {mode === "create" ? "Create Task" : "Edit Task"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create a structured Beads issue with the fields Planner and Builder rely on."
              : `Update ${task?.id ?? "task"} with complete, automation-ready details.`}
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={isSubmitting} className="flex min-h-0 flex-1 flex-col border-0 p-0">
          <div
            className={cn(
              "min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 transition-opacity",
              isSubmitting ? "cursor-wait opacity-55" : "opacity-100",
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
            ) : null}

            {isTypeStepVisible ? (
              <IssueTypeGrid state={state} onStateChange={updateState} />
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
                disabled={isSubmitting}
              >
                <ArrowLeft className="size-4" />
                Back
              </Button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              {error ? <p className="text-sm text-rose-600">{error}</p> : null}
              <Button
                type="button"
                variant="secondary"
                className="cursor-pointer"
                onClick={close}
                disabled={isSubmitting}
              >
                Cancel
              </Button>

              {mode === "create" && step === "type" ? (
                <Button
                  type="button"
                  className="cursor-pointer"
                  onClick={() => setStep("details")}
                  disabled={isSubmitting}
                >
                  Continue
                </Button>
              ) : (
                <Button
                  type="button"
                  className="cursor-pointer"
                  onClick={() => void submit()}
                  disabled={isSubmitting || !state.title.trim()}
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
  );
}

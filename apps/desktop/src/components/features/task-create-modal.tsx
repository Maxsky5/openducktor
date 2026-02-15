import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagSelector } from "@/components/ui/tag-selector";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useOrchestrator } from "@/state/orchestrator-context";
import type {
  IssueType,
  TaskCard,
  TaskCreateInput,
  TaskUpdatePatch,
} from "@openblueprint/contracts";
import {
  ArrowLeft,
  Bug,
  Check,
  Flag,
  Layers3,
  Lightbulb,
  ListTodo,
  Loader2,
  Sparkles,
  WandSparkles,
  Wrench,
} from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";

type TaskCreateModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: TaskCard[];
  task?: TaskCard | null;
};

type ComposerStep = "type" | "details";

type ComposerState = {
  issueType: IssueType;
  title: string;
  priority: number;
  description: string;
  design: string;
  acceptanceCriteria: string;
  labels: string[];
  parentId: string;
};

const issueTypeOptions: Array<{
  value: IssueType;
  label: string;
  description: string;
  icon: ReactElement;
  accentClass: string;
  iconClass: string;
  supportsParent: boolean;
}> = [
  {
    value: "feature",
    label: "Feature",
    description: "User-facing capability or workflow improvement.",
    icon: <Sparkles className="size-4" />,
    accentClass: "border-sky-300 bg-sky-50/90",
    iconClass: "bg-sky-100 text-sky-700",
    supportsParent: true,
  },
  {
    value: "bug",
    label: "Bug",
    description: "Unexpected behavior, regression, or production defect.",
    icon: <Bug className="size-4" />,
    accentClass: "border-rose-300 bg-rose-50/90",
    iconClass: "bg-rose-100 text-rose-700",
    supportsParent: true,
  },
  {
    value: "task",
    label: "Task",
    description: "Standard implementation work item.",
    icon: <ListTodo className="size-4" />,
    accentClass: "border-slate-300 bg-slate-100/80",
    iconClass: "bg-slate-200 text-slate-700",
    supportsParent: true,
  },
  {
    value: "chore",
    label: "Chore",
    description: "Maintenance, upgrades, tooling, or non-user-visible work.",
    icon: <Wrench className="size-4" />,
    accentClass: "border-amber-300 bg-amber-50/90",
    iconClass: "bg-amber-100 text-amber-700",
    supportsParent: true,
  },
  {
    value: "epic",
    label: "Epic",
    description: "Large initiative that contains multiple subtasks.",
    icon: <Layers3 className="size-4" />,
    accentClass: "border-violet-300 bg-violet-50/90",
    iconClass: "bg-violet-100 text-violet-700",
    supportsParent: false,
  },
  {
    value: "decision",
    label: "Decision",
    description: "Architecture/product decision record with explicit rationale.",
    icon: <Lightbulb className="size-4" />,
    accentClass: "border-emerald-300 bg-emerald-50/90",
    iconClass: "bg-emerald-100 text-emerald-700",
    supportsParent: false,
  },
];

const priorityOptions: Array<{ value: number; label: string; hint: string }> = [
  { value: 0, label: "P0", hint: "Critical" },
  { value: 1, label: "P1", hint: "High" },
  { value: 2, label: "P2", hint: "Normal" },
  { value: 3, label: "P3", hint: "Low" },
  { value: 4, label: "P4", hint: "Very low" },
];

const normalizeLines = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toFormState = (task?: TaskCard | null): ComposerState => {
  if (!task) {
    return {
      issueType: "task",
      title: "",
      priority: 2,
      description: "",
      design: "",
      acceptanceCriteria: "",
      labels: [],
      parentId: "",
    };
  }

  return {
    issueType: task.issueType,
    title: task.title,
    priority: task.priority,
    description: task.description,
    design: task.design,
    acceptanceCriteria: task.acceptanceCriteria,
    labels: task.labels,
    parentId: task.parentId ?? "",
  };
};

const issueTypeHelperCopy = (issueType: IssueType): string => {
  if (issueType === "bug") {
    return "Capture reproduction context and a concrete acceptance signal for the fix.";
  }
  if (issueType === "epic") {
    return "Use this for umbrella initiatives and then create scoped child tasks under it.";
  }
  if (issueType === "decision") {
    return "Document tradeoffs in Design and explicit outcomes in Acceptance Criteria.";
  }
  return "Define enough detail for Planner/Builder automation to execute with minimal ambiguity.";
};

export function TaskCreateModal({
  open,
  onOpenChange,
  tasks,
  task = null,
}: TaskCreateModalProps): ReactElement {
  const { activeRepo, createTask, updateTask } = useOrchestrator();
  const mode = task ? "edit" : "create";

  const [step, setStep] = useState<ComposerStep>("type");
  const [state, setState] = useState<ComposerState>(() => toFormState(task));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setState(toFormState(task));
    setStep(task ? "details" : "type");
    setError(null);
    setIsSubmitting(false);
  }, [open, task]);

  const selectedType = issueTypeOptions.find((option) => option.value === state.issueType);
  const canSelectParent = selectedType?.supportsParent ?? true;

  useEffect(() => {
    if (!canSelectParent && state.parentId.length > 0) {
      setState((current) => ({ ...current, parentId: "" }));
    }
  }, [canSelectParent, state.parentId]);

  const parentCandidates = useMemo(() => {
    return tasks
      .filter((entry) => entry.id !== task?.id)
      .filter((entry) => entry.issueType === "epic" || entry.issueType === "feature")
      .sort((left, right) => left.id.localeCompare(right.id));
  }, [task?.id, tasks]);

  const knownLabels = useMemo(() => {
    const labels = new Set<string>();
    for (const entry of tasks) {
      for (const label of entry.labels) {
        labels.add(label);
      }
    }
    return Array.from(labels).sort((left, right) => left.localeCompare(right));
  }, [tasks]);

  const priorityComboboxOptions: ComboboxOption[] = useMemo(
    () =>
      priorityOptions.map((option) => ({
        value: String(option.value),
        label: `${option.label} · ${option.hint}`,
        searchKeywords: [option.hint.toLowerCase(), `priority-${option.value}`],
      })),
    [],
  );

  const parentComboboxOptions: ComboboxOption[] = useMemo(
    () => [
      { value: "__none__", label: "No parent", searchKeywords: ["none"] },
      ...parentCandidates.map((entry) => ({
        value: entry.id,
        label: `${entry.id} · ${entry.title}`,
        searchKeywords: [entry.title.toLowerCase(), entry.issueType, ...entry.labels],
      })),
    ],
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

  const detailsView = (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>Issue Type *</Label>
        <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                "inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
                selectedType?.iconClass ?? "bg-slate-100 text-slate-700",
              )}
            >
              {selectedType?.icon ?? <ListTodo className="size-4" />}
            </span>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">
                {selectedType?.label ?? state.issueType}
              </p>
              <p className="text-xs text-slate-600">{issueTypeHelperCopy(state.issueType)}</p>
            </div>
          </div>
          {mode === "create" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="cursor-pointer"
              onClick={() => setStep("type")}
            >
              Change
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="task-title">Title *</Label>
        <Input
          id="task-title"
          placeholder="Short task title"
          value={state.title}
          onChange={(event) => updateState({ title: event.currentTarget.value })}
        />
      </div>

      <div className={cn("grid gap-4", canSelectParent ? "sm:grid-cols-2" : "sm:grid-cols-1")}>
        <div className="grid gap-2">
          <Label htmlFor="task-priority">Priority *</Label>
          <Combobox
            value={String(state.priority)}
            options={priorityComboboxOptions}
            searchPlaceholder="Search priority..."
            onValueChange={(nextValue) => {
              const parsed = Number(nextValue);
              if (!Number.isNaN(parsed)) {
                updateState({ priority: parsed });
              }
            }}
          />
        </div>

        {canSelectParent ? (
          <div className="grid gap-2">
            <Label htmlFor="task-parent">Parent (optional)</Label>
            <Combobox
              value={state.parentId.length > 0 ? state.parentId : "__none__"}
              options={parentComboboxOptions}
              searchPlaceholder="Search parent task..."
              onValueChange={(nextValue) =>
                updateState({ parentId: nextValue === "__none__" ? "" : nextValue })
              }
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="task-description">Description</Label>
        <Textarea
          id="task-description"
          rows={4}
          value={state.description}
          placeholder="Problem context, scope, and expected output."
          onChange={(event) => updateState({ description: event.currentTarget.value })}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="task-design">Design</Label>
        <Textarea
          id="task-design"
          rows={3}
          value={state.design}
          placeholder="Architecture notes, key constraints, and integration points."
          onChange={(event) => updateState({ design: event.currentTarget.value })}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="task-acceptance">Acceptance Criteria</Label>
        <Textarea
          id="task-acceptance"
          rows={3}
          value={state.acceptanceCriteria}
          placeholder="Concrete pass/fail criteria."
          onChange={(event) => updateState({ acceptanceCriteria: event.currentTarget.value })}
        />
      </div>

      <div className="grid gap-2">
        <Label>Labels</Label>
        <TagSelector
          value={state.labels}
          suggestions={knownLabels}
          onChange={(nextLabels) => updateState({ labels: nextLabels })}
        />
      </div>
    </div>
  );

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
              <>
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                    <button
                      type="button"
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                        step === "type"
                          ? "border-sky-300 bg-sky-50"
                          : "border-emerald-200 bg-emerald-50/70",
                      )}
                      onClick={() => setStep("type")}
                    >
                      <span
                        className={cn(
                          "inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                          step === "type"
                            ? "border-sky-400 bg-sky-100 text-sky-800"
                            : "border-emerald-300 bg-emerald-100 text-emerald-700",
                        )}
                      >
                        {step === "type" ? 1 : <Check className="size-4" />}
                      </span>
                      <span className="space-y-0.5">
                        <span className="block text-sm font-semibold text-slate-900">
                          Issue Type
                        </span>
                        <span className="block text-xs text-slate-500">
                          Choose the task category
                        </span>
                      </span>
                    </button>

                    <span
                      className={cn(
                        "h-px w-8 rounded-full",
                        step === "details" ? "bg-emerald-300" : "bg-slate-300",
                      )}
                    />

                    <button
                      type="button"
                      className={cn(
                        "flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                        step === "details"
                          ? "cursor-pointer border-sky-300 bg-sky-50"
                          : "cursor-not-allowed border-slate-200 bg-white text-slate-400",
                      )}
                      disabled={step !== "details"}
                      onClick={() => {
                        if (step === "details") {
                          setStep("details");
                        }
                      }}
                    >
                      <span
                        className={cn(
                          "inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                          step === "details"
                            ? "border-sky-400 bg-sky-100 text-sky-800"
                            : "border-slate-300 bg-slate-100 text-slate-500",
                        )}
                      >
                        2
                      </span>
                      <span className="space-y-0.5">
                        <span className="block text-sm font-semibold text-slate-900">
                          Task Details
                        </span>
                        <span className="block text-xs text-slate-500">Add required metadata</span>
                      </span>
                    </button>
                  </div>
                </div>

                {step === "type" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {issueTypeOptions.map((option) => {
                      const selected = state.issueType === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={cn(
                            "group min-h-36 cursor-pointer rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40",
                            selected
                              ? option.accentClass
                              : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50",
                          )}
                          onClick={() => {
                            updateState({
                              issueType: option.value,
                              parentId: option.supportsParent ? state.parentId : "",
                            });
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span
                              className={cn(
                                "inline-flex size-9 items-center justify-center rounded-lg",
                                selected ? option.iconClass : "bg-slate-100 text-slate-600",
                              )}
                            >
                              {option.icon}
                            </span>
                            <span
                              className={cn(
                                "inline-flex size-6 items-center justify-center rounded-full border transition-colors",
                                selected
                                  ? "border-sky-300 bg-sky-100 text-sky-700"
                                  : "border-slate-300 bg-white text-transparent",
                              )}
                            >
                              <Check className="size-3.5" />
                            </span>
                          </div>
                          <p className="mt-3 text-base font-semibold text-slate-900">
                            {option.label}
                          </p>
                          <p className="mt-1 text-sm text-slate-600">{option.description}</p>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  detailsView
                )}
              </>
            ) : (
              detailsView
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

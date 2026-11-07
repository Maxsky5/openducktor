import type {
  TaskWorkflow,
  WorkflowIssueTypeId as IssueType,
  ResolvedTaskCard as TaskCard,
} from "@openducktor/workflows";
import type { SelectOption } from "../../lib/select-option";
import { PRIORITY_LABELS, PRIORITY_LEVELS } from "../board/kanban-task-badge-model";
import type { ComposerState, IssueTypeChoice, PriorityOption } from "./task-composer-types";

/** The issue type that a new task or an import proposes. */
export const defaultIssueType = (workflow: TaskWorkflow | undefined): IssueType | undefined =>
  workflow?.definition.defaultIssueType ?? workflow?.definition.issueTypes[0]?.id;

/** The declared issue types of a workflow, in declaration order. */
export const issueTypeChoices = (workflow: TaskWorkflow | undefined): IssueTypeChoice[] =>
  workflow?.definition.issueTypes.map((type) => ({
    value: type.id,
    label: type.label,
    description: type.description ?? "",
    guidance: type.guidance ?? type.description ?? "",
    icon: type.icon,
  })) ?? [];

export const PRIORITY_OPTIONS: PriorityOption[] = PRIORITY_LEVELS.map((value) => ({
  value,
  ...PRIORITY_LABELS[value],
}));

export const toComposerState = (task?: TaskCard | null): ComposerState => {
  if (!task) {
    return {
      issueType: "task",
      removeWorktreeOnClose: null,
      title: "",
      priority: 2,
      description: "",
      labels: [],
    };
  }

  return {
    issueType: task.issueType,
    removeWorktreeOnClose: task.removeWorktreeOnClose,
    title: task.title,
    priority: task.priority,
    description: task.description,
    labels: task.labels,
  };
};

/** The labels of the tasks, once each, in alphabetical order. */
export const collectKnownLabels = (tasks: TaskCard[]): string[] => {
  const labels = new Set<string>();
  for (const entry of tasks) {
    for (const label of entry.labels) {
      labels.add(label);
    }
  }
  return Array.from(labels).sort((left, right) => left.localeCompare(right));
};

export const toPrioritySelectOptions = (): SelectOption[] =>
  PRIORITY_OPTIONS.map((option) => ({
    value: String(option.value),
    label: `${option.label} · ${option.hint}`,
    searchKeywords: [option.hint.toLowerCase(), `priority-${option.value}`],
  }));

export const REMOVE_WORKTREE_ON_CLOSE_LABEL = "Remove worktree on close";

/** One choice of the task value. `key` names the choice in a select control. */
export type RemoveWorktreeOnCloseChoice = {
  key: "default" | "yes" | "no";
  value: boolean | null;
  label: string;
  description: string;
};

/** The choices of the task value. The default choice names the global setting once it loads. */
export const removeWorktreeOnCloseChoices = (
  globalRemoveWorktreeOnClose: boolean | undefined,
): RemoveWorktreeOnCloseChoice[] => {
  let globalAnswer = "";
  if (globalRemoveWorktreeOnClose !== undefined) {
    globalAnswer = globalRemoveWorktreeOnClose ? " (Yes)" : " (No)";
  }
  return [
    {
      key: "default",
      value: null,
      label: `Default${globalAnswer}`,
      description: "Follows the global Git setting.",
    },
    {
      key: "yes",
      value: true,
      label: "Yes",
      description: "Removes the worktree and the local task branch.",
    },
    {
      key: "no",
      value: false,
      label: "No",
      description: "Keeps the worktree and the local task branch.",
    },
  ];
};

export const removeWorktreeOnCloseChoiceKey = (
  value: boolean | null,
): RemoveWorktreeOnCloseChoice["key"] => {
  if (value === null) return "default";
  return value ? "yes" : "no";
};

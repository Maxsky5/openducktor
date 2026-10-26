import type { IssueType, TaskCard } from "@openducktor/contracts";
import type { SelectOption } from "../../lib/select-option";
import {
  ISSUE_TYPE_LABELS,
  PRIORITY_LABELS,
  PRIORITY_LEVELS,
} from "../board/kanban-task-badge-model";
import type { ComposerState, IssueTypeChoice, PriorityOption } from "./task-composer-types";

/** The issue types in display order. New task cannot create an epic yet. */
export const ISSUE_TYPE_CHOICES: readonly IssueTypeChoice[] = [
  {
    value: "feature",
    label: ISSUE_TYPE_LABELS.feature,
    description: "User-facing capability or workflow improvement.",
  },
  {
    value: "bug",
    label: ISSUE_TYPE_LABELS.bug,
    description: "Unexpected behavior, regression, or production defect.",
  },
  {
    value: "task",
    label: ISSUE_TYPE_LABELS.task,
    description: "Standard implementation work item.",
  },
  {
    value: "epic",
    label: ISSUE_TYPE_LABELS.epic,
    description: "Large initiative that contains multiple subtasks.",
    disabled: true,
    disabledText: "Coming soon",
  },
];

export const PRIORITY_OPTIONS: PriorityOption[] = PRIORITY_LEVELS.map((value) => ({
  value,
  ...PRIORITY_LABELS[value],
}));

export const ISSUE_TYPE_DEFAULTS = {
  bug: { aiReviewEnabled: true },
  epic: { aiReviewEnabled: true },
  feature: { aiReviewEnabled: true },
  task: { aiReviewEnabled: true },
} as const;

export const toComposerState = (task?: TaskCard | null): ComposerState => {
  if (!task) {
    return {
      issueType: "task",
      aiReviewEnabled: ISSUE_TYPE_DEFAULTS.task.aiReviewEnabled,
      title: "",
      priority: 2,
      description: "",
      labels: [],
    };
  }

  return {
    issueType: task.issueType,
    aiReviewEnabled: task.aiReviewEnabled,
    title: task.title,
    priority: task.priority,
    description: task.description,
    labels: task.labels,
  };
};

export const issueTypeGuidance = (issueType: IssueType): string => {
  if (issueType === "bug") {
    return "Capture reproduction context, impact, and a concrete fix target.";
  }
  if (issueType === "epic") {
    return "Use this for umbrella initiatives and then create scoped child tasks under it.";
  }
  return "Define enough detail for Planner/Builder automation to execute with minimal ambiguity.";
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

import type { IssueType, TaskCard } from "@openducktor/contracts";
import {
  ISSUE_TYPE_DEFAULTS,
  PRIORITY_OPTIONS,
} from "@/components/features/task-composer/constants";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { ComposerState } from "@/types/task-composer";

export const normalizeLines = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

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

export const collectKnownLabels = (tasks: TaskCard[]): string[] => {
  const labels = new Set<string>();
  for (const entry of tasks) {
    for (const label of entry.labels) {
      labels.add(label);
    }
  }
  return Array.from(labels).sort((left, right) => left.localeCompare(right));
};

export const toPriorityComboboxOptions = (): ComboboxOption[] =>
  PRIORITY_OPTIONS.map((option) => ({
    value: String(option.value),
    label: `${option.label} · ${option.hint}`,
    searchKeywords: [option.hint.toLowerCase(), `priority-${option.value}`],
  }));

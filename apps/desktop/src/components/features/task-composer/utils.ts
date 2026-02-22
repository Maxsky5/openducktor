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
      acceptanceCriteria: "",
      labels: [],
      parentId: "",
    };
  }

  return {
    issueType: task.issueType,
    aiReviewEnabled: task.aiReviewEnabled,
    title: task.title,
    priority: task.priority,
    description: task.description,
    acceptanceCriteria: task.acceptanceCriteria,
    labels: task.labels,
    parentId: task.parentId ?? "",
  };
};

export const issueTypeGuidance = (issueType: IssueType): string => {
  if (issueType === "bug") {
    return "Capture reproduction context and a concrete acceptance signal for the fix.";
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

export const toParentComboboxOptions = (parentCandidates: TaskCard[]): ComboboxOption[] => [
  { value: "__none__", label: "No parent", searchKeywords: ["none"] },
  ...parentCandidates.map((entry) => ({
    value: entry.id,
    label: `${entry.id} · ${entry.title}`,
    searchKeywords: [entry.title.toLowerCase(), entry.issueType, ...entry.labels],
  })),
];

import { Bug, Layers3, ListTodo, Sparkles } from "lucide-react";
import type { IssueTypeOption, PriorityOption } from "@/types/task-composer";

export const ISSUE_TYPE_OPTIONS: IssueTypeOption[] = [
  {
    value: "feature",
    label: "Feature",
    description: "User-facing capability or workflow improvement.",
    icon: Sparkles,
    accentClass: "border-info-border bg-info-surface",
    iconClass: "bg-info-surface text-info-muted",
    indicatorClass: "border-info-border bg-info-surface text-info-muted",
  },
  {
    value: "bug",
    label: "Bug",
    description: "Unexpected behavior, regression, or production defect.",
    icon: Bug,
    accentClass: "border-destructive-border bg-destructive-surface",
    iconClass: "bg-destructive-surface text-destructive-muted",
    indicatorClass: "border-destructive-border bg-destructive-surface text-destructive-muted",
  },
  {
    value: "task",
    label: "Task",
    description: "Standard implementation work item.",
    icon: ListTodo,
    accentClass: "border-input bg-muted/80",
    iconClass: "bg-secondary text-foreground",
    indicatorClass: "border-input bg-secondary text-foreground",
  },
  {
    value: "epic",
    label: "Epic",
    description: "Large initiative that contains multiple subtasks.",
    icon: Layers3,
    accentClass: "border-pending-border bg-pending-surface",
    iconClass: "bg-pending-surface text-pending-muted",
    indicatorClass: "border-pending-border bg-pending-surface text-pending-muted",
  },
];

export const PRIORITY_OPTIONS: PriorityOption[] = [
  { value: 0, label: "P0", hint: "Critical" },
  { value: 1, label: "P1", hint: "High" },
  { value: 2, label: "P2", hint: "Normal" },
  { value: 3, label: "P3", hint: "Low" },
  { value: 4, label: "P4", hint: "Very low" },
];

export const ISSUE_TYPE_DEFAULTS = {
  bug: { aiReviewEnabled: true },
  epic: { aiReviewEnabled: true },
  feature: { aiReviewEnabled: true },
  task: { aiReviewEnabled: true },
} as const;

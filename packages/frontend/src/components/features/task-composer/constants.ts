import { type BuiltinIssueTypeId as IssueType } from "@openducktor/workflows";
import { ISSUE_TYPE_CHOICES } from "@openducktor/frontend-core/tasks/create/task-composer-options";
import type { IssueTypeChoice } from "@openducktor/frontend-core/tasks/create/task-composer-types";
import { Bug, ListTodo, Sparkles } from "lucide-react";
import type { IssueTypeOption } from "@/types/task-composer";

const ISSUE_TYPE_PRESENTATION = {
  feature: {
    icon: Sparkles,
    accentClass: "border-info-border bg-info-surface",
    iconClass: "bg-info-surface text-info-muted",
    indicatorClass: "border-info-border bg-info-surface text-info-muted",
  },
  bug: {
    icon: Bug,
    accentClass: "border-destructive-border bg-destructive-surface",
    iconClass: "bg-destructive-surface text-destructive-muted",
    indicatorClass: "border-destructive-border bg-destructive-surface text-destructive-muted",
  },
  task: {
    icon: ListTodo,
    accentClass: "border-input bg-muted/80",
    iconClass: "bg-secondary text-foreground",
    indicatorClass: "border-input bg-secondary text-foreground",
  },
} satisfies Record<IssueType, Omit<IssueTypeOption, keyof IssueTypeChoice>>;

export const ISSUE_TYPE_OPTIONS: IssueTypeOption[] = ISSUE_TYPE_CHOICES.map((choice) => ({
  ...choice,
  ...ISSUE_TYPE_PRESENTATION[choice.value],
}));

import type { WorkflowIcon } from "@openducktor/contracts";
import type { IssueTypeChoice } from "@openducktor/frontend-core/tasks/create/task-composer-types";
import { Bug, FileText, ListTodo, Sparkles } from "lucide-react";
import type { IssueTypeOption } from "@/types/task-composer";

type IssueTypePaint = Omit<IssueTypeOption, Exclude<keyof IssueTypeChoice, "icon">>;

/** The composer paint of the issue type icons. Other icons use the task paint. */
const ISSUE_TYPE_PRESENTATION = new Map<WorkflowIcon, IssueTypePaint>([
  [
    "feature",
    {
      icon: Sparkles,
      accentClass: "border-info-border bg-info-surface",
      iconClass: "bg-info-surface text-info-muted",
      indicatorClass: "border-info-border bg-info-surface text-info-muted",
    },
  ],
  [
    "bug",
    {
      icon: Bug,
      accentClass: "border-destructive-border bg-destructive-surface",
      iconClass: "bg-destructive-surface text-destructive-muted",
      indicatorClass: "border-destructive-border bg-destructive-surface text-destructive-muted",
    },
  ],
  [
    "task",
    {
      icon: ListTodo,
      accentClass: "border-input bg-muted/80",
      iconClass: "bg-secondary text-foreground",
      indicatorClass: "border-input bg-secondary text-foreground",
    },
  ],
]);

export const issueTypeOptions = (choices: readonly IssueTypeChoice[]): IssueTypeOption[] =>
  choices.map((choice) => {
    const paint = (choice.icon && ISSUE_TYPE_PRESENTATION.get(choice.icon)) || {
      ...ISSUE_TYPE_PRESENTATION.get("task")!,
      icon: FileText,
    };
    return { ...choice, ...paint };
  });

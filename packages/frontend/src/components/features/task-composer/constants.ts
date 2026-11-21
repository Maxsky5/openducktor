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
      iconClass: "bg-info-surface text-info-muted",
    },
  ],
  [
    "bug",
    {
      icon: Bug,
      iconClass: "bg-destructive-surface text-destructive-muted",
    },
  ],
  [
    "task",
    {
      icon: ListTodo,
      iconClass: "bg-secondary text-foreground",
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

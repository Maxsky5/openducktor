import type { IssueTypeChoice } from "@openducktor/frontend-core/tasks/create/task-composer-types";
import type { LucideIcon } from "lucide-react";

export type IssueTypeOption = IssueTypeChoice & {
  icon: LucideIcon;
  accentClass: string;
  iconClass: string;
  indicatorClass: string;
};

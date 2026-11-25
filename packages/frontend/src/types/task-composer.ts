import type { IssueTypeChoice } from "@openducktor/frontend-core/tasks/create/task-composer-types";
import type { LucideIcon } from "lucide-react";

export type IssueTypeOption = Omit<IssueTypeChoice, "icon"> & {
  icon: LucideIcon;
  iconClass: string;
};

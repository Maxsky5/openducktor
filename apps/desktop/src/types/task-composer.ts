import type { IssueType } from "@openducktor/contracts";
import type { LucideIcon } from "lucide-react";

export type ComposerMode = "create" | "edit";

export type ComposerStep = "type" | "details";

export type EditTaskSection = "details" | "spec" | "plan";

export type DocumentEditorView = "write" | "split" | "preview";

export type ComposerState = {
  issueType: IssueType;
  aiReviewEnabled: boolean;
  title: string;
  priority: number;
  description: string;
  labels: string[];
};

export type IssueTypeOption = {
  value: IssueType;
  label: string;
  description: string;
  icon: LucideIcon;
  accentClass: string;
  iconClass: string;
  indicatorClass: string;
};

export type PriorityOption = {
  value: number;
  label: string;
  hint: string;
};

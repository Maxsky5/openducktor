import type { IssueType } from "@openducktor/contracts";

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

/** The text of one issue type choice. Each platform adds its own icon and colors. */
export type IssueTypeChoice = {
  value: IssueType;
  label: string;
  description: string;
  disabled?: boolean;
  disabledText?: string;
};

export type PriorityOption = {
  value: number;
  label: string;
  hint: string;
};

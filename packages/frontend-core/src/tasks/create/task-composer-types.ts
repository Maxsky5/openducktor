import type { WorkflowIcon } from "@openducktor/contracts";
import type { WorkflowIssueTypeId as IssueType } from "@openducktor/workflows";

export type ComposerMode = "create" | "edit";

export type ComposerStep = "type" | "details";

export type EditTaskSection = "details" | { artifactCode: string };

export type DocumentEditorView = "write" | "split" | "preview";

export type ComposerState = {
  issueType: IssueType;
  /** Null follows the global setting. */
  removeWorktreeOnClose: boolean | null;
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
  icon?: WorkflowIcon | undefined;
  guidance?: string | undefined;
  disabled?: boolean;
  disabledText?: string;
};

export type PriorityOption = {
  value: number;
  label: string;
  hint: string;
};

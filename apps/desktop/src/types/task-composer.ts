import type { IssueType } from "@openblueprint/contracts";
import type { LucideIcon } from "lucide-react";

export type ComposerMode = "create" | "edit";

export type ComposerStep = "type" | "details";

export type ComposerState = {
  issueType: IssueType;
  aiReviewEnabled: boolean;
  title: string;
  priority: number;
  description: string;
  design: string;
  acceptanceCriteria: string;
  labels: string[];
  parentId: string;
};

export type IssueTypeOption = {
  value: IssueType;
  label: string;
  description: string;
  icon: LucideIcon;
  accentClass: string;
  iconClass: string;
  supportsParent: boolean;
};

export type PriorityOption = {
  value: number;
  label: string;
  hint: string;
};

export type TaskStatus =
  | "open"
  | "spec_ready"
  | "ready_for_dev"
  | "in_progress"
  | "blocked"
  | "ai_review"
  | "human_review"
  | "deferred"
  | "closed";

export type IssueType = "epic" | "feature" | "task" | "bug";

export type PlanSubtaskInput = {
  title: string;
  issueType?: "task" | "feature" | "bug" | undefined;
  priority?: number | undefined;
  description?: string | undefined;
};

export type TaskCard = {
  id: string;
  title: string;
  status: TaskStatus;
  issueType: IssueType;
  aiReviewEnabled: boolean;
  parentId: string | null;
};

export type RawIssue = {
  id: string;
  title: string;
  status: string;
  issue_type?: string;
  parent?: string | null;
  dependencies?: Array<{
    type?: string;
    dependency_type?: string;
    depends_on_id?: string | null;
    id?: string | null;
  }>;
  metadata?: unknown;
};

export type MarkdownEntry = {
  markdown: string;
  updatedAt: string;
  updatedBy: string;
  sourceTool: string;
  revision: number;
};

export type QaEntry = {
  markdown: string;
  verdict: "approved" | "rejected";
  updatedAt: string;
  updatedBy: string;
  sourceTool: string;
  revision: number;
};

export type JsonObject = Record<string, unknown>;

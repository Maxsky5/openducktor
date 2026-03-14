import type { TaskCard as CanonicalTaskCard, IssueType, TaskStatus } from "@openducktor/contracts";

export type { IssueType, TaskStatus };

export type PlanSubtaskInput = {
  title: string;
  issueType?: Exclude<IssueType, "epic"> | undefined;
  priority?: number | undefined;
  description?: string | undefined;
};

export type TaskCard = Omit<
  Pick<
    CanonicalTaskCard,
    "id" | "title" | "description" | "status" | "issueType" | "aiReviewEnabled"
  >,
  "description"
> & {
  description?: CanonicalTaskCard["description"];
  parentId?: string;
};

export type RawIssue = {
  id: string;
  title: string;
  description?: string;
  status: unknown;
  issue_type?: unknown;
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

import type {
  TaskCard as CanonicalTaskCard,
  IssueType,
  PlanSubtaskInput,
  QaReportVerdict,
  TaskStatus,
} from "@openducktor/contracts";

export type { IssueType, PlanSubtaskInput, QaReportVerdict, TaskStatus };

export type TaskCard = Pick<
  CanonicalTaskCard,
  "id" | "title" | "status" | "issueType" | "aiReviewEnabled" | "documentSummary"
> & {
  description?: CanonicalTaskCard["description"];
  parentId?: string;
};

export type PublicTask = Pick<
  CanonicalTaskCard,
  | "id"
  | "title"
  | "description"
  | "status"
  | "priority"
  | "issueType"
  | "aiReviewEnabled"
  | "labels"
  | "createdAt"
  | "updatedAt"
>;

export type RawIssue = {
  id: string;
  title: string;
  description?: string;
  status: unknown;
  priority?: unknown;
  issue_type?: unknown;
  labels?: unknown;
  owner?: unknown;
  parent?: string | null;
  created_at?: unknown;
  updated_at?: unknown;
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
  verdict: QaReportVerdict;
  updatedAt: string;
  updatedBy: string;
  sourceTool: string;
  revision: number;
};

export type JsonObject = Record<string, unknown>;

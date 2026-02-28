import { z } from "zod";
import type {
  IssueType,
  JsonObject,
  MarkdownEntry,
  QaEntry,
  RawIssue,
  TaskCard,
} from "./contracts";
import { toTaskStatus } from "./workflow-policy";

export const normalizeIssueType = (value: unknown): IssueType => {
  if (value === "epic" || value === "feature" || value === "bug") {
    return value;
  }
  return "task";
};

const defaultQaRequiredForIssueType = (_issueType: IssueType): boolean => true;

export const parseMetadataRoot = (metadata: unknown): JsonObject => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return { ...(metadata as JsonObject) };
};

export const ensureObject = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as JsonObject) };
};

const RevisionSchema = z.number().int().positive();
const UpdatedAtSchema = z.string().datetime({ offset: true });

const MarkdownEntrySchema = z.object({
  markdown: z.string(),
  updatedAt: UpdatedAtSchema,
  updatedBy: z.string(),
  sourceTool: z.string(),
  revision: RevisionSchema,
});

const QaEntrySchema = MarkdownEntrySchema.extend({
  verdict: z.enum(["approved", "rejected"]),
});

const parseTypedEntries = <T>(schema: z.ZodType<T>, value: unknown): T[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: T[] = [];
  for (const entry of value) {
    const parsed = schema.safeParse(entry);
    if (!parsed.success) {
      continue;
    }
    entries.push(parsed.data);
  }

  return entries;
};

export const parseMarkdownEntries = (value: unknown): MarkdownEntry[] => {
  return parseTypedEntries(MarkdownEntrySchema, value);
};

export const parseQaEntries = (value: unknown): QaEntry[] => {
  return parseTypedEntries(QaEntrySchema, value);
};

const normalizeParentId = (issue: RawIssue): string | undefined => {
  if (typeof issue.parent === "string" && issue.parent.trim().length > 0) {
    return issue.parent;
  }

  if (!Array.isArray(issue.dependencies)) {
    return undefined;
  }

  for (const dependency of issue.dependencies) {
    if (!dependency || typeof dependency !== "object") {
      continue;
    }
    const dependencyType = dependency.dependency_type ?? dependency.type;
    if (dependencyType !== "parent-child") {
      continue;
    }
    if (
      typeof dependency.depends_on_id === "string" &&
      dependency.depends_on_id.trim().length > 0
    ) {
      return dependency.depends_on_id;
    }
    if (typeof dependency.id === "string" && dependency.id.trim().length > 0) {
      return dependency.id;
    }
  }

  return undefined;
};

export const issueToTaskCard = (issue: RawIssue, metadataNamespace: string): TaskCard => {
  const root = parseMetadataRoot(issue.metadata);
  const namespace = ensureObject(root[metadataNamespace]);
  const qaRequired =
    typeof namespace.qaRequired === "boolean"
      ? namespace.qaRequired
      : defaultQaRequiredForIssueType(normalizeIssueType(issue.issue_type));

  const parentId = normalizeParentId(issue);

  return {
    id: issue.id,
    title: issue.title,
    status: toTaskStatus(issue.status),
    issueType: normalizeIssueType(issue.issue_type),
    aiReviewEnabled: qaRequired,
    parentId,
  };
};

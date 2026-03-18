import { qaReportVerdictSchema, taskPrioritySchema } from "@openducktor/contracts";
import { z } from "zod";
import { parseBeadsIssueType, parseBeadsTaskStatus } from "./beads-task-parsing";
import type {
  JsonObject,
  MarkdownEntry,
  PublicTask,
  QaEntry,
  RawIssue,
  TaskCard,
} from "./contracts";

const defaultQaRequiredForIssueType = (): boolean => true;

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
const BeadsTimestampSchema = z.string().datetime({ offset: true });

const MarkdownEntrySchema = z.object({
  markdown: z.string(),
  updatedAt: UpdatedAtSchema,
  updatedBy: z.string(),
  sourceTool: z.string(),
  revision: RevisionSchema,
});

const QaEntrySchema = MarkdownEntrySchema.extend({
  verdict: qaReportVerdictSchema,
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

export const normalizeLabels = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const labels = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }
    labels.add(trimmed);
  }

  return Array.from(labels).sort((left, right) => left.localeCompare(right));
};

const parsePriority = (taskId: string, value: unknown): number => {
  const parsed = taskPrioritySchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid Beads priority for task ${taskId}: received ${JSON.stringify(value)}. Expected an integer 0..4.`,
    );
  }
  return parsed.data;
};

const parseTimestamp = (
  taskId: string,
  fieldName: "created_at" | "updated_at",
  value: unknown,
): string => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (BeadsTimestampSchema.safeParse(trimmed).success) {
      return trimmed;
    }
  }

  throw new Error(
    `Invalid Beads ${fieldName} for task ${taskId}: expected a valid ISO-8601 timestamp string.`,
  );
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
  const issueType = parseBeadsIssueType(issue.id, issue.issue_type);
  const root = parseMetadataRoot(issue.metadata);
  const namespace = ensureObject(root[metadataNamespace]);
  const qaRequired =
    typeof namespace.qaRequired === "boolean"
      ? namespace.qaRequired
      : defaultQaRequiredForIssueType();

  const parentId = normalizeParentId(issue);

  return {
    id: issue.id,
    title: issue.title,
    ...(typeof issue.description === "string" ? { description: issue.description } : {}),
    status: parseBeadsTaskStatus(issue.id, issue.status),
    issueType,
    aiReviewEnabled: qaRequired,
    ...(parentId ? { parentId } : {}),
  };
};

export const issueToPublicTask = (issue: RawIssue, metadataNamespace: string): PublicTask => {
  const issueType = parseBeadsIssueType(issue.id, issue.issue_type);
  const status = parseBeadsTaskStatus(issue.id, issue.status);
  const root = parseMetadataRoot(issue.metadata);
  const namespace = ensureObject(root[metadataNamespace]);
  const qaRequired =
    typeof namespace.qaRequired === "boolean"
      ? namespace.qaRequired
      : defaultQaRequiredForIssueType();

  return {
    id: issue.id,
    title: issue.title,
    description: typeof issue.description === "string" ? issue.description : "",
    status,
    priority: parsePriority(issue.id, issue.priority),
    issueType,
    aiReviewEnabled: qaRequired,
    labels: normalizeLabels(issue.labels),
    createdAt: parseTimestamp(issue.id, "created_at", issue.created_at),
    updatedAt: parseTimestamp(issue.id, "updated_at", issue.updated_at),
  };
};

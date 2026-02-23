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

export const parseMarkdownEntries = (value: unknown): MarkdownEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: MarkdownEntry[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.markdown !== "string" ||
      typeof record.updatedAt !== "string" ||
      typeof record.updatedBy !== "string" ||
      typeof record.sourceTool !== "string" ||
      typeof record.revision !== "number"
    ) {
      continue;
    }
    entries.push({
      markdown: record.markdown,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy,
      sourceTool: record.sourceTool,
      revision: record.revision,
    });
  }
  return entries;
};

export const parseQaEntries = (value: unknown): QaEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: QaEntry[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.markdown !== "string" ||
      (record.verdict !== "approved" && record.verdict !== "rejected") ||
      typeof record.updatedAt !== "string" ||
      typeof record.updatedBy !== "string" ||
      typeof record.sourceTool !== "string" ||
      typeof record.revision !== "number"
    ) {
      continue;
    }

    entries.push({
      markdown: record.markdown,
      verdict: record.verdict,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy,
      sourceTool: record.sourceTool,
      revision: record.revision,
    });
  }
  return entries;
};

const normalizeParentId = (issue: RawIssue): string | null => {
  if (typeof issue.parent === "string" && issue.parent.trim().length > 0) {
    return issue.parent;
  }

  if (!Array.isArray(issue.dependencies)) {
    return null;
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

  return null;
};

export const issueToTaskCard = (issue: RawIssue, metadataNamespace: string): TaskCard => {
  const root = parseMetadataRoot(issue.metadata);
  const namespace = ensureObject(root[metadataNamespace]);
  const qaRequired =
    typeof namespace.qaRequired === "boolean"
      ? namespace.qaRequired
      : defaultQaRequiredForIssueType(normalizeIssueType(issue.issue_type));

  return {
    id: issue.id,
    title: issue.title,
    status: toTaskStatus(issue.status),
    issueType: normalizeIssueType(issue.issue_type),
    aiReviewEnabled: qaRequired,
    parentId: normalizeParentId(issue),
  };
};

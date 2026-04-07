import type { QaWorkflowVerdict } from "@openducktor/contracts";
import type { JsonObject, RawIssue } from "./contracts";
import {
  ensureObject,
  parseMarkdownEntries,
  parseMetadataRoot,
  parseQaEntries,
} from "./task-mapping";

export type NamespaceData = {
  root: JsonObject;
  namespace: JsonObject;
  documents: JsonObject;
};

export type TaskDocumentPresence = {
  hasSpec: boolean;
  hasPlan: boolean;
  hasQaReport: boolean;
};

export type TaskDocumentsSummary = {
  qaVerdict: QaWorkflowVerdict;
  documents: TaskDocumentPresence;
};

export type TaskDocumentSection = {
  markdown: string;
  updatedAt: string | null;
};

export type LatestQaReportSection = TaskDocumentSection & {
  verdict: QaWorkflowVerdict;
};

export type ReadTaskDocumentsInput = {
  includeSpec?: boolean | undefined;
  includePlan?: boolean | undefined;
  includeQaReport?: boolean | undefined;
};

export type ReadTaskDocumentsResult = {
  documents: {
    spec?: TaskDocumentSection;
    implementationPlan?: TaskDocumentSection;
    latestQaReport?: LatestQaReportSection;
  };
};

export function getNamespaceData(issue: RawIssue, metadataNamespace: string): NamespaceData {
  const root = parseMetadataRoot(issue.metadata);
  const namespace = ensureObject(root[metadataNamespace]);
  const documents = ensureObject(namespace.documents);
  return {
    root,
    namespace,
    documents,
  };
}

const hasMarkdownContent = (value: string | undefined): boolean => {
  return typeof value === "string" && value.trim().length > 0;
};

const toDocumentSection = (entry?: { markdown: string; updatedAt: string }) => {
  if (!entry || !hasMarkdownContent(entry.markdown)) {
    return {
      markdown: "",
      updatedAt: null,
    };
  }

  const { markdown, updatedAt } = entry;
  return {
    markdown,
    updatedAt,
  };
};

const toQaReportSection = (entry?: {
  markdown: string;
  updatedAt: string;
  verdict: QaWorkflowVerdict;
}): LatestQaReportSection => {
  if (!entry || !hasMarkdownContent(entry.markdown)) {
    return {
      markdown: "",
      updatedAt: null,
      verdict: "not_reviewed",
    };
  }

  const { markdown, updatedAt, verdict } = entry;
  return {
    markdown,
    updatedAt,
    verdict,
  };
};

const getLatestTaskDocuments = (issue: RawIssue, metadataNamespace: string) => {
  const { documents } = getNamespaceData(issue, metadataNamespace);
  const specEntries = parseMarkdownEntries(documents.spec);
  const planEntries = parseMarkdownEntries(documents.implementationPlan);
  const qaEntries = parseQaEntries(documents.qaReports);

  return {
    specLatest: specEntries.at(-1),
    planLatest: planEntries.at(-1),
    qaLatest: qaEntries.at(-1),
  };
};

export function summarizeTaskDocuments(
  issue: RawIssue,
  metadataNamespace: string,
): TaskDocumentsSummary {
  const { specLatest, planLatest, qaLatest } = getLatestTaskDocuments(issue, metadataNamespace);
  const qaHasContent = hasMarkdownContent(qaLatest?.markdown);
  const qaVerdict = qaHasContent && qaLatest ? qaLatest.verdict : "not_reviewed";

  return {
    qaVerdict,
    documents: {
      hasSpec: hasMarkdownContent(specLatest?.markdown),
      hasPlan: hasMarkdownContent(planLatest?.markdown),
      hasQaReport: qaHasContent,
    },
  };
}

export function readTaskDocuments(
  issue: RawIssue,
  metadataNamespace: string,
  input: ReadTaskDocumentsInput,
): ReadTaskDocumentsResult {
  const { specLatest, planLatest, qaLatest } = getLatestTaskDocuments(issue, metadataNamespace);

  return {
    documents: {
      ...(input.includeSpec
        ? {
            spec: toDocumentSection(specLatest),
          }
        : {}),
      ...(input.includePlan
        ? {
            implementationPlan: toDocumentSection(planLatest),
          }
        : {}),
      ...(input.includeQaReport
        ? {
            latestQaReport: toQaReportSection(qaLatest),
          }
        : {}),
    },
  };
}

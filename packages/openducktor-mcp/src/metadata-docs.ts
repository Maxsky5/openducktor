import type { QaReportVerdict } from "@openducktor/contracts";
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

export type TaskDocumentsSnapshot = {
  spec: { markdown: string; updatedAt: string | null };
  implementationPlan: { markdown: string; updatedAt: string | null };
  latestQaReport: {
    markdown: string;
    updatedAt: string | null;
    verdict: QaReportVerdict | null;
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

export function parseTaskDocuments(
  issue: RawIssue,
  metadataNamespace: string,
): TaskDocumentsSnapshot {
  const { documents } = getNamespaceData(issue, metadataNamespace);
  const specEntries = parseMarkdownEntries(documents.spec);
  const planEntries = parseMarkdownEntries(documents.implementationPlan);
  const qaEntries = parseQaEntries(documents.qaReports);

  const specLatest = specEntries.at(-1);
  const planLatest = planEntries.at(-1);
  const qaLatest = qaEntries.at(-1);

  return {
    spec: {
      markdown: specLatest?.markdown ?? "",
      updatedAt: specLatest?.updatedAt ?? null,
    },
    implementationPlan: {
      markdown: planLatest?.markdown ?? "",
      updatedAt: planLatest?.updatedAt ?? null,
    },
    latestQaReport: {
      markdown: qaLatest?.markdown ?? "",
      updatedAt: qaLatest?.updatedAt ?? null,
      verdict: qaLatest?.verdict ?? null,
    },
  };
}

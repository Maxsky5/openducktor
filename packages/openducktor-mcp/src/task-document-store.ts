import type { TimeProvider } from "./beads-runtime";
import type { JsonObject, MarkdownEntry, QaEntry, RawIssue } from "./contracts";
import {
  type NamespaceData,
  parseTaskDocuments,
  type TaskDocumentsSnapshot,
} from "./metadata-docs";
import { parseMarkdownEntries, parseQaEntries } from "./task-mapping";

type MarkdownDocumentKey = "spec" | "implementationPlan";

type PersistLatestMarkdownInput = {
  taskId: string;
  markdown: string;
  documentKey: MarkdownDocumentKey;
  updatedBy: string;
  sourceTool: string;
};

export type TaskDocumentPersistence = {
  metadataNamespace: string;
  showRawIssue: (taskId: string) => Promise<RawIssue>;
  getNamespaceData: (issue: RawIssue) => NamespaceData;
  writeNamespace: (taskId: string, root: JsonObject, namespace: JsonObject) => Promise<void>;
};

export class TaskDocumentStore {
  private readonly persistence: TaskDocumentPersistence;
  private readonly now: TimeProvider;

  constructor(persistence: TaskDocumentPersistence, now: TimeProvider) {
    this.persistence = persistence;
    this.now = now;
  }

  parseDocs(issue: RawIssue): TaskDocumentsSnapshot {
    return parseTaskDocuments(issue, this.persistence.metadataNamespace);
  }

  async persistSpec(
    taskId: string,
    markdown: string,
  ): Promise<{ updatedAt: string; revision: number }> {
    return this.persistLatestMarkdown({
      taskId,
      markdown,
      documentKey: "spec",
      updatedBy: "spec-agent",
      sourceTool: "odt_set_spec",
    });
  }

  async persistImplementationPlan(
    taskId: string,
    markdown: string,
  ): Promise<{ updatedAt: string; revision: number }> {
    return this.persistLatestMarkdown({
      taskId,
      markdown,
      documentKey: "implementationPlan",
      updatedBy: "planner-agent",
      sourceTool: "odt_set_plan",
    });
  }

  async appendQaReport(
    taskId: string,
    markdown: string,
    verdict: "approved" | "rejected",
  ): Promise<void> {
    const issue = await this.persistence.showRawIssue(taskId);
    const { root, namespace, documents } = this.persistence.getNamespaceData(issue);
    const entries = parseQaEntries(documents.qaReports);
    const nextRevision = (entries.at(-1)?.revision ?? 0) + 1;

    const entry: QaEntry = {
      markdown,
      verdict,
      updatedAt: this.now(),
      updatedBy: "qa-agent",
      sourceTool: verdict === "approved" ? "odt_qa_approved" : "odt_qa_rejected",
      revision: nextRevision,
    };

    const nextDocuments = {
      ...documents,
      qaReports: [...entries, entry],
    };

    const nextNamespace = {
      ...namespace,
      documents: nextDocuments,
    };

    await this.persistence.writeNamespace(taskId, root, nextNamespace);
  }

  private async persistLatestMarkdown(
    input: PersistLatestMarkdownInput,
  ): Promise<{ updatedAt: string; revision: number }> {
    const issue = await this.persistence.showRawIssue(input.taskId);
    const { root, namespace, documents } = this.persistence.getNamespaceData(issue);
    const nextRevision =
      (parseMarkdownEntries(documents[input.documentKey]).at(-1)?.revision ?? 0) + 1;

    const updatedAt = this.now();
    const entry: MarkdownEntry = {
      markdown: input.markdown,
      updatedAt,
      updatedBy: input.updatedBy,
      sourceTool: input.sourceTool,
      revision: nextRevision,
    };

    const nextDocuments = {
      ...documents,
      [input.documentKey]: [entry],
    };

    const nextNamespace = {
      ...namespace,
      documents: nextDocuments,
    };

    await this.persistence.writeNamespace(input.taskId, root, nextNamespace);
    return {
      updatedAt,
      revision: nextRevision,
    };
  }
}

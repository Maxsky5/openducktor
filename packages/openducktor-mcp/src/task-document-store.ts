import type { AgentToolName } from "@openducktor/contracts";
import type { TaskPersistencePort } from "./bd-persistence";
import type { TimeProvider } from "./beads-runtime";
import type { MarkdownEntry, QaEntry, RawIssue } from "./contracts";
import { parseTaskDocuments, type TaskDocumentsSnapshot } from "./metadata-docs";
import { parseMarkdownEntries, parseQaEntries } from "./task-mapping";

type MarkdownDocumentKey = "spec" | "implementationPlan";
type QaVerdict = "approved" | "rejected";

type PersistLatestMarkdownInput = {
  taskId: string;
  markdown: string;
  documentKey: MarkdownDocumentKey;
};

type DocumentSource = {
  updatedBy: string;
  sourceTool: AgentToolName;
};

const MARKDOWN_DOCUMENT_SOURCES = {
  spec: {
    updatedBy: "spec-agent",
    sourceTool: "odt_set_spec",
  },
  implementationPlan: {
    updatedBy: "planner-agent",
    sourceTool: "odt_set_plan",
  },
} as const satisfies Record<MarkdownDocumentKey, DocumentSource>;

const QA_REPORT_SOURCES = {
  approved: {
    updatedBy: "qa-agent",
    sourceTool: "odt_qa_approved",
  },
  rejected: {
    updatedBy: "qa-agent",
    sourceTool: "odt_qa_rejected",
  },
} as const satisfies Record<QaVerdict, DocumentSource>;

const getNextRevision = (entries: Array<{ revision: number }>): number => {
  const maxRevision = entries.reduce((max, entry) => Math.max(max, entry.revision), 0);
  return maxRevision + 1;
};

export type TaskDocumentPort = {
  parseDocs(issue: RawIssue): TaskDocumentsSnapshot;
  persistSpec(taskId: string, markdown: string): Promise<{ updatedAt: string; revision: number }>;
  persistImplementationPlan(
    taskId: string,
    markdown: string,
  ): Promise<{ updatedAt: string; revision: number }>;
  appendQaReport(taskId: string, markdown: string, verdict: QaVerdict): Promise<void>;
};

export type TaskDocumentPersistence = Pick<
  TaskPersistencePort,
  "metadataNamespace" | "showRawIssue" | "getNamespaceData" | "writeNamespace"
>;

export class TaskDocumentStore implements TaskDocumentPort {
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
    });
  }

  async appendQaReport(taskId: string, markdown: string, verdict: QaVerdict): Promise<void> {
    const issue = await this.persistence.showRawIssue(taskId);
    const { root, namespace, documents } = this.persistence.getNamespaceData(issue);
    const entries = parseQaEntries(documents.qaReports);
    const source = QA_REPORT_SOURCES[verdict];
    const nextRevision = getNextRevision(entries);

    const entry: QaEntry = {
      markdown,
      verdict,
      updatedAt: this.now(),
      updatedBy: source.updatedBy,
      sourceTool: source.sourceTool,
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
    const source = MARKDOWN_DOCUMENT_SOURCES[input.documentKey];
    const nextRevision = getNextRevision(parseMarkdownEntries(documents[input.documentKey]));

    const updatedAt = this.now();
    const entry: MarkdownEntry = {
      markdown: input.markdown,
      updatedAt,
      updatedBy: source.updatedBy,
      sourceTool: source.sourceTool,
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

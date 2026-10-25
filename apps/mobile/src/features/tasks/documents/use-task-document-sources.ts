import type { TaskCard } from "@openducktor/contracts";
import { TASK_DOCUMENT_SECTION_COPY } from "@openducktor/frontend-core/tasks/details/task-details-sheet-model";
import { useTaskDocuments } from "@openducktor/frontend-core/tasks/details/use-task-documents";
import { useCallback, useMemo } from "react";
import { useMarkdownBlocks } from "@/rich-content/markdown/markdown-view";
import {
  qaVerdictPresentation,
  taskDescriptionForReading,
} from "../presentation/task-document-paint";
import type { DocumentSource, HostDocumentKey } from "./document-rows";

/** The description of a task, parsed into Markdown blocks. It needs no host read. */
export function useTaskDescriptionSource(
  task: TaskCard,
  workspaceId: string,
  repoPath: string,
): DocumentSource {
  const description = useMemo(
    () => taskDescriptionForReading(task.description),
    [task.description],
  );
  const document = useMarkdownBlocks(description, `${task.id}:description:${task.updatedAt}`);
  const providerId = task.sourceIssue?.providerId ?? null;
  const imageContext = useMemo(
    () => ({
      workspaceId,
      taskId: task.id,
      issue: providerId ? { repoPath, providerId } : null,
    }),
    [providerId, repoPath, task.id, workspaceId],
  );
  return useMemo<DocumentSource>(
    () => ({
      key: "description",
      ...TASK_DOCUMENT_SECTION_COPY.description,
      updatedAt: null,
      exists: description.trim().length > 0,
      isLoading: false,
      error: null,
      blocks: document.blocks,
      definitions: document.definitions,
      imageContext,
      badge: null,
    }),
    [description, document, imageContext],
  );
}

export type TaskDocumentSources = {
  sources: Record<HostDocumentKey, DocumentSource>;
  reload: (key: HostDocumentKey) => void;
};

/**
 * The Spec Document, Implementation Plan, and latest QA report of a task, parsed into Markdown
 * blocks. The host reads all three at once, so a change of document shows at once.
 */
export function useTaskDocumentSources({
  task,
  repoPath,
}: {
  task: TaskCard;
  repoPath: string;
}): TaskDocumentSources {
  const { specDoc, planDoc, qaDoc, reloadDocument } = useTaskDocuments(task.id, true, repoPath);
  const specDocument = useMarkdownBlocks(
    specDoc.markdown,
    `${task.id}:spec:${specDoc.updatedAt ?? ""}`,
  );
  const planDocument = useMarkdownBlocks(
    planDoc.markdown,
    `${task.id}:plan:${planDoc.updatedAt ?? ""}`,
  );
  const qaDocument = useMarkdownBlocks(qaDoc.markdown, `${task.id}:qa:${qaDoc.updatedAt ?? ""}`);
  const summary = task.artifactSummary;
  const verdict = qaVerdictPresentation(summary.qaReport.verdict);

  const sources = useMemo(
    () =>
      ({
        spec: {
          key: "spec",
          ...TASK_DOCUMENT_SECTION_COPY.spec,
          updatedAt: specDoc.updatedAt ?? summary.spec.updatedAt ?? null,
          exists: summary.spec.has || specDoc.markdown.length > 0,
          isLoading: specDoc.isLoading,
          error: specDoc.error,
          blocks: specDoc.loaded ? specDocument.blocks : null,
          definitions: specDocument.definitions,
          imageContext: null,
          badge: null,
        },
        plan: {
          key: "plan",
          ...TASK_DOCUMENT_SECTION_COPY.plan,
          updatedAt: planDoc.updatedAt ?? summary.plan.updatedAt ?? null,
          exists: summary.plan.has || planDoc.markdown.length > 0,
          isLoading: planDoc.isLoading,
          error: planDoc.error,
          blocks: planDoc.loaded ? planDocument.blocks : null,
          definitions: planDocument.definitions,
          imageContext: null,
          badge: null,
        },
        qa: {
          key: "qa",
          ...TASK_DOCUMENT_SECTION_COPY.qa,
          updatedAt: qaDoc.updatedAt ?? summary.qaReport.updatedAt ?? null,
          exists: summary.qaReport.has || qaDoc.markdown.length > 0,
          isLoading: qaDoc.isLoading,
          error: qaDoc.error,
          blocks: qaDoc.loaded ? qaDocument.blocks : null,
          definitions: qaDocument.definitions,
          imageContext: null,
          badge: summary.qaReport.has ? { label: verdict.label, tone: verdict.tone } : null,
        },
      }) satisfies Record<HostDocumentKey, DocumentSource>,
    [
      planDoc,
      planDocument,
      qaDoc,
      qaDocument,
      specDoc,
      specDocument,
      summary,
      verdict.label,
      verdict.tone,
    ],
  );

  const reload = useCallback((key: HostDocumentKey) => void reloadDocument(key), [reloadDocument]);
  return { sources, reload };
}

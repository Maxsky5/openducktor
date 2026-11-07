import { readMarkdownDocument } from "@/rich-content/markdown/markdown-document";
import { type ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import { TASK_DOCUMENT_SECTION_COPY } from "@openducktor/frontend-core/tasks/details/task-details-sheet-model";
import { useTaskDocuments } from "@openducktor/frontend-core/tasks/details/use-task-documents";
import { useCallback, useMemo } from "react";
import { useMarkdownBlocks } from "@/rich-content/markdown/markdown-view";
import { taskDescriptionForReading } from "../presentation/task-document-paint";
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
  sources: ReadonlyMap<HostDocumentKey, DocumentSource>;
  reload: (key: HostDocumentKey) => void;
};

/**
 * The Spec Document, Implementation Plan, and latest QA report of a task, parsed into Markdown
 * blocks. The host reads all three at once, so a change of document shows at once.
 */
export function useTaskDocumentSources({
  task,
  workspaceId,
  repoPath,
}: {
  task: TaskCard;
  workspaceId: string;
  repoPath: string;
}): TaskDocumentSources {
  const { documents, reloadDocument } = useTaskDocuments(task, true, { workspaceId, repoPath });
  const sources = useMemo<ReadonlyMap<string, DocumentSource>>(
    () =>
      new Map(
        task.taskWorkflow.definition.artifacts.map((artifact) => {
          const payload = documents[artifact.id]!;
          const parsed = readMarkdownDocument(
            payload.markdown,
            `${repoPath}:${task.id}:${artifact.id}:${payload.updatedAt ?? ""}`,
            null,
          );
          const summary = task.artifactSummary[artifact.id];
          const verdict =
            artifact.kind === "review"
              ? artifact.verdicts.find(({ id }) => id === summary?.verdict)
              : undefined;
          return [
            artifact.id,
            {
              key: artifact.id,
              title: artifact.label,
              empty: `No ${artifact.label.toLowerCase()} saved.`,
              updatedAt: payload.updatedAt ?? summary?.updatedAt ?? null,
              exists: summary?.present === true || payload.markdown.length > 0,
              isLoading: payload.isLoading,
              error: payload.error,
              blocks: payload.loaded ? parsed.blocks : null,
              definitions: parsed.definitions,
              imageContext: null,
              badge: verdict
                ? { label: verdict.label, tone: verdict.passes ? "success" : "destructive" }
                : null,
            },
          ];
        }),
      ),
    [task, repoPath, documents],
  );
  const reload = useCallback(
    (key: string) => {
      reloadDocument(key);
    },
    [reloadDocument],
  );
  return { sources, reload };
}

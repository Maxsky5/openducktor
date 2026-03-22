import type { TaskCard } from "@openducktor/contracts";
import { normalizeOdtWorkflowToolName } from "@openducktor/core";
import { useEffect, useRef } from "react";
import { useTaskDocuments } from "@/components/features/task-details/use-task-documents";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { extractCompletionTimestamp, parseTimestamp } from "./agents-page-selection";

type UseAgentStudioDocumentsArgs = {
  activeRepo?: string | null;
  taskId: string;
  activeSession: AgentSessionState | null;
  selectedTask: TaskCard | null;
};

export function useAgentStudioDocuments({
  activeRepo = null,
  taskId,
  activeSession,
  selectedTask,
}: UseAgentStudioDocumentsArgs): {
  specDoc: ReturnType<typeof useTaskDocuments>["specDoc"];
  planDoc: ReturnType<typeof useTaskDocuments>["planDoc"];
  qaDoc: ReturnType<typeof useTaskDocuments>["qaDoc"];
} {
  const { specDoc, planDoc, qaDoc, reloadDocument, applyDocumentUpdate } = useTaskDocuments(
    taskId || null,
    true,
    activeRepo ?? "",
  );

  const documentContextKey = `${taskId}:${activeSession?.sessionId ?? ""}`;
  const processedDocumentToolEventsRef = useRef(new Set<string>());
  const documentReloadAttemptsRef = useRef(new Map<string, number>());
  const refreshedTaskVersionsRef = useRef(new Set<string>());
  const taskDocumentVersionKey =
    taskId && selectedTask
      ? [
          activeRepo ?? "",
          taskId,
          selectedTask.updatedAt,
          selectedTask.documentSummary.spec.has ? "1" : "0",
          selectedTask.documentSummary.spec.updatedAt ?? "",
          selectedTask.documentSummary.plan.has ? "1" : "0",
          selectedTask.documentSummary.plan.updatedAt ?? "",
          selectedTask.documentSummary.qaReport.has ? "1" : "0",
          selectedTask.documentSummary.qaReport.updatedAt ?? "",
          selectedTask.documentSummary.qaReport.verdict ?? "",
        ].join(":")
      : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: Context key intentionally controls reset boundary.
  useEffect(() => {
    processedDocumentToolEventsRef.current.clear();
    documentReloadAttemptsRef.current.clear();
    refreshedTaskVersionsRef.current.clear();
  }, [documentContextKey]);

  useEffect(() => {
    if (!taskId || taskDocumentVersionKey === null) {
      return;
    }

    if (refreshedTaskVersionsRef.current.has(taskDocumentVersionKey)) {
      return;
    }

    const accepted = [reloadDocument("spec"), reloadDocument("plan"), reloadDocument("qa")];
    if (accepted.every(Boolean)) {
      refreshedTaskVersionsRef.current.add(taskDocumentVersionKey);
    }
  }, [reloadDocument, taskDocumentVersionKey, taskId]);

  useEffect(() => {
    if (!activeSession || !taskId) {
      return;
    }

    for (let index = 0; index < activeSession.messages.length; index += 1) {
      const message = activeSession.messages[index];
      if (!message) {
        continue;
      }
      const eventKey = `${activeSession.sessionId}:${message.id}`;
      if (processedDocumentToolEventsRef.current.has(eventKey)) {
        continue;
      }

      const meta = message.meta;
      if (!meta || meta.kind !== "tool" || meta.status !== "completed") {
        continue;
      }
      const normalizedTool = normalizeOdtWorkflowToolName(meta.tool);
      const target =
        normalizedTool === "odt_set_spec"
          ? { section: "spec" as const, state: specDoc, inputKey: "markdown" as const }
          : normalizedTool === "odt_set_plan"
            ? { section: "plan" as const, state: planDoc, inputKey: "markdown" as const }
            : normalizedTool === "odt_qa_approved" || normalizedTool === "odt_qa_rejected"
              ? { section: "qa" as const, state: qaDoc, inputKey: "reportMarkdown" as const }
              : null;
      if (!target) {
        continue;
      }

      const completionInfo =
        extractCompletionTimestamp(meta.output) ?? extractCompletionTimestamp(message.content);
      const toolInput =
        typeof meta.input === "object" && meta.input !== null
          ? (meta.input as Record<string, unknown>)
          : null;
      const inputMarkdown = toolInput?.[target.inputKey];
      const hasInputMarkdown = typeof inputMarkdown === "string" && inputMarkdown.trim().length > 0;

      let effectiveUpdatedAtTimestamp = parseTimestamp(target.state.updatedAt);
      if (hasInputMarkdown) {
        const shouldApplyOptimisticDocument =
          target.state.markdown.trim() !== inputMarkdown.trim() ||
          (completionInfo !== null &&
            (effectiveUpdatedAtTimestamp === null ||
              effectiveUpdatedAtTimestamp < completionInfo.timestamp));
        if (shouldApplyOptimisticDocument) {
          applyDocumentUpdate(target.section, {
            markdown: inputMarkdown,
            updatedAt: completionInfo?.raw ?? target.state.updatedAt ?? new Date().toISOString(),
          });
          effectiveUpdatedAtTimestamp = completionInfo?.timestamp ?? effectiveUpdatedAtTimestamp;
        }
      }

      if (
        completionInfo !== null &&
        effectiveUpdatedAtTimestamp !== null &&
        effectiveUpdatedAtTimestamp >= completionInfo.timestamp
      ) {
        processedDocumentToolEventsRef.current.add(eventKey);
        documentReloadAttemptsRef.current.delete(eventKey);
        continue;
      }

      if (hasInputMarkdown) {
        processedDocumentToolEventsRef.current.add(eventKey);
        documentReloadAttemptsRef.current.delete(eventKey);
        continue;
      }

      if (target.state.isLoading) {
        continue;
      }

      const attempts = documentReloadAttemptsRef.current.get(eventKey) ?? 0;
      if (attempts >= 6) {
        processedDocumentToolEventsRef.current.add(eventKey);
        documentReloadAttemptsRef.current.delete(eventKey);
        continue;
      }

      const triggered = reloadDocument(target.section);
      if (triggered) {
        documentReloadAttemptsRef.current.set(eventKey, attempts + 1);
      }
    }
  }, [activeSession, applyDocumentUpdate, planDoc, qaDoc, reloadDocument, specDoc, taskId]);

  return {
    specDoc,
    planDoc,
    qaDoc,
  };
}

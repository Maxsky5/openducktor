import type { TaskCard } from "@openducktor/contracts";
import { normalizeOdtWorkflowToolName } from "@openducktor/core";
import { useEffect, useRef } from "react";
import { useTaskDocuments } from "@/components/features/task-details/use-task-documents";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { forEachSessionMessageFrom } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { findFirstChangedMessageIndex } from "./agent-session-message-diff";
import { extractCompletionTimestamp, parseTimestamp } from "./agents-page-selection";

type UseAgentStudioDocumentsArgs = {
  activeRepo?: string | null;
  taskId: string;
  activeSession: AgentSessionState | null;
  selectedTask: TaskCard | null;
};

type WorkflowDocumentTarget = {
  section: "spec" | "plan" | "qa";
  state: ReturnType<typeof useTaskDocuments>["specDoc"];
  inputKey: "markdown" | "reportMarkdown";
};

const resolveWorkflowDocumentTarget = (
  normalizedTool: string | null,
  docs: {
    specDoc: ReturnType<typeof useTaskDocuments>["specDoc"];
    planDoc: ReturnType<typeof useTaskDocuments>["planDoc"];
    qaDoc: ReturnType<typeof useTaskDocuments>["qaDoc"];
  },
): WorkflowDocumentTarget | null => {
  if (normalizedTool === "odt_set_spec") {
    return {
      section: "spec",
      state: docs.specDoc,
      inputKey: "markdown",
    };
  }

  if (normalizedTool === "odt_set_plan") {
    return {
      section: "plan",
      state: docs.planDoc,
      inputKey: "markdown",
    };
  }

  if (normalizedTool === "odt_qa_approved" || normalizedTool === "odt_qa_rejected") {
    return {
      section: "qa",
      state: docs.qaDoc,
      inputKey: "reportMarkdown",
    };
  }

  return null;
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
  const { runtimeDefinitions } = useRuntimeDefinitionsContext();
  const { specDoc, planDoc, qaDoc, reloadDocument, applyDocumentUpdate } = useTaskDocuments(
    taskId || null,
    true,
    activeRepo ?? "",
  );
  const workflowToolAliasesByCanonical = activeSession?.runtimeKind
    ? findRuntimeDefinition(runtimeDefinitions, activeSession.runtimeKind)
        ?.workflowToolAliasesByCanonical
    : undefined;

  const documentContextKey = `${taskId}:${activeSession?.sessionId ?? ""}`;
  const processedDocumentToolEventsRef = useRef(new Set<string>());
  const refreshedTaskVersionsRef = useRef(new Set<string>());
  const previousSessionIdRef = useRef<string | null>(null);
  const previousMessagesRef = useRef<AgentSessionState["messages"] | null>(null);
  const previousWorkflowAliasMetadataReadyRef = useRef(false);
  const workflowAliasMetadataReady = workflowToolAliasesByCanonical !== undefined;
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
    refreshedTaskVersionsRef.current.clear();
    previousSessionIdRef.current = null;
    previousMessagesRef.current = null;
    previousWorkflowAliasMetadataReadyRef.current = workflowAliasMetadataReady;
  }, [documentContextKey]);

  useEffect(() => {
    if (!activeSession || activeSession.role === "build" || !activeSession.runtimeKind) {
      previousWorkflowAliasMetadataReadyRef.current = workflowAliasMetadataReady;
      return;
    }

    const didHydrateWorkflowAliasMetadata =
      workflowAliasMetadataReady && !previousWorkflowAliasMetadataReadyRef.current;
    previousWorkflowAliasMetadataReadyRef.current = workflowAliasMetadataReady;

    if (didHydrateWorkflowAliasMetadata) {
      previousMessagesRef.current = null;
    }
  }, [activeSession, workflowAliasMetadataReady]);

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
    if (!activeSession || !taskId || !activeRepo) {
      return;
    }

    if (activeSession.role === "build") {
      previousSessionIdRef.current = activeSession.sessionId;
      previousMessagesRef.current = activeSession.messages;
      return;
    }

    const firstChangedMessageIndex =
      previousSessionIdRef.current !== activeSession.sessionId
        ? 0
        : findFirstChangedMessageIndex(previousMessagesRef.current, activeSession);

    if (firstChangedMessageIndex < 0) {
      previousSessionIdRef.current = activeSession.sessionId;
      previousMessagesRef.current = activeSession.messages;
      return;
    }

    forEachSessionMessageFrom(activeSession, firstChangedMessageIndex, (message) => {
      const eventKey = `${activeSession.sessionId}:${message.id}`;
      if (processedDocumentToolEventsRef.current.has(eventKey)) {
        return;
      }

      const meta = message.meta;
      if (!meta || meta.kind !== "tool" || meta.status !== "completed") {
        return;
      }
      const normalizedTool = normalizeOdtWorkflowToolName(
        meta.tool,
        workflowToolAliasesByCanonical,
      );
      const target = resolveWorkflowDocumentTarget(normalizedTool, {
        specDoc,
        planDoc,
        qaDoc,
      });
      if (!target) {
        return;
      }

      const completionInfo =
        extractCompletionTimestamp(meta.output) ?? extractCompletionTimestamp(message.content);
      const toolInput =
        typeof meta.input === "object" && meta.input !== null
          ? (meta.input as Record<string, unknown>)
          : null;
      const inputMarkdown = toolInput?.[target.inputKey];
      const hasInputMarkdown = typeof inputMarkdown === "string" && inputMarkdown.trim().length > 0;

      let effectiveUpdatedAtTimestamp = target.state.updatedAt
        ? parseTimestamp(target.state.updatedAt)
        : null;
      if (hasInputMarkdown) {
        const shouldApplyOptimisticDocument =
          target.state.markdown.trim() !== inputMarkdown.trim() ||
          (completionInfo !== null &&
            (effectiveUpdatedAtTimestamp === null ||
              effectiveUpdatedAtTimestamp < completionInfo.timestamp));
        if (shouldApplyOptimisticDocument) {
          applyDocumentUpdate(target.section, {
            markdown: inputMarkdown,
            updatedAt: completionInfo?.raw ?? target.state.updatedAt ?? null,
          });
          effectiveUpdatedAtTimestamp = completionInfo?.timestamp ?? effectiveUpdatedAtTimestamp;
        }
      }

      if (reloadDocument(target.section)) {
        processedDocumentToolEventsRef.current.add(eventKey);
      }
    });

    previousSessionIdRef.current = activeSession.sessionId;
    previousMessagesRef.current = activeSession.messages;
  }, [
    activeRepo,
    activeSession,
    applyDocumentUpdate,
    planDoc,
    qaDoc,
    reloadDocument,
    specDoc,
    taskId,
    workflowToolAliasesByCanonical,
  ]);

  return {
    specDoc,
    planDoc,
    qaDoc,
  };
}

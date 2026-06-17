import type { TaskCard } from "@openducktor/contracts";
import { normalizeOdtWorkflowToolName } from "@openducktor/core";
import { useEffect, useRef } from "react";
import { useTaskDocuments } from "@/components/features/task-details/use-task-documents";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import {
  findFirstChangedSessionMessageIndex,
  forEachSessionMessageFrom,
} from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { extractCompletionTimestamp, parseTimestamp } from "./agents-page-selection";

type UseAgentStudioDocumentsArgs = {
  workspaceRepoPath: string | null;
  taskId: string;
  selectedSessionIdentity: AgentSessionIdentity | null;
  loadedSession: AgentSessionState | null;
  selectedTask: TaskCard | null;
};

type WorkflowDocumentTarget = {
  section: "spec" | "plan" | "qa";
  state: ReturnType<typeof useTaskDocuments>["specDoc"];
  inputKey: "markdown" | "reportMarkdown";
};

const shouldReplayWorkflowDocumentMessagesAfterAliasMetadataReady = ({
  loadedSession,
  workflowAliasMetadataReady,
  previousWorkflowAliasMetadataReady,
}: {
  loadedSession: AgentSessionState | null;
  workflowAliasMetadataReady: boolean;
  previousWorkflowAliasMetadataReady: boolean;
}): boolean => {
  return Boolean(
    loadedSession &&
      loadedSession.role !== "build" &&
      loadedSession.runtimeKind &&
      workflowAliasMetadataReady &&
      !previousWorkflowAliasMetadataReady,
  );
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
  workspaceRepoPath,
  taskId,
  selectedSessionIdentity,
  loadedSession,
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
    workspaceRepoPath ?? "",
  );
  const workflowToolAliasesByCanonical = loadedSession?.runtimeKind
    ? findRuntimeDefinition(runtimeDefinitions, loadedSession.runtimeKind)
        ?.workflowToolAliasesByCanonical
    : undefined;

  const selectedSessionKey = selectedSessionIdentity
    ? agentSessionIdentityKey(selectedSessionIdentity)
    : null;
  const documentContextKey = `${taskId}:${selectedSessionKey ?? ""}`;
  const processedDocumentToolEventsRef = useRef<Set<string> | null>(null);
  if (processedDocumentToolEventsRef.current === null) {
    processedDocumentToolEventsRef.current = new Set<string>();
  }
  const processedDocumentToolEvents = processedDocumentToolEventsRef.current;
  const refreshedTaskVersionsRef = useRef<Set<string> | null>(null);
  if (refreshedTaskVersionsRef.current === null) {
    refreshedTaskVersionsRef.current = new Set<string>();
  }
  const refreshedTaskVersions = refreshedTaskVersionsRef.current;
  const previousSessionKeyRef = useRef<string | null>(null);
  const previousMessagesRef = useRef<AgentSessionState["messages"] | null>(null);
  const previousWorkflowAliasMetadataReadyRef = useRef(false);
  const workflowAliasMetadataReady = workflowToolAliasesByCanonical !== undefined;
  const workflowAliasMetadataReadyRef = useRef(workflowAliasMetadataReady);
  workflowAliasMetadataReadyRef.current = workflowAliasMetadataReady;
  const taskDocumentVersionKey =
    taskId && selectedTask
      ? [
          workspaceRepoPath ?? "",
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

  useEffect(() => {
    void documentContextKey;
    const documentToolEvents = processedDocumentToolEventsRef.current;
    const taskVersions = refreshedTaskVersionsRef.current;
    if (documentToolEvents === null || taskVersions === null) {
      throw new Error("Agent Studio document tracking refs were not initialized.");
    }

    documentToolEvents.clear();
    taskVersions.clear();
    previousSessionKeyRef.current = null;
    previousMessagesRef.current = null;
    previousWorkflowAliasMetadataReadyRef.current = workflowAliasMetadataReadyRef.current;
  }, [documentContextKey]);

  useEffect(() => {
    const previousWorkflowAliasMetadataReady = previousWorkflowAliasMetadataReadyRef.current;
    previousWorkflowAliasMetadataReadyRef.current = workflowAliasMetadataReady;

    if (
      shouldReplayWorkflowDocumentMessagesAfterAliasMetadataReady({
        loadedSession,
        workflowAliasMetadataReady,
        previousWorkflowAliasMetadataReady,
      })
    ) {
      previousMessagesRef.current = null;
    }
  }, [loadedSession, workflowAliasMetadataReady]);

  useEffect(() => {
    if (!taskId || taskDocumentVersionKey === null) {
      return;
    }

    if (refreshedTaskVersions.has(taskDocumentVersionKey)) {
      return;
    }

    const accepted = [reloadDocument("spec"), reloadDocument("plan"), reloadDocument("qa")];
    if (accepted.every(Boolean)) {
      refreshedTaskVersions.add(taskDocumentVersionKey);
    }
  }, [refreshedTaskVersions, reloadDocument, taskDocumentVersionKey, taskId]);

  useEffect(() => {
    if (!loadedSession || !selectedSessionKey || !taskId || !workspaceRepoPath) {
      return;
    }

    if (loadedSession.role === "build") {
      previousSessionKeyRef.current = selectedSessionKey;
      previousMessagesRef.current = loadedSession.messages;
      return;
    }

    const firstChangedMessageIndex =
      previousSessionKeyRef.current !== selectedSessionKey
        ? 0
        : findFirstChangedSessionMessageIndex(previousMessagesRef.current, loadedSession);

    if (firstChangedMessageIndex < 0) {
      previousSessionKeyRef.current = selectedSessionKey;
      previousMessagesRef.current = loadedSession.messages;
      return;
    }

    forEachSessionMessageFrom(loadedSession, firstChangedMessageIndex, (message) => {
      const eventKey = `${selectedSessionKey}:${message.id}`;
      if (processedDocumentToolEvents.has(eventKey)) {
        return;
      }

      const meta = message.meta;
      if (meta?.kind !== "tool" || meta.status !== "completed") {
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
        processedDocumentToolEvents.add(eventKey);
      }
    });

    previousSessionKeyRef.current = selectedSessionKey;
    previousMessagesRef.current = loadedSession.messages;
  }, [
    workspaceRepoPath,
    loadedSession,
    applyDocumentUpdate,
    processedDocumentToolEvents,
    planDoc,
    qaDoc,
    reloadDocument,
    selectedSessionKey,
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

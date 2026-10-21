import {
  type OdtToolName,
  type RuntimeDescriptor,
  type RuntimeKind,
  toOpencodeExposedOdtToolIds,
} from "@openducktor/contracts";
import {
  isOdtWorkflowMutationToolName,
  normalizeOdtToolName,
  toOdtWorkflowToolDisplayName,
} from "@openducktor/core";
import { findRuntimeDefinition } from "@openducktor/frontend-core/lib/agent-runtime";
import type { AgentChatTaskToolName, AgentChatRuntimePresentation } from "./agent-chat.types";
import { readBrowserToolAction } from "./browser-tool-summary";

/** Browser tools act on web pages, so they show as browser actions, not workflow steps. */
const browserToolDisplayName = (odtTool: OdtToolName | null): string | null => {
  const action = odtTool === null ? null : readBrowserToolAction(odtTool);
  return action === null ? null : `Browser ${action}`;
};

const resolveTaskTool = (odtTool: OdtToolName | null): AgentChatTaskToolName | null => {
  switch (odtTool) {
    case "odt_create_task":
      return "create_task";
    case "odt_search_tasks":
      return "search_tasks";
    case "odt_update_task":
      return "update_task";
    default:
      return null;
  }
};

export const resolveAgentChatRuntimePresentation = ({
  runtimeDefinitions,
  runtimeKind,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeKind: RuntimeKind | null;
}): AgentChatRuntimePresentation => {
  const runtimeDefinition = runtimeKind
    ? findRuntimeDefinition(runtimeDefinitions, runtimeKind)
    : null;
  const workflowToolAliasesByCanonical = runtimeDefinition?.workflowToolAliasesByCanonical;

  return {
    runtimeKind,
    presentToolCall: (toolName, displayLabel) => {
      const odtTool = normalizeOdtToolName(toolName, (canonical) => {
        if (runtimeKind === "opencode") return toOpencodeExposedOdtToolIds(canonical);
        if (runtimeKind === "claude") return [`mcp__openducktor__${canonical}`];
        return [];
      });
      const taskTool = resolveTaskTool(odtTool);
      if (taskTool) {
        return { kind: "task", displayName: taskTool, taskTool };
      }
      const browserDisplayName = browserToolDisplayName(odtTool);
      if (browserDisplayName) {
        return { kind: "regular", displayName: browserDisplayName };
      }
      return {
        kind: isOdtWorkflowMutationToolName(toolName, workflowToolAliasesByCanonical)
          ? "workflow"
          : "regular",
        displayName:
          displayLabel?.trim() ||
          toOdtWorkflowToolDisplayName(toolName, workflowToolAliasesByCanonical),
      };
    },
    supportedApprovalReplyOutcomes:
      runtimeDefinition?.capabilities.approvals.supportedReplyOutcomes ?? null,
  };
};

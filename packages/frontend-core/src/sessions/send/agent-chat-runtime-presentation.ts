import {
  isOdtBrowserToolName,
  type OdtToolName,
  type RuntimeDescriptor,
  type RuntimeKind,
  toOpencodeExposedOdtToolIds,
} from "@openducktor/contracts";
import {
  isOdtWorkflowMutationToolName,
  normalizeOdtToolName,
  retiredArtifactToolName,
  toOdtWorkflowToolDisplayName,
} from "@openducktor/core";
import { findRuntimeDefinition } from "../../lib/agent-runtime";
import type { AgentChatTaskToolName, AgentChatRuntimePresentation } from "./agent-chat.types";

const BROWSER_TOOL_PREFIX = "odt_browser_";

/** The action of an `odt_browser_*` tool, such as `click`, or null for other tools. */
const readBrowserToolAction = (odtTool: OdtToolName): string | null =>
  isOdtBrowserToolName(odtTool) ? odtTool.slice(BROWSER_TOOL_PREFIX.length) : null;

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

type PresentationInput = {
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeKind: RuntimeKind | null;
};

// One presentation for each definition list and runtime, so `presentToolCall` keeps its identity
// from one chat to the next, and the row caches that key on it stay valid.
const presentations = new WeakMap<
  RuntimeDescriptor[],
  Map<RuntimeKind | null, AgentChatRuntimePresentation>
>();

export const resolveAgentChatRuntimePresentation = (
  input: PresentationInput,
): AgentChatRuntimePresentation => {
  let byRuntime = presentations.get(input.runtimeDefinitions);
  if (!byRuntime) {
    byRuntime = new Map();
    presentations.set(input.runtimeDefinitions, byRuntime);
  }
  const known = byRuntime.get(input.runtimeKind);
  if (known) return known;
  const presentation = buildRuntimePresentation(input);
  byRuntime.set(input.runtimeKind, presentation);
  return presentation;
};

const buildRuntimePresentation = ({
  runtimeDefinitions,
  runtimeKind,
}: PresentationInput): AgentChatRuntimePresentation => {
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
      if (odtTool === "odt_set_task_artifact") {
        return { kind: "artifact", operation: "set", displayName: "Set Artifact" };
      }
      if (odtTool === "odt_delete_task_artifact") {
        return { kind: "artifact", operation: "delete", displayName: "Delete Artifact" };
      }
      if (odtTool === "odt_read_task_artifacts") {
        return { kind: "regular", displayName: "read_task_artifacts" };
      }
      // Browser tools act on web pages, so they show as browser actions, not workflow steps.
      const browserAction = odtTool === null ? null : readBrowserToolAction(odtTool);
      if (browserAction !== null) {
        return { kind: "browser", displayName: `Browser ${browserAction}`, action: browserAction };
      }
      const retiredTool = retiredArtifactToolName(toolName);
      return {
        kind:
          retiredTool || isOdtWorkflowMutationToolName(toolName, workflowToolAliasesByCanonical)
            ? "workflow"
            : "regular",
        displayName:
          displayLabel?.trim() ||
          retiredTool?.slice(4) ||
          toOdtWorkflowToolDisplayName(toolName, workflowToolAliasesByCanonical),
      };
    },
    supportedApprovalReplyOutcomes:
      runtimeDefinition?.capabilities.approvals.supportedReplyOutcomes ?? null,
  };
};

import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import { isOdtWorkflowMutationToolName, toOdtWorkflowToolDisplayName } from "@openducktor/core";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import type { AgentChatRuntimePresentation } from "./agent-chat.types";

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
    presentToolCall: (toolName, displayLabel) => ({
      kind: isOdtWorkflowMutationToolName(toolName, workflowToolAliasesByCanonical)
        ? "workflow"
        : "regular",
      displayName:
        displayLabel?.trim() ||
        toOdtWorkflowToolDisplayName(toolName, workflowToolAliasesByCanonical),
    }),
    supportedApprovalReplyOutcomes:
      runtimeDefinition?.capabilities.approvals.supportedReplyOutcomes ?? null,
  };
};

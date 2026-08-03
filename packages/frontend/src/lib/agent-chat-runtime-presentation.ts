import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import { isOdtWorkflowMutationToolName, toOdtWorkflowToolDisplayName } from "@openducktor/core";
import type { AgentChatRuntimePresentation } from "@/components/features/agents/agent-chat/agent-chat.types";
import { findRuntimeDefinition } from "@/lib/agent-runtime";

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

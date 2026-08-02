import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
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

  return {
    runtimeKind,
    ...(runtimeDefinition?.workflowToolAliasesByCanonical
      ? { workflowToolAliasesByCanonical: runtimeDefinition.workflowToolAliasesByCanonical }
      : {}),
    supportedApprovalReplyOutcomes:
      runtimeDefinition?.capabilities.approvals.supportedReplyOutcomes ?? null,
  };
};

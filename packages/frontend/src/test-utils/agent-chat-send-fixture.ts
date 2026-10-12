import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  type AgentChatSend,
  type AgentChatSendTarget,
  useAgentChatSend,
} from "@/features/agent-chat-composer/message-delivery/use-agent-chat-send";
import { useAgentOperations } from "@/state/app-state-provider";
import type { AgentChatMessage } from "@/types/agent-orchestrator";

type AgentChatSendArgs = Parameters<typeof useAgentChatSend>[0];

const NO_MESSAGES: readonly AgentChatMessage[] = [];
const DRAFT_RULES: AgentChatSendArgs["draftRules"] = {
  reusablePrompts: [],
  supportsAttachments: true,
};

/**
 * Sends through the target of a chat with the shared send rules. By default, the chat has no
 * session and no running work, uses the OpenCode runtime, and sends with the operations context.
 */
export const useAgentChatSendForTarget = (
  target: AgentChatSendTarget,
  overrides: Partial<Omit<AgentChatSendArgs, "target">> = {},
): AgentChatSend => {
  const { sendAgentMessage } = useAgentOperations();
  return useAgentChatSend({
    identity: null,
    repoPath: "/repo",
    runtimeDescriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    modelCatalog: null,
    messages: NO_MESSAGES,
    isSessionWorking: false,
    isWaitingInput: false,
    selectedModelDescriptor: null,
    draftRules: DRAFT_RULES,
    sendAgentMessage,
    ...overrides,
    target,
  });
};

/** The send state of a chat that has no queue and no send in progress. */
export const createAgentChatSendFixture = (
  overrides: Partial<AgentChatSend> = {},
): AgentChatSend => ({
  messageQueue: null,
  steerBlockedReason: null,
  runningTurnModel: null,
  isSending: false,
  onSend: async () => true,
  ...overrides,
});

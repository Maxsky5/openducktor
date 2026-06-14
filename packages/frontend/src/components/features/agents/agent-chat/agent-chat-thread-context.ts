import {
  type AgentSessionViewLifecycle,
  getAgentSessionTranscriptState,
} from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type { AgentChatThreadSession } from "./agent-chat.types";

export type AgentChatThreadLifecycle = Pick<
  AgentSessionViewLifecycle,
  "phase" | "canRenderHistory"
>;

type ResolveAgentChatThreadContextArgs = {
  activeSession: AgentChatThreadSession | null;
  lifecycle: AgentChatThreadLifecycle;
  isContextSwitching: boolean;
};

export type AgentChatThreadContext = {
  threadSession: AgentChatThreadSession | null;
  activeExternalSessionId: string | null;
  isContextSwitching: boolean;
};

export const resolveAgentChatThreadContext = ({
  activeSession,
  lifecycle,
  isContextSwitching,
}: ResolveAgentChatThreadContextArgs): AgentChatThreadContext => {
  const activeExternalSessionId = activeSession?.externalSessionId ?? null;
  const shouldClearThread =
    isContextSwitching && getAgentSessionTranscriptState(lifecycle).kind !== "visible";

  return {
    threadSession: shouldClearThread ? null : activeSession,
    activeExternalSessionId: shouldClearThread ? null : activeExternalSessionId,
    isContextSwitching: shouldClearThread,
  };
};

import {
  type AgentSessionViewLifecycle,
  deriveAgentSessionViewLifecycle,
  type SessionRepoReadinessState,
} from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export type AgentStudioReadinessState = SessionRepoReadinessState;

export const deriveAgentStudioTaskHydrationState = ({
  activeSession,
  agentStudioReadinessState,
}: {
  activeSession: AgentSessionState | null;
  agentStudioReadinessState: AgentStudioReadinessState;
}): AgentSessionViewLifecycle => {
  return deriveAgentSessionViewLifecycle({
    session: activeSession,
    repoReadinessState: agentStudioReadinessState,
  });
};

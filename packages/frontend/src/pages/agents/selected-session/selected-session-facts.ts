import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionActivityState } from "@/types/agent-session-activity";

export type SelectedSessionFactsSource = {
  selectedSessionSummary: AgentSessionSummary | null;
  loadedSession: AgentSessionState | null;
};

export const resolveSelectedSessionActivityState = ({
  selectedSessionSummary,
  loadedSession,
}: SelectedSessionFactsSource): AgentSessionActivityState | null =>
  loadedSession
    ? getAgentSessionActivityStateFromSession(loadedSession)
    : (selectedSessionSummary?.activityState ?? null);

export const resolveSelectedSessionModel = ({
  selectedSessionSummary,
  loadedSession,
}: SelectedSessionFactsSource): AgentSessionState["selectedModel"] =>
  loadedSession?.selectedModel ?? selectedSessionSummary?.selectedModel ?? null;

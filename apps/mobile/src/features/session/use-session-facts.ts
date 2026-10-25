import type { AgentModelSelection } from "@openducktor/core";
import {
  getAgentSessionActivityStateFromSession,
  isAgentSessionActivityWorking,
} from "@openducktor/frontend-core/lib/agent-session-activity-state";
import { isAgentSessionBlockedOnInput } from "@openducktor/frontend-core/lib/agent-session-waiting-input";
import type {
  AgentSessionContextUsage,
  AgentSessionState,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import type { AgentSessionActivityState } from "@openducktor/frontend-core/types/agent-session-activity";
import { useSessionTarget } from "./session-target";
import { useSessionSelector } from "./use-session-selector";

/** The slow-changing facts of the open session. Streaming text does not change them. */
export type SessionFacts = {
  /** True when the session store has the session. */
  present: boolean;
  title: string | null;
  status: AgentSessionState["status"] | null;
  activityState: AgentSessionActivityState | null;
  /** True while a turn starts or runs. */
  isWorking: boolean;
  /** True while a turn runs in the foreground, as the host reports it. Steering needs one. */
  foregroundTurnActive: boolean | undefined;
  /** True while the session waits for a reply to its pending input. */
  isWaitingInput: boolean;
  runtimeStatusMessage: string | null;
  selectedModel: AgentModelSelection | null;
  contextUsage: AgentSessionContextUsage | null;
  historyLoadState: AgentSessionState["historyLoadState"] | null;
  stopRequested: boolean;
};

const ABSENT_FACTS: SessionFacts = Object.freeze({
  present: false,
  title: null,
  status: null,
  activityState: null,
  isWorking: false,
  foregroundTurnActive: undefined,
  isWaitingInput: false,
  runtimeStatusMessage: null,
  selectedModel: null,
  contextUsage: null,
  historyLoadState: null,
  stopRequested: false,
});

const selectSessionFacts = (session: AgentSessionState | null): SessionFacts => {
  if (!session) return ABSENT_FACTS;
  const activityState = getAgentSessionActivityStateFromSession(session);
  return {
    present: true,
    title: session.title ?? null,
    status: session.status,
    activityState,
    isWorking: isAgentSessionActivityWorking(activityState),
    foregroundTurnActive: session.foregroundTurnActive,
    isWaitingInput: isAgentSessionBlockedOnInput(session),
    runtimeStatusMessage: session.runtimeStatusMessage,
    selectedModel: session.selectedModel,
    contextUsage: session.contextUsage ?? null,
    historyLoadState: session.historyLoadState,
    stopRequested: Boolean(session.stopRequestedAt),
  };
};

/** Reads the facts of the open session. The view renders again only when one of them changes. */
export const useSessionFacts = (): SessionFacts =>
  useSessionSelector(useSessionTarget().identity, selectSessionFacts);

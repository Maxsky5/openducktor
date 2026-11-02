import type { AgentModelSelection } from "@openducktor/core";
import {
  getAgentSessionActivityStateFromSession,
  isAgentSessionActivityWorking,
} from "@openducktor/frontend-core/lib/agent-session-activity-state";
import { isAgentSessionBlockedOnInput } from "@openducktor/frontend-core/lib/agent-session-waiting-input";
import type { AgentSessionState } from "@openducktor/frontend-core/types/agent-orchestrator";
import { useSessionTarget } from "./session-target";
import { useSessionSelector } from "./use-session-selector";

/**
 * The slow-changing facts of the open session that several views show. A value that one view
 * shows has its own selector in that view, so a change of it renders only that view. Streaming
 * text and history reads do not change these facts.
 */
export type SessionFacts = {
  title: string | null;
  /** True while a turn starts or runs. */
  isWorking: boolean;
  /** True while a turn runs in the foreground, as the host reports it. Steering needs one. */
  foregroundTurnActive: boolean | undefined;
  /** True while the session waits for a reply to its pending input. */
  isWaitingInput: boolean;
  runtimeStatusMessage: string | null;
  selectedModel: AgentModelSelection | null;
};

const ABSENT_FACTS: SessionFacts = Object.freeze({
  title: null,
  isWorking: false,
  foregroundTurnActive: undefined,
  isWaitingInput: false,
  runtimeStatusMessage: null,
  selectedModel: null,
});

const selectSessionFacts = (session: AgentSessionState | null): SessionFacts => {
  if (!session) return ABSENT_FACTS;
  return {
    title: session.title ?? null,
    isWorking: isAgentSessionActivityWorking(getAgentSessionActivityStateFromSession(session)),
    foregroundTurnActive: session.foregroundTurnActive,
    isWaitingInput: isAgentSessionBlockedOnInput(session),
    runtimeStatusMessage: session.runtimeStatusMessage,
    selectedModel: session.selectedModel,
  };
};

/** Reads the facts of the open session. The view renders again only when one of them changes. */
export const useSessionFacts = (): SessionFacts =>
  useSessionSelector(useSessionTarget().identity, selectSessionFacts);

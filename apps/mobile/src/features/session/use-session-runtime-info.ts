import { useRuntimeAvailabilityContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useSessionRuntimeData } from "@openducktor/frontend-core/sessions/agent-orchestrator/hooks/use-session-runtime-data";
import { isMatchingFreshCodexSessionAwaitingKickoff } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/fresh-codex-session";
import type { SessionRuntimeDataTarget } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/session-runtime-data-refs";
import { useAgentOperationsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import type { AgentSessionState } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { SelectedSessionRuntimeData } from "@openducktor/frontend-core/types/selected-session-runtime-data";
import { useMemo } from "react";
import { useSessionScreen } from "./session-target";
import { useSessionSelector } from "./use-session-selector";

type RuntimeDataInput = {
  selectedModel: AgentSessionState["selectedModel"];
  /** The session only while it waits for its first Codex message, for the todo read rule. */
  awaitingKickoff: AgentSessionState | null;
};

const ABSENT: RuntimeDataInput = Object.freeze({ selectedModel: null, awaitingKickoff: null });

const selectRuntimeDataInput = (session: AgentSessionState | null): RuntimeDataInput =>
  session
    ? {
        selectedModel: session.selectedModel,
        awaitingKickoff: isMatchingFreshCodexSessionAwaitingKickoff(session, session)
          ? session
          : null,
      }
    : ABSENT;

/**
 * The model catalog and Session Todos of the open session. Header, panels, and composer call it;
 * TanStack Query shares the reads. A Read-only Session View reads no runtime data.
 */
export function useSessionRuntimeInfo(): SelectedSessionRuntimeData {
  const { target, interaction } = useSessionScreen();
  const { allRuntimeDefinitions, loadRepoRuntimeCatalog } = useRuntimeAvailabilityContext();
  const { readSessionTodos } = useAgentOperationsContext();
  const input = useSessionSelector(target.identity, selectRuntimeDataInput);
  const selectedSession = useMemo<SessionRuntimeDataTarget | null>(
    () =>
      target.readOnly
        ? null
        : {
            identity: target.identity,
            sessionAssociation: target.sessionAssociation,
            selectedModel: input.selectedModel,
          },
    [input.selectedModel, target.identity, target.readOnly, target.sessionAssociation],
  );
  return useSessionRuntimeData({
    repoPath: target.repoPath,
    selectedSession,
    sessionState: input.awaitingKickoff,
    runtimeDefinitions: allRuntimeDefinitions,
    runtimeReadinessState: interaction.runtimeReadiness.state,
    loadRuntimeCatalog: loadRepoRuntimeCatalog,
    readSessionTodos,
  });
}

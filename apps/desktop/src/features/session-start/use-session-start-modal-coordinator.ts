import type { AgentModelCatalog, AgentRole, AgentScenario } from "@openducktor/core";
import { useCallback } from "react";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { AGENT_ROLE_LABELS } from "@/types";
import type { RepoSettingsInput } from "@/types/state-slices";
import { SCENARIO_LABELS } from "./session-start-prompts";
import type { SessionStartRequestReason } from "./session-start-types";
import {
  type SessionStartModalIntent,
  type SessionStartPostAction,
  useSessionStartModalState,
} from "./use-session-start-modal-state";

const startModeLabelFor = (startMode: SessionStartModalIntent["startMode"]): string =>
  startMode === "fresh" ? "Start a fresh session" : "Continue latest or start a new session";

export const buildSessionStartModalTitle = (role: AgentRole): string => {
  const roleLabel = AGENT_ROLE_LABELS[role] ?? role.toUpperCase();
  return `Start ${roleLabel} Session`;
};

export const buildSessionStartModalDescription = ({
  scenario,
  startMode,
}: {
  scenario: AgentScenario;
  startMode: SessionStartModalIntent["startMode"];
}): string => {
  const scenarioLabel = SCENARIO_LABELS[scenario] ?? scenario;
  return `${startModeLabelFor(startMode)} for ${scenarioLabel}.`;
};

export const toSessionStartPostAction = (
  reason: SessionStartRequestReason,
): SessionStartPostAction => {
  if (reason === "composer_send" || reason === "rebase_conflict_resolution") {
    return "send_message";
  }
  if (reason === "scenario_kickoff") {
    return "kickoff";
  }
  return "none";
};

export type SessionStartModalOpenRequest = Omit<
  SessionStartModalIntent,
  "title" | "description"
> & {
  title?: string;
  description?: string;
};

type UseSessionStartModalCoordinatorArgs = {
  activeRepo: string | null;
  repoSettings: RepoSettingsInput | null;
  initialCatalog?: AgentModelCatalog | null;
};

type UseSessionStartModalCoordinatorResult = Omit<
  ReturnType<typeof useSessionStartModalState>,
  "openStartModal"
> & {
  openStartModal: (request: SessionStartModalOpenRequest) => void;
};

export function useSessionStartModalCoordinator({
  activeRepo,
  repoSettings,
  initialCatalog,
}: UseSessionStartModalCoordinatorArgs): UseSessionStartModalCoordinatorResult {
  const { runtimeDefinitions } = useRuntimeDefinitionsContext();
  const { openStartModal: openRawStartModal, ...modalState } = useSessionStartModalState({
    activeRepo,
    repoSettings,
    runtimeDefinitions,
    ...(initialCatalog !== undefined ? { initialCatalog } : {}),
  });

  const openStartModal = useCallback(
    (request: SessionStartModalOpenRequest): void => {
      openRawStartModal({
        ...request,
        title: request.title ?? buildSessionStartModalTitle(request.role),
        description:
          request.description ??
          buildSessionStartModalDescription({
            scenario: request.scenario,
            startMode: request.startMode,
          }),
      });
    },
    [openRawStartModal],
  );

  return {
    ...modalState,
    openStartModal,
  };
}

import type { GitBranch } from "@openducktor/contracts";
import {
  type AgentModelCatalog,
  type AgentRole,
  type AgentScenario,
  defaultStartModeForScenario,
  getAgentScenarioDefinition,
} from "@openducktor/core";
import { useCallback } from "react";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { AGENT_ROLE_LABELS } from "@/types";
import type { RepoSettingsInput } from "@/types/state-slices";
import { orderStartModesForDisplay } from "./session-start-display";
import type { SessionStartModalIntent, SessionStartPostAction } from "./session-start-modal-types";
import { SCENARIO_LABELS } from "./session-start-prompts";
import type { SessionStartRequestReason } from "./session-start-types";
import { useSessionStartModalState } from "./use-session-start-modal-state";

const startModeLabelFor = (startMode: "fresh" | "reuse" | "fork"): string => {
  if (startMode === "fresh") {
    return "Start a fresh session";
  }
  if (startMode === "reuse") {
    return "Reuse an existing session";
  }
  return "Fork an existing session";
};

export const buildSessionStartModalTitle = (role: AgentRole): string => {
  const roleLabel = AGENT_ROLE_LABELS[role] ?? role.toUpperCase();
  return `Start ${roleLabel} Session`;
};

export const buildSessionStartModalDescription = ({
  scenario,
}: {
  scenario: AgentScenario;
}): string => {
  const scenarioLabel = SCENARIO_LABELS[scenario] ?? scenario;
  const allowedStartModes = orderStartModesForDisplay(
    getAgentScenarioDefinition(scenario).allowedStartModes,
  );
  if (allowedStartModes.length > 1) {
    const allowedModeLabels = allowedStartModes.map((mode) => {
      if (mode === "fresh") {
        return "start fresh";
      }
      if (mode === "reuse") {
        return "reuse an existing session";
      }
      return "fork an existing session";
    });
    const conjunction = allowedModeLabels.length === 2 ? " or " : ", ";
    return `Choose how to ${allowedModeLabels.join(conjunction)} for ${scenarioLabel}.`;
  }
  return `${startModeLabelFor(defaultStartModeForScenario(scenario))} for ${scenarioLabel}.`;
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
  branches?: GitBranch[];
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
  branches = [],
  repoSettings,
  initialCatalog,
}: UseSessionStartModalCoordinatorArgs): UseSessionStartModalCoordinatorResult {
  const { runtimeDefinitions } = useRuntimeDefinitionsContext();
  const { openStartModal: openRawStartModal, ...modalState } = useSessionStartModalState({
    activeRepo,
    branches,
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

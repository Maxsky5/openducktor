import type { AgentRole } from "@openducktor/core";
import { useCallback } from "react";
import type { RepoSettingsInput } from "@/types/state-slices";
import { SCENARIO_LABELS } from "./agents-page-constants";
import type { SessionStartRequestReason } from "./use-agent-studio-session-start-types";
import {
  type SessionStartModalIntent,
  type SessionStartPostAction,
  useSessionStartModalState,
} from "./use-session-start-modal-state";

const ROLE_LABEL_BY_ROLE: Record<AgentRole, string> = {
  spec: "Spec",
  planner: "Planner",
  build: "Build",
  qa: "QA",
};

const startModeLabelFor = (startMode: SessionStartModalIntent["startMode"]): string =>
  startMode === "fresh" ? "Start a fresh session" : "Continue latest or start a new session";

const titleForIntent = (intent: Pick<SessionStartModalIntent, "role">): string => {
  const roleLabel = ROLE_LABEL_BY_ROLE[intent.role] ?? intent.role.toUpperCase();
  return `Start ${roleLabel} Session`;
};

const descriptionForIntent = (
  intent: Pick<SessionStartModalIntent, "scenario" | "startMode">,
): string => {
  const scenarioLabel = SCENARIO_LABELS[intent.scenario] ?? intent.scenario;
  return `${startModeLabelFor(intent.startMode)} for ${scenarioLabel}.`;
};

export const toSessionStartPostAction = (
  reason: SessionStartRequestReason,
): SessionStartPostAction => {
  if (reason === "composer_send") {
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
}: UseSessionStartModalCoordinatorArgs): UseSessionStartModalCoordinatorResult {
  const { openStartModal: openRawStartModal, ...modalState } = useSessionStartModalState({
    activeRepo,
    repoSettings,
  });

  const openStartModal = useCallback(
    (request: SessionStartModalOpenRequest): void => {
      openRawStartModal({
        ...request,
        title: request.title ?? titleForIntent(request),
        description: request.description ?? descriptionForIntent(request),
      });
    },
    [openRawStartModal],
  );

  return {
    ...modalState,
    openStartModal,
  };
}

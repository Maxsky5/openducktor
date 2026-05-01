import type { GitBranch } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentRole } from "@openducktor/core";
import { useCallback } from "react";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { AGENT_ROLE_LABELS } from "@/types";
import type { ActiveWorkspace, RepoSettingsInput } from "@/types/state-slices";
import { orderStartModesForDisplay } from "./session-start-display";
import { getSessionLaunchAction, type SessionLaunchActionId } from "./session-start-launch-options";
import type { SessionStartModalIntent } from "./session-start-modal-types";
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
  launchActionId,
}: {
  launchActionId: SessionLaunchActionId;
}): string => {
  const launchAction = getSessionLaunchAction(launchActionId);
  const actionLabel = launchAction.label;
  const allowedStartModes = orderStartModesForDisplay(launchAction.allowedStartModes);
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
    return `Choose how to ${allowedModeLabels.join(conjunction)} for ${actionLabel}.`;
  }
  return `${startModeLabelFor(launchAction.defaultStartMode)} for ${actionLabel}.`;
};

export type SessionStartModalOpenRequest = Omit<
  SessionStartModalIntent,
  "title" | "description"
> & {
  title?: string;
  description?: string;
};

type UseSessionStartModalCoordinatorArgs = {
  activeWorkspace: ActiveWorkspace | null;
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
  activeWorkspace,
  branches = [],
  repoSettings,
  initialCatalog,
}: UseSessionStartModalCoordinatorArgs): UseSessionStartModalCoordinatorResult {
  const { runtimeDefinitions } = useRuntimeDefinitionsContext();
  const { openStartModal: openRawStartModal, ...modalState } = useSessionStartModalState({
    activeWorkspace,
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
            launchActionId: request.launchActionId,
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

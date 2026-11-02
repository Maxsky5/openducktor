import {
  BUILTIN_ROLE_LABELS,
  getSessionLaunchAction,
  type BuiltinLaunchActionId as SessionLaunchActionId,
  type BuiltinRoleId as AgentRole,
} from "@openducktor/workflows";
import type { GitBranch } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useCallback } from "react";
import type { RepoSettingsInput } from "../../types/session-slices";
import type { SessionStartModalIntent } from "./session-start-modal-types";
import { useSessionStartModalState } from "./use-session-start-modal-state";

const startModeLabelFor = (startMode: "fresh" | "reuse" | "fork"): string => {
  if (startMode === "fresh") return "Start a new session";
  if (startMode === "reuse") return "Continue an existing session";
  return "Fork an existing session";
};

export const buildSessionStartModalTitle = (role: AgentRole): string => {
  const roleLabel = BUILTIN_ROLE_LABELS[role] ?? role.toUpperCase();
  return `Start ${roleLabel} session`;
};

export const buildSessionStartModalDescription = ({
  launchActionId,
}: {
  launchActionId: SessionLaunchActionId;
}): string => {
  const action = getSessionLaunchAction(launchActionId);
  if (action.startModes.length > 1) return "Choose how to start this session.";
  return `${startModeLabelFor(action.defaultStartMode)}.`;
};

export type SessionStartModalOpenRequest = Omit<
  SessionStartModalIntent,
  "title" | "description"
> & {
  title?: string;
  description?: string;
};

type UseSessionStartModalCoordinatorArgs = {
  branches?: GitBranch[];
  repoSettings: RepoSettingsInput | null;
  initialCatalog?: AgentModelCatalog | null;
  workspaceRepoPath: string | null;
};

type UseSessionStartModalCoordinatorResult = Omit<
  ReturnType<typeof useSessionStartModalState>,
  "openStartModal"
> & {
  openStartModal: (request: SessionStartModalOpenRequest) => void;
};

export function useSessionStartModalCoordinator({
  branches = [],
  repoSettings,
  initialCatalog,
  workspaceRepoPath,
}: UseSessionStartModalCoordinatorArgs): UseSessionStartModalCoordinatorResult {
  const modalStateArgs: Parameters<typeof useSessionStartModalState>[0] = {
    branches,
    repoSettings,
    workspaceRepoPath,
  };

  if (initialCatalog !== undefined) {
    modalStateArgs.initialCatalog = initialCatalog;
  }

  const { openStartModal: openRawStartModal, ...modalState } =
    useSessionStartModalState(modalStateArgs);

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

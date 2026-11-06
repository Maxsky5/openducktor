import {
  type WorkflowLaunchActionId as SessionLaunchActionId,
  type WorkflowRoleId as AgentRole,
  workflowRoleLabel,
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

export const buildSessionStartModalTitle = (
  role: AgentRole,
  taskWorkflow: import("@openducktor/workflows").TaskWorkflow,
): string => {
  const roleLabel = workflowRoleLabel(taskWorkflow, role);
  return `Start ${roleLabel} session`;
};

export const buildSessionStartModalDescription = ({
  launchActionId,
  taskWorkflow,
}: {
  launchActionId: SessionLaunchActionId;
  taskWorkflow: import("@openducktor/workflows").TaskWorkflow;
}): string => {
  const action = taskWorkflow.launchDefinition(launchActionId);
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
        title: request.title ?? buildSessionStartModalTitle(request.role, request.taskWorkflow),
        description:
          request.description ??
          buildSessionStartModalDescription({
            launchActionId: request.launchActionId,
            taskWorkflow: request.taskWorkflow,
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

import type { TaskStoreCheck } from "@openducktor/contracts";
import { useRequiredContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { createContext } from "react";
import type {
  ChecksStateContextValue,
  WorkspaceBranchStateContextValue,
  WorkspacePresenceContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";

export const WorkspaceStateContext = createContext<WorkspaceStateContextValue | null>(null);
export const WorkspaceBranchStateContext = createContext<WorkspaceBranchStateContextValue | null>(
  null,
);
export const WorkspacePresenceContext = createContext<WorkspacePresenceContextValue | null>(null);
export const ChecksStateContext = createContext<ChecksStateContextValue | null>(null);

export type ChecksOperationsContextValue = {
  refreshTaskStoreCheckForRepo: (repoPath: string, force?: boolean) => Promise<TaskStoreCheck>;
};

export type WorkspaceOperationsContextValue = {
  refreshWorkspaces: () => Promise<void>;
  refreshBranches: (force?: boolean) => Promise<void>;
  clearBranchData: () => void;
};

export const ChecksOperationsContext = createContext<ChecksOperationsContextValue | null>(null);
export const WorkspaceOperationsContext = createContext<WorkspaceOperationsContextValue | null>(
  null,
);

export const useChecksOperationsContext = (): ChecksOperationsContextValue =>
  useRequiredContext(ChecksOperationsContext, "useChecksOperationsContext");

export const useChecksStateContext = (): ChecksStateContextValue =>
  useRequiredContext(ChecksStateContext, "useChecksStateContext");

export const useWorkspaceOperationsContext = (): WorkspaceOperationsContextValue =>
  useRequiredContext(WorkspaceOperationsContext, "useWorkspaceOperationsContext");

export const useWorkspaceStateContext = (): WorkspaceStateContextValue =>
  useRequiredContext(WorkspaceStateContext, "useWorkspaceState");

export const useWorkspaceBranchStateContext = (): WorkspaceBranchStateContextValue =>
  useRequiredContext(WorkspaceBranchStateContext, "useWorkspaceBranchState");

export const useWorkspacePresenceContext = (): WorkspacePresenceContextValue =>
  useRequiredContext(WorkspacePresenceContext, "useWorkspacePresence");

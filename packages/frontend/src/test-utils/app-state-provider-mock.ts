import type { ReactElement, ReactNode } from "react";

export type AppStateProviderModule = typeof import("@/state/app-state-provider");

const unused = (name: keyof AppStateProviderModule) => () => {
  throw new Error(`${String(name)} is not used in this test`);
};

export const createAppStateProviderModuleMock = (
  overrides: Partial<AppStateProviderModule>,
): AppStateProviderModule => ({
  AppStateProvider: ({ children }: { children?: ReactNode }) => children as ReactElement,
  useActiveWorkspace: unused("useActiveWorkspace"),
  useWorkspaceBranchState: unused("useWorkspaceBranchState"),
  useWorkspacePresence: unused("useWorkspacePresence"),
  useWorkspaceState: unused("useWorkspaceState"),
  useChecksState: unused("useChecksState"),
  useTasksState: unused("useTasksState"),
  useDelegationState: unused("useDelegationState"),
  useSpecState: unused("useSpecState"),
  useAgentOperations: unused("useAgentOperations"),
  useAgentSessions: unused("useAgentSessions"),
  useAgentSessionSummaries: unused("useAgentSessionSummaries"),
  useAgentActivitySessions: unused("useAgentActivitySessions"),
  useAgentSession: unused("useAgentSession"),
  useAgentState: unused("useAgentState"),
  ...overrides,
});

import { createElement, type Context, type ReactNode, useContext, useMemo } from "react";
import { UNSAFE_LocationContext } from "react-router";
import {
  ActiveWorkspaceContext,
  DelegationStateContext,
  DocumentStateContext,
  TasksStateContext,
  TaskControlContext,
  TaskSnapshotContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import {
  ChecksStateContext,
  WorkspaceBranchStateContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import {
  AgentOperationsContext,
  AgentSessionHistoryLoadContext,
  AgentSessionReadModelStateContext,
  AgentSessionsContext,
} from "@openducktor/frontend-core/sessions/session-contexts";

export type SessionViewScope = readonly ((children: ReactNode) => ReactNode)[];

/** Bind a kept view to the workspace and address that its operations own. */
export function useSessionViewScope(): SessionViewScope {
  return [
    useBinding(UNSAFE_LocationContext),
    useBinding(ActiveWorkspaceContext),
    useBinding(WorkspaceStateContext),
    useBinding(WorkspaceBranchStateContext),
    useBinding(TasksStateContext),
    useBinding(TaskSnapshotContext),
    useBinding(TaskControlContext),
    useBinding(ChecksStateContext),
    useBinding(DocumentStateContext),
    useBinding(DelegationStateContext),
    useBinding(AgentOperationsContext),
    useBinding(AgentSessionsContext),
    useBinding(AgentSessionReadModelStateContext),
    useBinding(AgentSessionHistoryLoadContext),
  ];
}

function useBinding<T>(context: Context<T>): (children: ReactNode) => ReactNode {
  const value = useContext(context);
  return useMemo(
    () => (children) => createElement(context.Provider, { value }, children),
    [context, value],
  );
}

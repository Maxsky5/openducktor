import {
  effectiveWorkspaceSessionTargetBranch,
  type GitTargetBranch,
  type WorkspaceSession,
  type WorkspaceSessionCreateInput,
  type WorkspaceSessionLocation,
  type WorkspaceSessionWorktreeInput,
  workspaceSessionAllowsTargetBranch,
} from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useHostClient } from "../../connection/client-connection-react";
import { useMountedRef } from "../../lib/use-mounted-ref";
import { useSingleFlightMutation } from "../../lib/use-single-flight";
import { invalidateRepoBranchesQuery, repoBranchesQueryOptions } from "../../queries/git";
import { invalidateTerminalList } from "../../queries/terminals";
import { repoConfigQueryOptions, toRepoSettingsInput } from "../../queries/workspace";
import {
  customAgentRolesQueryOptions,
  updateWorkspaceSessionQueries,
  workspaceSessionWorktreesQueryOptions,
} from "../../queries/workspace-sessions";
import { repoDefaultModelSelectionFor } from "../../sessions/session-start-selection";
import {
  buildWorkspaceSessionCreateInput,
  workspaceSessionValidationError,
} from "./workspace-session-create-input";
import { useExistingWorktreeChoice } from "./use-existing-worktree-choice";
import { INITIAL_WORKSPACE_SESSION_WORKTREE } from "./workspace-session-worktree-rules";

/** The role choice that creates a chat without a Custom Agent Role. */
export const NO_CUSTOM_AGENT_ROLE = "none";

export type WorkspaceSessionCreateLocation = WorkspaceSessionLocation;

export type WorkspaceSessionCreateWorkspace = { workspaceId: string; repoPath: string };

/** The model of the new chat. Each client resolves it with its own model picker. */
export type WorkspaceSessionCreateModel = {
  selection: AgentModelSelection | null;
  /** True when the runtime catalog lists the selected model. */
  selectedModelAvailable: boolean;
};

/** Reads the repository config, whose Default Model seeds the model of a new chat. */
export function useWorkspaceSessionCreateDefaults(workspaceId: string) {
  const repoConfig = useQuery(repoConfigQueryOptions(workspaceId));
  const defaultModelSelection = useMemo(
    () =>
      repoConfig.data ? repoDefaultModelSelectionFor(toRepoSettingsInput(repoConfig.data)) : null,
    [repoConfig.data],
  );
  return { repoConfig, defaultModelSelection };
}

/**
 * The New chat form: name, Custom Agent Role, work location, new or existing worktree, and target
 * branch. It
 * builds the create request, sends it once, and updates the chat, terminal, and branch reads of
 * the workspace. `onCreated` runs only while the form is still mounted.
 */
export function useWorkspaceSessionCreate({
  workspace,
  model,
  open = true,
  onCreated,
}: {
  workspace: WorkspaceSessionCreateWorkspace;
  model: WorkspaceSessionCreateModel;
  /** False while the form is hidden, so it reads no branches. */
  open?: boolean;
  onCreated: (session: WorkspaceSession) => void;
}) {
  const host = useHostClient();
  const queryClient = useQueryClient();
  const roles = useQuery(customAgentRolesQueryOptions());
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState(NO_CUSTOM_AGENT_ROLE);
  // The location and the target change together, so a location change can drop a pick that the
  // new location cannot use. The target then falls back to the repository default.
  const [choice, setChoice] = useState<{
    location: WorkspaceSessionCreateLocation;
    picked: GitTargetBranch | null;
  }>({ location: "local_repo_root", picked: null });
  const { location, picked } = choice;
  const [worktree, setWorktree] = useState<WorkspaceSessionWorktreeInput>(
    INITIAL_WORKSPACE_SESSION_WORKTREE,
  );
  const repoConfig = useQuery(repoConfigQueryOptions(workspace.workspaceId));
  const defaultTarget = repoConfig.data?.defaultTargetBranch ?? null;
  const targetBranch = effectiveWorkspaceSessionTargetBranch(location, picked, defaultTarget);
  const branches = useQuery({ ...repoBranchesQueryOptions(workspace.repoPath), enabled: open });
  const existing = useExistingWorktreeChoice(workspace.workspaceId, open, location);
  const mounted = useMountedRef();
  const create = useSingleFlightMutation({
    mutationFn: (input: WorkspaceSessionCreateInput) => host.workspaceSessionCreate(input),
    onSuccess: (result, input) => {
      updateWorkspaceSessionQueries(queryClient, input.workspaceId, result.session);
      void invalidateTerminalList(queryClient, {
        kind: "workspace_session",
        workspaceId: input.workspaceId,
        sessionId: result.session.id,
      });
      if (input.location === "local_worktree")
        void invalidateRepoBranchesQuery(queryClient, workspace.repoPath);
      if (mounted.current) onCreated(result.session);
    },
    onError: (error, input) => {
      if (workspaceSessionValidationError(error))
        void invalidateRepoBranchesQuery(queryClient, workspace.repoPath);
      // A new read shows a worktree that the failure removed as unavailable.
      if (input.location === "existing_worktree")
        void queryClient.invalidateQueries({
          queryKey: workspaceSessionWorktreesQueryOptions(workspace.workspaceId).queryKey,
        });
    },
  });
  // Worktree name and branch errors belong to New worktree. Other locations show them below.
  const worktreeError =
    location === "local_worktree" ? workspaceSessionValidationError(create.error) : null;
  const input = buildWorkspaceSessionCreateInput({
    workspaceId: workspace.workspaceId,
    name,
    roleId,
    location,
    worktree,
    existingWorktree: existing.listedWorktree,
    targetBranch,
    selection: model.selection,
    selectedModelAvailable: model.selectedModelAvailable,
    rolesReady: roles.isSuccess,
    availableBranches: branches.isSuccess ? branches.data : null,
  });
  const submit = (): void => {
    if (input) create.mutate(input);
  };
  // A changed location, worktree, or target clears the last failure, so its message cannot mislead.
  const selectLocation = (next: WorkspaceSessionCreateLocation): void => {
    create.reset();
    setChoice((current) => ({ location: next, picked: usablePick(next, current.picked) }));
  };
  const pickTarget = (target: GitTargetBranch): void => {
    create.reset();
    setChoice((current) => ({ ...current, picked: target }));
  };
  const changeWorktree = (next: WorkspaceSessionWorktreeInput): void => {
    create.reset();
    setWorktree(next);
  };
  const selectExistingWorktree = (workingDirectory: string): void => {
    create.reset();
    existing.select(workingDirectory);
  };
  return {
    name,
    setName,
    roleId,
    setRoleId,
    location,
    selectLocation,
    worktree,
    changeWorktree,
    existing,
    selectExistingWorktree,
    targetBranch,
    defaultTarget,
    pickTarget,
    roles,
    branches,
    create,
    worktreeError,
    input,
    submit,
  };
}

function usablePick(
  location: WorkspaceSessionCreateLocation,
  picked: GitTargetBranch | null,
): GitTargetBranch | null {
  return picked && workspaceSessionAllowsTargetBranch(location, picked) ? picked : null;
}

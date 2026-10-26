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
import { useMemo, useRef, useState } from "react";
import { useClientConnection } from "../../connection/client-connection-react";
import { errorMessage } from "../../lib/errors";
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
import { useAgentSessionsContext } from "../../sessions/session-contexts";
import { projectWorkspaceSessionResult } from "./launch-workspace-session";
import {
  observeStartupPreparation,
  releaseStartupPreparationAttempt,
} from "../../sessions/startup/startup-prepared-handoff";

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

/** Creates and prepares one workspace session. Only the mounted source form can open it. */
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
  onCreated: (session: WorkspaceSession, startupAttemptId: string) => void | Promise<void>;
}) {
  const connection = useClientConnection();
  const { client: host } = connection.host;
  const { startupAttempts } = connection;
  const sessions = useAgentSessionsContext();
  const [startupAttemptId, setStartupAttemptId] = useState<string | null>(null);
  const submittedInput = useRef<WorkspaceSessionCreateInput | null>(null);
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
    mutationFn: async (input: WorkspaceSessionCreateInput) => {
      const retained = startupAttemptId ? startupAttempts.getAttempt(startupAttemptId) : null;
      const saved =
        retained?.ownership.state === "saved" && retained.ownership.target.kind === "workspace"
          ? retained.ownership.target.record
          : null;
      if (retained && (!saved || retained.status.confirmation !== "current"))
        throw new Error("Inspect the saved session before starting again.");
      const startupWorkspace = retained
        ? {
            workspaceId: retained.origin.workspaceId,
            repoPath: retained.origin.repoPath,
          }
        : workspace;
      const id =
        retained?.id ??
        startupAttempts.begin({
          origin: { ...startupWorkspace, scope: { kind: "workspace" } },
          label: "Start workspace session",
          presentation: "dialog",
        });
      setStartupAttemptId(id);
      submittedInput.current = input;
      try {
        if (saved) releaseStartupPreparationAttempt(queryClient, id);
        await observeStartupPreparation(queryClient, startupWorkspace.repoPath, id).catch(
          (cause) => {
            startupAttempts.rejectBeforeDispatch(id, errorMessage(cause));
            throw cause;
          },
        );
        let record = saved;
        if (!record) {
          const result = await startupAttempts.operation(
            id,
            (startup) => host.workspaceSessionCreate({ ...input, startup }),
            { final: false },
          );
          record = result.session;
          startupAttempts.setSaved(id, { state: "saved", target: { kind: "workspace", record } });
          updateWorkspaceSessionQueries(queryClient, input.workspaceId, record);
        }
        const sessionId = record.id;
        const result = await startupAttempts.operation(id, (startup) =>
          host.workspaceSessionStart({
            workspaceId: startupWorkspace.workspaceId,
            sessionId,
            startup,
          }),
        );
        startupAttempts.setSaved(id, {
          state: "saved",
          target: {
            kind: "workspace",
            record: result.session,
            ...(result.runtimeSession && { runtimeSession: result.runtimeSession }),
          },
        });
        try {
          projectWorkspaceSessionResult(
            {
              ...startupWorkspace,
              record: result.session,
              session: result.runtimeSession ?? undefined,
            },
            sessions,
            queryClient,
          );
        } catch (cause) {
          console.error("Cannot project the prepared workspace session.", cause);
        }
        if (!result.runtimeSession || !result.startupProgress?.prepared)
          throw new Error(
            "Session preparation is unconfirmed. Inspect the saved session before you try again.",
          );
        await startupAttempts.complete(id);
        return { ...result, startupAttemptId: id };
      } catch (cause) {
        const attempt = startupAttempts.getAttempt(id);
        if (attempt && !["failed", "canceled"].includes(attempt.status.phase))
          startupAttempts.fail(id, errorMessage(cause), false);
        throw cause;
      }
    },
    onSuccess: async (result, input) => {
      const attempt = startupAttempts.getAttempt(result.startupAttemptId);
      updateWorkspaceSessionQueries(queryClient, input.workspaceId, result.session);
      void invalidateTerminalList(queryClient, {
        kind: "workspace_session",
        workspaceId: input.workspaceId,
        sessionId: result.session.id,
      }).catch((cause) => console.error("Cannot refresh workspace session terminals.", cause));
      if (input.location === "local_worktree" && attempt)
        void invalidateRepoBranchesQuery(queryClient, attempt.origin.repoPath).catch((cause) =>
          console.error("Cannot refresh workspace session branches.", cause),
        );
      if (
        mounted.current &&
        attempt?.status.phase === "ready" &&
        attempt.origin.workspaceId === workspace.workspaceId &&
        attempt.origin.repoPath === workspace.repoPath
      ) {
        try {
          await onCreated(result.session, result.startupAttemptId);
        } catch (cause) {
          startupAttempts.setWarning(
            result.startupAttemptId,
            `The session is ready, but it did not open. ${errorMessage(cause)}`,
          );
        }
      }
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
  const dismissStartup = (): void => {
    if (startupAttemptId) startupAttempts.dismiss(startupAttemptId);
    setStartupAttemptId(null);
  };
  const editChoices = (): void => {
    const attempt = startupAttemptId ? startupAttempts.getAttempt(startupAttemptId) : null;
    if (attempt?.ownership.state !== "not_saved" || attempt.status.confirmation !== "current")
      return;
    dismissStartup();
  };
  const repairSavedSession = (): void => {
    const attempt = startupAttemptId ? startupAttempts.getAttempt(startupAttemptId) : null;
    if (
      submittedInput.current &&
      attempt?.ownership.state === "saved" &&
      attempt.status.phase === "failed" &&
      attempt.status.confirmation === "current"
    )
      create.mutate(submittedInput.current);
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
    startupAttemptId,
    editChoices,
    dismissStartup,
    repairSavedSession,
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

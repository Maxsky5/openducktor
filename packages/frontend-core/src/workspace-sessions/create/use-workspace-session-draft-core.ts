import type {
  CustomAgentRole,
  GitBranch,
  GitTargetBranch,
  RepoConfig,
  ReusablePrompt,
  WorkspaceSession,
  WorkspaceSessionLocation,
  WorkspaceSessionWorktreeInput,
  WorkspaceSessionWorktreesListResult,
} from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useClientConnection } from "../../connection/client-connection-react";
import type { AgentChatComposerDraft } from "../../drafts/agent-chat-composer-draft";
import type {
  WorkspaceSessionDraft,
  WorkspaceSessionDraftOptions,
} from "../../drafts/new-workspace-session-draft-store";
import { sessionComparisonOptions } from "../../git/session-comparison-options";
import { errorMessage } from "../../lib/errors";
import { runtimeReadinessTargetForRuntime } from "../../lib/runtime-readiness";
import { useRuntimeReadiness } from "../../lib/use-runtime-readiness";
import { repoBranchesQueryOptions } from "../../queries/git";
import {
  repoConfigQueryOptions,
  settingsSnapshotQueryOptions,
  toRepoSettingsInput,
} from "../../queries/workspace";
import {
  customAgentRolesQueryOptions,
  workspaceSessionWorktreesQueryOptions,
} from "../../queries/workspace-sessions";
import { useSessionPromptInput } from "../../sessions/composer/prompt-input/use-session-prompt-input";
import { useAgentSessionsContext } from "../../sessions/session-contexts";
import { repoDefaultModelSelectionFor } from "../../sessions/session-start-selection";
import { startupIsPending } from "../../sessions/startup/startup-navigation";
import {
  type StartupAttempt,
  useDraftStartupAttempt,
} from "../../sessions/startup/use-startup-attempts";
import {
  submitWorkspaceSessionDraft,
  type WorkspaceSessionDraftLaunchOutcome,
} from "./launch-workspace-session-draft";
import { useWorkspaceSessionCreateModel } from "./use-workspace-session-create-model";
import {
  type DraftQueryReadState,
  validateWorkspaceSessionDraft,
  type WorkspaceSessionDraftFieldErrors,
} from "./workspace-session-draft-validation";
import {
  existingBranchUnavailableReason,
  localWorktreeBranches,
  workspaceSessionValidationError,
  worktreeFolderName,
} from "./workspace-session-worktree-rules";

/** The role choice that creates a chat without a Custom Agent Role. */
export const NO_CUSTOM_AGENT_ROLE = "none";

const EMPTY_PROMPTS: ReusablePrompt[] = [];

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

function useDraftQueryReadState<Data>(query: UseQueryResult<Data>): DraftQueryReadState<Data> {
  const { isPending, isError, error, data } = query;
  return useMemo(
    () => ({
      isPending,
      isError,
      errorMessage: error ? errorMessage(error) : null,
      data,
    }),
    [data, error, isError, isPending],
  );
}

export const resolveDraftReadOnlyReason = ({
  isStarting,
  hasActiveAttempt,
}: {
  isStarting: boolean;
  hasActiveAttempt: boolean;
}): string | null => {
  if (isStarting) return "Starting session…";
  if (hasActiveAttempt) {
    return "Review startup progress above or choose Edit choices to change your message.";
  }
  return null;
};

export type DraftDiscardPolicy = "blocked" | "immediate" | "confirm";

export type DraftRoleChoice = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type DraftExistingWorktreeChoice = {
  value: string;
  label: string;
  branchName: string | null;
  description: string;
  disabled?: boolean;
};

export type DraftLocalBranchChoice = {
  branch: GitBranch;
  unavailableReason: string | null;
};

export type WorkspaceSessionDraftModelReadiness = {
  available: boolean;
  isLoading: boolean;
  error: string | null;
};

export type WorkspaceSessionDraftOptionsModel = {
  options: WorkspaceSessionDraftOptions;
  effectiveTargetBranch: GitTargetBranch | null;
  defaultTargetBranch: GitTargetBranch | null;
  branchPrefix: string | undefined;
  repoConfig: UseQueryResult<RepoConfig>;
  roles: UseQueryResult<CustomAgentRole[]>;
  branches: UseQueryResult<GitBranch[]>;
  worktrees: UseQueryResult<WorkspaceSessionWorktreesListResult>;
  fieldErrors: WorkspaceSessionDraftFieldErrors;
  selectedRoleName: string | null;
  targetBranchChoices: ReturnType<typeof sessionComparisonOptions> | undefined;
  roleChoices: DraftRoleChoice[] | undefined;
  existingWorktreeChoices: DraftExistingWorktreeChoice[];
  localBranchChoices: DraftLocalBranchChoice[] | undefined;
  onSelectLocation: (location: WorkspaceSessionLocation) => void;
  onSelectTargetBranch: (targetBranch: GitTargetBranch) => void;
  onChangeWorktree: (worktree: WorkspaceSessionWorktreeInput) => void;
  onSelectExistingWorktree: (workingDirectory: string) => void;
  onSelectRole: (roleId: string) => void;
};

export type WorkspaceSessionDraftStartupState = {
  attempt: StartupAttempt | null;
  attemptId: string | null;
  hasAttempt: boolean;
  isAttemptPending: boolean;
  isStarting: boolean;
  showingTranscript: boolean;
  readOnlyReason: string | null;
  submittedComposer: AgentChatComposerDraft | null;
};

export type WorkspaceSessionDraftSubmitInput = {
  submittedComposer: AgentChatComposerDraft;
  onSavedRecord?: (record: WorkspaceSession, startupAttemptId: string) => void;
  onBoundRecord?: (record: WorkspaceSession, startupAttemptId: string) => void;
};

const projectRoleChoices = (
  roles: UseQueryResult<CustomAgentRole[]>,
  selectedRoleId: string | null,
): DraftRoleChoice[] | undefined => {
  if (!roles.data) return undefined;
  const choices: DraftRoleChoice[] = [
    { value: NO_CUSTOM_AGENT_ROLE, label: "No role" },
    ...roles.data.map((role) => ({ value: role.id, label: role.name })),
  ];
  if (
    selectedRoleId !== null &&
    !roles.isPending &&
    !choices.some((choice) => choice.value === selectedRoleId)
  ) {
    choices.push({
      value: selectedRoleId,
      label: "Unavailable role",
      description: "No longer exists",
      disabled: true,
    });
  }
  return choices;
};

const projectExistingWorktreeChoices = (
  worktrees: UseQueryResult<WorkspaceSessionWorktreesListResult>,
  selectedDirectory: string | null,
): DraftExistingWorktreeChoice[] => {
  const entries = worktrees.data?.worktrees ?? [];
  const choices: DraftExistingWorktreeChoice[] = entries.map((entry) => ({
    value: entry.workingDirectory,
    label: worktreeFolderName(entry.workingDirectory),
    branchName: entry.branchName,
    description: entry.branchName ?? "Detached HEAD",
  }));
  if (
    selectedDirectory !== null &&
    worktrees.isSuccess &&
    !entries.some((entry) => entry.workingDirectory === selectedDirectory)
  ) {
    choices.push({
      value: selectedDirectory,
      label: worktreeFolderName(selectedDirectory),
      branchName: null,
      description: "No longer available",
      disabled: true,
    });
  }
  return choices;
};

function useDraftOptionsModel({
  draftId,
  options,
  repoConfig,
  roles,
  branches,
  worktrees,
  effectiveTargetBranch,
  fieldErrors,
  setPreSaveError,
}: {
  draftId: string;
  options: WorkspaceSessionDraftOptions;
  repoConfig: UseQueryResult<RepoConfig>;
  roles: UseQueryResult<CustomAgentRole[]>;
  branches: UseQueryResult<GitBranch[]>;
  worktrees: UseQueryResult<WorkspaceSessionWorktreesListResult>;
  effectiveTargetBranch: GitTargetBranch | null;
  fieldErrors: WorkspaceSessionDraftFieldErrors;
  setPreSaveError: (error: Error | null) => void;
}): WorkspaceSessionDraftOptionsModel {
  const { drafts } = useClientConnection();
  const draftStore = drafts.newWorkspaceSessions;

  const handleSelectLocation = useCallback(
    (location: WorkspaceSessionLocation) => {
      setPreSaveError(null);
      draftStore.updateOptions(draftId, { location });
    },
    [draftId, draftStore, setPreSaveError],
  );
  const handleSelectTargetBranch = useCallback(
    (targetBranch: GitTargetBranch) => {
      setPreSaveError(null);
      draftStore.updateOptions(draftId, { targetBranch });
    },
    [draftId, draftStore, setPreSaveError],
  );
  const handleChangeWorktree = useCallback(
    (worktree: WorkspaceSessionWorktreeInput) => {
      setPreSaveError(null);
      draftStore.updateOptions(draftId, { worktree });
    },
    [draftId, draftStore, setPreSaveError],
  );
  const handleSelectExistingWorktree = useCallback(
    (existingWorktreeDirectory: string) => {
      setPreSaveError(null);
      draftStore.updateOptions(draftId, { existingWorktreeDirectory });
    },
    [draftId, draftStore, setPreSaveError],
  );
  const handleSelectRole = useCallback(
    (value: string) => {
      setPreSaveError(null);
      draftStore.updateOptions(draftId, {
        customAgentRoleId: value === NO_CUSTOM_AGENT_ROLE ? null : value,
      });
    },
    [draftId, draftStore, setPreSaveError],
  );

  const defaultTargetBranch = repoConfig.data?.defaultTargetBranch ?? null;
  const targetBranchChoices = useMemo(
    () =>
      branches.data
        ? sessionComparisonOptions(branches.data, effectiveTargetBranch, {
            allowUpstream: options.location === "local_repo_root",
            defaultTarget: defaultTargetBranch,
          })
        : undefined,
    [branches.data, defaultTargetBranch, effectiveTargetBranch, options.location],
  );
  const roleChoices = useMemo(
    () => projectRoleChoices(roles, options.customAgentRoleId),
    [options.customAgentRoleId, roles],
  );
  const selectedRoleName = useMemo(
    () =>
      options.customAgentRoleId !== null
        ? (roles.data?.find((role) => role.id === options.customAgentRoleId)?.name ?? null)
        : null,
    [options.customAgentRoleId, roles.data],
  );
  const existingWorktreeChoices = useMemo(
    () => projectExistingWorktreeChoices(worktrees, options.existingWorktreeDirectory),
    [options.existingWorktreeDirectory, worktrees],
  );
  const localBranchChoices = useMemo<DraftLocalBranchChoice[] | undefined>(
    () =>
      branches.data
        ? localWorktreeBranches(branches.data).map((branch) => ({
            branch,
            unavailableReason: existingBranchUnavailableReason(branch),
          }))
        : undefined,
    [branches.data],
  );

  return useMemo(
    () => ({
      options,
      effectiveTargetBranch,
      defaultTargetBranch,
      branchPrefix: repoConfig.data?.branchPrefix,
      repoConfig,
      roles,
      branches,
      worktrees,
      fieldErrors,
      selectedRoleName,
      targetBranchChoices,
      roleChoices,
      existingWorktreeChoices,
      localBranchChoices,
      onSelectLocation: handleSelectLocation,
      onSelectTargetBranch: handleSelectTargetBranch,
      onChangeWorktree: handleChangeWorktree,
      onSelectExistingWorktree: handleSelectExistingWorktree,
      onSelectRole: handleSelectRole,
    }),
    [
      branches,
      defaultTargetBranch,
      effectiveTargetBranch,
      existingWorktreeChoices,
      fieldErrors,
      handleChangeWorktree,
      handleSelectExistingWorktree,
      handleSelectLocation,
      handleSelectRole,
      handleSelectTargetBranch,
      localBranchChoices,
      options,
      repoConfig,
      roleChoices,
      roles,
      selectedRoleName,
      targetBranchChoices,
      worktrees,
    ],
  );
}

function useDraftActions({
  workspaceId,
  draft,
  isStarting,
  reusablePrompts,
  selectedModelEntry,
  supportsAttachments,
  validation,
  setPreSaveError,
  setIsLaunching,
}: {
  workspaceId: string;
  draft: WorkspaceSessionDraft;
  isStarting: boolean;
  reusablePrompts: ReusablePrompt[];
  selectedModelEntry: ReturnType<typeof useWorkspaceSessionCreateModel>["selectedModelEntry"];
  supportsAttachments: boolean;
  validation: ReturnType<typeof validateWorkspaceSessionDraft>;
  setPreSaveError: (error: Error | null) => void;
  setIsLaunching: (launching: boolean) => void;
}) {
  const connection = useClientConnection();
  const sessions = useAgentSessionsContext();
  const draftStore = connection.drafts.newWorkspaceSessions;
  const draftId = draft.id;

  const validationRef = useRef(validation);
  useLayoutEffect(() => {
    validationRef.current = validation;
  }, [validation]);

  const submit = useCallback(
    async ({
      submittedComposer,
      onSavedRecord,
      onBoundRecord,
    }: WorkspaceSessionDraftSubmitInput): Promise<WorkspaceSessionDraftLaunchOutcome | null> => {
      const currentValidation = validationRef.current;
      if (isStarting || !currentValidation.canSubmit) return null;
      setPreSaveError(null);
      setIsLaunching(true);
      try {
        const submitArgs: Parameters<typeof submitWorkspaceSessionDraft>[0] = {
          connection,
          sessions,
          draftId,
          submittedComposer,
          reusablePrompts,
          modelDescriptor: selectedModelEntry,
          supportsAttachments,
          buildLaunchRequest: currentValidation.buildLaunchRequest,
          onPreSaveError: (error) => {
            setPreSaveError(error);
          },
        };
        if (onSavedRecord) submitArgs.onSavedRecord = onSavedRecord;
        if (onBoundRecord) submitArgs.onBoundRecord = onBoundRecord;
        return await submitWorkspaceSessionDraft(submitArgs);
      } finally {
        setIsLaunching(false);
      }
    },
    [
      connection,
      draftId,
      isStarting,
      reusablePrompts,
      selectedModelEntry,
      sessions,
      setIsLaunching,
      setPreSaveError,
      supportsAttachments,
    ],
  );

  const switchWorkspace = useCallback(
    (nextWorkspaceId: string) => {
      if (nextWorkspaceId === workspaceId || isStarting) {
        return { switched: false, removedReferenceCount: 0 };
      }
      setPreSaveError(null);
      const { removedReferenceCount } = draftStore.switchWorkspace(draftId, nextWorkspaceId);
      if (removedReferenceCount > 0) {
        const suffix = removedReferenceCount === 1 ? "" : "s";
        connection.feedback.show(
          "info",
          `Removed ${removedReferenceCount} workspace-specific reference${suffix} after switching workspace.`,
        );
      }
      return { switched: true, removedReferenceCount };
    },
    [connection.feedback, draftId, draftStore, isStarting, setPreSaveError, workspaceId],
  );

  const discardPolicy: DraftDiscardPolicy = isStarting
    ? "blocked"
    : draft.lifecycle === "untouched"
      ? "immediate"
      : "confirm";

  return useMemo(
    () => ({
      submit,
      switchWorkspace,
      discardPolicy,
    }),
    [discardPolicy, submit, switchWorkspace],
  );
}

function resolvePromptWorkingDirectory(
  options: WorkspaceSessionDraftOptions,
  repoPath: string,
): string {
  return options.location === "existing_worktree" && options.existingWorktreeDirectory
    ? options.existingWorktreeDirectory
    : repoPath;
}

function resolveDraftModelReadiness(
  model: ReturnType<typeof useWorkspaceSessionCreateModel>,
  defaultModelSelection: AgentModelSelection | null,
  repoConfig: UseQueryResult<RepoConfig>,
  resolveModelReadiness?: (input: {
    model: ReturnType<typeof useWorkspaceSessionCreateModel>;
    defaultModelSelection: AgentModelSelection | null;
    repoConfig: UseQueryResult<RepoConfig>;
  }) => WorkspaceSessionDraftModelReadiness,
): WorkspaceSessionDraftModelReadiness {
  if (resolveModelReadiness) {
    return resolveModelReadiness({ model, defaultModelSelection, repoConfig });
  }
  return {
    available: Boolean(model.selectedModelEntry),
    isLoading: model.isLoading,
    error: null,
  };
}

function resolveRuntimeValidationInputs({
  options,
  preSaveError,
  modelReadinessError,
  runtimeReadiness,
  isHostConnected,
}: {
  options: WorkspaceSessionDraftOptions;
  preSaveError: Error | null;
  modelReadinessError: string | null;
  runtimeReadiness: ReturnType<typeof useRuntimeReadiness>;
  isHostConnected: boolean;
}) {
  const hostValidationError =
    options.location === "local_worktree" ? workspaceSessionValidationError(preSaveError) : null;
  const runtimeSelectionError =
    modelReadinessError ??
    (runtimeReadiness.state === "blocked"
      ? (runtimeReadiness.message ?? "The selected runtime is unavailable.")
      : null);
  const isConnected = isHostConnected && runtimeReadiness.state !== "blocked";
  const connectionBlockedReason = isHostConnected
    ? runtimeReadiness.message
    : "Wait for the host connection before starting a session.";
  return { hostValidationError, runtimeSelectionError, isConnected, connectionBlockedReason };
}

function useDraftStartupState(
  draftId: string,
  isLaunching: boolean,
): WorkspaceSessionDraftStartupState {
  const startupAttempt = useDraftStartupAttempt(draftId);
  const hasAttempt = startupAttempt !== null;
  const isAttemptPending = startupAttempt !== null && startupIsPending(startupAttempt);
  const isStarting = isAttemptPending || isLaunching;
  const showingTranscript = isStarting || hasAttempt;
  return useMemo(
    () => ({
      attempt: startupAttempt,
      attemptId: startupAttempt?.id ?? null,
      hasAttempt,
      isAttemptPending,
      isStarting,
      showingTranscript,
      readOnlyReason: resolveDraftReadOnlyReason({ isStarting, hasActiveAttempt: hasAttempt }),
      submittedComposer: startupAttempt?.submittedComposer ?? null,
    }),
    [hasAttempt, isAttemptPending, isStarting, showingTranscript, startupAttempt],
  );
}

/**
 * Deep shared controller for a new workspace session draft across desktop and mobile.
 * Owns option queries, model selection, runtime readiness, prompt catalogs, option projections,
 * validation, startup status, workspace switching, and draft submission.
 */
export function useWorkspaceSessionDraftCore({
  workspaceId,
  repoPath,
  draft,
  composer,
  isHostConnected = true,
  resolveModelReadiness,
}: {
  workspaceId: string;
  repoPath: string;
  draft: WorkspaceSessionDraft;
  composer?: AgentChatComposerDraft;
  isHostConnected?: boolean;
  resolveModelReadiness?: (input: {
    model: ReturnType<typeof useWorkspaceSessionCreateModel>;
    defaultModelSelection: AgentModelSelection | null;
    repoConfig: UseQueryResult<RepoConfig>;
  }) => WorkspaceSessionDraftModelReadiness;
}) {
  const { drafts } = useClientConnection();
  const draftStore = drafts.newWorkspaceSessions;
  const draftId = draft.id;
  const activeComposer = composer ?? draft.composer;

  const [isLaunching, setIsLaunching] = useState(false);
  const [preSaveErrorState, setPreSaveErrorState] = useState<{
    workspaceId: string;
    error: Error;
  } | null>(null);
  const preSaveError =
    preSaveErrorState?.workspaceId === workspaceId ? preSaveErrorState.error : null;
  const setPreSaveError = useCallback(
    (error: Error | null) => {
      setPreSaveErrorState(error ? { workspaceId, error } : null);
    },
    [workspaceId],
  );

  const settings = useQuery(settingsSnapshotQueryOptions());
  const reusablePrompts = settings.data?.reusablePrompts ?? EMPTY_PROMPTS;
  const { repoConfig, defaultModelSelection } = useWorkspaceSessionCreateDefaults(workspaceId);
  const roles = useQuery(customAgentRolesQueryOptions());
  const branches = useQuery(repoBranchesQueryOptions(repoPath));
  const worktrees = useQuery({
    ...workspaceSessionWorktreesQueryOptions(workspaceId),
    enabled: draft.options.location === "existing_worktree",
  });

  const handleModelSelectionChange = useCallback(
    (selection: AgentModelSelection | null) => {
      setPreSaveError(null);
      draftStore.updateOptions(draftId, {
        selectedModel: selection?.runtimeKind
          ? { ...selection, runtimeKind: selection.runtimeKind }
          : null,
      });
    },
    [draftId, draftStore, setPreSaveError],
  );
  const modelControl = useMemo(
    () => ({
      selection: draft.options.selectedModel,
      onSelectionChange: handleModelSelectionChange,
    }),
    [draft.options.selectedModel, handleModelSelectionChange],
  );
  const model = useWorkspaceSessionCreateModel(repoPath, defaultModelSelection, modelControl);
  const modelReadiness = resolveDraftModelReadiness(
    model,
    defaultModelSelection,
    repoConfig,
    resolveModelReadiness,
  );

  const composerPersistence = useMemo(
    () => draftStore.composerPersistence(draftId),
    [draftId, draftStore],
  );

  const runtimeReadiness = useRuntimeReadiness({
    hasWorkspace: true,
    runtimeTarget: model.runtimeKind
      ? runtimeReadinessTargetForRuntime(model.runtimeKind)
      : { kind: "resolving" },
  });

  const { options } = draft;
  const promptInput = useSessionPromptInput({
    repoPath,
    runtimeKind: model.runtimeKind,
    workingDirectory: resolvePromptWorkingDirectory(options, repoPath),
    identity: null,
    runtimeReadinessState: runtimeReadiness.state,
    reusablePrompts,
  });

  const { hostValidationError, runtimeSelectionError, isConnected, connectionBlockedReason } =
    resolveRuntimeValidationInputs({
      options,
      preSaveError,
      modelReadinessError: modelReadiness.error,
      runtimeReadiness,
      isHostConnected,
    });

  const repoConfigState = useDraftQueryReadState(repoConfig);
  const rolesState = useDraftQueryReadState(roles);
  const branchesState = useDraftQueryReadState(branches);
  const worktreesState = useDraftQueryReadState(worktrees);

  const validation = useMemo(
    () =>
      validateWorkspaceSessionDraft({
        workspaceId,
        repoPath,
        isConnected,
        connectionBlockedReason,
        options,
        composer: activeComposer,
        repoConfig: repoConfigState,
        roles: rolesState,
        branches: branchesState,
        worktrees: worktreesState,
        effectiveSelection: model.selection,
        selectedModelAvailable: modelReadiness.available,
        isModelCatalogLoading: modelReadiness.isLoading,
        runtimeSelectionError,
        hostValidationError,
      }),
    [
      activeComposer,
      branchesState,
      connectionBlockedReason,
      hostValidationError,
      isConnected,
      model.selection,
      modelReadiness.available,
      modelReadiness.isLoading,
      options,
      repoConfigState,
      repoPath,
      rolesState,
      runtimeSelectionError,
      workspaceId,
      worktreesState,
    ],
  );

  const startup = useDraftStartupState(draftId, isLaunching);

  const optionsModel = useDraftOptionsModel({
    draftId,
    options,
    repoConfig,
    roles,
    branches,
    worktrees,
    effectiveTargetBranch: validation.effectiveTargetBranch,
    fieldErrors: validation.fieldErrors,
    setPreSaveError,
  });

  const actions = useDraftActions({
    workspaceId,
    draft,
    isStarting: startup.isStarting,
    reusablePrompts,
    selectedModelEntry: model.selectedModelEntry,
    supportsAttachments: promptInput.support.supportsAttachments,
    validation,
    setPreSaveError,
    setIsLaunching,
  });

  return {
    settings,
    reusablePrompts,
    defaultModelSelection,
    model,
    modelReadiness,
    composerPersistence,
    runtimeReadiness,
    promptInput,
    validation,
    optionsModel,
    startup,
    actions,
    preSaveError,
    setPreSaveError,
    hostValidationError,
  };
}

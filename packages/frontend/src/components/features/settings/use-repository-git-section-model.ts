import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type GitProviderConfig,
  type GitProviderHealth,
  type GitProviderRepository,
  type SettingsRepoConfig,
} from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

type UseRepositoryGitSectionModelArgs = {
  selectedRepoPath: string | null;
  selectedRepoConfig: SettingsRepoConfig | null;
  providerHealth: GitProviderHealthState;
  disabled: boolean;
  onDetectGithubRepository: () => Promise<GitProviderRepository | null>;
  onUpdateSelectedRepoConfig: (
    updater: (current: SettingsRepoConfig) => SettingsRepoConfig,
  ) => void;
};

export type GitProviderHealthState =
  | { status: "idle" }
  | { status: "draft" }
  | { status: "pending" }
  | { status: "error"; message: string }
  | { status: "loaded"; health: GitProviderHealth };

export type GithubCliStatus = "hidden" | "pending" | "error" | "installed" | "missing";

export type GithubRepositoryDraft = {
  host: string;
  owner: string;
  name: string;
};

type RepositoryGitSectionState = {
  repoPath: string | null;
  providerId: string | undefined;
  repositoryKey: string;
  repositoryDraft: GithubRepositoryDraft;
  isManualConfigOpen: boolean;
  isDetecting: boolean;
  detectionMessage: string | null;
};

type RepositoryGitSectionContext = {
  repoPath: string | null;
  providerId: string | undefined;
  repository: GitProviderRepository | undefined;
  hasRepositoryCoordinates: boolean;
};

type RepositoryGitSectionAction =
  | {
      type: "context_changed";
      context: RepositoryGitSectionContext;
    }
  | {
      type: "draft_committed";
      draft: GithubRepositoryDraft;
    }
  | {
      type: "detection_failed";
      manual: boolean;
      reason: string;
    }
  | {
      type: "detection_invalidated";
      clearMessage: boolean;
      keepManualConfigOpen: boolean;
    }
  | {
      type: "detection_missing";
      manual: boolean;
    }
  | {
      type: "detection_started";
    }
  | {
      type: "detection_succeeded";
      closeManualConfig: boolean;
      repository: GitProviderRepository;
    }
  | {
      type: "manual_toggled";
    };

type UseRepositoryGitSectionModelResult = {
  cliStatusLabel: string;
  cliStatus: GithubCliStatus;
  detectionMessage: string | null;
  githubEnabled: boolean;
  githubHost: string;
  githubReadinessLabel: string;
  githubReadinessMessage: string;
  githubReady: boolean;
  githubControlsDisabled: boolean;
  configuredProviderId: string | undefined;
  hasConfiguredNonGithubProvider: boolean;
  isDetecting: boolean;
  isManualConfigOpen: boolean;
  providerStatusLabel: string;
  repositoryDraft: GithubRepositoryDraft;
  repositorySlug: string | null;
  usesDefaultGithubHost: boolean;
  handleDetectFromOrigin: () => void;
  handleGithubEnabledChange: (checked: boolean) => void;
  handleRemoveConfiguredProvider: () => void;
  handleRepositoryDraftFieldChange: (field: keyof GithubRepositoryDraft, value: string) => void;
  handleToggleManualEdit: () => void;
};

const EMPTY_GITHUB_CONFIG = {
  enabled: false,
  autoDetected: false,
  repository: undefined,
} as const;

const hasNonGithubProvider = (repoConfig: SettingsRepoConfig | null): boolean => {
  const provider = repoConfig?.git.provider;
  return provider !== undefined && provider.id !== GITHUB_PROVIDER_DESCRIPTOR.id;
};

const updateGithubProviderConfig = (
  repoConfig: SettingsRepoConfig,
  overrides: Partial<Omit<GitProviderConfig, "id">>,
): SettingsRepoConfig => {
  if (hasNonGithubProvider(repoConfig)) {
    return repoConfig;
  }

  const github = repoConfig.git.provider;
  return {
    ...repoConfig,
    git: {
      ...repoConfig.git,
      provider: {
        enabled: github?.enabled ?? false,
        autoDetected: github?.autoDetected ?? false,
        repository: github?.repository,
        ...overrides,
        id: GITHUB_PROVIDER_DESCRIPTOR.id,
      },
    },
  };
};

const trimRepositoryDraft = (draft: GithubRepositoryDraft): GithubRepositoryDraft => ({
  host: draft.host.trim(),
  owner: draft.owner.trim(),
  name: draft.name.trim(),
});

const buildRepositoryDraft = (
  repository: GitProviderRepository | undefined,
): GithubRepositoryDraft => ({
  host: repository?.host ?? "github.com",
  owner: repository?.owner ?? "",
  name: repository?.name ?? "",
});

const toRepositoryKey = (repository: GitProviderRepository | undefined): string => {
  if (!repository?.host || !repository.owner || !repository.name) {
    return "";
  }
  return `${repository.host}:${repository.owner}:${repository.name}`;
};

const toRepositoryFromDraft = (draft: GithubRepositoryDraft): GitProviderRepository | undefined => {
  const trimmedDraft = trimRepositoryDraft(draft);
  return trimmedDraft.host && trimmedDraft.owner && trimmedDraft.name ? trimmedDraft : undefined;
};

const createRepositoryGitSectionState = ({
  hasRepositoryCoordinates,
  providerId,
  repoPath,
  repository,
}: RepositoryGitSectionContext): RepositoryGitSectionState => ({
  repoPath,
  providerId,
  repositoryKey: toRepositoryKey(repository),
  repositoryDraft: buildRepositoryDraft(repository),
  isManualConfigOpen: repoPath != null && !hasRepositoryCoordinates,
  isDetecting: false,
  detectionMessage: null,
});

const isStateForContext = (
  state: RepositoryGitSectionState,
  context: RepositoryGitSectionContext,
): boolean =>
  state.repoPath === context.repoPath &&
  state.providerId === context.providerId &&
  state.repositoryKey === toRepositoryKey(context.repository);

const repositoryGitSectionReducer = (
  state: RepositoryGitSectionState,
  action: RepositoryGitSectionAction,
): RepositoryGitSectionState => {
  switch (action.type) {
    case "context_changed":
      return isStateForContext(state, action.context)
        ? state
        : createRepositoryGitSectionState(action.context);
    case "draft_committed": {
      const nextRepository = toRepositoryFromDraft(action.draft);
      return {
        ...state,
        repositoryDraft: action.draft,
        repositoryKey: toRepositoryKey(nextRepository),
      };
    }
    case "detection_failed": {
      const nextState: RepositoryGitSectionState = {
        ...state,
        detectionMessage: action.reason,
        isDetecting: false,
      };
      if (action.manual) {
        nextState.isManualConfigOpen = true;
      }
      return nextState;
    }
    case "detection_invalidated": {
      return {
        ...state,
        detectionMessage: action.clearMessage ? null : state.detectionMessage,
        isDetecting: false,
        isManualConfigOpen: action.keepManualConfigOpen ? true : state.isManualConfigOpen,
      };
    }
    case "detection_missing": {
      const nextState: RepositoryGitSectionState = {
        ...state,
        detectionMessage:
          "No GitHub origin was detected for this repository. You can still configure it manually.",
        isDetecting: false,
      };
      if (action.manual) {
        nextState.isManualConfigOpen = true;
      }
      return nextState;
    }
    case "detection_started": {
      return {
        ...state,
        isDetecting: true,
      };
    }
    case "detection_succeeded": {
      const nextDraft = buildRepositoryDraft(action.repository);
      return {
        ...state,
        detectionMessage: `Detected ${action.repository.owner}/${action.repository.name} from origin. Save settings to keep this mapping.`,
        isDetecting: false,
        isManualConfigOpen: action.closeManualConfig ? false : state.isManualConfigOpen,
        repositoryDraft: nextDraft,
        repositoryKey: toRepositoryKey(action.repository),
      };
    }
    case "manual_toggled": {
      return {
        ...state,
        isManualConfigOpen: !state.isManualConfigOpen,
      };
    }
  }
};

const getGithubView = ({
  disabled,
  providerHealth,
  selectedRepoConfig,
}: {
  disabled: boolean;
  providerHealth: GitProviderHealthState;
  selectedRepoConfig: SettingsRepoConfig | null;
}) => {
  const configuredProvider = selectedRepoConfig?.git.provider;
  const github =
    configuredProvider?.id === GITHUB_PROVIDER_DESCRIPTOR.id
      ? configuredProvider
      : EMPTY_GITHUB_CONFIG;
  const hasConfiguredNonGithubProvider = hasNonGithubProvider(selectedRepoConfig);
  const configuredProviderId = configuredProvider?.id;
  const githubControlsDisabled = disabled || hasConfiguredNonGithubProvider;
  const githubEnabled = github.enabled ?? false;
  const health = providerHealth.status === "loaded" ? providerHealth.health : null;
  const hasGithubCli = health?.executablePath != null;
  const githubHost = github.repository?.host ?? "github.com";
  const usesDefaultGithubHost = githubHost === "github.com";
  const hasRepositoryCoordinates = Boolean(
    github.repository?.host && github.repository?.owner && github.repository?.name,
  );
  const repositorySlug = hasRepositoryCoordinates
    ? `${github.repository?.owner}/${github.repository?.name}`
    : null;
  const githubReady = githubEnabled && hasRepositoryCoordinates && health?.available === true;
  let githubReadinessLabel = "Not ready";
  if (hasConfiguredNonGithubProvider) {
    githubReadinessLabel = "Unavailable";
  } else if (githubReady) {
    githubReadinessLabel = usesDefaultGithubHost ? "Ready" : "Configured";
  }

  let githubReadinessMessage: string;
  if (hasConfiguredNonGithubProvider) {
    githubReadinessMessage = `Git provider ${configuredProviderId} is configured. Remove it before you configure GitHub.`;
  } else if (!github.enabled) {
    githubReadinessMessage =
      "Enable GitHub for this repository to offer “Open pull request” during human approval.";
  } else if (providerHealth.status === "draft") {
    githubReadinessMessage = "Save settings to check GitHub health.";
  } else if (providerHealth.status === "pending") {
    githubReadinessMessage = "Checking GitHub CLI, authentication, and repository mapping.";
  } else if (providerHealth.status === "error") {
    githubReadinessMessage = providerHealth.message;
  } else if (providerHealth.status === "idle") {
    githubReadinessMessage = "GitHub health has not been checked.";
  } else if (!hasGithubCli) {
    githubReadinessMessage = "Install GitHub CLI (`gh`) to enable provider-backed pull requests.";
  } else if (!hasRepositoryCoordinates) {
    githubReadinessMessage = "Repository host, owner, and name are still missing.";
  } else if (health?.available) {
    githubReadinessMessage = "GitHub pull requests are ready for this repository.";
  } else {
    githubReadinessMessage = health?.reason ?? `GitHub is not ready for ${githubHost}.`;
  }

  let providerStatusLabel = "Pull requests disabled";
  if (hasConfiguredNonGithubProvider) {
    providerStatusLabel = `${configuredProviderId} configured`;
  } else if (githubEnabled) {
    providerStatusLabel = "Pull requests enabled";
  }
  let cliStatus: GithubCliStatus = "hidden";
  let cliStatusLabel = "";
  if (githubEnabled && !hasConfiguredNonGithubProvider) {
    if (providerHealth.status === "pending") {
      cliStatus = "pending";
      cliStatusLabel = "Checking CLI";
    } else if (providerHealth.status === "error") {
      cliStatus = "error";
      cliStatusLabel = "Health check failed";
    } else if (providerHealth.status === "loaded") {
      cliStatus = hasGithubCli ? "installed" : "missing";
      cliStatusLabel = hasGithubCli ? "CLI installed" : "CLI missing";
    }
  }

  return {
    cliStatus,
    cliStatusLabel,
    configuredProviderId,
    github,
    githubControlsDisabled,
    githubEnabled,
    githubHost,
    githubReadinessLabel,
    githubReadinessMessage,
    githubReady,
    hasConfiguredNonGithubProvider,
    hasRepositoryCoordinates,
    providerStatusLabel,
    repositorySlug,
    usesDefaultGithubHost,
  };
};

export function useRepositoryGitSectionModel({
  disabled,
  onDetectGithubRepository,
  onUpdateSelectedRepoConfig,
  providerHealth,
  selectedRepoConfig,
  selectedRepoPath,
}: UseRepositoryGitSectionModelArgs): UseRepositoryGitSectionModelResult {
  const initialProvider = selectedRepoConfig?.git.provider;
  const initialGithubRepository =
    initialProvider?.id === GITHUB_PROVIDER_DESCRIPTOR.id ? initialProvider.repository : undefined;
  const initialHasRepositoryCoordinates = Boolean(
    initialGithubRepository?.host && initialGithubRepository.owner && initialGithubRepository.name,
  );
  const attemptedAutoDetectByRepoRef = useRef<Set<string> | null>(null);
  if (attemptedAutoDetectByRepoRef.current === null) {
    attemptedAutoDetectByRepoRef.current = new Set();
  }
  const attemptedAutoDetectByRepo = attemptedAutoDetectByRepoRef.current;
  const activeDetectionSequenceRef = useRef(0);
  const activeRepoPathRef = useRef<string | null>(selectedRepoPath);
  const activeProviderIdRef = useRef(selectedRepoConfig?.git.provider?.id);
  const [sectionState, dispatchSectionState] = useReducer(
    repositoryGitSectionReducer,
    {
      hasRepositoryCoordinates: initialHasRepositoryCoordinates,
      providerId: selectedRepoConfig?.git.provider?.id,
      repository: initialGithubRepository,
      repoPath: selectedRepoPath,
    },
    createRepositoryGitSectionState,
  );

  const {
    cliStatus,
    cliStatusLabel,
    configuredProviderId,
    github,
    githubControlsDisabled,
    githubEnabled,
    githubHost,
    githubReadinessLabel,
    githubReadinessMessage,
    githubReady,
    hasConfiguredNonGithubProvider,
    hasRepositoryCoordinates,
    providerStatusLabel,
    repositorySlug,
    usesDefaultGithubHost,
  } = getGithubView({ disabled, providerHealth, selectedRepoConfig });
  const repositorySectionContext = useMemo<RepositoryGitSectionContext>(
    () => ({
      hasRepositoryCoordinates,
      providerId: configuredProviderId,
      repository: github.repository,
      repoPath: selectedRepoPath,
    }),
    [configuredProviderId, github.repository, hasRepositoryCoordinates, selectedRepoPath],
  );
  const currentSectionState = isStateForContext(sectionState, repositorySectionContext)
    ? sectionState
    : createRepositoryGitSectionState(repositorySectionContext);
  const { detectionMessage, isDetecting, isManualConfigOpen, repositoryDraft } =
    currentSectionState;

  useEffect(() => {
    activeRepoPathRef.current = selectedRepoPath;
    activeProviderIdRef.current = configuredProviderId;
    dispatchSectionState({ type: "context_changed", context: repositorySectionContext });
  }, [configuredProviderId, repositorySectionContext, selectedRepoPath]);

  const commitGithubRepositoryDraft = useCallback(
    (nextDraft: GithubRepositoryDraft): void => {
      const trimmedDraft = trimRepositoryDraft(nextDraft);

      onUpdateSelectedRepoConfig((repoConfig) =>
        updateGithubProviderConfig(repoConfig, {
          repository:
            trimmedDraft.host && trimmedDraft.owner && trimmedDraft.name ? trimmedDraft : undefined,
        }),
      );
    },
    [onUpdateSelectedRepoConfig],
  );

  const commitRepositoryDraft = useCallback(
    (nextDraft: GithubRepositoryDraft): void => {
      dispatchSectionState({
        type: "draft_committed",
        draft: nextDraft,
      });
      commitGithubRepositoryDraft(nextDraft);
    },
    [commitGithubRepositoryDraft],
  );

  const invalidateActiveDetection = useCallback(
    (options: { clearMessage?: boolean; keepManualConfigOpen?: boolean } = {}): void => {
      activeDetectionSequenceRef.current += 1;
      dispatchSectionState({
        type: "detection_invalidated",
        clearMessage: options.clearMessage === true,
        keepManualConfigOpen: options.keepManualConfigOpen === true,
      });
    },
    [],
  );

  const handleGithubEnabledChange = useCallback(
    (checked: boolean): void => {
      onUpdateSelectedRepoConfig((repoConfig) =>
        updateGithubProviderConfig(repoConfig, { enabled: checked }),
      );
    },
    [onUpdateSelectedRepoConfig],
  );

  const handleRemoveConfiguredProvider = useCallback((): void => {
    if (!hasConfiguredNonGithubProvider || configuredProviderId === undefined) {
      return;
    }

    const providerId = configuredProviderId;
    invalidateActiveDetection({ clearMessage: true });
    onUpdateSelectedRepoConfig((repoConfig) => {
      if (repoConfig.git.provider?.id !== providerId) {
        return repoConfig;
      }
      const { provider: _provider, ...git } = repoConfig.git;
      return { ...repoConfig, git };
    });
  }, [
    configuredProviderId,
    hasConfiguredNonGithubProvider,
    invalidateActiveDetection,
    onUpdateSelectedRepoConfig,
  ]);

  const handleRepositoryDraftFieldChange = useCallback(
    (field: keyof GithubRepositoryDraft, value: string): void => {
      if (isDetecting) {
        invalidateActiveDetection({ clearMessage: true, keepManualConfigOpen: true });
      }
      const nextDraft = {
        ...repositoryDraft,
        [field]: value,
      };
      commitRepositoryDraft(nextDraft);
    },
    [commitRepositoryDraft, invalidateActiveDetection, isDetecting, repositoryDraft],
  );

  const runDetection = useCallback(
    async (manual: boolean): Promise<void> => {
      if (!selectedRepoConfig || hasConfiguredNonGithubProvider || isDetecting) {
        return;
      }

      const detectionSequence = activeDetectionSequenceRef.current + 1;
      const detectionProviderId = configuredProviderId;
      activeDetectionSequenceRef.current = detectionSequence;
      dispatchSectionState({
        type: "detection_started",
      });

      const isActiveDetection = (): boolean =>
        detectionSequence === activeDetectionSequenceRef.current &&
        activeRepoPathRef.current === selectedRepoPath &&
        activeProviderIdRef.current === detectionProviderId;
      try {
        const detected = await onDetectGithubRepository();
        if (isActiveDetection()) {
          if (!detected) {
            dispatchSectionState({
              type: "detection_missing",
              manual,
            });
          } else {
            dispatchSectionState({
              type: "detection_succeeded",
              closeManualConfig: manual || !repositorySectionContext.hasRepositoryCoordinates,
              repository: detected,
            });
            commitGithubRepositoryDraft(buildRepositoryDraft(detected));
          }
        }
      } catch (error) {
        if (isActiveDetection()) {
          const reason = error instanceof Error ? error.message : "Detection failed.";
          dispatchSectionState({
            type: "detection_failed",
            manual,
            reason,
          });
        }
      }
    },
    [
      commitGithubRepositoryDraft,
      configuredProviderId,
      hasConfiguredNonGithubProvider,
      isDetecting,
      onDetectGithubRepository,
      repositorySectionContext,
      selectedRepoConfig,
      selectedRepoPath,
    ],
  );

  useEffect(() => {
    if (
      !selectedRepoPath ||
      !selectedRepoConfig ||
      disabled ||
      hasConfiguredNonGithubProvider ||
      hasRepositoryCoordinates ||
      isDetecting
    ) {
      return;
    }
    if (attemptedAutoDetectByRepo.has(selectedRepoPath)) {
      return;
    }

    attemptedAutoDetectByRepo.add(selectedRepoPath);
    void runDetection(false);
  }, [
    attemptedAutoDetectByRepo,
    disabled,
    hasConfiguredNonGithubProvider,
    hasRepositoryCoordinates,
    isDetecting,
    runDetection,
    selectedRepoConfig,
    selectedRepoPath,
  ]);

  return {
    cliStatus,
    cliStatusLabel,
    configuredProviderId,
    detectionMessage,
    githubEnabled,
    githubControlsDisabled,
    githubHost,
    githubReadinessLabel,
    githubReadinessMessage,
    githubReady,
    hasConfiguredNonGithubProvider,
    isDetecting,
    isManualConfigOpen,
    providerStatusLabel,
    repositoryDraft,
    repositorySlug,
    usesDefaultGithubHost,
    handleDetectFromOrigin: () => {
      void runDetection(true);
    },
    handleGithubEnabledChange,
    handleRemoveConfiguredProvider,
    handleRepositoryDraftFieldChange,
    handleToggleManualEdit: () => {
      dispatchSectionState({
        type: "manual_toggled",
      });
    },
  };
}

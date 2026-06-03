import type { GitProviderRepository, RepoConfig, RuntimeCheck } from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

type UseRepositoryGitSectionModelArgs = {
  selectedRepoPath: string | null;
  selectedRepoConfig: RepoConfig | null;
  runtimeCheck: RuntimeCheck | null;
  disabled: boolean;
  onDetectGithubRepository: () => Promise<GitProviderRepository | null>;
  onUpdateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => void;
};

export type GithubRepositoryDraft = {
  host: string;
  owner: string;
  name: string;
};

type RepositoryGitSectionState = {
  repoPath: string | null;
  repositoryKey: string;
  repositoryDraft: GithubRepositoryDraft;
  isManualConfigOpen: boolean;
  isDetecting: boolean;
  detectionMessage: string | null;
};

type RepositoryGitSectionContext = {
  repoPath: string | null;
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
  detectionMessage: string | null;
  githubEnabled: boolean;
  githubHost: string;
  githubReadinessLabel: string;
  githubReadinessMessage: string;
  githubReady: boolean;
  hasGithubCli: boolean;
  isDetecting: boolean;
  isManualConfigOpen: boolean;
  providerStatusLabel: string;
  repositoryDraft: GithubRepositoryDraft;
  repositorySlug: string | null;
  usesDefaultGithubHost: boolean;
  handleDetectFromOrigin: () => void;
  handleGithubEnabledChange: (checked: boolean) => void;
  handleRepositoryDraftFieldChange: (field: keyof GithubRepositoryDraft, value: string) => void;
  handleToggleManualEdit: () => void;
};

const EMPTY_GITHUB_CONFIG = {
  enabled: false,
  autoDetected: false,
  repository: undefined,
} as const;

const buildGithubConfig = (
  repoConfig: RepoConfig,
  overrides: Partial<NonNullable<RepoConfig["git"]["providers"]["github"]>>,
): NonNullable<RepoConfig["git"]["providers"]["github"]> => ({
  enabled: repoConfig.git.providers.github?.enabled ?? false,
  autoDetected: repoConfig.git.providers.github?.autoDetected ?? false,
  repository: repoConfig.git.providers.github?.repository,
  ...overrides,
});

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
  repoPath,
  repository,
}: RepositoryGitSectionContext): RepositoryGitSectionState => ({
  repoPath,
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
      return {
        ...state,
        detectionMessage: action.reason,
        isDetecting: false,
        ...(action.manual ? { isManualConfigOpen: true } : {}),
      };
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
      return {
        ...state,
        detectionMessage:
          "No GitHub origin was detected for this repository. You can still configure it manually.",
        isDetecting: false,
        ...(action.manual ? { isManualConfigOpen: true } : {}),
      };
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

export function useRepositoryGitSectionModel({
  disabled,
  onDetectGithubRepository,
  onUpdateSelectedRepoConfig,
  runtimeCheck,
  selectedRepoConfig,
  selectedRepoPath,
}: UseRepositoryGitSectionModelArgs): UseRepositoryGitSectionModelResult {
  const initialGithubRepository = selectedRepoConfig?.git.providers.github?.repository;
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
  const [sectionState, dispatchSectionState] = useReducer(
    repositoryGitSectionReducer,
    {
      hasRepositoryCoordinates: initialHasRepositoryCoordinates,
      repository: initialGithubRepository,
      repoPath: selectedRepoPath,
    },
    createRepositoryGitSectionState,
  );

  const github = selectedRepoConfig?.git.providers.github ?? EMPTY_GITHUB_CONFIG;
  const githubEnabled = github.enabled ?? false;
  const hasGithubCli = runtimeCheck?.ghOk ?? false;
  const githubHost = github.repository?.host ?? "github.com";
  const usesDefaultGithubHost = githubHost === "github.com";
  const hasRepositoryCoordinates = Boolean(
    github.repository?.host && github.repository?.owner && github.repository?.name,
  );
  const repositorySlug = hasRepositoryCoordinates
    ? `${github.repository?.owner}/${github.repository?.name}`
    : null;
  const githubReady =
    githubEnabled &&
    hasGithubCli &&
    hasRepositoryCoordinates &&
    (usesDefaultGithubHost ? (runtimeCheck?.ghAuthOk ?? false) : true);
  const githubReadinessLabel = githubReady
    ? usesDefaultGithubHost
      ? "Ready"
      : "Configured"
    : "Not ready";
  const githubReadinessMessage = !github.enabled
    ? "Enable GitHub for this repository to offer “Open pull request” during human approval."
    : !runtimeCheck?.ghOk
      ? "Install GitHub CLI (`gh`) to enable provider-backed pull requests."
      : usesDefaultGithubHost && !runtimeCheck.ghAuthOk
        ? (runtimeCheck.ghAuthError ?? "Run `gh auth login` to authenticate GitHub.")
        : !hasRepositoryCoordinates
          ? "Repository host, owner, and name are still missing."
          : usesDefaultGithubHost
            ? "GitHub pull requests are ready for this repository."
            : `GitHub pull requests are configured for ${githubHost}. Authentication for that host is validated during approval.`;
  const providerStatusLabel = githubEnabled ? "Pull requests enabled" : "Pull requests disabled";
  const cliStatusLabel = hasGithubCli ? "CLI installed" : "CLI missing";
  activeRepoPathRef.current = selectedRepoPath;
  const repositorySectionContext = useMemo<RepositoryGitSectionContext>(
    () => ({
      hasRepositoryCoordinates,
      repository: github.repository,
      repoPath: selectedRepoPath,
    }),
    [github.repository, hasRepositoryCoordinates, selectedRepoPath],
  );
  const currentSectionState = isStateForContext(sectionState, repositorySectionContext)
    ? sectionState
    : createRepositoryGitSectionState(repositorySectionContext);
  const { detectionMessage, isDetecting, isManualConfigOpen, repositoryDraft } =
    currentSectionState;

  useEffect(() => {
    dispatchSectionState({ type: "context_changed", context: repositorySectionContext });
  }, [repositorySectionContext]);

  const commitGithubRepositoryDraft = useCallback(
    (nextDraft: GithubRepositoryDraft): void => {
      const trimmedDraft = trimRepositoryDraft(nextDraft);

      onUpdateSelectedRepoConfig((repoConfig) => ({
        ...repoConfig,
        git: {
          ...repoConfig.git,
          providers: {
            ...repoConfig.git.providers,
            github: buildGithubConfig(repoConfig, {
              repository:
                trimmedDraft.host && trimmedDraft.owner && trimmedDraft.name
                  ? trimmedDraft
                  : undefined,
            }),
          },
        },
      }));
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
      onUpdateSelectedRepoConfig((repoConfig) => ({
        ...repoConfig,
        git: {
          ...repoConfig.git,
          providers: {
            ...repoConfig.git.providers,
            github: buildGithubConfig(repoConfig, { enabled: checked }),
          },
        },
      }));
    },
    [onUpdateSelectedRepoConfig],
  );

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
      if (!selectedRepoConfig || isDetecting) {
        return;
      }

      const detectionSequence = activeDetectionSequenceRef.current + 1;
      activeDetectionSequenceRef.current = detectionSequence;
      dispatchSectionState({
        type: "detection_started",
      });

      const isActiveDetection = (): boolean =>
        detectionSequence === activeDetectionSequenceRef.current &&
        activeRepoPathRef.current === selectedRepoPath;
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
    hasRepositoryCoordinates,
    isDetecting,
    runDetection,
    selectedRepoConfig,
    selectedRepoPath,
  ]);

  return {
    cliStatusLabel,
    detectionMessage,
    githubEnabled,
    githubHost,
    githubReadinessLabel,
    githubReadinessMessage,
    githubReady,
    hasGithubCli,
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
    handleRepositoryDraftFieldChange,
    handleToggleManualEdit: () => {
      dispatchSectionState({
        type: "manual_toggled",
      });
    },
  };
}

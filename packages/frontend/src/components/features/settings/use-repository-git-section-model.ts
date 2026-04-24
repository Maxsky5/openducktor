import type { GitProviderRepository, RepoConfig, RuntimeCheck } from "@openducktor/contracts";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

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

type RepositoryGitSectionUiState = {
  isManualConfigOpen: boolean;
  isDetecting: boolean;
  detectionMessage: string | null;
};

type RepositoryGitSectionUiAction =
  | {
      type: "reset_for_repo";
      hasRepositoryCoordinates: boolean;
      hasSelectedRepoPath: boolean;
    }
  | {
      type: "set_manual_config_open";
      isManualConfigOpen: boolean;
    }
  | {
      type: "toggle_manual_config_open";
    }
  | {
      type: "detection_started";
    }
  | {
      type: "detection_finished";
    }
  | {
      type: "set_detection_result";
      detectionMessage: string | null;
      isManualConfigOpen?: boolean;
      isDetecting?: boolean;
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

const INITIAL_REPOSITORY_GIT_SECTION_UI_STATE: RepositoryGitSectionUiState = {
  isManualConfigOpen: false,
  isDetecting: false,
  detectionMessage: null,
};

const repositoryGitSectionUiReducer = (
  state: RepositoryGitSectionUiState,
  action: RepositoryGitSectionUiAction,
): RepositoryGitSectionUiState => {
  switch (action.type) {
    case "reset_for_repo":
      return {
        ...state,
        detectionMessage: null,
        isDetecting: false,
        isManualConfigOpen: action.hasSelectedRepoPath ? !action.hasRepositoryCoordinates : false,
      };
    case "set_manual_config_open":
      return {
        ...state,
        isManualConfigOpen: action.isManualConfigOpen,
      };
    case "toggle_manual_config_open":
      return {
        ...state,
        isManualConfigOpen: !state.isManualConfigOpen,
      };
    case "detection_started":
      return {
        ...state,
        isDetecting: true,
      };
    case "detection_finished":
      return {
        ...state,
        isDetecting: false,
      };
    case "set_detection_result":
      return {
        ...state,
        detectionMessage: action.detectionMessage,
        ...(typeof action.isDetecting === "boolean" ? { isDetecting: action.isDetecting } : {}),
        ...(typeof action.isManualConfigOpen === "boolean"
          ? { isManualConfigOpen: action.isManualConfigOpen }
          : {}),
      };
  }
};

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

export function useRepositoryGitSectionModel({
  disabled,
  onDetectGithubRepository,
  onUpdateSelectedRepoConfig,
  runtimeCheck,
  selectedRepoConfig,
  selectedRepoPath,
}: UseRepositoryGitSectionModelArgs): UseRepositoryGitSectionModelResult {
  const attemptedAutoDetectByRepoRef = useRef<Set<string>>(new Set());
  const activeDetectionSequenceRef = useRef(0);
  const activeRepoPathRef = useRef<string | null>(selectedRepoPath);
  const previousSelectedRepoPathRef = useRef<string | null>(null);
  const hasInitializedRepoStateRef = useRef(false);
  const repositoryDraftRef = useRef<GithubRepositoryDraft>({
    host: "github.com",
    owner: "",
    name: "",
  });
  const [uiState, dispatchUiState] = useReducer(
    repositoryGitSectionUiReducer,
    INITIAL_REPOSITORY_GIT_SECTION_UI_STATE,
  );
  const [repositoryDraft, setRepositoryDraft] = useState<GithubRepositoryDraft>({
    host: "github.com",
    owner: "",
    name: "",
  });

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
  const { detectionMessage, isDetecting, isManualConfigOpen } = uiState;

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

  const invalidateActiveDetection = useCallback(
    (options: { clearMessage?: boolean; keepManualConfigOpen?: boolean } = {}): void => {
      activeDetectionSequenceRef.current += 1;
      dispatchUiState({
        type: "set_detection_result",
        detectionMessage: options.clearMessage ? null : uiState.detectionMessage,
        ...(options.keepManualConfigOpen ? { isManualConfigOpen: true } : {}),
        isDetecting: false,
      });
    },
    [uiState.detectionMessage],
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
        ...repositoryDraftRef.current,
        [field]: value,
      };
      repositoryDraftRef.current = nextDraft;
      setRepositoryDraft(nextDraft);
      commitGithubRepositoryDraft(nextDraft);
    },
    [commitGithubRepositoryDraft, invalidateActiveDetection, isDetecting],
  );

  const runDetection = useCallback(
    async (manual: boolean): Promise<void> => {
      if (!selectedRepoConfig || isDetecting) {
        return;
      }

      const detectionSequence = activeDetectionSequenceRef.current + 1;
      activeDetectionSequenceRef.current = detectionSequence;
      dispatchUiState({ type: "detection_started" });

      try {
        const detected = await onDetectGithubRepository();
        if (
          detectionSequence !== activeDetectionSequenceRef.current ||
          activeRepoPathRef.current !== selectedRepoPath
        ) {
          return;
        }

        if (!detected) {
          dispatchUiState({
            type: "set_detection_result",
            detectionMessage:
              "No GitHub origin was detected for this repository. You can still configure it manually.",
            ...(manual ? { isManualConfigOpen: true } : {}),
          });
          return;
        }

        const nextDraft = {
          host: detected.host,
          owner: detected.owner,
          name: detected.name,
        };
        repositoryDraftRef.current = nextDraft;
        setRepositoryDraft(nextDraft);
        commitGithubRepositoryDraft(nextDraft);
        dispatchUiState({
          type: "set_detection_result",
          detectionMessage: `Detected ${detected.owner}/${detected.name} from origin. Save settings to keep this mapping.`,
          ...(manual || !hasRepositoryCoordinates ? { isManualConfigOpen: false } : {}),
        });
      } catch (error) {
        if (
          detectionSequence !== activeDetectionSequenceRef.current ||
          activeRepoPathRef.current !== selectedRepoPath
        ) {
          return;
        }

        const reason = error instanceof Error ? error.message : "Detection failed.";
        dispatchUiState({
          type: "set_detection_result",
          detectionMessage: reason,
          ...(manual ? { isManualConfigOpen: true } : {}),
        });
      } finally {
        if (detectionSequence === activeDetectionSequenceRef.current) {
          dispatchUiState({ type: "detection_finished" });
        }
      }
    },
    [
      commitGithubRepositoryDraft,
      hasRepositoryCoordinates,
      isDetecting,
      onDetectGithubRepository,
      selectedRepoConfig,
      selectedRepoPath,
    ],
  );

  useEffect(() => {
    activeRepoPathRef.current = selectedRepoPath;

    const hasRepoChanged =
      !hasInitializedRepoStateRef.current ||
      previousSelectedRepoPathRef.current !== selectedRepoPath;
    previousSelectedRepoPathRef.current = selectedRepoPath;
    hasInitializedRepoStateRef.current = true;

    if (hasRepoChanged) {
      invalidateActiveDetection({ clearMessage: true });
      dispatchUiState({
        type: "reset_for_repo",
        hasSelectedRepoPath: selectedRepoPath != null,
        hasRepositoryCoordinates,
      });
      return;
    }

    if (selectedRepoPath == null) {
      dispatchUiState({
        type: "set_manual_config_open",
        isManualConfigOpen: false,
      });
      return;
    }

    if (!hasRepositoryCoordinates && !uiState.isManualConfigOpen) {
      dispatchUiState({
        type: "set_manual_config_open",
        isManualConfigOpen: true,
      });
    }
  }, [
    hasRepositoryCoordinates,
    invalidateActiveDetection,
    selectedRepoPath,
    uiState.isManualConfigOpen,
  ]);

  useEffect(() => {
    const nextDraft = {
      host: github.repository?.host ?? "github.com",
      owner: github.repository?.owner ?? "",
      name: github.repository?.name ?? "",
    };
    repositoryDraftRef.current = nextDraft;
    setRepositoryDraft(nextDraft);
  }, [github.repository?.host, github.repository?.name, github.repository?.owner]);

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
    if (attemptedAutoDetectByRepoRef.current.has(selectedRepoPath)) {
      return;
    }

    attemptedAutoDetectByRepoRef.current.add(selectedRepoPath);
    void runDetection(false);
  }, [
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
      dispatchUiState({ type: "toggle_manual_config_open" });
    },
  };
}

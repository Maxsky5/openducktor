import { describe, expect, mock, test } from "bun:test";
import type { GitProviderRepository, RepoConfig } from "@openducktor/contracts";
import { useState } from "react";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { useSettingsModalRepositoryActions } from "./use-settings-modal-repository-actions";

enableReactActEnvironment();

type HookArgs = {
  selectedRepoPath: string | null;
  initialRepoConfig: RepoConfig;
  detectGithubRepository: (repoPath: string) => Promise<GitProviderRepository | null>;
};

const createRepoConfig = (): RepoConfig => ({
  workspaceId: "repo-a",
  workspaceName: "Repo A",
  repoPath: "/repo-a",
  defaultRuntimeKind: "opencode",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {
    providers: {},
  },
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeFileCopies: [],
  promptOverrides: {},
  agentDefaults: {},
});

const useRepositoryActionsHarness = ({
  selectedRepoPath,
  initialRepoConfig,
  detectGithubRepository,
}: HookArgs) => {
  const [repoConfig, setRepoConfig] = useState(initialRepoConfig);
  const actions = useSettingsModalRepositoryActions({
    selectedRepoPath,
    detectGithubRepository,
    updateSelectedRepoConfig: (updater) => {
      setRepoConfig((current) => updater(current));
    },
  });

  return {
    repoConfig,
    ...actions,
  };
};

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useRepositoryActionsHarness, initialProps);

describe("useSettingsModalRepositoryActions", () => {
  test("no-ops when no repository is selected", async () => {
    const detectGithubRepository = mock(async () => ({
      host: "github.com",
      owner: "duck",
      name: "repo",
    }));
    const harness = createHookHarness({
      selectedRepoPath: null,
      initialRepoConfig: createRepoConfig(),
      detectGithubRepository,
    });

    await harness.mount();

    let detected: GitProviderRepository | null = null;
    await harness.run(async (state) => {
      detected = await state.detectSelectedRepoGithubRepository();
    });

    expect(detected).toBeNull();
    expect(detectGithubRepository).toHaveBeenCalledTimes(0);
    expect(harness.getLatest().repoConfig.git.providers.github).toBeUndefined();

    await harness.unmount();
  });

  test("updates the selected repo github config and preserves an existing enabled state", async () => {
    const detectGithubRepository = mock(async () => ({
      host: "github.com",
      owner: "duck",
      name: "repo",
    }));
    const initialRepoConfig: RepoConfig = {
      ...createRepoConfig(),
      git: {
        providers: {
          github: {
            enabled: false,
            autoDetected: false,
            repository: { host: "github.com", owner: "existing", name: "repo" },
          },
        },
      },
    };
    const harness = createHookHarness({
      selectedRepoPath: "/repo-a",
      initialRepoConfig,
      detectGithubRepository,
    });

    await harness.mount();

    let detected: unknown = null;
    await harness.run(async (state) => {
      detected = await state.detectSelectedRepoGithubRepository();
    });

    expect(detectGithubRepository).toHaveBeenCalledWith("/repo-a");
    expect(detected).not.toBeNull();
    if (typeof detected !== "object" || detected === null) {
      throw new Error("Expected detected repository");
    }
    const detectedRepo = detected as GitProviderRepository;
    expect(detectedRepo.host).toBe("github.com");
    expect(detectedRepo.owner).toBe("duck");
    expect(detectedRepo.name).toBe("repo");
    const githubProvider = harness.getLatest().repoConfig.git.providers.github;
    if (!githubProvider) {
      throw new Error("Expected GitHub provider settings");
    }
    expect(githubProvider.enabled).toBe(false);
    expect(githubProvider.autoDetected).toBe(true);
    expect(githubProvider.repository?.host).toBe("github.com");
    expect(githubProvider.repository?.owner).toBe("duck");
    expect(githubProvider.repository?.name).toBe("repo");

    await harness.unmount();
  });
});

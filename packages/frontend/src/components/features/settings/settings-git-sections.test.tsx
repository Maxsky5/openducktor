import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type GitProviderConfig,
  type GitProviderHealth,
  type SettingsRepoConfig,
} from "@openducktor/contracts";
import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, createElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsGitSection } from "./settings-git-section";
import { RepositoryGitSection } from "./settings-repository-git-section";
import type { GitProviderState } from "./use-repository-git-section-model";

const authenticatedGitProviderHealth: GitProviderHealth = {
  providerId: "github",
  enabled: true,
  available: true,
  executablePath: "gh",
  version: "gh version 2.73.0",
  authenticated: true,
  account: "octocat",
  repositoryMappingValid: true,
};

const loadedState = (health: GitProviderHealth): GitProviderState => ({
  status: "loaded",
  context: {
    descriptor: GITHUB_PROVIDER_DESCRIPTOR,
    config: {
      id: GITHUB_PROVIDER_DESCRIPTOR.id,
      enabled: health.enabled,
      autoDetected: false,
    },
    health,
  },
});

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

const baseRepoConfig: SettingsRepoConfig = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
  worktreeBasePath: undefined,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {
    provider: {
      id: "github",
      enabled: true,
      autoDetected: true,
      repository: {
        host: "github.com",
        owner: "openai",
        name: "openducktor",
      },
    },
  },
  hooks: {
    preStart: [],
    postComplete: [],
  },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
};

const createGitlabProvider = (): GitProviderConfig => ({
  id: "gitlab",
  enabled: true,
  autoDetected: false,
  repository: { host: "gitlab.com", owner: "acme", name: "widget" },
});

describe("settings git sections", () => {
  test("renders global Git defaults without provider details", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsGitSection, {
        git: { defaultMergeMethod: "merge_commit" },
        disabled: false,
        onUpdateGit: () => ({ defaultMergeMethod: "merge_commit" }),
      }),
    );

    expect(html).toContain("Default merge method");
    expect(html).not.toContain("GitHub CLI");
  });

  test("renders repository readiness blockers when GitHub auth is missing", () => {
    const html = renderToStaticMarkup(
      createElement(RepositoryGitSection, {
        selectedRepoPath: "/repo",
        selectedRepoConfig: baseRepoConfig,
        providerState: loadedState({
          ...authenticatedGitProviderHealth,
          available: false,
          authenticated: false,
          account: null,
          reason: "Run `gh auth login` to connect GitHub.",
        }),
        disabled: false,
        onDetectGithubRepository: async () => null,
        onUpdateSelectedRepoConfig: () => baseRepoConfig,
      }),
    );

    expect(html).toContain("GitHub Pull Requests");
    expect(html).toContain("Not ready");
    expect(html).toContain("Run `gh auth login` to connect GitHub.");
    expect(html).toContain("openai/openducktor");
    expect(html).toContain("bg-warning-surface");
    expect(html).toContain("bg-success-surface");
  });

  test("renders the configured provider label and description from its descriptor", () => {
    const gitlabProvider = createGitlabProvider();
    const html = renderToStaticMarkup(
      createElement(RepositoryGitSection, {
        selectedRepoPath: "/repo",
        selectedRepoConfig: {
          ...baseRepoConfig,
          git: { provider: gitlabProvider },
        },
        providerState: {
          status: "loaded",
          context: {
            descriptor: {
              id: "gitlab",
              label: "GitLab",
              description: "GitLab repository hosting.",
              capabilities: {
                supportsPullRequests: true,
                supportsPullRequestReview: false,
              },
            },
            config: gitlabProvider,
            health: {
              providerId: "gitlab",
              enabled: true,
              available: true,
              executablePath: "glab",
              version: "1.0.0",
              authenticated: true,
              account: "tester",
              repositoryMappingValid: true,
            },
          },
        },
        disabled: false,
        onDetectGithubRepository: async () => null,
        onUpdateSelectedRepoConfig: () => baseRepoConfig,
      }),
    );

    expect(html).toContain(">GitLab<");
    expect(html).not.toContain("GitLab Pull Requests");
    expect(html).toContain("GitLab repository hosting.");
  });

  test("does not report a missing CLI while GitHub is disabled", () => {
    const html = renderToStaticMarkup(
      createElement(RepositoryGitSection, {
        selectedRepoPath: "/repo",
        selectedRepoConfig: {
          ...baseRepoConfig,
          git: {
            provider: {
              ...baseRepoConfig.git.provider!,
              enabled: false,
            },
          },
        },
        providerState: { status: "idle" },
        disabled: false,
        onDetectGithubRepository: async () => null,
        onUpdateSelectedRepoConfig: () => baseRepoConfig,
      }),
    );

    expect(html).toContain("Pull requests disabled");
    expect(html).not.toContain("CLI missing");
  });

  test("shows a pending GitHub health check without reporting a missing CLI", () => {
    const html = renderToStaticMarkup(
      createElement(RepositoryGitSection, {
        selectedRepoPath: "/repo",
        selectedRepoConfig: baseRepoConfig,
        providerState: { status: "pending" },
        disabled: false,
        onDetectGithubRepository: async () => null,
        onUpdateSelectedRepoConfig: () => baseRepoConfig,
      }),
    );

    expect(html).toContain("Checking CLI");
    expect(html).not.toContain("CLI missing");
  });

  test("shows a failed GitHub health check without reporting a missing CLI", () => {
    const html = renderToStaticMarkup(
      createElement(RepositoryGitSection, {
        selectedRepoPath: "/repo",
        selectedRepoConfig: baseRepoConfig,
        providerState: { status: "error", message: "Health command failed." },
        disabled: false,
        onDetectGithubRepository: async () => null,
        onUpdateSelectedRepoConfig: () => baseRepoConfig,
      }),
    );

    expect(html).toContain("Health check failed");
    expect(html).toContain("Health command failed.");
    expect(html).not.toContain("CLI missing");
  });

  test("does not use saved health for an unsaved GitHub provider", () => {
    const html = renderToStaticMarkup(
      createElement(RepositoryGitSection, {
        selectedRepoPath: "/repo",
        selectedRepoConfig: baseRepoConfig,
        providerState: { status: "draft" },
        disabled: false,
        onDetectGithubRepository: async () => null,
        onUpdateSelectedRepoConfig: () => baseRepoConfig,
      }),
    );

    expect(html).toContain("Not ready");
    expect(html).toContain("Save settings to check GitHub health.");
    expect(html).not.toContain("GitHub pull requests are ready");
    expect(html).not.toContain("CLI installed");
  });

  test("renders enterprise host repository readiness without assuming github.com auth", () => {
    const html = renderToStaticMarkup(
      createElement(RepositoryGitSection, {
        selectedRepoPath: "/repo",
        selectedRepoConfig: {
          ...baseRepoConfig,
          git: {
            provider: {
              id: "github",
              enabled: true,
              autoDetected: false,
              repository: {
                host: "github.mycorp.com",
                owner: "openai",
                name: "openducktor",
              },
            },
          },
        },
        providerState: loadedState(authenticatedGitProviderHealth),
        disabled: false,
        onDetectGithubRepository: async () => null,
        onUpdateSelectedRepoConfig: () => baseRepoConfig,
      }),
    );

    expect(html).toContain("Configured");
    expect(html).toContain("github.mycorp.com");
    expect(html).toContain("GitHub pull requests are ready");
  });

  test("allows editing repository inputs without crashing when the field is temporarily blank", () => {
    const ControlledRepositoryGitSection = (): ReturnType<typeof createElement> => {
      const [repoConfig, setRepoConfig] = useState<SettingsRepoConfig>({
        ...baseRepoConfig,
        git: {
          provider: {
            id: "github",
            enabled: true,
            autoDetected: false,
            repository: {
              host: "github.com",
              owner: "openai",
              name: "openducktor",
            },
          },
        },
      });

      return createElement(RepositoryGitSection, {
        selectedRepoPath: "/repo",
        selectedRepoConfig: repoConfig,
        providerState: loadedState(authenticatedGitProviderHealth),
        disabled: false,
        onDetectGithubRepository: async () => null,
        onUpdateSelectedRepoConfig: (updater) => {
          setRepoConfig(updater);
        },
      });
    };

    const rendered = render(createElement(ControlledRepositoryGitSection));

    try {
      fireEvent.click(screen.getByRole("button", { name: /edit manually/i }));

      const repoInput = rendered.container.querySelector("#repo-github-name");
      if (!(repoInput instanceof HTMLInputElement)) {
        throw new Error("Expected repo name input");
      }

      fireEvent.change(repoInput, { target: { value: "" } });
      fireEvent.change(repoInput, { target: { value: "fairnest-renamed" } });

      expect(screen.getByRole("button", { name: /hide manual edit/i })).toBeTruthy();
    } finally {
      rendered.unmount();
    }
  });

  test("detecting from origin updates the repository draft that gets saved", async () => {
    let repoConfig: SettingsRepoConfig = {
      ...baseRepoConfig,
      git: {
        provider: {
          id: "github",
          enabled: true,
          autoDetected: false,
          repository: {
            host: "github.com",
            owner: "before-click",
            name: "before-click",
          },
        },
      },
    };

    const onDetectGithubRepository = mock(async () => ({
      host: "github.com",
      owner: "acme",
      name: "widget",
    }));

    const onUpdateSelectedRepoConfig = (
      updater: (current: SettingsRepoConfig) => SettingsRepoConfig,
    ): SettingsRepoConfig => {
      repoConfig = updater(repoConfig);
      return repoConfig;
    };

    const rendered = render(
      createElement(RepositoryGitSection, {
        selectedRepoPath: "/repo",
        selectedRepoConfig: repoConfig,
        providerState: loadedState(authenticatedGitProviderHealth),
        disabled: false,
        onDetectGithubRepository,
        onUpdateSelectedRepoConfig,
      }),
    );

    try {
      expect(repoConfig.git.provider?.repository).toEqual({
        host: "github.com",
        owner: "before-click",
        name: "before-click",
      });
      expect(onDetectGithubRepository).toHaveBeenCalledTimes(0);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /detect from origin/i }));
      });

      expect(repoConfig.git.provider?.repository).toEqual({
        host: "github.com",
        owner: "acme",
        name: "widget",
      });
      expect(onDetectGithubRepository).toHaveBeenCalledTimes(1);
    } finally {
      rendered.unmount();
    }
  });

  test("allows removing another configured provider before configuring GitHub", async () => {
    const onDetectGithubRepository = mock(async () => null);
    const gitlabProvider = createGitlabProvider();
    const initialRepoConfig: SettingsRepoConfig = {
      ...baseRepoConfig,
      git: {
        provider: gitlabProvider,
      },
    };
    const ControlledRepositoryGitSection = (): ReturnType<typeof createElement> => {
      const [repoConfig, setRepoConfig] = useState(initialRepoConfig);
      return createElement(
        "div",
        null,
        createElement(
          "output",
          { "data-testid": "configured-provider-id" },
          repoConfig.git.provider?.id ?? "none",
        ),
        createElement(RepositoryGitSection, {
          selectedRepoPath: "/repo",
          selectedRepoConfig: repoConfig,
          providerState: loadedState(authenticatedGitProviderHealth),
          disabled: false,
          onDetectGithubRepository,
          onUpdateSelectedRepoConfig: setRepoConfig,
        }),
      );
    };
    const rendered = render(createElement(ControlledRepositoryGitSection));

    try {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(rendered.container.textContent).toContain(
        "Git provider gitlab is configured. Remove it before you configure GitHub.",
      );
      expect(onDetectGithubRepository).toHaveBeenCalledTimes(0);
      expect(screen.queryByRole("switch")).toBeNull();
      expect(screen.queryByRole("button", { name: /detect from origin/i })).toBeNull();
      expect(rendered.container.querySelector("#repo-github-host")).toBeNull();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /remove provider/i }));
      });

      expect(screen.getByTestId("configured-provider-id").textContent).toBe("none");
      expect(screen.getByRole("switch")).toBeTruthy();
    } finally {
      rendered.unmount();
    }
  });

  test("does not replace a provider configured during origin detection", async () => {
    let repoConfig: SettingsRepoConfig = baseRepoConfig;
    const pendingDetection = createDeferred<{
      host: string;
      owner: string;
      name: string;
    } | null>();
    const onUpdateSelectedRepoConfig = (
      updater: (current: SettingsRepoConfig) => SettingsRepoConfig,
    ): SettingsRepoConfig => {
      repoConfig = updater(repoConfig);
      return repoConfig;
    };
    const props = () => ({
      selectedRepoPath: "/repo",
      selectedRepoConfig: repoConfig,
      providerState: loadedState(authenticatedGitProviderHealth),
      disabled: false,
      onDetectGithubRepository: () => pendingDetection.promise,
      onUpdateSelectedRepoConfig,
    });
    const rendered = render(createElement(RepositoryGitSection, props()));

    try {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /detect from origin/i }));
        await Promise.resolve();
      });

      const gitlabProvider = createGitlabProvider();
      repoConfig = {
        ...repoConfig,
        git: {
          provider: gitlabProvider,
        },
      };
      rendered.rerender(createElement(RepositoryGitSection, props()));

      await act(async () => {
        pendingDetection.resolve({ host: "github.com", owner: "detected", name: "repo" });
        await pendingDetection.promise;
        await Promise.resolve();
      });

      expect(repoConfig.git.provider).toBe(gitlabProvider);
    } finally {
      rendered.unmount();
    }
  });

  test("same-repo manual edits invalidate an in-flight origin detection", async () => {
    let repoConfig: SettingsRepoConfig = {
      ...baseRepoConfig,
      git: {
        provider: {
          id: "github",
          enabled: true,
          autoDetected: false,
          repository: undefined,
        },
      },
    };
    const pendingDetection = createDeferred<{
      host: string;
      owner: string;
      name: string;
    } | null>();

    const onUpdateSelectedRepoConfig = (
      updater: (current: SettingsRepoConfig) => SettingsRepoConfig,
    ): SettingsRepoConfig => {
      repoConfig = updater(repoConfig);
      return repoConfig;
    };

    const rendered = render(
      createElement(RepositoryGitSection, {
        selectedRepoPath: "/repo",
        selectedRepoConfig: repoConfig,
        providerState: loadedState(authenticatedGitProviderHealth),
        disabled: false,
        onDetectGithubRepository: () => pendingDetection.promise,
        onUpdateSelectedRepoConfig,
      }),
    );

    try {
      const ownerInput = rendered.container.querySelector("#repo-github-owner");
      const repoInput = rendered.container.querySelector("#repo-github-name");
      if (!(ownerInput instanceof HTMLInputElement) || !(repoInput instanceof HTMLInputElement)) {
        throw new Error("Expected repo owner and name inputs");
      }

      fireEvent.change(ownerInput, { target: { value: "manual-owner" } });
      fireEvent.change(repoInput, { target: { value: "manual-repo" } });

      await act(async () => {
        pendingDetection.resolve({
          host: "github.com",
          owner: "detected-owner",
          name: "detected-repo",
        });
        await pendingDetection.promise;
        await Promise.resolve();
      });

      expect(repoConfig.git.provider?.repository).toEqual({
        host: "github.com",
        owner: "manual-owner",
        name: "manual-repo",
      });
    } finally {
      rendered.unmount();
    }
  });

  test("keeps successful origin-detection feedback visible after coordinates are saved", async () => {
    const detectedMessage = "Detected acme/widget from origin. Save settings to keep this mapping.";
    const detection = createDeferred<{
      host: string;
      owner: string;
      name: string;
    }>();

    const ControlledRepositoryGitSection = (): ReturnType<typeof createElement> => {
      const [repoConfig, setRepoConfig] = useState<SettingsRepoConfig>({
        ...baseRepoConfig,
        git: {
          provider: {
            id: "github",
            enabled: true,
            autoDetected: false,
            repository: undefined,
          },
        },
      });

      return createElement(RepositoryGitSection, {
        selectedRepoPath: "/repo",
        selectedRepoConfig: repoConfig,
        providerState: loadedState(authenticatedGitProviderHealth),
        disabled: false,
        onDetectGithubRepository: () => detection.promise,
        onUpdateSelectedRepoConfig: (updater) => {
          setRepoConfig(updater);
        },
      });
    };

    let rendered: ReturnType<typeof render> | undefined;
    await act(async () => {
      rendered = render(createElement(ControlledRepositoryGitSection));
      await Promise.resolve();
      await Promise.resolve();
    });

    try {
      await act(async () => {
        detection.resolve({
          host: "github.com",
          owner: "acme",
          name: "widget",
        });
        await detection.promise;
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(rendered?.container.textContent).toContain(detectedMessage);
      });
      const detectButton = screen.getByRole("button", { name: /detect from origin/i });
      expect(detectButton).toBeInstanceOf(HTMLButtonElement);
      if (!(detectButton instanceof HTMLButtonElement)) throw new TypeError("Expected a button");
      expect(detectButton.disabled).toBe(false);
    } finally {
      rendered?.unmount();
    }
  });

  test("auto-detect waits for repo config before consuming the repo attempt", async () => {
    const detection = createDeferred<{
      host: string;
      owner: string;
      name: string;
    }>();
    const onDetectGithubRepository = mock(() => detection.promise);

    let rendered: ReturnType<typeof render> | undefined;
    await act(async () => {
      rendered = render(
        createElement(RepositoryGitSection, {
          selectedRepoPath: "/repo",
          selectedRepoConfig: null,
          providerState: loadedState(authenticatedGitProviderHealth),
          disabled: false,
          onDetectGithubRepository,
          onUpdateSelectedRepoConfig: () => baseRepoConfig,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    try {
      expect(rendered?.container.textContent).toBeTruthy();
      expect(onDetectGithubRepository).toHaveBeenCalledTimes(0);

      await act(async () => {
        rendered?.rerender(
          createElement(RepositoryGitSection, {
            selectedRepoPath: "/repo",
            selectedRepoConfig: {
              ...baseRepoConfig,
              git: {
                provider: {
                  id: "github",
                  enabled: true,
                  autoDetected: false,
                  repository: undefined,
                },
              },
            },
            providerState: loadedState(authenticatedGitProviderHealth),
            disabled: false,
            onDetectGithubRepository,
            onUpdateSelectedRepoConfig: () => baseRepoConfig,
          }),
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        detection.resolve({
          host: "github.com",
          owner: "acme",
          name: "widget",
        });
        await detection.promise;
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(onDetectGithubRepository).toHaveBeenCalledTimes(1);
      });
    } finally {
      rendered?.unmount();
    }
  });
});

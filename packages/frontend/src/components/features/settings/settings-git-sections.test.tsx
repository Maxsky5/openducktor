import { describe, expect, mock, test } from "bun:test";
import type { RepoConfig, RuntimeCheck } from "@openducktor/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, createElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsGitSection } from "./settings-git-section";
import { RepositoryGitSection } from "./settings-repository-git-section";

const authenticatedRuntimeCheck: RuntimeCheck = {
  gitOk: true,
  gitVersion: "git version 2.50.1",
  ghOk: true,
  ghVersion: "gh version 2.73.0",
  ghAuthOk: true,
  ghAuthLogin: "octocat",
  ghAuthError: null,
  runtimes: [],
  errors: [],
};

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

const baseRepoConfig: RepoConfig = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
  worktreeBasePath: undefined,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {
    providers: {
      github: {
        enabled: true,
        autoDetected: true,
        repository: {
          host: "github.com",
          owner: "openai",
          name: "openducktor",
        },
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

describe("settings git sections", () => {
  test("renders global GitHub CLI and auth readiness", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsGitSection, {
        git: { defaultMergeMethod: "merge_commit" },
        runtimeCheck: authenticatedRuntimeCheck,
        disabled: false,
        onUpdateGit: () => ({ defaultMergeMethod: "merge_commit" }),
      }),
    );

    expect(html).toContain("GitHub CLI");
    expect(html).toContain("Installed");
    expect(html).toContain("gh version 2.73.0");
    expect(html).toContain("GitHub Authentication");
    expect(html).toContain("Authenticated");
    expect(html).toContain("Authenticated as octocat.");
  });

  test("renders repository readiness blockers when GitHub auth is missing", () => {
    const html = renderToStaticMarkup(
      createElement(RepositoryGitSection, {
        selectedRepoPath: "/repo",
        selectedRepoConfig: baseRepoConfig,
        runtimeCheck: {
          ...authenticatedRuntimeCheck,
          ghAuthOk: false,
          ghAuthLogin: null,
          ghAuthError: "Run `gh auth login` to connect GitHub.",
        },
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

  test("renders enterprise host repository readiness without assuming github.com auth", () => {
    const html = renderToStaticMarkup(
      createElement(RepositoryGitSection, {
        selectedRepoPath: "/repo",
        selectedRepoConfig: {
          ...baseRepoConfig,
          git: {
            providers: {
              github: {
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
        },
        runtimeCheck: {
          ...authenticatedRuntimeCheck,
          ghAuthOk: false,
          ghAuthLogin: null,
          ghAuthError: "github.com auth missing",
        },
        disabled: false,
        onDetectGithubRepository: async () => null,
        onUpdateSelectedRepoConfig: () => baseRepoConfig,
      }),
    );

    expect(html).toContain("Configured");
    expect(html).toContain("github.mycorp.com");
    expect(html).toContain("validated during approval");
  });

  test("allows editing repository inputs without crashing when the field is temporarily blank", () => {
    const ControlledRepositoryGitSection = (): ReturnType<typeof createElement> => {
      const [repoConfig, setRepoConfig] = useState<RepoConfig>({
        ...baseRepoConfig,
        git: {
          providers: {
            github: {
              enabled: true,
              autoDetected: false,
              repository: {
                host: "github.com",
                owner: "openai",
                name: "openducktor",
              },
            },
          },
        },
      });

      return createElement(RepositoryGitSection, {
        selectedRepoPath: "/repo",
        selectedRepoConfig: repoConfig,
        runtimeCheck: authenticatedRuntimeCheck,
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
    let repoConfig: RepoConfig = {
      ...baseRepoConfig,
      git: {
        providers: {
          github: {
            enabled: true,
            autoDetected: false,
            repository: {
              host: "github.com",
              owner: "before-click",
              name: "before-click",
            },
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
      updater: (current: RepoConfig) => RepoConfig,
    ): RepoConfig => {
      repoConfig = updater(repoConfig);
      return repoConfig;
    };

    const rendered = render(
      createElement(RepositoryGitSection, {
        selectedRepoPath: "/repo",
        selectedRepoConfig: repoConfig,
        runtimeCheck: authenticatedRuntimeCheck,
        disabled: false,
        onDetectGithubRepository,
        onUpdateSelectedRepoConfig,
      }),
    );

    try {
      expect(repoConfig.git.providers.github?.repository).toEqual({
        host: "github.com",
        owner: "before-click",
        name: "before-click",
      });
      expect(onDetectGithubRepository).toHaveBeenCalledTimes(0);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /detect from origin/i }));
      });

      expect(repoConfig.git.providers.github?.repository).toEqual({
        host: "github.com",
        owner: "acme",
        name: "widget",
      });
      expect(onDetectGithubRepository).toHaveBeenCalledTimes(1);
    } finally {
      rendered.unmount();
    }
  });

  test("same-repo manual edits invalidate an in-flight origin detection", async () => {
    let repoConfig: RepoConfig = {
      ...baseRepoConfig,
      git: {
        providers: {
          github: {
            enabled: true,
            autoDetected: false,
            repository: undefined,
          },
        },
      },
    };
    const pendingDetection = createDeferred<{
      host: string;
      owner: string;
      name: string;
    } | null>();

    const onUpdateSelectedRepoConfig = (
      updater: (current: RepoConfig) => RepoConfig,
    ): RepoConfig => {
      repoConfig = updater(repoConfig);
      return repoConfig;
    };

    const rendered = render(
      createElement(RepositoryGitSection, {
        selectedRepoPath: "/repo",
        selectedRepoConfig: repoConfig,
        runtimeCheck: authenticatedRuntimeCheck,
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

      expect(repoConfig.git.providers.github?.repository).toEqual({
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
      const [repoConfig, setRepoConfig] = useState<RepoConfig>({
        ...baseRepoConfig,
        git: {
          providers: {
            github: {
              enabled: true,
              autoDetected: false,
              repository: undefined,
            },
          },
        },
      });

      return createElement(RepositoryGitSection, {
        selectedRepoPath: "/repo",
        selectedRepoConfig: repoConfig,
        runtimeCheck: authenticatedRuntimeCheck,
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
          runtimeCheck: authenticatedRuntimeCheck,
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
                providers: {
                  github: {
                    enabled: true,
                    autoDetected: false,
                    repository: undefined,
                  },
                },
              },
            },
            runtimeCheck: authenticatedRuntimeCheck,
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

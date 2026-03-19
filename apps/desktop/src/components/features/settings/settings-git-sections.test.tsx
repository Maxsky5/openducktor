import { describe, expect, mock, test } from "bun:test";
import type { RepoConfig, RuntimeCheck } from "@openducktor/contracts";
import { createElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create } from "react-test-renderer";
import { SettingsGitSection } from "./settings-git-section";
import { RepositoryGitSection } from "./settings-repository-git-section";

const flattenChildrenText = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(flattenChildrenText).join(" ");
  }
  if (value && typeof value === "object" && "props" in value) {
    return flattenChildrenText((value as { props?: { children?: unknown } }).props?.children);
  }
  return "";
};

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
  trustedHooks: false,
  trustedHooksFingerprint: undefined,
  hooks: {
    preStart: [],
    postComplete: [],
  },
  worktreeFileCopies: [],
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

    let renderer!: ReturnType<typeof create>;

    act(() => {
      renderer = create(createElement(ControlledRepositoryGitSection));
    });

    const editButton = renderer.root.find(
      (node) =>
        node.type === "button" &&
        flattenChildrenText(node.props.children).includes("Edit manually"),
    );
    act(() => {
      editButton.props.onClick();
    });

    const repoInput = renderer.root.findByProps({ id: "repo-github-name" });

    act(() => {
      repoInput.props.onChange({
        currentTarget: {
          value: "",
        },
      });
    });

    act(() => {
      repoInput.props.onChange({
        currentTarget: {
          value: "fairnest-renamed",
        },
      });
    });

    const manualToggle = renderer.root.find(
      (node) =>
        node.type === "button" &&
        flattenChildrenText(node.props.children).includes("Hide manual edit"),
    );

    expect(manualToggle).toBeTruthy();
  });

  test("detecting from origin updates the repository draft that gets saved", async () => {
    let renderer!: ReturnType<typeof create>;
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

    await act(async () => {
      renderer = create(
        createElement(RepositoryGitSection, {
          selectedRepoPath: "/repo",
          selectedRepoConfig: repoConfig,
          runtimeCheck: authenticatedRuntimeCheck,
          disabled: false,
          onDetectGithubRepository,
          onUpdateSelectedRepoConfig,
        }),
      );
    });

    expect(repoConfig.git.providers.github?.repository).toEqual({
      host: "github.com",
      owner: "before-click",
      name: "before-click",
    });
    expect(onDetectGithubRepository).toHaveBeenCalledTimes(0);

    const detectButton = renderer.root.find(
      (node) =>
        node.type === "button" &&
        flattenChildrenText(node.props.children).includes("Detect from origin"),
    );

    await act(async () => {
      await detectButton.props.onClick();
    });

    expect(repoConfig.git.providers.github?.repository).toEqual({
      host: "github.com",
      owner: "acme",
      name: "widget",
    });
    expect(onDetectGithubRepository).toHaveBeenCalledTimes(1);
  });

  test("same-repo manual edits invalidate an in-flight origin detection", async () => {
    let renderer!: ReturnType<typeof create>;
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

    await act(async () => {
      renderer = create(
        createElement(RepositoryGitSection, {
          selectedRepoPath: "/repo",
          selectedRepoConfig: repoConfig,
          runtimeCheck: authenticatedRuntimeCheck,
          disabled: false,
          onDetectGithubRepository: () => pendingDetection.promise,
          onUpdateSelectedRepoConfig,
        }),
      );
      await Promise.resolve();
    });

    const ownerInput = renderer.root.findByProps({ id: "repo-github-owner" });
    const repoInput = renderer.root.findByProps({ id: "repo-github-name" });

    act(() => {
      ownerInput.props.onChange({
        currentTarget: {
          value: "manual-owner",
        },
      });
      repoInput.props.onChange({
        currentTarget: {
          value: "manual-repo",
        },
      });
    });

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
  });

  test("keeps successful origin-detection feedback visible after coordinates are saved", async () => {
    const detectedMessage = "Detected acme/widget from origin. Save settings to keep this mapping.";

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
        onDetectGithubRepository: async () => ({
          host: "github.com",
          owner: "acme",
          name: "widget",
        }),
        onUpdateSelectedRepoConfig: (updater) => {
          setRepoConfig(updater);
        },
      });
    };

    let renderer!: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(createElement(ControlledRepositoryGitSection));
    });

    const matchingNodes = renderer.root.findAll((node) =>
      flattenChildrenText(node.props.children).includes(detectedMessage),
    );

    expect(matchingNodes.length).toBeGreaterThan(0);
  });

  test("auto-detect waits for repo config before consuming the repo attempt", async () => {
    let renderer!: ReturnType<typeof create>;
    const onDetectGithubRepository = mock(async () => ({
      host: "github.com",
      owner: "acme",
      name: "widget",
    }));

    await act(async () => {
      renderer = create(
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
    });

    expect(renderer.toJSON()).toBeTruthy();
    expect(onDetectGithubRepository).toHaveBeenCalledTimes(0);

    await act(async () => {
      renderer.update(
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
    });

    expect(onDetectGithubRepository).toHaveBeenCalledTimes(1);
  });
});

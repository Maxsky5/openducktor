import { describe, expect, test } from "bun:test";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@openducktor/contracts";
import type { JSONType } from "zod";
import {
  createDefaultGlobalConfig,
  parsePersistedGlobalConfig,
  parsePersistedGlobalConfigV2,
  parsePersistedGlobalConfigV3,
  upgradePersistedGlobalConfigV2,
  upgradePersistedGlobalConfigV3,
} from "./global-config";

const rejectionMessage = (run: () => void): string => {
  try {
    run();
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }

  throw new Error("Expected the config to be rejected");
};

describe("global config", () => {
  test("creates current version 4 config", () => {
    const config = createDefaultGlobalConfig();

    expect(config.version).toBe(4);
    expect(config.agentRuntimes.opencode).toEqual({
      enabled: false,
      executablePath: "",
      defaults: { rules: [] },
      roleOverrides: {},
    });
    expect(config.autopilot.alwaysStartQaReviewsFresh).toBe(false);
    expect(config.notifications).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  test("parses current and legacy versions through distinct entry points", () => {
    expect(parsePersistedGlobalConfig({ version: 4 }).autopilot.alwaysStartQaReviewsFresh).toBe(
      false,
    );
    expect(parsePersistedGlobalConfigV3({ version: 3 }).autopilot.alwaysStartQaReviewsFresh).toBe(
      false,
    );
    expect(parsePersistedGlobalConfigV2({ version: 2 }).autopilot.alwaysStartQaReviewsFresh).toBe(
      false,
    );
    expect(() => parsePersistedGlobalConfig({ version: 2 })).toThrow(
      "Unsupported config version 2. Expected 4.",
    );
  });

  test("normalizes missing and empty legacy repository Git config", () => {
    const withoutGit = parsePersistedGlobalConfig({
      version: 4,
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
        },
      },
    });
    const withEmptyLegacyProviders = parsePersistedGlobalConfig({
      version: 4,
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          git: { providers: {} },
        },
      },
    });

    expect(withoutGit.workspaces.repo?.git).toEqual({});
    expect(withEmptyLegacyProviders.workspaces.repo?.git).toEqual({});
  });

  test("migrates legacy reusable prompts before strict settings validation", () => {
    const prompts = [{ id: "review", name: "review", content: "Review this" }];
    const config = parsePersistedGlobalConfig({
      version: 4,
      chat: { customPrompts: prompts },
    });

    expect(config.reusablePrompts).toEqual([{ ...prompts[0]!, description: "" }]);
    expect(config.chat).not.toHaveProperty("customPrompts");
  });

  test("keeps top-level reusable prompts when legacy chat prompts also exist", () => {
    const config = parsePersistedGlobalConfig({
      version: 4,
      reusablePrompts: [{ id: "current", name: "Current", content: "Current prompt" }],
      chat: {
        customPrompts: [{ id: "old", name: "Old", content: "Old prompt" }],
      },
    });

    expect(config.reusablePrompts).toEqual([
      { id: "current", name: "Current", content: "Current prompt", description: "" },
    ]);
    expect(config.chat).not.toHaveProperty("customPrompts");
  });

  test("keeps supported legacy fields out of strict persisted validation", () => {
    const config = parsePersistedGlobalConfig({
      version: 4,
      trustedHooks: true,
      trustedHooksFingerprint: "old",
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          defaultRuntimeKind: "opencode",
          trustedHooks: true,
          trustedHooksFingerprint: "old",
        },
      },
    });

    expect(config).not.toHaveProperty("trustedHooks");
    expect(config).not.toHaveProperty("trustedHooksFingerprint");
    expect(config.workspaces.repo).not.toHaveProperty("defaultRuntimeKind");
    expect(config.workspaces.repo).not.toHaveProperty("trustedHooks");
    expect(config.workspaces.repo).not.toHaveProperty("trustedHooksFingerprint");
  });

  const unknownNestedSettings: Array<[Record<string, JSONType>, string]> = [
    [{ git: { extra: true } }, "git.extra"],
    [
      { reusablePrompts: [{ id: "review", name: "review", content: "Review this", extra: true }] },
      "reusablePrompts.0.extra",
    ],
    [
      {
        autopilot: {
          rules: [{ eventId: "taskProgressedToSpecReady", actionIds: [], extra: true }],
        },
      },
      "autopilot.rules.0.extra",
    ],
    [
      {
        workspaces: {
          repo: {
            workspaceId: "repo",
            workspaceName: "Repo",
            repoPath: "/repo",
            defaultTargetBranch: { branch: "main", extra: true },
          },
        },
      },
      "workspaces.repo.defaultTargetBranch.extra",
    ],
    [
      {
        globalPromptOverrides: {
          "system.shared.workflow_guards": { template: "text", baseVersion: 1, extra: true },
        },
      },
      "globalPromptOverrides.system.shared.workflow_guards.extra",
    ],
    [
      {
        workspaces: {
          repo: {
            workspaceId: "repo",
            workspaceName: "Repo",
            repoPath: "/repo",
            agentStudioState: { openTaskIds: [], extra: true },
          },
        },
      },
      "workspaces.repo.agentStudioState.extra",
    ],
    [
      {
        workspaces: {
          repo: {
            workspaceId: "repo",
            workspaceName: "Repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [], extra: true },
          },
        },
      },
      "workspaces.repo.hooks.extra",
    ],
    [
      {
        workspaces: {
          repo: {
            workspaceId: "repo",
            workspaceName: "Repo",
            repoPath: "/repo",
            devServers: [{ id: "web", name: "Web", command: "bun dev", extra: true }],
          },
        },
      },
      "workspaces.repo.actions.items.0.extra",
    ],
    [
      {
        workspaces: {
          repo: {
            workspaceId: "repo",
            workspaceName: "Repo",
            repoPath: "/repo",
            defaultModel: {
              runtimeKind: "opencode",
              providerId: "openai",
              modelId: "gpt-5",
              extra: true,
            },
          },
        },
      },
      "workspaces.repo.defaultModel.extra",
    ],
    [
      {
        workspaces: {
          repo: {
            workspaceId: "repo",
            workspaceName: "Repo",
            repoPath: "/repo",
            git: {
              provider: {
                id: "github",
                repository: { host: "github.com", owner: "duck", name: "app", extra: true },
              },
            },
          },
        },
      },
      "workspaces.repo.git.provider.repository.extra",
    ],
  ];
  test.each(unknownNestedSettings)("rejects an unknown nested setting at %s", (fields, path) => {
    expect(() => parsePersistedGlobalConfig({ version: 4, ...fields })).toThrow(
      `${path}: Unknown setting.`,
    );
  });

  test.each([2, 3] as const)(
    "rejects an unknown target branch setting in version %i",
    (version) => {
      const parse = version === 2 ? parsePersistedGlobalConfigV2 : parsePersistedGlobalConfigV3;
      expect(() =>
        parse({
          version,
          workspaces: {
            repo: {
              workspaceId: "repo",
              workspaceName: "Repo",
              repoPath: "/repo",
              defaultTargetBranch: { branch: "main", extra: true },
            },
          },
        }),
      ).toThrow("workspaces.repo.defaultTargetBranch.extra: Unknown setting.");
    },
  );

  test("converts the worktree setup script and dev servers into actions", () => {
    const config = parsePersistedGlobalConfig({
      version: 4,
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          hooks: {
            preStart: ["bun install", "  ", " bun run build "],
            postComplete: ["make clean"],
          },
          devServers: [
            { id: "web", name: "Web", command: "bun run dev" },
            { id: "api", name: "API", command: "bun run api" },
          ],
          worktreeCopyPaths: [".env"],
        },
      },
    });

    expect(config.workspaces.repo?.actions).toEqual({
      items: [
        {
          id: "worktree-setup",
          icon: "configure",
          name: "Worktree setup",
          command: "bun install\nbun run build",
          runOnWorktreeCreate: true,
          waitBeforeAgentStart: true,
        },
        {
          id: "web",
          icon: "play",
          name: "Web",
          command: "bun run dev",
          runOnWorktreeCreate: false,
          waitBeforeAgentStart: false,
        },
        {
          id: "api",
          icon: "play",
          name: "API",
          command: "bun run api",
          runOnWorktreeCreate: false,
          waitBeforeAgentStart: false,
        },
      ],
      defaultActionId: "web",
    });
    expect(config.workspaces.repo?.hooks).toEqual({ postComplete: ["make clean"] });
    expect(config.workspaces.repo?.worktreeCopyPaths).toEqual([".env"]);
    expect(config.workspaces.repo).not.toHaveProperty("devServers");
  });

  test("makes the converted worktree setup action the default when no dev servers exist", () => {
    const config = parsePersistedGlobalConfigV3({
      version: 3,
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          hooks: { preStart: ["bun install"], postComplete: [] },
        },
      },
    });

    expect(config.workspaces.repo?.actions).toEqual({
      items: [
        {
          id: "worktree-setup",
          icon: "configure",
          name: "Worktree setup",
          command: "bun install",
          runOnWorktreeCreate: true,
          waitBeforeAgentStart: true,
        },
      ],
      defaultActionId: "worktree-setup",
    });
  });

  test("converts empty or comment-only legacy settings into no actions", () => {
    const config = parsePersistedGlobalConfigV2({
      version: 2,
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          hooks: { preStart: [" ", "# bun install"], postComplete: [] },
          devServers: [],
        },
      },
    });

    expect(config.workspaces.repo?.actions).toEqual({ items: [], defaultActionId: null });
    expect(config.workspaces.repo?.hooks).toEqual({ postComplete: [] });
  });

  test("gives the converted setup action an id that no dev server uses", () => {
    const config = parsePersistedGlobalConfig({
      version: 4,
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          hooks: { preStart: ["bun install"] },
          devServers: [{ id: "worktree-setup", name: "Setup server", command: "bun run setup" }],
        },
      },
    });

    expect(config.workspaces.repo?.actions.items.map((action) => action.id)).toEqual([
      "worktree-setup-1",
      "worktree-setup",
    ]);
    expect(config.workspaces.repo?.actions.defaultActionId).toBe("worktree-setup");
  });

  test("trims hand-edited dev server ids before it selects the default action", () => {
    const config = parsePersistedGlobalConfig({
      version: 4,
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          hooks: { preStart: ["bun install"] },
          devServers: [
            { id: " worktree-setup ", name: "Setup server", command: "bun run setup" },
            { id: " web ", name: "Web", command: "bun run dev" },
          ],
        },
      },
    });

    expect(config.workspaces.repo?.actions.items.map((action) => action.id)).toEqual([
      "worktree-setup-1",
      "worktree-setup",
      "web",
    ]);
    expect(config.workspaces.repo?.actions.defaultActionId).toBe("worktree-setup");
  });

  test("rejects actions together with legacy dev server or setup settings", () => {
    expect(() =>
      parsePersistedGlobalConfig({
        version: 4,
        workspaces: {
          repo: {
            workspaceId: "repo",
            workspaceName: "Repo",
            repoPath: "/repo",
            devServers: [],
            actions: { items: [], defaultActionId: null },
          },
        },
      }),
    ).toThrow(
      'Repository "repo" contains both actions and legacy dev server or worktree setup settings.',
    );
  });

  test("migrates one legacy repository Git provider without losing values", () => {
    const config = parsePersistedGlobalConfig({
      version: 4,
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          git: {
            providers: {
              github: {
                enabled: false,
                autoDetected: true,
                repository: {
                  host: "github.example.com",
                  owner: "open-ducktor",
                  name: "desktop",
                },
              },
            },
          },
        },
      },
    });

    expect(config.workspaces.repo?.git).toEqual({
      provider: {
        id: "github",
        enabled: false,
        autoDetected: true,
        repository: {
          host: "github.example.com",
          owner: "open-ducktor",
          name: "desktop",
        },
      },
    });
  });

  test("migrates one legacy repository Git provider from version 2 config", () => {
    const config = parsePersistedGlobalConfigV2({
      version: 2,
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          git: {
            providers: {
              github: {
                enabled: false,
                autoDetected: true,
              },
            },
          },
        },
      },
    });

    expect(config.workspaces.repo?.git).toEqual({
      provider: {
        id: "github",
        enabled: false,
        autoDetected: true,
      },
    });
  });

  test("moves flat Azure settings into the provider settings object", () => {
    const repository = {
      providerId: "azure_devops" as const,
      deployment: "services" as const,
      serviceUrl: "https://dev.azure.com",
      organization: "OpenDucktor",
      project: "Desktop",
      name: "app",
    };
    const mapping = {
      remoteName: "origin",
      fetchUrl: "https://dev.azure.com/OpenDucktor/Desktop/_git/app",
      pushUrls: ["https://dev.azure.com/OpenDucktor/Desktop/_git/app"],
      repository,
    };
    const config = parsePersistedGlobalConfig({
      version: 4,
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          git: {
            provider: {
              id: "azure_devops",
              enabled: true,
              repository,
              remoteMappings: [mapping],
              httpConsentCollectionUrl: "http://ado.example/DefaultCollection",
              areaPath: "Desktop\\Client",
            },
          },
        },
      },
    });

    expect(config.workspaces.repo?.git.provider).toMatchObject({
      id: "azure_devops",
      repository,
      settings: {
        remoteMappings: [mapping],
        httpConsentCollectionUrl: "http://ado.example/DefaultCollection",
        areaPath: "Desktop\\Client",
      },
    });
    expect(config.workspaces.repo?.git.provider).not.toHaveProperty("areaPath");
  });

  test("migrates Azure settings inside a legacy provider map", () => {
    const config = parsePersistedGlobalConfigV2({
      version: 2,
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          git: { providers: { azure_devops: { enabled: true, areaPath: "Desktop\\Client" } } },
        },
      },
    });

    expect(config.workspaces.repo?.git.provider).toMatchObject({
      id: "azure_devops",
      settings: { areaPath: "Desktop\\Client" },
    });
  });

  test("rejects mixed nested and flat Azure settings", () => {
    expect(() =>
      parsePersistedGlobalConfig({
        version: 4,
        workspaces: {
          repo: {
            workspaceId: "repo",
            workspaceName: "Repo",
            repoPath: "/repo",
            git: {
              provider: {
                id: "azure_devops",
                enabled: true,
                settings: { areaPath: "Desktop\\Client" },
                areaPath: "Desktop\\Other",
              },
            },
          },
        },
      }),
    ).toThrow('Repository "repo" contains both nested and legacy Azure DevOps settings.');
  });

  test("rejects canonical and legacy repository Git config together", () => {
    expect(() =>
      parsePersistedGlobalConfig({
        version: 4,
        workspaces: {
          repo: {
            workspaceId: "repo",
            workspaceName: "Repo",
            repoPath: "/repo",
            git: {
              provider: { id: "github", enabled: true, autoDetected: false },
              providers: {},
            },
          },
        },
      }),
    ).toThrow('Repository "repo" contains both canonical and legacy Git provider configuration.');
  });

  test("rejects legacy repository Git config with more than one provider", () => {
    expect(() =>
      parsePersistedGlobalConfig({
        version: 4,
        workspaces: {
          repo: {
            workspaceId: "repo",
            workspaceName: "Repo",
            repoPath: "/repo",
            git: {
              providers: {
                github: { enabled: true, autoDetected: false },
                gitlab: { enabled: false, autoDetected: true },
              },
            },
          },
        },
      }),
    ).toThrow('Repository "repo" has 2 legacy Git providers; only one provider can be configured.');
  });

  test("upgrades runtime paths without changing existing enabled choices", () => {
    const legacy = parsePersistedGlobalConfigV2({
      version: 2,
      agentRuntimes: {
        opencode: { enabled: false },
        codex: { enabled: true },
        claude: { enabled: true },
      },
      autopilot: {
        alwaysStartQaReviewsFresh: true,
        rules: [],
      },
    });

    const upgraded = upgradePersistedGlobalConfigV2(legacy, {
      opencode: "/tools/opencode",
      codex: "",
      claude: "/tools/claude",
    });

    expect(upgraded.version).toBe(4);
    expect(upgraded.agentRuntimes.opencode).toMatchObject({
      enabled: false,
      executablePath: "/tools/opencode",
    });
    expect(upgraded.agentRuntimes.codex).toMatchObject({ enabled: true, executablePath: "" });
    expect(upgraded.agentRuntimes.claude).toMatchObject({
      enabled: true,
      executablePath: "/tools/claude",
    });
    expect(upgraded.autopilot.alwaysStartQaReviewsFresh).toBe(true);
    expect(upgraded.notifications).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  test("reports a missing field for a rejected config", () => {
    expect(() =>
      parsePersistedGlobalConfig({
        version: 4,
        workspaces: {
          fairnest: {
            workspaceId: "fairnest",
            repoPath: "/repo",
          },
        },
      }),
    ).toThrow(
      "workspaces.fairnest.workspaceName: Invalid input: expected string, received undefined (missing)",
    );
  });

  test("lists each rejected config field on its own line without raw issue JSON", () => {
    const message = rejectionMessage(() =>
      parsePersistedGlobalConfig({
        version: 4,
        theme: "blue",
        workspaces: {
          fairnest: {
            workspaceId: "fairnest",
            workspaceName: null,
            repoPath: "/repo",
          },
          openducktor: {
            workspaceId: "openducktor",
            workspaceName: "",
            repoPath: "/repo",
          },
        },
      }),
    );

    const lines = message.split("\n");
    expect(lines).toContain(
      'theme: Invalid option: expected one of "system"|"light"|"dark" (found "blue")',
    );
    expect(lines).toContain(
      "workspaces.fairnest.workspaceName: Invalid input: expected string, received null (found null)",
    );
    expect(lines).toContain(
      'workspaces.openducktor.workspaceName: Workspace name cannot be blank. (found "")',
    );
    expect(message).not.toContain('"code"');
  });

  test("caps a long list of rejected config fields", () => {
    const workspaces = Object.fromEntries(
      Array.from({ length: 7 }, (_, index) => {
        const workspaceId = `repo-${index}`;
        return [
          workspaceId,
          {
            workspaceId,
            workspaceName: null,
            repoPath: "/repo",
          },
        ];
      }),
    );

    const message = rejectionMessage(() => parsePersistedGlobalConfig({ version: 4, workspaces }));

    const lines = message.split("\n");
    expect(lines.filter((line) => line.startsWith("workspaces."))).toHaveLength(5);
    expect(lines.at(-1)).toMatch(/^\d+ more problems not shown\.$/);
  });

  test("formats version 2 config validation failures the same way", () => {
    expect(() => parsePersistedGlobalConfigV2({ version: 2, theme: "blue" })).toThrow(
      'theme: Invalid option: expected one of "system"|"light"|"dark" (found "blue")',
    );
  });

  test("upgrades version 3 workspace lifecycle state", () => {
    const legacy = parsePersistedGlobalConfigV3({
      version: 3,
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          closed: true,
        },
      },
    });

    const upgraded = upgradePersistedGlobalConfigV3(legacy);

    expect(upgraded.version).toBe(4);
    expect(upgraded.workspaces.repo?.closed).toBe(true);
  });
});

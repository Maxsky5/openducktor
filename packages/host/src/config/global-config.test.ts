import { describe, expect, test } from "bun:test";
import {
  createDefaultGlobalConfig,
  parsePersistedGlobalConfig,
  parsePersistedGlobalConfigV2,
  upgradePersistedGlobalConfigV2,
} from "./global-config";

describe("global config", () => {
  test("creates only current version 3 config", () => {
    const config = createDefaultGlobalConfig();

    expect(config.version).toBe(3);
    expect(config.agentRuntimes.opencode).toEqual({ enabled: false, executablePath: "" });
    expect(config.autopilot.alwaysStartQaReviewsFresh).toBe(false);
  });

  test("parses current and legacy versions through distinct entry points", () => {
    expect(parsePersistedGlobalConfig({ version: 3 }).autopilot.alwaysStartQaReviewsFresh).toBe(
      false,
    );
    expect(parsePersistedGlobalConfigV2({ version: 2 }).autopilot.alwaysStartQaReviewsFresh).toBe(
      false,
    );
    expect(() => parsePersistedGlobalConfig({ version: 2 })).toThrow(
      "Unsupported config version 2. Expected 3.",
    );
  });

  test("normalizes missing and empty legacy repository Git config", () => {
    const withoutGit = parsePersistedGlobalConfig({
      version: 3,
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          defaultRuntimeKind: "opencode",
        },
      },
    });
    const withEmptyLegacyProviders = parsePersistedGlobalConfig({
      version: 3,
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          defaultRuntimeKind: "opencode",
          git: { providers: {} },
        },
      },
    });

    expect(withoutGit.workspaces.repo?.git).toEqual({});
    expect(withEmptyLegacyProviders.workspaces.repo?.git).toEqual({});
  });

  test("migrates one legacy repository Git provider without losing values", () => {
    const config = parsePersistedGlobalConfig({
      version: 3,
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          defaultRuntimeKind: "opencode",
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
          defaultRuntimeKind: "opencode",
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

  test("rejects canonical and legacy repository Git config together", () => {
    expect(() =>
      parsePersistedGlobalConfig({
        version: 3,
        workspaces: {
          repo: {
            workspaceId: "repo",
            workspaceName: "Repo",
            repoPath: "/repo",
            defaultRuntimeKind: "opencode",
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
        version: 3,
        workspaces: {
          repo: {
            workspaceId: "repo",
            workspaceName: "Repo",
            repoPath: "/repo",
            defaultRuntimeKind: "opencode",
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

    expect(upgraded.version).toBe(3);
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
  });
});

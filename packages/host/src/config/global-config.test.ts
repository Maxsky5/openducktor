import { describe, expect, test } from "bun:test";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@openducktor/contracts";
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
    expect(config.agentRuntimes.opencode).toEqual({ enabled: false, executablePath: "" });
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

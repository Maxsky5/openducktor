import { describe, expect, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  createDefaultAutopilotSettings,
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type SettingsSnapshot,
} from "@openducktor/contracts";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { buildRuntimeAvailabilityValidationState } from "./use-settings-modal-runtime-validation";

const createSnapshot = (): SettingsSnapshot =>
  createSettingsSnapshotFixture({
    autopilot: createDefaultAutopilotSettings(),
    agentRuntimes: {
      opencode: { enabled: true, executablePath: "/bin/opencode" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false },
      claude: { enabled: false, executablePath: "" },
    },
    workspaces: {
      repo: {
        workspaceId: "repo",
        workspaceName: "Repo",
        repoPath: "/repo",
        defaultRuntimeKind: "codex",
        worktreeBasePath: undefined,
        branchPrefix: "odt",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: {
          providers: {},
        },
        hooks: { preStart: [], postComplete: [] },
        devServers: [],
        worktreeCopyPaths: [],
        promptOverrides: {},
        agentDefaults: {
          build: {
            runtimeKind: "codex",
            providerId: "codex",
            modelId: "gpt-5.4",
            variant: "medium",
            profileId: "",
          },
        },
      },
    },
  });

describe("settings runtime availability validation", () => {
  test("reports disabled repo default and role runtimes", () => {
    const validation = buildRuntimeAvailabilityValidationState({
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
      snapshotDraft: createSnapshot(),
    });

    expect(validation.totalErrorCount).toBe(2);
    expect(validation.errorCountByWorkspaceId.repo).toBe(2);
    expect(validation.errorsByWorkspaceId.repo).toEqual([
      'Default agent runtime "Codex" is disabled.',
      'Builder agent runtime "Codex" is disabled.',
    ]);
  });

  test("does not report disabled runtimes while runtime definitions are unavailable", () => {
    const validation = buildRuntimeAvailabilityValidationState({
      runtimeDefinitions: [],
      snapshotDraft: createSnapshot(),
    });

    expect(validation.totalErrorCount).toBe(0);
    expect(validation.errorsByWorkspaceId).toEqual({});
  });

  test("reports an enabled runtime whose saved executable path is invalid", () => {
    const validation = buildRuntimeAvailabilityValidationState({
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
      snapshotDraft: createSnapshot(),
      runtimeExecutableResults: [
        {
          kind: "opencode",
          path: "/missing/opencode",
          ok: false,
          version: null,
          error: "Executable does not exist: /missing/opencode",
        },
        {
          kind: "codex",
          path: "",
          ok: false,
          version: null,
          error: "Executable path is empty.",
        },
      ],
    });

    expect(validation.runtimeExecutableErrors).toEqual([
      "Executable does not exist: /missing/opencode",
    ]);
    expect(validation.totalErrorCount).toBe(3);
  });

  test("reports configured disabled runtimes without substituting another runtime", () => {
    const snapshotDraft = createSnapshot();
    snapshotDraft.agentRuntimes = {
      opencode: { enabled: false, executablePath: "" },
      codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false },
      claude: { enabled: false, executablePath: "" },
    };
    const repoConfig = snapshotDraft.workspaces.repo;
    if (!repoConfig) {
      throw new Error("Fixture repo workspace is missing.");
    }
    snapshotDraft.workspaces = {
      ...snapshotDraft.workspaces,
      repo: { ...repoConfig, defaultRuntimeKind: "opencode" },
    };

    const validation = buildRuntimeAvailabilityValidationState({
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
      snapshotDraft,
    });

    expect(validation.errorsByWorkspaceId.repo).toEqual([
      'Default agent runtime "OpenCode" is disabled.',
      'Builder agent runtime "Codex" is disabled.',
    ]);
  });
});

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
  test("reports repository references to disabled runtimes", () => {
    const validation = buildRuntimeAvailabilityValidationState({
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
      snapshotDraft: createSnapshot(),
    });

    expect(validation.errorsByWorkspaceId).toEqual({
      repo: [
        'Default agent runtime "Codex" is disabled.',
        'Builder agent runtime "Codex" is disabled.',
      ],
    });
    expect(validation.errorCountByWorkspaceId).toEqual({ repo: 2 });
    expect(validation.totalErrorCount).toBe(2);
  });

  test("does not require a runtime while runtime definitions are unavailable", () => {
    const validation = buildRuntimeAvailabilityValidationState({
      runtimeDefinitions: [],
      snapshotDraft: createSnapshot(),
    });

    expect(validation.totalErrorCount).toBe(0);
  });

  test("allows dormant repository runtime references when every runtime is disabled", () => {
    const snapshotDraft = createSnapshot();
    snapshotDraft.agentRuntimes.opencode.enabled = false;

    const validation = buildRuntimeAvailabilityValidationState({
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
      snapshotDraft,
    });

    expect(validation.errorsByWorkspaceId).toEqual({});
    expect(validation.totalErrorCount).toBe(0);
  });

  test("reports an enabled runtime whose saved executable path is invalid", () => {
    const snapshotDraft = createSnapshot();
    snapshotDraft.agentRuntimes.codex = {
      ...snapshotDraft.agentRuntimes.codex,
      enabled: true,
      executablePath: "/bin/codex",
    };
    const validation = buildRuntimeAvailabilityValidationState({
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
      snapshotDraft,
      runtimeExecutableResults: [
        {
          kind: "opencode",
          path: "/bin/opencode",
          requestedPath: "/bin/opencode",
          ok: false,
          version: null,
          error: "Executable does not exist: /bin/opencode",
        },
        {
          kind: "codex",
          path: "/bin/codex",
          requestedPath: "/bin/codex",
          ok: true,
          version: "codex-cli 1.0.0",
          error: null,
        },
      ],
    });

    expect(validation.runtimeExecutableErrors).toEqual([
      "Executable does not exist: /bin/opencode",
    ]);
    expect(validation.totalErrorCount).toBe(1);
  });

  test("does not accept a valid result for a previous executable path", () => {
    const validation = buildRuntimeAvailabilityValidationState({
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
      snapshotDraft: createSnapshot(),
      runtimeExecutableResults: [
        {
          kind: "opencode",
          path: "/previous/opencode",
          requestedPath: "/previous/opencode",
          ok: true,
          version: "1.0.0",
          error: null,
        },
      ],
    });

    expect(validation.runtimeExecutableErrors).toEqual(["OpenCode needs a valid executable path."]);
  });
});

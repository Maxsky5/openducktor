import { describe, expect, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import { buildDisabledRuntimeHealth } from "@/lib/repo-runtime-health";
import { buildDiagnosticsPanelModel as buildDiagnosticsPanelModelBase } from "./diagnostics-panel-model";
import {
  makeBuiltInRuntimeDefinitions,
  makeBuiltInRuntimeDiagnostics,
  makeRepoHealth,
  makeRuntimeDiagnosticInstance,
  makeTaskStoreCheck,
  makeWorkspace,
} from "./diagnostics-panel-model-test-fixtures";

const buildDiagnosticsPanelModel = (input: Parameters<typeof buildDiagnosticsPanelModelBase>[0]) =>
  buildDiagnosticsPanelModelBase({
    ...input,
    runtimeHealthByRuntime: {
      claude: buildDisabledRuntimeHealth(CLAUDE_RUNTIME_DESCRIPTOR),
      ...input.runtimeHealthByRuntime,
    },
  });

describe("buildDiagnosticsPanelModel", () => {
  test("returns no-repository summary and empty-state messages when no repository is selected", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: null,
      activeWorkspace: null,
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: null,
      taskStoreCheck: null,
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {},
      isLoadingChecks: false,
    });

    expect(model.summaryState.label).toBe("No repository selected");
    expect(model.criticalReasons).toEqual([]);
    expect(model.sections[0]?.emptyMessage).toBe("Select a repository to load diagnostics.");
    expect(model.sections[2]?.emptyMessage).toBe("Select a repository first.");
    expect(model.sections[3]?.emptyMessage).toBe("Select a repository first.");
    expect(model.sections[4]?.emptyMessage).toBe("Select a repository first.");
  });

  test("returns checking summary while diagnostics are loading", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: null,
      taskStoreCheck: null,
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {},
      isLoadingChecks: true,
    });

    expect(model.isSummaryChecking).toBe(true);
    expect(model.summaryState.label).toBe("Checking...");
    const cliToolsSection = model.sections.find((section) => section.key === "cli-tools");
    expect(cliToolsSection?.rows).toEqual([]);
    expect(cliToolsSection?.emptyMessage).toBe("CLI checks are loading...");
  });

  test("keeps summary in checking state while runtime health is still pending", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: true,
        ghVersion: "gh version 2.73.0",
        ghAuthOk: true,
        ghAuthLogin: "octocat",
        ghAuthError: null,
        runtimes: makeBuiltInRuntimeDiagnostics({ kind: "opencode", ok: true, version: "1.2.9" }),
        errors: [],
      },
      taskStoreCheck: makeTaskStoreCheck(),
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {},
      isLoadingChecks: false,
    });

    expect(model.isSummaryChecking).toBe(true);
    expect(model.summaryState.label).toBe("Checking...");
  });

  test("keeps diagnostics checking while an enabled runtime awaits automatic startup", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: true,
        ghVersion: "gh version 2.73.0",
        ghAuthOk: true,
        ghAuthLogin: "octocat",
        ghAuthError: null,
        runtimes: makeBuiltInRuntimeDiagnostics({ kind: "opencode", ok: true, version: "1.2.9" }),
        errors: [],
      },
      taskStoreCheck: makeTaskStoreCheck(),
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "not_started",
          runtime: {
            status: "not_started",
            stage: "idle",
            observation: null,
            instance: null,
            detail: "Runtime has not been started yet.",
          },
          mcp: {
            supported: true,
            status: "waiting_for_runtime",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: null,
            failureKind: null,
          },
        }),
        codex: buildDisabledRuntimeHealth(CODEX_RUNTIME_DESCRIPTOR),
      },
      isLoadingChecks: false,
    });

    expect(model.isSummaryChecking).toBe(true);
    expect(model.summaryState.label).toBe("Checking...");
  });

  test("keeps diagnostics checking when stale health summary wraps pending startup fields", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: true,
        ghVersion: "gh version 2.73.0",
        ghAuthOk: true,
        ghAuthLogin: "octocat",
        ghAuthError: null,
        runtimes: makeBuiltInRuntimeDiagnostics({ kind: "opencode", ok: true, version: "1.2.9" }),
        errors: [],
      },
      taskStoreCheck: makeTaskStoreCheck(),
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "error",
          runtime: {
            status: "not_started",
            stage: "idle",
            observation: null,
            instance: null,
            detail: "Runtime has not been started yet.",
          },
          mcp: {
            supported: true,
            status: "waiting_for_runtime",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: null,
            failureKind: null,
          },
        }),
      },
      isLoadingChecks: false,
    });

    expect(model.isSummaryChecking).toBe(true);
    expect(model.summaryState.label).toBe("Checking...");
    expect(model.criticalReasons).toEqual([]);
  });

  test("reports disabled runtimes without leaving diagnostics stuck checking", () => {
    const disabledRuntimeDefinitions = [
      OPENCODE_RUNTIME_DESCRIPTOR,
      CODEX_RUNTIME_DESCRIPTOR,
      CLAUDE_RUNTIME_DESCRIPTOR,
    ];
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions: disabledRuntimeDefinitions,
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: true,
        ghVersion: "gh version 2.73.0",
        ghAuthOk: true,
        ghAuthLogin: "octocat",
        ghAuthError: null,
        runtimes: makeBuiltInRuntimeDiagnostics({ kind: "opencode", ok: true, version: "1.2.9" }),
        errors: [],
      },
      taskStoreCheck: makeTaskStoreCheck(),
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({ runtime: { instance: makeRuntimeDiagnosticInstance() } }),
        codex: buildDisabledRuntimeHealth(CODEX_RUNTIME_DESCRIPTOR),
        claude: buildDisabledRuntimeHealth(CLAUDE_RUNTIME_DESCRIPTOR),
      },
      isLoadingChecks: false,
    });

    const cliToolsSection = model.sections.find((section) => section.key === "cli-tools");
    const codexRuntimeSection = model.sections.find((section) => section.key === "runtime:codex");

    expect(model.isSummaryChecking).toBe(false);
    expect(cliToolsSection?.badge.label).toBe("Available");
    expect(cliToolsSection?.rows).toEqual([
      { label: "Git", value: "git version 2.50.1" },
      { label: "GitHub CLI", value: "gh version 2.73.0" },
      { label: "OpenCode", value: "1.2.9", breakAll: true },
      { label: "Codex", value: "missing (runtime disabled)", breakAll: true },
      { label: "Claude", value: "missing (runtime disabled)", breakAll: true },
    ]);
    expect(codexRuntimeSection?.badge.label).toBe("Disabled");
    expect(codexRuntimeSection?.rows).toContainEqual(
      expect.objectContaining({
        label: "Detail",
        value: "Codex runtime is disabled in Agent Runtime settings.",
      }),
    );
  });

  test("returns setup-needed summary when no effective worktree directory is available", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/repo",
      activeWorkspace: makeWorkspace("/repo", {
        hasConfig: false,
        configuredWorktreeBasePath: null,
        defaultWorktreeBasePath: null,
        effectiveWorktreeBasePath: null,
      }),
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: true,
        ghVersion: "gh version 2.73.0",
        ghAuthOk: true,
        ghAuthLogin: "octocat",
        ghAuthError: null,
        runtimes: makeBuiltInRuntimeDiagnostics({ kind: "opencode", ok: true, version: "1.2.9" }),
        errors: [],
      },
      taskStoreCheck: makeTaskStoreCheck(),
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          runtime: { instance: makeRuntimeDiagnosticInstance() },
          mcp: { toolIds: [] },
        }),
        codex: buildDisabledRuntimeHealth(CODEX_RUNTIME_DESCRIPTOR),
      },
      isLoadingChecks: false,
    });

    expect(model.summaryState.label).toBe("Setup needed");
    expect(model.sections[0]?.badge.label).toBe("Needs setup");
    expect(model.sections[0]?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Worktree directory", value: "Not available" }),
      ]),
    );
  });

  test("renders first-class repo store diagnostics rows from structured health", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: true,
        ghVersion: "gh version 2.73.0",
        ghAuthOk: true,
        ghAuthLogin: "octocat",
        ghAuthError: null,
        runtimes: makeBuiltInRuntimeDiagnostics({ kind: "opencode", ok: true, version: "1.2.9" }),
        errors: [],
      },
      taskStoreCheck: makeTaskStoreCheck({
        repoStoreHealth: {
          category: "database_unavailable",
          status: "blocking",
          isReady: false,
          detail: "SQLite task store database is unavailable",
          databasePath: "/Users/dev/.openducktor/task-stores/repo/database.sqlite",
        },
        taskStoreOk: false,
        taskStoreError: "SQLite task store database is unavailable",
      }),
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          runtime: { instance: makeRuntimeDiagnosticInstance() },
          mcp: { toolIds: [] },
        }),
      },
      isLoadingChecks: false,
    });

    const taskStoreSection = model.sections.find((section) => section.key === "task-store");

    expect(taskStoreSection?.badge).toEqual({ label: "Blocked", variant: "danger" });
    expect(taskStoreSection?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Status", value: "Blocked" }),
        expect.objectContaining({ label: "Health category", value: "Database unavailable" }),
        expect.objectContaining({
          label: "SQLite database path",
          value: "/Users/dev/.openducktor/task-stores/repo/database.sqlite",
        }),
      ]),
    );
    expect(taskStoreSection?.errors).toEqual(["SQLite task store database is unavailable"]);
  });

  test("treats repositories using the default worktree path as healthy", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/repo",
      activeWorkspace: makeWorkspace("/repo", {
        configuredWorktreeBasePath: null,
        effectiveWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
      }),
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: true,
        ghVersion: "gh version 2.73.0",
        ghAuthOk: true,
        ghAuthLogin: "octocat",
        ghAuthError: null,
        runtimes: makeBuiltInRuntimeDiagnostics({ kind: "opencode", ok: true, version: "1.2.9" }),
        errors: [],
      },
      taskStoreCheck: makeTaskStoreCheck(),
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          runtime: { instance: makeRuntimeDiagnosticInstance() },
          mcp: { toolIds: [] },
        }),
        codex: buildDisabledRuntimeHealth(CODEX_RUNTIME_DESCRIPTOR),
      },
      isLoadingChecks: false,
    });

    expect(model.summaryState.label).toBe("Healthy");
    expect(model.sections[0]?.badge.label).toBe("Configured");
    expect(model.sections[0]?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Worktree directory",
          value: "/Users/dev/.openducktor/worktrees/repo",
        }),
      ]),
    );
  });

  test("builds keyed rows for repository and runtime mcp sections", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/Users/dev/fairnest",
      activeWorkspace: makeWorkspace("/Users/dev/fairnest", {
        configuredWorktreeBasePath: "/Users/dev/worktrees",
        defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/fairnest",
        effectiveWorktreeBasePath: "/Users/dev/worktrees",
      }),
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: true,
        ghVersion: "gh version 2.73.0",
        ghAuthOk: true,
        ghAuthLogin: "octocat",
        ghAuthError: null,
        runtimes: makeBuiltInRuntimeDiagnostics({
          kind: "opencode",
          ok: true,
          version: "1.2.9 (/Users/dev/.opencode/bin/opencode)",
        }),
        errors: [],
      },
      taskStoreCheck: makeTaskStoreCheck({
        taskStorePath: "/Users/dev/.openducktor/task-stores/fairnest/database.sqlite",
        repoStoreHealth: {
          databasePath: "/Users/dev/.openducktor/task-stores/fairnest/database.sqlite",
        },
      }),
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          runtime: { instance: makeRuntimeDiagnosticInstance() },
          mcp: { toolIds: ["openducktor_odt_read_task", "openducktor_odt_set_spec"] },
        }),
        codex: buildDisabledRuntimeHealth(CODEX_RUNTIME_DESCRIPTOR),
      },
      isLoadingChecks: false,
    });

    const mcpSection = model.sections.find((section) => section.key === "mcp:opencode");
    expect(model.summaryState.label).toBe("Healthy");
    expect(model.sections[0]?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Repository" }),
        expect.objectContaining({ label: "Repository path" }),
        expect.objectContaining({ label: "Worktree directory", value: "/Users/dev/worktrees" }),
      ]),
    );
    expect(mcpSection?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Server name", value: "openducktor" }),
        expect.objectContaining({ label: "Status", value: "connected" }),
        expect.objectContaining({ label: "Tools detected", value: "2" }),
      ]),
    );
  });

  test("includes critical reasons and section errors when checks fail", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/repo",
      activeWorkspace: makeWorkspace("/repo", {
        hasConfig: false,
        configuredWorktreeBasePath: null,
        defaultWorktreeBasePath: null,
        effectiveWorktreeBasePath: null,
      }),
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: false,
        ghVersion: null,
        ghAuthOk: false,
        ghAuthLogin: null,
        ghAuthError: "gh not found in PATH",
        runtimes: makeBuiltInRuntimeDiagnostics({ kind: "opencode", ok: false, version: null }),
        errors: ["opencode not found in PATH"],
      },
      taskStoreCheck: makeTaskStoreCheck({
        taskStoreOk: false,
        taskStorePath: null,
        taskStoreError: "task store failed",
        repoStoreHealth: {
          category: "database_unavailable",
          status: "blocking",
          isReady: false,
          detail: "task store failed",
          databasePath: null,
        },
      }),
      runtimeCheckFailureKind: "error",
      taskStoreCheckFailureKind: "error",
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "error",
          runtime: {
            status: "error",
            stage: "startup_failed",
            instance: null,
            detail: "runtime failed",
            failureKind: "error",
          },
          mcp: {
            supported: true,
            status: "error",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: "server unavailable",
            failureKind: "error",
          },
        }),
        codex: buildDisabledRuntimeHealth(CODEX_RUNTIME_DESCRIPTOR),
      },
      isLoadingChecks: false,
    });

    const runtimeSection = model.sections.find((section) => section.key === "runtime:opencode");
    const mcpSection = model.sections.find((section) => section.key === "mcp:opencode");
    const taskStoreSection = model.sections.find((section) => section.key === "task-store");

    expect(model.summaryState.label).toBe("Critical issue");
    expect(model.criticalReasons).toEqual(
      expect.arrayContaining(["runtime failed", "task store failed"]),
    );
    expect(model.criticalReasons).not.toContain("gh not found in PATH");
    const cliToolsSection = model.sections.find((section) => section.key === "cli-tools");
    expect(cliToolsSection?.badge).toEqual({ label: "GitHub optional", variant: "warning" });
    expect(cliToolsSection?.errors).toEqual([]);
    expect(runtimeSection?.errors).toEqual(["runtime failed"]);
    expect(mcpSection?.errors).toEqual([]);
    expect(taskStoreSection?.errors).toEqual(["task store failed"]);
  });

  test("falls back to mcpError when server error is absent", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: true,
        ghVersion: "gh version 2.73.0",
        ghAuthOk: true,
        ghAuthLogin: "octocat",
        ghAuthError: null,
        runtimes: makeBuiltInRuntimeDiagnostics({ kind: "opencode", ok: true, version: "1.2.9" }),
        errors: [],
      },
      taskStoreCheck: makeTaskStoreCheck(),
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "error",
          runtime: { instance: makeRuntimeDiagnosticInstance() },
          mcp: {
            supported: true,
            status: "error",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: "mcp unavailable",
            failureKind: "error",
          },
        }),
        codex: buildDisabledRuntimeHealth(CODEX_RUNTIME_DESCRIPTOR),
      },
      isLoadingChecks: false,
    });

    const mcpSection = model.sections.find((section) => section.key === "mcp:opencode");
    expect(mcpSection?.errors).toEqual(["mcp unavailable"]);
  });

  test("shows timeout-specific badges and messages while runtime health is warming up", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: true,
        ghVersion: "gh version 2.73.0",
        ghAuthOk: true,
        ghAuthLogin: "octocat",
        ghAuthError: null,
        runtimes: makeBuiltInRuntimeDiagnostics({ kind: "opencode", ok: true, version: "1.2.9" }),
        errors: [],
      },
      taskStoreCheck: makeTaskStoreCheck(),
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "checking",
          runtime: {
            status: "checking",
            stage: "waiting_for_runtime",
            observation: "started_by_diagnostics",
            instance: null,
            startedAt: "2026-02-20T12:00:55.000Z",
            updatedAt: "2026-02-20T12:01:00.000Z",
            elapsedMs: 5000,
            attempts: 4,
            detail: "Timed out waiting for OpenCode runtime startup readiness",
            failureKind: "timeout",
            failureReason: null,
          },
          mcp: {
            supported: true,
            status: "waiting_for_runtime",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: "Runtime is unavailable, so MCP cannot be verified.",
            failureKind: "timeout",
          },
        }),
        codex: buildDisabledRuntimeHealth(CODEX_RUNTIME_DESCRIPTOR),
      },
      isLoadingChecks: false,
    });

    const runtimeSection = model.sections.find((section) => section.key === "runtime:opencode");
    const mcpSection = model.sections.find((section) => section.key === "mcp:opencode");

    expect(runtimeSection?.badge).toEqual({ label: "Starting", variant: "warning" });
    expect(runtimeSection?.errors).toEqual([]);
    expect(runtimeSection?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Stage", value: "waiting for runtime" }),
        expect.objectContaining({ label: "Attempts", value: "4" }),
      ]),
    );
    expect(mcpSection?.badge).toEqual({ label: "Waiting on runtime", variant: "warning" });
    expect(mcpSection?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Status", value: "waiting for runtime" }),
      ]),
    );
    expect(mcpSection?.rows).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Tools detected" })]),
    );
    expect(mcpSection?.errors).toEqual([]);
    expect(model.summaryState.label).toBe("Checking...");
    expect(model.criticalReasons).toEqual([]);
  });

  test("keeps runtime and mcp progress details scoped to the relevant section", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: true,
        ghVersion: "gh version 2.73.0",
        ghAuthOk: true,
        ghAuthLogin: "octocat",
        ghAuthError: null,
        runtimes: makeBuiltInRuntimeDiagnostics({ kind: "opencode", ok: true, version: "1.2.9" }),
        errors: [],
      },
      taskStoreCheck: makeTaskStoreCheck(),
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "checking",
          runtime: {
            status: "ready",
            stage: "runtime_ready",
            observation: "started_by_diagnostics",
            instance: makeRuntimeDiagnosticInstance(),
            startedAt: "2026-02-20T12:00:59.000Z",
            updatedAt: "2026-02-20T12:01:00.000Z",
            elapsedMs: 886,
            attempts: 7,
            detail: null,
            failureKind: null,
            failureReason: null,
          },
          mcp: {
            supported: true,
            status: "checking",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: null,
            failureKind: null,
          },
        }),
        codex: buildDisabledRuntimeHealth(CODEX_RUNTIME_DESCRIPTOR),
      },
      isLoadingChecks: false,
    });

    const runtimeSection = model.sections.find((section) => section.key === "runtime:opencode");
    const mcpSection = model.sections.find((section) => section.key === "mcp:opencode");

    expect(runtimeSection).toBeDefined();
    if (!runtimeSection) {
      throw new Error("Expected runtime:opencode diagnostics section");
    }
    const runtimeLabels = runtimeSection.rows.map((row) => row.label);
    expect(runtimeLabels).not.toContain("Stage");
    expect(runtimeLabels).not.toContain("Observation");
    expect(runtimeLabels).not.toContain("Elapsed");
    expect(runtimeLabels).not.toContain("Attempts");
    expect(mcpSection?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Status", value: "checking" }),
        expect.objectContaining({ label: "Activity", value: "Checking server status" }),
      ]),
    );
    const mcpLabels = mcpSection?.rows.map((row) => row.label) ?? [];
    expect(mcpLabels).not.toContain("Observation");
    expect(mcpLabels).not.toContain("Elapsed");
    expect(mcpLabels).not.toContain("Attempts");
    expect(mcpLabels).not.toContain("Tools detected");
    expect(mcpSection?.errors).toEqual([]);
    expect(model.criticalReasons).not.toContain("OpenCode OpenDucktor MCP unavailable");
  });

  test("keeps the summary in checking while a settled runtime health entry is still checking", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: true,
        ghVersion: "gh version 2.73.0",
        ghAuthOk: true,
        ghAuthLogin: "octocat",
        ghAuthError: null,
        runtimes: makeBuiltInRuntimeDiagnostics({ kind: "opencode", ok: true, version: "1.2.9" }),
        errors: [],
      },
      taskStoreCheck: makeTaskStoreCheck(),
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "checking",
          runtime: { instance: makeRuntimeDiagnosticInstance() },
          mcp: {
            supported: true,
            status: "checking",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: "Checking OpenDucktor MCP",
            failureKind: null,
          },
        }),
        codex: buildDisabledRuntimeHealth(CODEX_RUNTIME_DESCRIPTOR),
      },
      isLoadingChecks: false,
    });

    expect(model.isSummaryChecking).toBe(true);
    expect(model.summaryState.label).toBe("Checking...");
  });

  test("keeps the summary checking when MCP is reconnecting even if the health summary is stale", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: true,
        ghVersion: "gh version 2.73.0",
        ghAuthOk: true,
        ghAuthLogin: "octocat",
        ghAuthError: null,
        runtimes: makeBuiltInRuntimeDiagnostics({ kind: "opencode", ok: true, version: "1.2.9" }),
        errors: [],
      },
      taskStoreCheck: makeTaskStoreCheck(),
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "ready",
          runtime: { instance: makeRuntimeDiagnosticInstance() },
          mcp: {
            supported: true,
            status: "reconnecting",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: "The operation was aborted due to timeout",
            failureKind: "timeout",
          },
        }),
        codex: buildDisabledRuntimeHealth(CODEX_RUNTIME_DESCRIPTOR),
      },
      isLoadingChecks: false,
    });

    const mcpSection = model.sections.find((section) => section.key === "mcp:opencode");

    expect(model.isSummaryChecking).toBe(true);
    expect(model.summaryState.label).toBe("Checking...");
    expect(model.criticalReasons).toEqual([]);
    expect(mcpSection?.badge).toEqual({ label: "Reconnecting", variant: "warning" });
  });

  test("reports MCP failures as critical even if the health summary is stale", () => {
    const model = buildDiagnosticsPanelModel({
      workspaceRepoPath: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions: makeBuiltInRuntimeDefinitions(),
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: true,
        ghVersion: "gh version 2.73.0",
        ghAuthOk: true,
        ghAuthLogin: "octocat",
        ghAuthError: null,
        runtimes: makeBuiltInRuntimeDiagnostics({ kind: "opencode", ok: true, version: "1.2.9" }),
        errors: [],
      },
      taskStoreCheck: makeTaskStoreCheck(),
      runtimeCheckFailureKind: null,
      taskStoreCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "ready",
          runtime: { instance: makeRuntimeDiagnosticInstance() },
          mcp: {
            supported: true,
            status: "error",
            serverName: "openducktor",
            serverStatus: null,
            toolIds: [],
            detail: "MCP unavailable",
            failureKind: "error",
          },
        }),
        codex: buildDisabledRuntimeHealth(CODEX_RUNTIME_DESCRIPTOR),
      },
      isLoadingChecks: false,
    });

    const mcpSection = model.sections.find((section) => section.key === "mcp:opencode");

    expect(model.isSummaryChecking).toBe(false);
    expect(model.summaryState.label).toBe("Critical issue");
    expect(model.criticalReasons).toContain("MCP unavailable");
    expect(mcpSection?.errors).toEqual(["MCP unavailable"]);
  });
});

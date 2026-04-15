import { describe, expect, test } from "bun:test";
import type {
  BeadsCheck,
  RuntimeDescriptor,
  RuntimeInstanceSummary,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  type BeadsCheckFixtureOverrides,
  createBeadsCheckFixture,
} from "@/test-utils/shared-test-fixtures";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import { buildDiagnosticsPanelModel } from "./diagnostics-panel-model";

const runtimeDefinitions: RuntimeDescriptor[] = [OPENCODE_RUNTIME_DESCRIPTOR];

const runtimeSummary: RuntimeInstanceSummary = {
  kind: "opencode",
  runtimeId: "runtime-1",
  repoPath: "/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:49700",
  },
  startedAt: "2026-02-20T12:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
};

type RepoHealthOverrides = Omit<Partial<RepoRuntimeHealthCheck>, "runtime" | "mcp"> & {
  runtime?: Partial<RepoRuntimeHealthCheck["runtime"]>;
  mcp?: Partial<NonNullable<RepoRuntimeHealthCheck["mcp"]>>;
};

const makeRepoHealth = (overrides: RepoHealthOverrides = {}): RepoRuntimeHealthCheck => {
  const checkedAt = overrides.checkedAt ?? "2026-02-20T12:01:00.000Z";
  const runtime: RepoRuntimeHealthCheck["runtime"] = {
    status: "ready",
    stage: "runtime_ready",
    observation: null,
    instance: null,
    startedAt: null,
    updatedAt: checkedAt,
    elapsedMs: null,
    attempts: null,
    detail: null,
    failureKind: null,
    failureReason: null,
    ...overrides.runtime,
  };
  const mcp: NonNullable<RepoRuntimeHealthCheck["mcp"]> = {
    supported: true,
    status: "connected",
    serverName: "openducktor",
    serverStatus: "connected",
    toolIds: [],
    detail: null,
    failureKind: null,
    ...overrides.mcp,
  };

  return {
    status:
      overrides.status ??
      (runtime.status === "error" || mcp.status === "error"
        ? "error"
        : mcp.status === "checking" ||
            mcp.status === "reconnecting" ||
            mcp.status === "waiting_for_runtime"
          ? "checking"
          : runtime.status),
    checkedAt,
    runtime,
    mcp,
  };
};

const makeBeadsCheck = (overrides: BeadsCheckFixtureOverrides = {}): BeadsCheck =>
  createBeadsCheckFixture(
    {
      beadsPath: "/Users/dev/.openducktor/beads/repo/.beads",
      repoStoreHealth: {
        attachment: {
          path: "/Users/dev/.openducktor/beads/repo/.beads",
          databaseName: "repo_db",
        },
      },
    },
    overrides,
  );

const makeWorkspace = (
  repoPath: string,
  overrides: Partial<WorkspaceRecord> = {},
): WorkspaceRecord => ({
  workspaceId: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: "/worktrees",
  defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
  effectiveWorktreeBasePath: "/worktrees",
  ...overrides,
});

describe("buildDiagnosticsPanelModel", () => {
  test("returns no-repository summary and empty-state messages when no repository is selected", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: null,
      activeWorkspace: null,
      runtimeDefinitions,
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: null,
      beadsCheck: null,
      runtimeCheckFailureKind: null,
      beadsCheckFailureKind: null,
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
      activeRepo: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions,
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: null,
      beadsCheck: null,
      runtimeCheckFailureKind: null,
      beadsCheckFailureKind: null,
      runtimeHealthByRuntime: {},
      isLoadingChecks: true,
    });

    expect(model.isSummaryChecking).toBe(true);
    expect(model.summaryState.label).toBe("Checking...");
  });

  test("keeps summary in checking state while runtime health is still pending", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions,
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
        runtimes: [{ kind: "opencode", ok: true, version: "1.2.9" }],
        errors: [],
      },
      beadsCheck: makeBeadsCheck(),
      runtimeCheckFailureKind: null,
      beadsCheckFailureKind: null,
      runtimeHealthByRuntime: {},
      isLoadingChecks: false,
    });

    expect(model.isSummaryChecking).toBe(true);
    expect(model.summaryState.label).toBe("Checking...");
  });

  test("returns setup-needed summary when no effective worktree directory is available", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: "/repo",
      activeWorkspace: makeWorkspace("/repo", {
        hasConfig: false,
        configuredWorktreeBasePath: null,
        defaultWorktreeBasePath: null,
        effectiveWorktreeBasePath: null,
      }),
      runtimeDefinitions,
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
        runtimes: [{ kind: "opencode", ok: true, version: "1.2.9" }],
        errors: [],
      },
      beadsCheck: makeBeadsCheck(),
      runtimeCheckFailureKind: null,
      beadsCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          runtime: { instance: runtimeSummary },
          mcp: { toolIds: [] },
        }),
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
      activeRepo: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions,
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
        runtimes: [{ kind: "opencode", ok: true, version: "1.2.9" }],
        errors: [],
      },
      beadsCheck: makeBeadsCheck({
        repoStoreHealth: {
          category: "missing_shared_database",
          status: "restore_needed",
          isReady: false,
          detail: "Shared Dolt database repo_db is missing and restore is required",
          attachment: {
            path: "/Users/dev/.openducktor/beads/repo/.beads",
            databaseName: "repo_db",
          },
          sharedServer: {
            host: "127.0.0.1",
            port: 36123,
            ownershipState: "reused_existing_server",
          },
        },
        beadsOk: false,
        beadsError: "Shared Dolt database repo_db is missing and restore is required",
      }),
      runtimeCheckFailureKind: null,
      beadsCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          runtime: { instance: runtimeSummary },
          mcp: { toolIds: [] },
        }),
      },
      isLoadingChecks: false,
    });

    const beadsSection = model.sections.find((section) => section.key === "beads-store");

    expect(beadsSection?.badge).toEqual({ label: "Restore needed", variant: "warning" });
    expect(beadsSection?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Status", value: "Restore needed" }),
        expect.objectContaining({ label: "Health category", value: "Missing Dolt database" }),
        expect.objectContaining({
          label: "Beads attachment path",
          value: "/Users/dev/.openducktor/beads/repo/.beads",
        }),
        expect.objectContaining({ label: "Dolt database name", value: "repo_db" }),
        expect.objectContaining({ label: "Dolt server host", value: "127.0.0.1" }),
        expect.objectContaining({ label: "Dolt server port", value: "36123" }),
        expect.objectContaining({
          label: "Dolt server ownership",
          value: "Reusing another OpenDucktor-managed Dolt server",
        }),
      ]),
    );
    expect(beadsSection?.errors).toEqual([
      "Shared Dolt database repo_db is missing and restore is required",
    ]);
  });

  test("treats repositories using the default worktree path as healthy", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: "/repo",
      activeWorkspace: makeWorkspace("/repo", {
        configuredWorktreeBasePath: null,
        effectiveWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
      }),
      runtimeDefinitions,
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
        runtimes: [{ kind: "opencode", ok: true, version: "1.2.9" }],
        errors: [],
      },
      beadsCheck: makeBeadsCheck(),
      runtimeCheckFailureKind: null,
      beadsCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          runtime: { instance: runtimeSummary },
          mcp: { toolIds: [] },
        }),
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
      activeRepo: "/Users/dev/fairnest",
      activeWorkspace: makeWorkspace("/Users/dev/fairnest", {
        configuredWorktreeBasePath: "/Users/dev/worktrees",
        defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/fairnest",
        effectiveWorktreeBasePath: "/Users/dev/worktrees",
      }),
      runtimeDefinitions,
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
        runtimes: [
          { kind: "opencode", ok: true, version: "1.2.9 (/Users/dev/.opencode/bin/opencode)" },
        ],
        errors: [],
      },
      beadsCheck: makeBeadsCheck({
        beadsPath: "/Users/dev/.openducktor/beads/fairnest/.beads",
        repoStoreHealth: {
          attachment: {
            path: "/Users/dev/.openducktor/beads/fairnest/.beads",
          },
        },
      }),
      runtimeCheckFailureKind: null,
      beadsCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          runtime: { instance: runtimeSummary },
          mcp: { toolIds: ["openducktor_odt_read_task", "openducktor_odt_set_spec"] },
        }),
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
      activeRepo: "/repo",
      activeWorkspace: makeWorkspace("/repo", {
        hasConfig: false,
        configuredWorktreeBasePath: null,
        defaultWorktreeBasePath: null,
        effectiveWorktreeBasePath: null,
      }),
      runtimeDefinitions,
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
        runtimes: [{ kind: "opencode", ok: false, version: null }],
        errors: ["opencode not found in PATH"],
      },
      beadsCheck: makeBeadsCheck({
        beadsOk: false,
        beadsPath: null,
        beadsError: "beads init failed",
        repoStoreHealth: {
          category: "attachment_verification_failed",
          status: "blocking",
          isReady: false,
          detail: "beads init failed",
          attachment: {
            path: null,
          },
        },
      }),
      runtimeCheckFailureKind: "error",
      beadsCheckFailureKind: "error",
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
      },
      isLoadingChecks: false,
    });

    const runtimeSection = model.sections.find((section) => section.key === "runtime:opencode");
    const mcpSection = model.sections.find((section) => section.key === "mcp:opencode");
    const beadsSection = model.sections.find((section) => section.key === "beads-store");

    expect(model.summaryState.label).toBe("Critical issue");
    expect(model.criticalReasons).toEqual(
      expect.arrayContaining(["Runtime CLI checks failing", "runtime failed", "beads init failed"]),
    );
    expect(model.sections[1]?.errors).toEqual(["opencode not found in PATH"]);
    expect(runtimeSection?.errors).toEqual(["runtime failed"]);
    expect(mcpSection?.errors).toEqual([]);
    expect(beadsSection?.errors).toEqual(["beads init failed"]);
  });

  test("falls back to mcpError when server error is absent", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions,
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
        runtimes: [{ kind: "opencode", ok: true, version: "1.2.9" }],
        errors: [],
      },
      beadsCheck: makeBeadsCheck(),
      runtimeCheckFailureKind: null,
      beadsCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "error",
          runtime: { instance: runtimeSummary },
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
      },
      isLoadingChecks: false,
    });

    const mcpSection = model.sections.find((section) => section.key === "mcp:opencode");
    expect(mcpSection?.errors).toEqual(["mcp unavailable"]);
  });

  test("shows timeout-specific badges and messages while runtime health is warming up", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions,
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
        runtimes: [{ kind: "opencode", ok: true, version: "1.2.9" }],
        errors: [],
      },
      beadsCheck: makeBeadsCheck(),
      runtimeCheckFailureKind: null,
      beadsCheckFailureKind: null,
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
      activeRepo: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions,
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
        runtimes: [{ kind: "opencode", ok: true, version: "1.2.9" }],
        errors: [],
      },
      beadsCheck: makeBeadsCheck(),
      runtimeCheckFailureKind: null,
      beadsCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "checking",
          runtime: {
            status: "ready",
            stage: "runtime_ready",
            observation: "started_by_diagnostics",
            instance: runtimeSummary,
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
      activeRepo: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions,
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
        runtimes: [{ kind: "opencode", ok: true, version: "1.2.9" }],
        errors: [],
      },
      beadsCheck: makeBeadsCheck(),
      runtimeCheckFailureKind: null,
      beadsCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "checking",
          runtime: { instance: runtimeSummary },
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
      },
      isLoadingChecks: false,
    });

    expect(model.isSummaryChecking).toBe(true);
    expect(model.summaryState.label).toBe("Checking...");
  });

  test("shows timeout-specific cli tools and beads states instead of leaving them checking", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions,
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: false,
        gitVersion: null,
        ghOk: false,
        ghVersion: null,
        ghAuthOk: false,
        ghAuthLogin: null,
        ghAuthError: "Timed out after 15000ms",
        runtimes: [{ kind: "opencode", ok: false, version: null }],
        errors: ["Timed out after 15000ms"],
      },
      beadsCheck: makeBeadsCheck({
        beadsOk: false,
        beadsPath: null,
        beadsError: "Timed out after 15000ms",
        repoStoreHealth: {
          category: "attachment_verification_failed",
          status: "blocking",
          isReady: false,
          detail: "Timed out after 15000ms",
          attachment: {
            path: null,
          },
        },
      }),
      runtimeCheckFailureKind: "timeout",
      beadsCheckFailureKind: "timeout",
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          runtime: { instance: runtimeSummary },
          mcp: { toolIds: [] },
        }),
      },
      isLoadingChecks: false,
    });

    expect(model.isSummaryChecking).toBe(true);
    expect(model.summaryState.label).toBe("Checking...");
    expect(model.criticalReasons).toEqual([]);
    expect(model.sections[1]?.badge).toEqual({ label: "Retrying", variant: "warning" });
    expect(model.sections[1]?.errors[0]).toContain("CLI tools are not yet available");
    expect(model.sections[4]?.badge).toEqual({ label: "Retrying", variant: "warning" });
    expect(model.sections[4]?.errors[0]).toContain("Beads store is not yet available");
  });

  test("keeps hard failures ahead of retrying summary state", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions,
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: false,
        gitVersion: null,
        ghOk: false,
        ghVersion: null,
        ghAuthOk: false,
        ghAuthLogin: null,
        ghAuthError: "Timed out after 15000ms",
        runtimes: [{ kind: "opencode", ok: false, version: null }],
        errors: ["Timed out after 15000ms"],
      },
      beadsCheck: makeBeadsCheck(),
      runtimeCheckFailureKind: "timeout",
      beadsCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          status: "error",
          runtime: {
            status: "error",
            stage: "startup_failed",
            observation: null,
            instance: runtimeSummary,
            startedAt: runtimeSummary.startedAt,
            updatedAt: "2026-02-22T08:00:00.000Z",
            elapsedMs: 20_000,
            attempts: 4,
            detail: "runtime failed",
            failureKind: "error",
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
      },
      isLoadingChecks: false,
    });

    expect(model.isSummaryChecking).toBe(true);
    expect(model.summaryState.label).toBe("Critical issue");
    expect(model.criticalReasons).toEqual(expect.arrayContaining(["runtime failed"]));
  });

  test("treats GitHub CLI auth failures as CLI issues even without query failure classification", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: "/repo",
      activeWorkspace: makeWorkspace("/repo"),
      runtimeDefinitions,
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        ghOk: false,
        ghVersion: null,
        ghAuthOk: false,
        ghAuthLogin: null,
        ghAuthError: "gh auth missing",
        runtimes: [{ kind: "opencode", ok: true, version: "1.2.9" }],
        errors: ["gh auth missing"],
      },
      beadsCheck: makeBeadsCheck(),
      runtimeCheckFailureKind: null,
      beadsCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          runtime: { instance: runtimeSummary },
          mcp: { toolIds: [] },
        }),
      },
      isLoadingChecks: false,
    });

    expect(model.criticalReasons).toContain("Runtime CLI checks failing");
    expect(model.sections[1]?.badge).toEqual({ label: "Issue", variant: "danger" });
    expect(model.sections[1]?.errors).toEqual(["gh auth missing"]);
  });
});

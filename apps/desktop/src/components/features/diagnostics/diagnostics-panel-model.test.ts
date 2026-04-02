import { describe, expect, test } from "bun:test";
import type { RuntimeDescriptor, RuntimeInstanceSummary } from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
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
      activeWorkspace: {
        path: "/repo",
        isActive: true,
        hasConfig: true,
        configuredWorktreeBasePath: "/worktrees",
        defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
        effectiveWorktreeBasePath: "/worktrees",
      },
      runtimeDefinitions,
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: null,
      beadsCheck: null,
      runtimeHealthByRuntime: {},
      isLoadingChecks: true,
    });

    expect(model.isSummaryChecking).toBe(true);
    expect(model.summaryState.label).toBe("Checking...");
  });

  test("keeps summary in checking state while runtime health is still pending", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: "/repo",
      activeWorkspace: {
        path: "/repo",
        isActive: true,
        hasConfig: true,
        configuredWorktreeBasePath: "/worktrees",
        defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
        effectiveWorktreeBasePath: "/worktrees",
      },
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
      beadsCheck: {
        beadsOk: true,
        beadsPath: "/Users/dev/.openducktor/beads/repo/.beads",
        beadsError: null,
      },
      runtimeHealthByRuntime: {},
      isLoadingChecks: false,
    });

    expect(model.isSummaryChecking).toBe(true);
    expect(model.summaryState.label).toBe("Checking...");
  });

  test("returns setup-needed summary when no effective worktree directory is available", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: "/repo",
      activeWorkspace: {
        path: "/repo",
        isActive: true,
        hasConfig: false,
        configuredWorktreeBasePath: null,
        defaultWorktreeBasePath: null,
        effectiveWorktreeBasePath: null,
      },
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
      beadsCheck: {
        beadsOk: true,
        beadsPath: "/Users/dev/.openducktor/beads/repo/.beads",
        beadsError: null,
      },
      runtimeHealthByRuntime: {
        opencode: {
          runtimeOk: true,
          runtimeError: null,
          runtimeFailureKind: null,
          runtime: runtimeSummary,
          mcpOk: true,
          mcpError: null,
          mcpFailureKind: null,
          mcpServerName: "openducktor",
          mcpServerStatus: "connected",
          mcpServerError: null,
          availableToolIds: [],
          checkedAt: "2026-02-20T12:01:00.000Z",
          errors: [],
        },
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

  test("treats repositories using the default worktree path as healthy", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: "/repo",
      activeWorkspace: {
        path: "/repo",
        isActive: true,
        hasConfig: true,
        configuredWorktreeBasePath: null,
        defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
        effectiveWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
      },
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
      beadsCheck: {
        beadsOk: true,
        beadsPath: "/Users/dev/.openducktor/beads/repo/.beads",
        beadsError: null,
      },
      runtimeHealthByRuntime: {
        opencode: {
          runtimeOk: true,
          runtimeError: null,
          runtimeFailureKind: null,
          runtime: runtimeSummary,
          mcpOk: true,
          mcpError: null,
          mcpFailureKind: null,
          mcpServerName: "openducktor",
          mcpServerStatus: "connected",
          mcpServerError: null,
          availableToolIds: [],
          checkedAt: "2026-02-20T12:01:00.000Z",
          errors: [],
        },
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
      activeWorkspace: {
        path: "/Users/dev/fairnest",
        isActive: true,
        hasConfig: true,
        configuredWorktreeBasePath: "/Users/dev/worktrees",
        defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/fairnest",
        effectiveWorktreeBasePath: "/Users/dev/worktrees",
      },
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
      beadsCheck: {
        beadsOk: true,
        beadsPath: "/Users/dev/.openducktor/beads/fairnest/.beads",
        beadsError: null,
      },
      runtimeHealthByRuntime: {
        opencode: {
          runtimeOk: true,
          runtimeError: null,
          runtimeFailureKind: null,
          runtime: runtimeSummary,
          mcpOk: true,
          mcpError: null,
          mcpFailureKind: null,
          mcpServerName: "openducktor",
          mcpServerStatus: "connected",
          mcpServerError: null,
          availableToolIds: ["openducktor_odt_read_task", "openducktor_odt_set_spec"],
          checkedAt: "2026-02-20T12:01:00.000Z",
          errors: [],
        },
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
      activeWorkspace: {
        path: "/repo",
        isActive: true,
        hasConfig: false,
        configuredWorktreeBasePath: null,
        defaultWorktreeBasePath: null,
        effectiveWorktreeBasePath: null,
      },
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
      beadsCheck: {
        beadsOk: false,
        beadsPath: null,
        beadsError: "beads init failed",
      },
      runtimeHealthByRuntime: {
        opencode: {
          runtimeOk: false,
          runtimeError: "runtime failed",
          runtimeFailureKind: "error",
          runtime: null,
          mcpOk: false,
          mcpError: "mcp unavailable",
          mcpFailureKind: "error",
          mcpServerName: "openducktor",
          mcpServerStatus: null,
          mcpServerError: "server unavailable",
          availableToolIds: [],
          checkedAt: "2026-02-20T12:01:00.000Z",
          errors: ["runtime failed", "mcp unavailable"],
        },
      },
      isLoadingChecks: false,
    });

    const runtimeSection = model.sections.find((section) => section.key === "runtime:opencode");
    const mcpSection = model.sections.find((section) => section.key === "mcp:opencode");
    const beadsSection = model.sections.find((section) => section.key === "beads-store");

    expect(model.summaryState.label).toBe("Critical issue");
    expect(model.criticalReasons).toEqual(
      expect.arrayContaining([
        "Runtime CLI checks failing",
        "OpenCode runtime unavailable",
        "OpenCode OpenDucktor MCP unavailable",
        "Beads store unavailable",
      ]),
    );
    expect(model.sections[1]?.errors).toEqual(["opencode not found in PATH"]);
    expect(runtimeSection?.errors).toEqual(["runtime failed"]);
    expect(mcpSection?.errors).toEqual(["server unavailable"]);
    expect(beadsSection?.errors).toEqual(["beads init failed"]);
  });

  test("falls back to mcpError when server error is absent", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: "/repo",
      activeWorkspace: {
        path: "/repo",
        isActive: true,
        hasConfig: true,
        configuredWorktreeBasePath: "/worktrees",
        defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
        effectiveWorktreeBasePath: "/worktrees",
      },
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
      beadsCheck: {
        beadsOk: true,
        beadsPath: "/Users/dev/.openducktor/beads/repo/.beads",
        beadsError: null,
      },
      runtimeHealthByRuntime: {
        opencode: {
          runtimeOk: true,
          runtimeError: null,
          runtimeFailureKind: null,
          runtime: runtimeSummary,
          mcpOk: false,
          mcpError: "mcp unavailable",
          mcpFailureKind: "error",
          mcpServerName: "openducktor",
          mcpServerStatus: null,
          mcpServerError: null,
          availableToolIds: [],
          checkedAt: "2026-02-20T12:01:00.000Z",
          errors: [],
        },
      },
      isLoadingChecks: false,
    });

    const mcpSection = model.sections.find((section) => section.key === "mcp:opencode");
    expect(mcpSection?.errors).toEqual(["mcp unavailable"]);
  });

  test("shows timeout-specific badges and messages while runtime health is warming up", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: "/repo",
      activeWorkspace: {
        path: "/repo",
        isActive: true,
        hasConfig: true,
        configuredWorktreeBasePath: "/worktrees",
        defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
        effectiveWorktreeBasePath: "/worktrees",
      },
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
      beadsCheck: {
        beadsOk: true,
        beadsPath: "/Users/dev/.openducktor/beads/repo/.beads",
        beadsError: null,
      },
      runtimeHealthByRuntime: {
        opencode: {
          runtimeOk: false,
          runtimeError: "Timed out waiting for OpenCode runtime startup readiness",
          runtimeFailureKind: "timeout",
          runtime: null,
          mcpOk: false,
          mcpError: "Runtime is unavailable, so MCP cannot be verified.",
          mcpFailureKind: "timeout",
          mcpServerName: "openducktor",
          mcpServerStatus: null,
          mcpServerError: "Runtime is unavailable, so MCP cannot be verified.",
          availableToolIds: [],
          checkedAt: "2026-02-20T12:01:00.000Z",
          errors: ["Timed out waiting for OpenCode runtime startup readiness"],
        },
      },
      isLoadingChecks: false,
    });

    const runtimeSection = model.sections.find((section) => section.key === "runtime:opencode");
    const mcpSection = model.sections.find((section) => section.key === "mcp:opencode");

    expect(runtimeSection?.badge).toEqual({ label: "Starting", variant: "warning" });
    expect(runtimeSection?.errors[0]).toContain("Retrying automatically");
    expect(mcpSection?.badge).toEqual({ label: "Retrying", variant: "warning" });
  });

  test("shows timeout-specific cli tools and beads states instead of leaving them checking", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: "/repo",
      activeWorkspace: {
        path: "/repo",
        isActive: true,
        hasConfig: true,
        configuredWorktreeBasePath: "/worktrees",
        defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/repo",
        effectiveWorktreeBasePath: "/worktrees",
      },
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
      beadsCheck: {
        beadsOk: false,
        beadsPath: null,
        beadsError: "Timed out after 15000ms",
      },
      runtimeHealthByRuntime: {
        opencode: {
          runtimeOk: true,
          runtimeError: null,
          runtimeFailureKind: null,
          runtime: runtimeSummary,
          mcpOk: true,
          mcpError: null,
          mcpFailureKind: null,
          mcpServerName: "openducktor",
          mcpServerStatus: "connected",
          mcpServerError: null,
          availableToolIds: [],
          checkedAt: "2026-02-20T12:01:00.000Z",
          errors: [],
        },
      },
      isLoadingChecks: false,
    });

    expect(model.isSummaryChecking).toBe(false);
    expect(model.sections[1]?.badge).toEqual({ label: "Retrying", variant: "warning" });
    expect(model.sections[1]?.errors[0]).toContain("CLI tools is not yet available");
    expect(model.sections[4]?.badge).toEqual({ label: "Retrying", variant: "warning" });
    expect(model.sections[4]?.errors[0]).toContain("Beads store is not yet available");
  });
});

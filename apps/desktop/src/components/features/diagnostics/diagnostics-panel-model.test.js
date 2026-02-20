import { describe, expect, test } from "bun:test";
import { buildDiagnosticsPanelModel } from "./diagnostics-panel-model";

const runtimeSummary = {
  runtimeId: "runtime-1",
  repoPath: "/repo",
  taskId: "repo-main",
  role: "spec",
  workingDirectory: "/repo",
  port: 49700,
  startedAt: "2026-02-20T12:00:00.000Z",
};

describe("buildDiagnosticsPanelModel", () => {
  test("returns checking summary while diagnostics are loading", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: "/repo",
      activeWorkspace: {
        path: "/repo",
        isActive: true,
        hasConfig: true,
        configuredWorktreeBasePath: "/worktrees",
      },
      runtimeCheck: null,
      beadsCheck: null,
      opencodeHealth: null,
      isLoadingChecks: true,
    });

    expect(model.isSummaryChecking).toBe(true);
    expect(model.summaryState.label).toBe("Checking...");
  });

  test("builds keyed rows for repository and mcp sections", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: "/Users/dev/fairnest",
      activeWorkspace: {
        path: "/Users/dev/fairnest",
        isActive: true,
        hasConfig: true,
        configuredWorktreeBasePath: "/Users/dev/worktrees",
      },
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        opencodeOk: true,
        opencodeVersion: "1.2.9 (/Users/dev/.opencode/bin/opencode)",
        errors: [],
      },
      beadsCheck: {
        beadsOk: true,
        beadsPath: "/Users/dev/.openblueprint/beads/fairnest/.beads",
        beadsError: null,
      },
      opencodeHealth: {
        runtimeOk: true,
        runtimeError: null,
        runtime: runtimeSummary,
        mcpOk: true,
        mcpError: null,
        mcpServerName: "openducktor",
        mcpServerStatus: "connected",
        mcpServerError: null,
        availableToolIds: ["openducktor_odt_read_task", "openducktor_odt_set_spec"],
        checkedAt: "2026-02-20T12:01:00.000Z",
        errors: [],
      },
      isLoadingChecks: false,
    });

    expect(model.summaryState.label).toBe("Healthy");
    expect(model.sections.repository.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Repository" }),
        expect.objectContaining({ label: "Repository path" }),
        expect.objectContaining({
          label: "Worktree directory",
          value: "/Users/dev/worktrees",
        }),
      ]),
    );
    expect(model.sections.openducktorMcp.rows).toEqual(
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
      },
      runtimeCheck: {
        gitOk: true,
        gitVersion: "git version 2.50.1",
        opencodeOk: false,
        opencodeVersion: null,
        errors: ["opencode not found in PATH"],
      },
      beadsCheck: {
        beadsOk: false,
        beadsPath: null,
        beadsError: "beads init failed",
      },
      opencodeHealth: {
        runtimeOk: false,
        runtimeError: "runtime failed",
        runtime: null,
        mcpOk: false,
        mcpError: "mcp unavailable",
        mcpServerName: "openducktor",
        mcpServerStatus: null,
        mcpServerError: "server unavailable",
        availableToolIds: [],
        checkedAt: "2026-02-20T12:01:00.000Z",
        errors: ["runtime failed", "mcp unavailable"],
      },
      isLoadingChecks: false,
    });

    expect(model.summaryState.label).toBe("Critical issue");
    expect(model.criticalReasons).toEqual(
      expect.arrayContaining([
        "Runtime checks failing",
        "OpenCode server unavailable",
        "OpenDucktor MCP unavailable",
        "Beads store unavailable",
      ]),
    );
    expect(model.sections.cliTools.errors).toEqual(["opencode not found in PATH"]);
    expect(model.sections.opencodeRuntime.errors).toEqual(["runtime failed"]);
    expect(model.sections.openducktorMcp.errors).toEqual(["server unavailable"]);
    expect(model.sections.beadsStore.errors).toEqual(["beads init failed"]);
  });
});

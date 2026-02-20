import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDiagnosticsPanelModel } from "./diagnostics-panel-model";
import { DiagnosticsPanelSections } from "./diagnostics-panel-sections";

describe("DiagnosticsPanelSections", () => {
  test("renders repository-first empty messages when no repository is selected", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: null,
      activeWorkspace: null,
      runtimeCheck: null,
      beadsCheck: null,
      opencodeHealth: null,
      isLoadingChecks: false,
    });

    const html = renderToStaticMarkup(createElement(DiagnosticsPanelSections, { model }));

    expect(html).toContain("Select a repository to load diagnostics.");
    expect(html).toContain("Select a repository first.");
  });

  test("renders key-value labels consistently across sections", () => {
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
        runtime: {
          runtimeId: "runtime-1",
          repoPath: "/Users/dev/fairnest",
          taskId: "repo-main",
          role: "spec",
          workingDirectory: "/Users/dev/fairnest",
          port: 49700,
          startedAt: "2026-02-20T12:00:00.000Z",
        },
        mcpOk: true,
        mcpError: null,
        mcpServerName: "openducktor",
        mcpServerStatus: "connected",
        mcpServerError: null,
        availableToolIds: ["openducktor_odt_read_task"],
        checkedAt: "2026-02-20T12:01:00.000Z",
        errors: [],
      },
      isLoadingChecks: false,
    });

    const html = renderToStaticMarkup(createElement(DiagnosticsPanelSections, { model }));

    expect(html).toContain("Repository:");
    expect(html).toContain("Repository path:");
    expect(html).toContain("Worktree directory:");
    expect(html).toContain("OpenCode:");
    expect(html).toContain("Runtime ID:");
    expect(html).toContain("Server name:");
    expect(html).toContain("Status:");
    expect(html).toContain("Tools detected:");
    expect(html).toContain("Store path:");
  });

  test("renders error rows when section errors are present", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: "/Users/dev/fairnest",
      activeWorkspace: {
        path: "/Users/dev/fairnest",
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
        errors: [],
      },
      isLoadingChecks: false,
    });

    const html = renderToStaticMarkup(createElement(DiagnosticsPanelSections, { model }));

    expect(html).toContain("opencode not found in PATH");
    expect(html).toContain("runtime failed");
    expect(html).toContain("server unavailable");
    expect(html).toContain("beads init failed");
  });
});

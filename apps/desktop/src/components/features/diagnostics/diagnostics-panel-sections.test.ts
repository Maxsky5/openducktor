import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDiagnosticsPanelModel } from "./diagnostics-panel-model";
import { DiagnosticsPanelSections } from "./diagnostics-panel-sections";

describe("DiagnosticsPanelSections", () => {
  test("renders repository-first empty messages when no repository is selected", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: null,
      activeWorkspace: null,
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      isLoadingRuntimeDefinitions: false,
      runtimeDefinitionsError: null,
      runtimeCheck: null,
      beadsCheck: null,
      runtimeHealthByRuntime: {},
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
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
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
          runtime: {
            kind: "opencode",
            runtimeId: "runtime-1",
            repoPath: "/Users/dev/fairnest",
            taskId: null,
            role: "workspace",
            workingDirectory: "/Users/dev/fairnest",
            runtimeRoute: {
              type: "local_http",
              endpoint: "http://127.0.0.1:49700",
            },
            startedAt: "2026-02-20T12:00:00.000Z",
            descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
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
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
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

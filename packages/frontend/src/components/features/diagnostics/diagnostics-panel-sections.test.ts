import { describe, expect, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createHostRuntimeStatusContextValue,
  createObservedCheckFixture,
} from "@/test-utils/shared-test-fixtures";
import { buildDiagnosticsPanelModel } from "./diagnostics-panel-model";
import { DiagnosticsPanelSections } from "./diagnostics-panel-sections";
import { DiagnosticsStatusPill } from "./diagnostics-status";

type ModelInput = Parameters<typeof buildDiagnosticsPanelModel>[0];

const renderSections = (workspace: ModelInput["workspace"], overrides: Partial<ModelInput> = {}) =>
  renderToStaticMarkup(
    createElement(DiagnosticsPanelSections, {
      model: buildDiagnosticsPanelModel({
        runtimeDefinitions: [
          OPENCODE_RUNTIME_DESCRIPTOR,
          CODEX_RUNTIME_DESCRIPTOR,
          CLAUDE_RUNTIME_DESCRIPTOR,
        ],
        isLoadingRuntimeDefinitions: false,
        runtimeDefinitionsError: null,
        // No status yet: entries render without lifecycle actions.
        runtimeStatus: createHostRuntimeStatusContextValue({
          statusByKind: {},
          isLoading: true,
          isCurrent: false,
        }),
        pathCheck: createObservedCheckFixture(),
        gitCheck: createObservedCheckFixture(),
        workspace,
        checksRepoPath: workspace?.repoPath ?? null,
        taskStoreCheck: createObservedCheckFixture(),
        ...overrides,
      }),
    }),
  );

describe("DiagnosticsPanelSections", () => {
  test("renders the overview, then the host group, then the workspace message", () => {
    const html = renderSections(null);

    const order = [
      'data-testid="diagnostics-overview"',
      "Host",
      "Shared by all workspaces",
      "Agent runtimes",
      "Tools and services",
      "PATH",
      "Git",
      "OpenDucktor MCP bridge",
      "Select a workspace to view workspace checks.",
    ].map((text) => html.indexOf(text));
    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(html).toContain("OpenCode");
    expect(html).toContain("Codex");
    expect(html).toContain("Claude");
  });

  test("labels the workspace group with the workspace name and path", () => {
    const html = renderSections({
      workspaceId: "workspace-a",
      workspaceName: "Repo A",
      abbreviation: null,
      tileColor: null,
      repoPath: "/repo-a",
      isActive: true,
      hasConfig: true,
      configuredWorktreeBasePath: null,
      defaultWorktreeBasePath: null,
      effectiveWorktreeBasePath: "/worktrees",
    });

    expect(html).toContain("Repo A");
    expect(html).toContain("/repo-a");
    expect(html).toContain("Repository setup");
    expect(html).toContain("Task store");
  });

  test("labels values kept after a failed refresh as an earlier result", () => {
    const html = renderSections(null, {
      gitCheck: createObservedCheckFixture({
        data: {
          ok: true,
          executablePath: "/bin/git",
          version: "git version 2.50.1",
          error: null,
        },
        error: "Git check failed.",
        failureKind: "error",
        observedAt: "2026-02-22T08:00:00.000Z",
      }),
    });

    expect(html).toContain("Showing the result from ");
    expect(html).toContain("It may be out of date.");
    expect(html).toContain(
      "Git check could not be read: Git check failed. Select Refresh to try again.",
    );
  });

  test("maps each check health to a pill tone, with a spinner while work runs", () => {
    const renderPill = (status: Parameters<typeof DiagnosticsStatusPill>[0]["status"]) =>
      renderToStaticMarkup(createElement(DiagnosticsStatusPill, { status }));

    expect(renderPill({ health: "failed", label: "Error" })).toContain("bg-destructive-surface");
    expect(renderPill({ health: "warning", label: "Degraded" })).toContain("bg-warning-surface");
    expect(renderPill({ health: "ok", label: "Ready" })).toContain("bg-success-surface");
    expect(renderPill({ health: "busy", label: "Starting" })).toContain("animate-spin");
    expect(renderPill({ health: "neutral", label: "Disabled" })).not.toContain("animate-spin");
  });
});

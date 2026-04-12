import { describe, expect, test } from "bun:test";
import { type BeadsCheck, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";
import { buildDiagnosticsPanelModel } from "./diagnostics-panel-model";
import { DiagnosticsPanelSections } from "./diagnostics-panel-sections";

type RepoHealthOverrides = Omit<Partial<RepoRuntimeHealthCheck>, "runtime" | "mcp"> & {
  runtime?: Partial<RepoRuntimeHealthCheck["runtime"]>;
  mcp?: Partial<NonNullable<RepoRuntimeHealthCheck["mcp"]>>;
};

const makeRepoHealth = (overrides: RepoHealthOverrides = {}): RepoRuntimeHealthCheck => ({
  status: overrides.status ?? "ready",
  checkedAt: overrides.checkedAt ?? "2026-02-20T12:01:00.000Z",
  runtime: {
    status: "ready",
    stage: "runtime_ready",
    observation: null,
    instance: null,
    startedAt: null,
    updatedAt: overrides.checkedAt ?? "2026-02-20T12:01:00.000Z",
    elapsedMs: null,
    attempts: null,
    detail: null,
    failureKind: null,
    failureReason: null,
    ...overrides.runtime,
  },
  mcp: {
    supported: true,
    status: "connected",
    serverName: "openducktor",
    serverStatus: "connected",
    toolIds: [],
    detail: null,
    failureKind: null,
    ...overrides.mcp,
  },
});

const makeBeadsCheck = (overrides: Partial<BeadsCheck> = {}): BeadsCheck => ({
  beadsOk: true,
  beadsPath: "/Users/dev/.openducktor/beads/fairnest/.beads",
  beadsError: null,
  repoStoreHealth: {
    category: "healthy",
    status: "ready",
    isReady: true,
    detail: "Beads attachment and shared Dolt server are healthy.",
    attachment: {
      path: "/Users/dev/.openducktor/beads/fairnest/.beads",
      databaseName: "fairnest_db",
    },
    sharedServer: {
      host: "127.0.0.1",
      port: 3307,
      ownershipState: "owned_by_current_process",
    },
  },
  ...overrides,
});

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
      runtimeCheckFailureKind: null,
      beadsCheckFailureKind: null,
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
        defaultWorktreeBasePath: "/Users/dev/.openducktor/worktrees/fairnest",
        effectiveWorktreeBasePath: "/Users/dev/worktrees",
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
      beadsCheck: makeBeadsCheck(),
      runtimeCheckFailureKind: null,
      beadsCheckFailureKind: null,
      runtimeHealthByRuntime: {
        opencode: makeRepoHealth({
          runtime: {
            status: "ready",
            stage: "runtime_ready",
            observation: null,
            instance: {
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
          },
          mcp: {
            supported: true,
            status: "connected",
            serverName: "openducktor",
            serverStatus: "connected",
            toolIds: ["openducktor_odt_read_task"],
            detail: null,
            failureKind: null,
          },
        }),
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
    expect(html).toContain("Beads attachment path:");
    expect(html).toContain("Dolt database name:");
    expect(html).toContain("Dolt server host:");
    expect(html).toContain("Dolt server port:");
    expect(html).toContain("Dolt server ownership:");
  });

  test("renders error rows when section errors are present", () => {
    const model = buildDiagnosticsPanelModel({
      activeRepo: "/Users/dev/fairnest",
      activeWorkspace: {
        path: "/Users/dev/fairnest",
        isActive: true,
        hasConfig: false,
        configuredWorktreeBasePath: null,
        defaultWorktreeBasePath: null,
        effectiveWorktreeBasePath: null,
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
      beadsCheck: makeBeadsCheck({
        beadsOk: false,
        beadsPath: null,
        beadsError: "beads init failed",
        repoStoreHealth: {
          category: "attachment_verification_failed",
          status: "degraded",
          isReady: false,
          detail: "beads init failed",
          attachment: {
            path: null,
            databaseName: "fairnest_db",
          },
          sharedServer: {
            host: "127.0.0.1",
            port: 3307,
            ownershipState: "owned_by_current_process",
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
            observation: null,
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

    const html = renderToStaticMarkup(createElement(DiagnosticsPanelSections, { model }));

    expect(html).toContain("opencode not found in PATH");
    expect(html).toContain("runtime failed");
    expect(html).not.toContain("server unavailable");
    expect(html).toContain("beads init failed");
  });
});

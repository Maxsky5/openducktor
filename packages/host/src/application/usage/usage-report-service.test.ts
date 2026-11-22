import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { usagePeriods } from "../../domain/usage/usage-calendar";
import { EMPTY_USAGE_SUMS, type UsageSums } from "../../domain/usage/usage-figure";
import type { UsageIndexPort, UsageReadInput, UsageReadResult } from "../../ports/usage-index-port";
import { createUsageReportService } from "./usage-report-service";

const sums = (values: Partial<UsageSums>): UsageSums => ({ ...EMPTY_USAGE_SUMS, ...values });

/** A fake index that answers each read with the range it got and the given figures. */
type WorkspaceFixture = {
  workspaceId: string;
  workspaceName: string;
  repoPath: string;
  worktreeBasePath?: string;
};

const ODT_WORKSPACE: WorkspaceFixture = {
  workspaceId: "odt",
  workspaceName: "OpenDucktor",
  repoPath: "/code/odt",
};

const createHarness = (
  result: Partial<UsageReadResult> = {},
  workspaces: WorkspaceFixture[] = [ODT_WORKSPACE],
  tasks: { workspaceId: string; taskId: string; sessionDirectories?: string[] }[] = [],
) => {
  const reads: UsageReadInput[] = [];
  const index: UsageIndexPort = {
    read: (input) => {
      reads.push(input);
      const range = { start: input.range.start ?? "2026-09-19", end: input.range.end };
      return Effect.succeed({
        resultAtMs: Date.parse("2026-11-21T12:00:00Z"),
        range,
        granularity: "day",
        periodBounds: usagePeriods(range.start, range.end, "day"),
        withoutHistory: [],
        issues: [],
        locationIssues: [],
        byRuntime: [],
        periods: [],
        byModel: [],
        byProject: [],
        projects: [],
        pricing: {
          source: "models.dev",
          updatedAtMs: Date.parse("2026-11-21T08:00:00Z"),
          issue: null,
        },
        ...result,
      });
    },
    shutdown: () => Effect.void,
  };
  const service = createUsageReportService({
    index,
    settingsConfig: {
      readWorkspaceCatalogSnapshot: () =>
        Effect.succeed({
          catalogRevision: 1,
          workspaceOrder: [],
          workspaces,
        }),
      defaultWorktreeBasePath: (workspaceId) => `/home/u/.odt/worktrees/${workspaceId}`,
      resolveConfiguredPath: (value) => value,
      join: (...parts) => parts.join("/"),
    },
    taskOwnership: {
      listTaskDirectoriesForWorktreeOwnership: ({ workspaces: sharing }) =>
        Effect.succeed(
          tasks
            .filter((task) =>
              sharing.some((workspace) => workspace.workspaceId === task.workspaceId),
            )
            .map((task) => ({
              workspaceId: task.workspaceId,
              taskId: task.taskId,
              title: task.taskId,
              sessionDirectories: task.sessionDirectories ?? [],
            })),
        ),
    },
    locations: () => ({
      claude: "/home/u/.claude/projects",
      codex: ["/codex/sessions", "/codex/archived_sessions"],
      opencode: { directory: "/home/u/.local/share/opencode", databaseFile: null },
    }),
    timeZone: () => "UTC",
    now: () => Date.parse("2026-11-21T12:00:00Z"),
  });
  return { service, reads };
};

describe("createUsageReportService", () => {
  test.each([
    ["last_7_days", "2026-11-15"],
    ["last_90_days", "2026-08-24"],
  ] as const)("reads %s up to today", async (kind, start) => {
    const { service, reads } = createHarness();
    await Effect.runPromise(service.read({ range: { kind }, runtime: null }));
    expect(reads[0]?.range).toEqual({ start, end: "2026-11-21" });
  });

  test("reads the last 30 days of all runtimes in one index read", async () => {
    const { service, reads } = createHarness();
    const report = await Effect.runPromise(
      service.read({ range: { kind: "last_30_days" }, runtime: null }),
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]?.range).toEqual({ start: "2026-10-23", end: "2026-11-21" });
    expect(reads[0]?.runtimes).toEqual(["opencode", "codex", "claude"]);
    expect(reads[0]?.workspaces).toEqual([
      {
        workspaceId: "odt",
        name: "OpenDucktor",
        repoPath: "/code/odt",
        roots: ["/code/odt", "/home/u/.odt/worktrees/odt"],
      },
    ]);
    expect(reads[0]?.separateFolders).toEqual([]);
    expect(report.range).toEqual({ start: "2026-10-23", end: "2026-11-21" });
    expect(report.periods).toHaveLength(30);
  });

  test("gives each workspace only the worktrees of its own tasks in a shared worktree folder", async () => {
    const { service, reads } = createHarness(
      {},
      [
        { workspaceId: "a", workspaceName: "A", repoPath: "/code/a", worktreeBasePath: "/shared" },
        { workspaceId: "b", workspaceName: "B", repoPath: "/code/b", worktreeBasePath: "/shared" },
      ],
      [
        { workspaceId: "a", taskId: "task-a", sessionDirectories: ["/shared/custom-a", "/shared"] },
        { workspaceId: "b", taskId: "task-b" },
        // Imported task IDs can repeat across workspaces. Nobody owns that folder.
        { workspaceId: "a", taskId: "same" },
        { workspaceId: "b", taskId: "same" },
      ],
    );
    await Effect.runPromise(service.read({ range: { kind: "last_30_days" }, runtime: null }));
    expect(reads[0]?.workspaces.map((workspace) => workspace.roots)).toEqual([
      ["/code/a", "/shared/task-a", "/shared/custom-a"],
      ["/code/b", "/shared/task-b"],
    ]);
    expect(reads[0]?.separateFolders).toEqual(["/shared", "/shared/same"]);
  });

  test("lets the index start All time at the earliest activity", async () => {
    const { service, reads } = createHarness();
    const report = await Effect.runPromise(
      service.read({ range: { kind: "all_time" }, runtime: "claude" }),
    );
    expect(reads[0]?.range).toEqual({ start: null, end: "2026-11-21" });
    expect(report.range.start).toBe("2026-09-19");
    expect(report.coverage.map((entry) => entry.runtime)).toEqual(["claude"]);
  });

  test("marks only the figures whose dates an issue covers as incomplete", async () => {
    const { service } = createHarness({
      issues: [
        {
          runtime: "codex",
          code: "malformed_records",
          firstAtMs: Date.parse("2026-11-03T10:00:00Z"),
          lastAtMs: Date.parse("2026-11-03T11:00:00Z"),
        },
      ],
      byRuntime: [
        { runtime: "codex", ...sums({ input: 5, sessions: 1, costUsd: 1 }) },
        { runtime: "claude", ...sums({ input: 7, sessions: 2, costUsd: 2 }) },
      ],
      periods: [{ period: 1, runtime: "codex", ...sums({ input: 5, sessions: 1 }) }],
    });
    const report = await Effect.runPromise(
      service.read({
        range: { kind: "custom", start: "2026-11-02", end: "2026-11-04" },
        runtime: null,
      }),
    );
    expect(report.totals.complete).toBe(false);
    expect(report.totals.tokens.input).toBe(12);
    expect(report.totals.sessions).toBe(3);
    expect(report.byRuntime.map((row) => [row.runtime, row.figure.complete])).toEqual([
      ["opencode", true],
      ["codex", false],
      ["claude", true],
    ]);
    const codexCells = report.periods.map(
      (period) => period.runtimes.find((cell) => cell.runtime === "codex")?.figure.complete,
    );
    expect(codexCells).toEqual([true, false, true]);
    const codex = report.coverage.find((entry) => entry.runtime === "codex");
    expect(codex?.state).toBe("partial");
    expect(codex?.issues[0]?.message).toContain("Codex");
  });

  test("labels projects without paths and merges a model across runtimes", async () => {
    const { service } = createHarness({
      withoutHistory: ["opencode"],
      byModel: [
        {
          runtime: "claude",
          provider: "anthropic",
          model: "claude-opus-5-5",
          ...sums({ input: 3, sessions: 1 }),
        },
        {
          runtime: "opencode",
          provider: "anthropic",
          model: "claude-opus-5-5",
          ...sums({ input: 4, sessions: 1 }),
        },
      ],
      byProject: [
        { group: "workspace:odt", ...sums({ input: 3 }) },
        { group: "path:/work/app", ...sums({ input: 9 }) },
      ],
      projects: [
        { key: "workspace:odt", workspaceName: "OpenDucktor", path: null },
        { key: "path:/work/app", workspaceName: null, path: "/work/app" },
      ],
    });
    const report = await Effect.runPromise(
      service.read({ range: { kind: "last_30_days" }, runtime: null }),
    );
    expect(
      report.byModel.map((row) => [row.model, row.figure.tokens.input, row.figure.sessions]),
    ).toEqual([["claude-opus-5-5", 7, 2]]);
    expect(report.byProject.map((row) => row.label)).toEqual(["app", "OpenDucktor"]);
    expect(JSON.stringify(report)).not.toContain("/work/app");
    expect(report.coverage.find((entry) => entry.runtime === "opencode")?.state).toBe("no_history");
  });
});

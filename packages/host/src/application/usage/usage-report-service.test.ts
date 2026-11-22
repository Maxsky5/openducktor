import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { usagePeriods } from "../../domain/usage/usage-calendar";
import type { UsageIndexPort, UsageReadInput } from "../../ports/usage-index-port";
import { createUsageReportService } from "./usage-report-service";

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

/** A fake index that answers each read with the range it got and no figures. */
const createHarness = (
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
        byRuntime: [],
        periods: [],
        byModel: [],
        byProject: [],
        projects: [],
        pricing: {
          source: "models.dev",
          updatedAtMs: Date.parse("2026-11-21T08:00:00Z"),
          failure: null,
        },
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
    timeZone: () => "UTC",
    now: () => Date.parse("2026-11-21T12:00:00Z"),
  });
  return { service, reads };
};

describe("createUsageReportService", () => {
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
});

import type { RuntimeKind, UsageCoverageIssue, UsageGranularity } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { UsageDate } from "../domain/usage/usage-calendar";
import type { UsageSums } from "../domain/usage/usage-figure";
import type { UsageProjectGroup, UsageWorkspace } from "../domain/usage/usage-projects";
import type { HostOperationErrorAggregate } from "../effect/host-errors";

export type UsageSourceIssue = {
  code: UsageCoverageIssue["code"];
  firstAtMs: number | null;
  lastAtMs: number | null;
};

export type UsageIssueRow = UsageSourceIssue & { runtime: RuntimeKind };

export type UsageSumRow = UsageSums & { runtime: RuntimeKind };

export type UsageAggregate = {
  byRuntime: UsageSumRow[];
  periods: (UsageSumRow & { period: number })[];
  byModel: (UsageSumRow & { provider: string | null; model: string | null })[];
  byProject: (UsageSums & { group: string })[];
};

/** The native history folders of each runtime. */
export type UsageLocations = {
  /** The Claude Code `projects` folder. */
  claude: string;
  /** The Codex `sessions` and `archived_sessions` folders. */
  codex: readonly string[];
  /** The OpenCode data folder, and the database file when `OPENCODE_DB` names one. */
  opencode: { directory: string; databaseFile: string | null };
};

export type UsageReadInput = {
  timeZone: string;
  locations: UsageLocations;
  runtimes: readonly RuntimeKind[];
  /** A null start reads all history and starts at the earliest activity of the runtimes. */
  range: { start: UsageDate | null; end: UsageDate };
  workspaces: readonly UsageWorkspace[];
  /** True to check the sources again; else a recent check of an earlier read can serve. */
  refresh: boolean;
  /** Folders without a single owner, such as a shared worktree folder. They stay separate. */
  separateFolders: readonly string[];
};

/** One report read: the source check and the figures of one snapshot of the index. */
export type UsageReadResult = UsageAggregate & {
  resultAtMs: number;
  range: { start: UsageDate; end: UsageDate };
  granularity: UsageGranularity;
  /** The periods of the range. `periods` holds their sums. */
  periodBounds: { start: UsageDate; end: UsageDate }[];
  /** Runtimes whose history location holds no source. */
  withoutHistory: RuntimeKind[];
  issues: UsageIssueRow[];
  /** Problems with a whole location, such as a folder that cannot be read. */
  locationIssues: { runtime: RuntimeKind; code: "unreadable" }[];
  projects: UsageProjectGroup[];
  /** The rate catalog of the costs, when the host downloaded it, and why it is missing or old. */
  pricing: { source: string; updatedAtMs: number | null; issue: string | null };
};

/**
 * The usage index: a derived cache of the native runtime history. A read brings it up to date
 * for a range and sums its daily rollup on one snapshot.
 */
export type UsageIndexPort = {
  read(input: UsageReadInput): Effect.Effect<UsageReadResult, HostOperationErrorAggregate>;
  shutdown(): Effect.Effect<void>;
};

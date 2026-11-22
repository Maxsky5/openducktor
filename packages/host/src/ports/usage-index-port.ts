import type { RuntimeKind } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { UsageDate } from "../domain/usage/usage-calendar";
import type { UsageWorkspace } from "../domain/usage/usage-projects";
import type { UsageIndexFigures } from "../domain/usage/usage-report";
import type { HostOperationErrorAggregate } from "../effect/host-errors";

export type UsageReadInput = {
  timeZone: string;
  runtimes: readonly RuntimeKind[];
  /** A null start reads all history and starts at the earliest activity of the runtimes. */
  range: { start: UsageDate | null; end: UsageDate };
  workspaces: readonly UsageWorkspace[];
  /** True to check the sources again; else a recent check of an earlier read can serve. */
  refresh: boolean;
  /** Folders without a single owner, such as a shared worktree folder. They stay separate. */
  separateFolders: readonly string[];
};

/**
 * The usage index: a derived cache of the native runtime history. A read brings it up to date
 * for a range and sums its daily rollup on one snapshot.
 */
export type UsageIndexPort = {
  read(input: UsageReadInput): Effect.Effect<UsageIndexFigures, HostOperationErrorAggregate>;
  shutdown(): Effect.Effect<void>;
};

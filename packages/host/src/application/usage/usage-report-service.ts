import {
  knownRuntimeKindValues,
  type UsageReport,
  type UsageReportReadInput,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createUsageCalendar, usageReadRange } from "../../domain/usage/usage-calendar";
import { usageReport } from "../../domain/usage/usage-report";
import {
  type UsageWorkspaceFolders,
  usageWorkspaceFolders,
  workspacesWithSharedWorktrees,
} from "../../domain/usage/usage-workspace-folders";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import { managedWorktreeBaseForRepoConfig } from "../git/managed-worktree-roots";
import type { SettingsConfigError, SettingsConfigPort } from "../../ports/settings-config-port";
import type { TaskOwnershipReader, TaskStoreError } from "../../ports/task-repository-ports";
import type { UsageIndexPort } from "../../ports/usage-index-port";

export type UsageReportServiceDependencies = {
  index: UsageIndexPort;
  settingsConfig: Pick<
    SettingsConfigPort,
    "readWorkspaceCatalogSnapshot" | "defaultWorktreeBasePath" | "resolveConfiguredPath" | "join"
  >;
  /** The tasks of workspaces in any state. They own their worktrees in a shared folder. */
  taskOwnership: Pick<TaskOwnershipReader, "listTaskDirectoriesForWorktreeOwnership">;
  timeZone: () => string;
  now: () => number;
};

/** Reads the workspaces and, for shared worktree folders, the tasks that own their worktrees. */
const workspaceFoldersOf = ({
  settingsConfig,
  taskOwnership,
}: UsageReportServiceDependencies): Effect.Effect<
  UsageWorkspaceFolders,
  SettingsConfigError | TaskStoreError
> =>
  Effect.gen(function* () {
    const catalog = yield* settingsConfig.readWorkspaceCatalogSnapshot();
    const workspaces = catalog.workspaces.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      name: workspace.workspaceName,
      repoPath: workspace.repoPath,
      worktreeBase: managedWorktreeBaseForRepoConfig(settingsConfig, workspace),
    }));
    const sharing = workspacesWithSharedWorktrees(workspaces);
    // The administrative read admits every workspace and task state, also a closed workspace.
    const tasks =
      sharing.length === 0
        ? []
        : yield* taskOwnership.listTaskDirectoriesForWorktreeOwnership({ workspaces: sharing });
    return usageWorkspaceFolders(workspaces, tasks, settingsConfig.join);
  });

/** Builds the usage report of one selection from the usage index. */
export const createUsageReportService = (dependencies: UsageReportServiceDependencies) => ({
  read: (
    input: UsageReportReadInput,
  ): Effect.Effect<
    UsageReport,
    HostOperationErrorAggregate | SettingsConfigError | TaskStoreError
  > =>
    Effect.gen(function* () {
      const timeZone = dependencies.timeZone();
      const today = createUsageCalendar(timeZone).dateOf(dependencies.now());
      const runtimes = input.runtime ? [input.runtime] : [...knownRuntimeKindValues];
      // The check and the figures come from one worker read on one snapshot of the index.
      const figures = yield* dependencies.index.read({
        timeZone,
        runtimes,
        range: usageReadRange(input.range, today),
        refresh: input.refresh ?? false,
        ...(yield* workspaceFoldersOf(dependencies)),
      });
      return usageReport({ timeZone, runtimes, figures });
    }),
});

export type UsageReportService = ReturnType<typeof createUsageReportService>;

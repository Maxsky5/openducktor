import type { RepoConfig, StartupStep } from "@openducktor/contracts";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
import { plannedWorktreeActionSteps } from "../actions/worktree-action-runner";
import { startupStep, updateStartup } from "./session-startup-progress";

export const existingCheckoutStepMeta = (
  workingDirectory: string,
  isMainCheckout: boolean,
  reuseLabel: string,
): Pick<StartupStep, "id" | "label" | "details"> & Partial<Pick<StartupStep, "resources">> =>
  isMainCheckout
    ? { id: "checkout", label: "Use current checkout", details: [workingDirectory] }
    : {
        id: "checkout",
        label: reuseLabel,
        details: [workingDirectory],
        resources: [{ kind: "worktree", value: workingDirectory, state: "reused" }],
      };

export const copyWorktreeConfiguredFiles = (
  worktreeFiles: Pick<WorktreeFilePort, "copyConfiguredPaths">,
  repoPath: string,
  worktreePath: string,
  copyPaths: string[],
) => {
  const copyFiles = worktreeFiles.copyConfiguredPaths(repoPath, worktreePath, copyPaths);
  return copyPaths.length > 0
    ? startupStep({ id: "copies", label: "Copy configured files", details: copyPaths }, copyFiles)
    : copyFiles;
};

export type WorktreeSetupPlanInput = {
  label: string;
  worktreePath: string;
  /** Null while the naming model still writes the branch. The checkout step adds it when it runs. */
  branch: string | null;
  /**
   * The step that names the branch before Git creates the worktree. Defaults to `"running"` when
   * published immediately before naming begins.
   */
  namingStep?: { id: string; label: string; state?: "pending" | "running" } | null;
  upstreamRemote: string | null | undefined;
  repoConfig: Pick<RepoConfig, "worktreeCopyPaths" | "actions">;
};

export const buildWorktreeSetupPlanSteps = (input: WorktreeSetupPlanInput) => [
  ...(input.namingStep
    ? [
        {
          id: input.namingStep.id,
          label: input.namingStep.label,
          state: input.namingStep.state ?? ("running" as const),
        },
      ]
    : []),
  {
    id: "checkout",
    label: input.label,
    state: "pending" as const,
    details: input.branch === null ? [input.worktreePath] : [input.worktreePath, input.branch],
  },
  ...(input.upstreamRemote
    ? [
        {
          id: "upstream",
          label: "Set branch upstream",
          state: "pending" as const,
          details: [input.upstreamRemote],
        },
      ]
    : []),
  ...(input.repoConfig.worktreeCopyPaths.length > 0
    ? [
        {
          id: "copies",
          label: "Copy configured files",
          state: "pending" as const,
          details: input.repoConfig.worktreeCopyPaths,
        },
      ]
    : []),
  ...plannedWorktreeActionSteps(input.repoConfig.actions),
];

/**
 * Publishes every setup step of a new worktree in one snapshot. Call it after validation and
 * before Git creates the worktree, so the client shows the full plan once.
 */
export const planWorktreeSetup = (input: WorktreeSetupPlanInput) =>
  updateStartup((progress) => progress.plan(buildWorktreeSetupPlanSteps(input)));

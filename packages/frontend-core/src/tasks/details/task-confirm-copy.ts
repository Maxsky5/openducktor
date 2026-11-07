import { plural } from "../../lib/plural";
import type { TaskWorktreeOwnersRead } from "../../queries/use-task-worktree-owners";
import type { TaskConfirmImpact } from "./task-confirm-dialog-types";
import {
  isConfirmBlockedByImpact,
  worktreeOwnerLines,
  worktreeOwnerReadErrorMessage,
} from "./task-worktree-owner-copy";

/** The task that a confirmation names. A missing title leaves its ID visible. */
export type TaskConfirmSubject = { id: string; title: string | null };

export type TaskConfirmCopy = {
  title: string;
  description: string;
  subject: TaskConfirmSubject;
  tone: "warning" | "destructive";
  changes: readonly string[];
  kept: readonly string[];
  warning: string;
  errors: readonly string[];
  confirmLabel: { idle: string; pending: string; checking: string };
};

export type TaskResetImplementationCopyInput = {
  taskId: string;
  taskTitle: string;
  actionLabel: string;
  targetStatusLabel: string;
  worktreeRoleLabels: readonly string[];
  dropsLocalMerge: boolean;
  activeSessionCount: number | null;
  activeSessionCountError: string | null;
  hasCanonicalWorktree: boolean;
  legacyWorktreeCount: number;
  terminalCount: number;
  /** The others that need a worktree that the reset removes. */
  worktreeOwners: TaskWorktreeOwnersRead;
  impactError: string | null;
};

/** Reset keeps the task record and clears its workflow work. */
export function buildTaskResetConfirmCopy(
  subject: TaskConfirmSubject,
  impact: TaskConfirmImpact,
): TaskConfirmCopy {
  return {
    title: "Reset task",
    description: "Move this task back to the start of its workflow.",
    subject,
    tone: "destructive",
    changes: [
      "Delete all task artifacts",
      "Remove all task sessions",
      "Remove pull request and merge links",
      ...cleanupChanges(impact),
      ...stoppedWork(impact),
    ],
    kept: ["Task title, description and labels"],
    warning: withOwnerWarnings(
      impact.hasManagedSessionCleanup || impact.error
        ? "Artifacts and session history cannot be recovered. Uncommitted work in deleted worktrees will be lost."
        : "Artifacts and session history cannot be recovered.",
      impact.worktreeOwners,
    ),
    errors: [
      ...readErrors(impact.activeSessionCountError, impact.error),
      ...ownerErrors(impact.worktreeOwners),
    ],
    confirmLabel: { idle: "Reset task", pending: "Resetting…", checking: "Checking…" },
  };
}

export function buildTaskDeleteConfirmCopy(
  subject: TaskConfirmSubject,
  impact: TaskConfirmImpact,
): TaskConfirmCopy {
  return {
    title: "Delete task",
    description: "Delete this task and its saved history.",
    subject,
    tone: "destructive",
    changes: [
      "Delete the task and all its artifacts",
      "Remove linked sessions and task history",
      ...cleanupChanges(impact),
      ...stoppedWork(impact),
    ],
    kept: [],
    warning: withOwnerWarnings(
      impact.hasManagedSessionCleanup || impact.error
        ? "This cannot be undone. Uncommitted work in deleted worktrees will be lost."
        : "This cannot be undone.",
      impact.worktreeOwners,
    ),
    errors: [
      ...readErrors(impact.activeSessionCountError, impact.error),
      ...ownerErrors(impact.worktreeOwners),
    ],
    confirmLabel: { idle: "Delete task", pending: "Deleting…", checking: "Checking…" },
  };
}

/** "A", "A and B", or "A, B, and C". Hermes on mobile has no `Intl.ListFormat`. */
const listLabels = (labels: readonly string[]): string =>
  labels.length < 3
    ? labels.join(" and ")
    : `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;

/** The `worktree.reset` effect keeps the other artifacts and the current worktree. */
export function buildTaskResetImplementationConfirmCopy(
  input: TaskResetImplementationCopyInput,
): TaskConfirmCopy {
  const roles = listLabels(input.worktreeRoleLabels);
  const changes = [
    `Remove the ${roles} session history`,
    "Delete review reports and remove the pull request link",
  ];
  if (input.dropsLocalMerge) {
    changes.push(
      "Drop the record of the unpublished local merge. The merge commit stays on the local target branch",
    );
  }
  if (input.hasCanonicalWorktree) {
    changes.push("Reset tracked files to the latest local base commit and delete untracked files");
  }
  if (input.legacyWorktreeCount > 0) {
    changes.push(
      `Delete ${plural(input.legacyWorktreeCount, "older worktree")} and related local branches`,
    );
  }
  changes.push(
    input.hasCanonicalWorktree
      ? "Remove other related local branches"
      : "Remove related local branches",
    ...stoppedWork(input),
  );
  return {
    title: input.actionLabel,
    description: `Move this task back to ${input.targetStatusLabel} and clear the implementation.`,
    subject: { id: input.taskId, title: input.taskTitle },
    tone: "destructive",
    changes,
    kept: [
      "Other task artifacts",
      ...(input.hasCanonicalWorktree ? ["Current worktree, its branch and ignored files"] : []),
    ],
    warning: withOwnerWarnings(
      input.hasCanonicalWorktree || input.legacyWorktreeCount > 0
        ? `Uncommitted and untracked work will be lost. The ${roles} session history cannot be recovered.`
        : `The ${roles} session history cannot be recovered.`,
      input.worktreeOwners,
    ),
    errors: [
      ...readErrors(input.activeSessionCountError, input.impactError),
      ...ownerErrors(input.worktreeOwners),
    ],
    confirmLabel: { idle: input.actionLabel, pending: "Resetting…", checking: "Checking…" },
  };
}

export const stopImpactReadErrorMessage = (error: string): string =>
  `Could not check running sessions: ${error}`;

export type TaskConfirmControlState = { isBusy: boolean; disabled: boolean; label: string };

export function taskResetImplementationConfirmState(
  state: {
    isSubmitting: boolean;
    isLoadingImpact: boolean;
    activeSessionCountError: string | null;
    worktreeOwners: TaskWorktreeOwnersRead;
  },
  copy: Pick<TaskConfirmCopy, "confirmLabel">,
): TaskConfirmControlState {
  const isBusy = state.isSubmitting || state.isLoadingImpact;
  let label = copy.confirmLabel.idle;
  if (state.isSubmitting) label = copy.confirmLabel.pending;
  else if (state.isLoadingImpact) label = copy.confirmLabel.checking;
  return { isBusy, disabled: isBusy || isConfirmBlockedByImpact(state), label };
}

function stoppedWork(impact: {
  activeSessionCount: number | null;
  terminalCount: number;
}): string[] {
  const changes: string[] = [];
  if (impact.activeSessionCount && impact.activeSessionCount > 0) {
    changes.push(`Stop ${plural(impact.activeSessionCount, "running agent session")}`);
  }
  if (impact.terminalCount > 0) {
    changes.push(`Close ${plural(impact.terminalCount, "terminal")}`);
  }
  return changes;
}

function cleanupChanges(impact: TaskConfirmImpact): string[] {
  if (impact.error) return ["Remove linked worktrees and local branches, if present"];
  if (!impact.hasManagedSessionCleanup) return [];
  return [
    impact.managedWorktreeCount > 0
      ? `Delete ${plural(impact.managedWorktreeCount, "linked worktree")} and related local branches`
      : "Delete linked worktrees and related local branches, if present",
  ];
}

function readErrors(stopError: string | null, cleanupError: string | null): string[] {
  return [
    ...(stopError ? [stopImpactReadErrorMessage(stopError)] : []),
    ...(cleanupError ? [cleanupError] : []),
  ];
}

/** The others that need a removed worktree and stop the action. */
function ownerErrors(owners: TaskWorktreeOwnersRead): string[] {
  const readError = worktreeOwnerReadErrorMessage(owners);
  return [
    ...(readError ? [readError] : []),
    ...worktreeOwnerLines(owners)
      .filter((line) => line.blocking)
      .map((line) => line.text),
  ];
}

/** The warning of a confirmation, with the owners that the action can break but not stop. */
function withOwnerWarnings(warning: string, owners: TaskWorktreeOwnersRead): string {
  return [
    warning,
    ...worktreeOwnerLines(owners)
      .filter((line) => !line.blocking)
      .map((line) => line.text),
  ].join(" ");
}

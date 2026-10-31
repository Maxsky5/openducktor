import { plural } from "../../lib/plural";
import type { TaskConfirmImpact } from "./task-confirm-dialog-types";

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
  targetStatusLabel: string;
  activeSessionCount: number | null;
  activeSessionCountError: string | null;
  hasCanonicalWorktree: boolean;
  legacyWorktreeCount: number;
  terminalCount: number;
  impactError: string | null;
};

/** Reset keeps the task record and clears its workflow work. */
export function buildTaskResetConfirmCopy(
  subject: TaskConfirmSubject,
  impact: TaskConfirmImpact,
): TaskConfirmCopy {
  return {
    title: "Reset task",
    description: "Move this task to Backlog and start again.",
    subject,
    tone: "destructive",
    changes: [
      "Delete all task artifacts",
      "Remove Spec, Planner, Builder and QA sessions",
      "Remove pull request and merge links",
      ...cleanupChanges(impact),
      ...stoppedWork(impact),
    ],
    kept: ["Task title, description and labels"],
    warning:
      impact.hasManagedSessionCleanup || impact.error
        ? "Artifacts and session history cannot be recovered. Uncommitted work in deleted worktrees will be lost."
        : "Artifacts and session history cannot be recovered.",
    errors: readErrors(impact.activeSessionCountError, impact.error),
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
    warning:
      impact.hasManagedSessionCleanup || impact.error
        ? "This cannot be undone. Uncommitted work in deleted worktrees will be lost."
        : "This cannot be undone.",
    errors: readErrors(impact.activeSessionCountError, impact.error),
    confirmLabel: { idle: "Delete task", pending: "Deleting…", checking: "Checking…" },
  };
}

/** Reset implementation keeps the plan and the current worktree, and discards build progress. */
export function buildTaskResetImplementationConfirmCopy(
  input: TaskResetImplementationCopyInput,
): TaskConfirmCopy {
  const changes = [
    "Remove Builder and QA session history",
    "Delete QA reports and remove the pull request link",
  ];
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
    title: "Reset implementation",
    description: `Move this task back to ${input.targetStatusLabel} and clear the implementation.`,
    subject: { id: input.taskId, title: input.taskTitle },
    tone: "destructive",
    changes,
    kept: [
      "Spec, plan and artifacts you added",
      ...(input.hasCanonicalWorktree ? ["Current worktree, its branch and ignored files"] : []),
    ],
    warning:
      input.hasCanonicalWorktree || input.legacyWorktreeCount > 0
        ? "Uncommitted and untracked work will be lost. Builder and QA history cannot be recovered."
        : "Builder and QA history cannot be recovered.",
    errors: readErrors(input.activeSessionCountError, input.impactError),
    confirmLabel: {
      idle: "Reset implementation",
      pending: "Resetting…",
      checking: "Checking…",
    },
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
  },
  copy: Pick<TaskConfirmCopy, "confirmLabel">,
): TaskConfirmControlState {
  const isBusy = state.isSubmitting || state.isLoadingImpact;
  let label = copy.confirmLabel.idle;
  if (state.isSubmitting) label = copy.confirmLabel.pending;
  else if (state.isLoadingImpact) label = copy.confirmLabel.checking;
  return { isBusy, disabled: isBusy || state.activeSessionCountError !== null, label };
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

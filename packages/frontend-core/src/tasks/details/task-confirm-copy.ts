import {
  formatActiveSessionStopLoadingMessage,
  formatActiveSessionStopMessage,
  formatCleanupImpactMessage,
  type TaskCleanupOperationLabel,
} from "./task-cleanup-impact-model";
import type { TaskConfirmImpact } from "./task-confirm-dialog-types";

/** One line of a confirmation. `error` lines show in the destructive text color. */
export type TaskConfirmCopyLine = { text: string; emphasis: boolean; error: boolean };

/** A part of a description. `emphasis` parts name the task or the status. */
export type TaskConfirmCopySegment = { text: string; emphasis: boolean };

/** The task that a confirmation names. The title is null when the task list lacks the task. */
export type TaskConfirmSubject = { id: string; title: string | null };

export type TaskConfirmCopy = {
  title: string;
  description: string;
  /** The description with the parts that a client can show with emphasis. */
  descriptionSegments: readonly TaskConfirmCopySegment[];
  tone: "warning" | "destructive";
  /** What the host keeps and removes, in display order. */
  lines: readonly TaskConfirmCopyLine[];
  /** The Confirm label while idle, while the action runs, and while the impact reads run. */
  confirmLabel: { idle: string; pending: string; checking: string };
};

/** The Reset Implementation impact that its confirmation describes. */
export type TaskResetImplementationCopyInput = {
  taskId: string;
  taskTitle: string;
  targetStatusLabel: string;
  activeSessionCount: number | null;
  activeSessionCountError: string | null;
  isLoadingImpact: boolean;
  hasCanonicalWorktree: boolean;
  hasManagedSessionCleanup: boolean;
  managedWorktreeCount: number;
  legacyWorktreeCount: number;
  terminalCount: number;
  impactError: string | null;
};

const CHECKING_LABEL = "Checking...";

const line = (text: string, emphasis = false): TaskConfirmCopyLine => ({
  text,
  emphasis,
  error: false,
});

const plainDescription = (description: string): readonly TaskConfirmCopySegment[] => [
  { text: description, emphasis: false },
];

const plural = (count: number, noun: string): string => `${noun}${count === 1 ? "" : "s"}`;

/**
 * A description that names the task by its title and its ID, as the user knows the title. The
 * title part has emphasis.
 */
const namedDescription = (
  before: string,
  task: TaskConfirmSubject,
  after: string,
): Pick<TaskConfirmCopy, "description" | "descriptionSegments"> => {
  if (task.title === null) {
    const description = `${before}${task.id}${after}`;
    return { description, descriptionSegments: plainDescription(description) };
  }
  const descriptionSegments = [
    { text: `${before}“`, emphasis: false },
    { text: task.title, emphasis: true },
    { text: `” (${task.id})${after}`, emphasis: false },
  ];
  return {
    description: descriptionSegments.map((segment) => segment.text).join(""),
    descriptionSegments,
  };
};

/** The active session line of a confirmation, or null when no active session stops. */
export const taskStopImpactLine = (
  count: number | null,
  error: string | null,
  operation: TaskCleanupOperationLabel,
): TaskConfirmCopyLine | null => {
  if (error !== null) {
    return {
      text: `Unable to check how many active sessions will be stopped: ${error}`,
      emphasis: false,
      error: true,
    };
  }
  if (count !== null && count > 0) return line(formatActiveSessionStopMessage(count, operation));
  return null;
};

const stopImpactLines = (
  impact: TaskConfirmImpact,
  operation: TaskCleanupOperationLabel,
): TaskConfirmCopyLine[] => {
  const lines: TaskConfirmCopyLine[] = [];
  const stopLine = taskStopImpactLine(
    impact.activeSessionCount,
    impact.activeSessionCountError,
    operation,
  );
  if (stopLine) lines.push(stopLine);
  if (impact.isLoadingStopImpact) {
    lines.push(line(formatActiveSessionStopLoadingMessage(operation)));
  }
  return lines;
};

const closeTerminalLine = (terminalCount: number): string => {
  if (terminalCount === 0) return "No running task terminals will be stopped.";
  return `${terminalCount} task ${plural(terminalCount, "terminal")}, including action terminals, will be stopped before the task closes.`;
};

/** The Close Task confirmation. It keeps the task record and removes task worktrees. */
export const buildTaskCloseConfirmCopy = (
  task: TaskConfirmSubject,
  impact: TaskConfirmImpact,
): TaskConfirmCopy => {
  return {
    title: "Close Task",
    ...namedDescription("Close ", task, " manually and move it to Done?"),
    tone: "warning",
    lines: [
      line(
        "This manual override moves the task to Done and bypasses unfinished workflow steps.",
        true,
      ),
      line("No code is merged and no pull request is created, updated, or merged."),
      line(closeTerminalLine(impact.terminalCount)),
      ...stopImpactLines(impact, "close"),
      line(
        formatCleanupImpactMessage(impact, "close") ??
          "Linked task worktrees and related local branches will be deleted when present. Any uncommitted changes in those worktrees will be lost.",
      ),
      line(
        "The task record, all artifacts, and linked history are retained. Free artifacts become read-only.",
      ),
    ],
    confirmLabel: { idle: "Close task", pending: "Closing...", checking: CHECKING_LABEL },
  };
};

/** The Reset Task confirmation. It keeps the task record and clears workflow artifacts. */
export const buildTaskResetConfirmCopy = (
  task: TaskConfirmSubject,
  impact: TaskConfirmImpact,
): TaskConfirmCopy => {
  const lines = [
    line("This action moves the task back to Backlog and keeps the task record itself.", true),
    line("All workflow and free artifacts will be removed."),
    line("Linked spec, planner, builder, and QA sessions will be removed."),
    line("Linked pull request and direct-merge metadata will be cleared."),
  ];
  if (impact.terminalCount > 0) {
    lines.push(
      line(
        `${impact.terminalCount} associated ${plural(impact.terminalCount, "terminal")} will be terminated before the task resets.`,
      ),
    );
  }
  lines.push(
    ...stopImpactLines(impact, "reset"),
    line(
      formatCleanupImpactMessage(impact, "reset") ??
        "Task-managed worktrees and related local branches will be deleted when present. Any uncommitted changes in those worktrees will be lost.",
    ),
  );
  return {
    title: "Reset Task",
    ...namedDescription(
      "Reset ",
      task,
      " back to Backlog? This permanently clears all task artifacts.",
    ),
    tone: "destructive",
    lines,
    confirmLabel: { idle: "Reset task", pending: "Resetting...", checking: CHECKING_LABEL },
  };
};

/** The Delete confirmation. Delete also removes the direct subtasks of the task. */
export const buildTaskDeleteConfirmCopy = (
  task: TaskConfirmSubject,
  impact: TaskConfirmImpact,
  subtasksCount: number,
): TaskConfirmCopy => {
  const hasSubtasks = subtasksCount > 0;
  const subtasks = hasSubtasks
    ? ` and its ${subtasksCount} direct ${plural(subtasksCount, "subtask")}`
    : "";
  const lines = [
    line("This action permanently removes the task and all its workflow and free artifacts.", true),
    line(
      hasSubtasks
        ? "Direct subtasks will also be deleted to avoid orphaned children in the workflow."
        : "Any descendant subtasks will also be deleted to avoid orphaned children.",
    ),
  ];
  if (impact.terminalCount > 0) {
    lines.push(
      line(
        `${impact.terminalCount} associated ${plural(impact.terminalCount, "terminal")} will be terminated before deletion.`,
      ),
    );
  }
  lines.push(...stopImpactLines(impact, "delete"));
  const cleanupMessage = formatCleanupImpactMessage(impact, "delete");
  if (cleanupMessage) lines.push(line(cleanupMessage));
  return {
    title: "Delete Task",
    ...namedDescription("Delete ", task, `${subtasks}? This cannot be undone.`),
    tone: "destructive",
    lines,
    confirmLabel: { idle: "Delete", pending: "Deleting...", checking: CHECKING_LABEL },
  };
};

const legacyCleanupMessage = (legacyWorktreeCount: number): string => {
  if (legacyWorktreeCount === 1) {
    return "1 legacy implementation worktree and its related local branch will be deleted. Any uncommitted changes in that worktree will be lost.";
  }
  return `${legacyWorktreeCount} legacy implementation worktrees and their related local branches will be deleted. Any uncommitted changes in those worktrees will be lost.`;
};

/**
 * The Reset Implementation confirmation. It keeps the canonical worktree, the branch, the spec,
 * and the plan, and removes Builder and QA progress.
 */
export const buildTaskResetImplementationConfirmCopy = (
  input: TaskResetImplementationCopyInput,
): TaskConfirmCopy => {
  const descriptionSegments: TaskConfirmCopySegment[] = [
    { text: "Reset the current implementation for ", emphasis: false },
    { text: input.taskTitle, emphasis: true },
    {
      text: ". Builder and QA progress for this task will be discarded and the task will move back to ",
      emphasis: false,
    },
    { text: input.targetStatusLabel, emphasis: true },
    { text: ".", emphasis: false },
  ];
  const lines = [line("This action removes Builder and QA session history for this task.", true)];
  const stopLine = taskStopImpactLine(
    input.activeSessionCount,
    input.activeSessionCountError,
    "reset",
  );
  if (stopLine) lines.push(stopLine);
  if (input.hasCanonicalWorktree) {
    lines.push(
      line(
        "The canonical task worktree and branch are retained. Tracked content is reset to the latest locally available base, ordinary untracked files are removed, and ignored files are preserved.",
      ),
    );
  }
  if (input.legacyWorktreeCount > 0) {
    lines.push(line(legacyCleanupMessage(input.legacyWorktreeCount)));
  }
  lines.push(
    line(
      input.hasCanonicalWorktree
        ? "Other related local task branches will be deleted if present."
        : "Related local task branches will be deleted if present.",
    ),
  );
  if (input.terminalCount > 0) {
    lines.push(
      line(
        `${input.terminalCount} associated ${plural(input.terminalCount, "terminal")} will be terminated before the implementation resets.`,
      ),
    );
  }
  lines.push(
    line(
      "QA report artifacts and linked pull request metadata will be cleared. Specification, Implementation Plan, and free artifacts are kept.",
    ),
    line(
      `Specs and implementation plans are kept. The task status will move back to ${input.targetStatusLabel}.`,
    ),
  );
  return {
    title: "Reset Implementation",
    description: descriptionSegments.map((segment) => segment.text).join(""),
    descriptionSegments,
    tone: "destructive",
    lines,
    confirmLabel: {
      idle: "Reset implementation",
      pending: "Resetting implementation…",
      checking: "Checking impact…",
    },
  };
};

/** The Confirm control of a confirmation: its label, and whether it waits or cannot run. */
export type TaskConfirmControlState = { isBusy: boolean; disabled: boolean; label: string };

/** The Confirm control of the Reset Implementation confirmation. */
export const taskResetImplementationConfirmState = (
  state: {
    isSubmitting: boolean;
    isLoadingImpact: boolean;
    activeSessionCountError: string | null;
  },
  copy: Pick<TaskConfirmCopy, "confirmLabel">,
): TaskConfirmControlState => {
  const isBusy = state.isSubmitting || state.isLoadingImpact;
  let label = copy.confirmLabel.idle;
  if (state.isSubmitting) label = copy.confirmLabel.pending;
  else if (state.isLoadingImpact) label = copy.confirmLabel.checking;
  return { isBusy, disabled: isBusy || state.activeSessionCountError !== null, label };
};

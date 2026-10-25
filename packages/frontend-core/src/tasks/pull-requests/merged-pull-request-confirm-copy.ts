/** The text of the confirmation that links a merged pull request and moves its task to Done. */
export const MERGED_PULL_REQUEST_CONFIRM_COPY = {
  title: "Attach merged PR and finish task?",
  description:
    "This branch is already merged. Linking the Pull Request will close the task and retire the builder worktree in one step.",
  cancelLabel: "Cancel",
  confirmLabel: "Link and mark done",
  confirmPendingLabel: "Linking merged PR...",
  taskHeading: "Task to mark done",
  pullRequestHeading: "Pull Request",
  mergedAtHeading: "Merged At",
  nextStepsHeading: "What happens next",
  nextSteps:
    "The task will be marked Done, then OpenDucktor will stop the task terminals and remove the builder worktree and local branch for this task.",
} as const;

const MERGED_AT_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** The merge time in the local date and time format, or the input when it is not a date. */
export const formatMergedAt = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return MERGED_AT_FORMATTER.format(parsed);
};

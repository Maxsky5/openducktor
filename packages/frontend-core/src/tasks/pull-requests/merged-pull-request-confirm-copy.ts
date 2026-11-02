/** The text of the confirmation that links a merged pull request and moves its task to Done. */
export const MERGED_PULL_REQUEST_CONFIRM_COPY = {
  title: "Link merged pull request?",
  description:
    "This pull request is already merged. Link it to this task and move the task to Done.",
  cancelLabel: "Cancel",
  confirmLabel: "Link and mark done",
  confirmPendingLabel: "Linking pull request…",
  taskHeading: "Task to mark done",
  pullRequestHeading: "Pull request",
  mergedAtHeading: "Merged",
  nextStepsHeading: "What happens next",
  nextSteps: "The task moves to Done, and OpenDucktor stops the task terminals and live sessions.",
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

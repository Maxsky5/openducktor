/** Pending input labels that both clients show. Icons and colors stay in each client. */
export const PENDING_INPUT_LABELS = {
  permissionTitle: "Approval required",
  questionTitle: "Input needed",
  subagentRequest: "Subagent request",
  permissionStatus: "Action required",
  submittingApproval: "Submitting approval choice…",
  submittingAnswers: "Submitting answers…",
} as const;

/** The answered count of a Structured Question, such as "1/3 answered". */
export const questionAnsweredStatus = (answeredCount: number, questionCount: number): string =>
  `${answeredCount}/${questionCount} answered`;

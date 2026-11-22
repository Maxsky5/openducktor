import { isAgentSessionActivityWorking } from "@openducktor/frontend-core/lib/agent-session-activity-state";
import type { WorkflowStepPresentation } from "@openducktor/frontend-core/types/agent-workflow";
import type { IconName } from "@/ui/icon-names";

/** One state mark of a workflow step. The spinner moves; the icons stay still. */
export type WorkflowStepMark = IconName | "spinner";

/** The mark of the workflow state, as the desktop `WorkflowToneMark` and attention mark. */
const toneMark = ({ tone, liveSession }: WorkflowStepPresentation): WorkflowStepMark | null => {
  if (tone === "done") return "check";
  if (liveSession === "waiting_input") return "circle-dashed";
  if (tone === "in_progress") {
    return liveSession !== "none" && isAgentSessionActivityWorking(liveSession)
      ? "spinner"
      : "circle-dot-dashed";
  }
  if (tone === "available") return "circle";
  if (tone === "optional") return "circle-dashed";
  if (tone === "rejected" || tone === "failed") return "triangle-alert";
  // A Builder step that waits for the user marks a blocked task.
  if (tone === "waiting_input") return "triangle-alert";
  return null;
};

/**
 * The state marks after the label, as the desktop `WorkflowStepContent`. The workflow state and
 * the session state are separate: a done step, such as a Builder in AI review, can still wait on
 * background tasks, so it shows the still hourglass beside its check. An in-progress step shows
 * the hourglass in place of its mark.
 */
export const workflowStepMarks = (state: WorkflowStepPresentation): WorkflowStepMark[] => {
  if (state.waitingOnBackground && state.tone === "in_progress") return ["hourglass"];
  const mark = toneMark(state);
  const marks: WorkflowStepMark[] = mark ? [mark] : [];
  if (state.waitingOnBackground) marks.push("hourglass");
  return marks;
};

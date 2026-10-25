import type { WorkflowCondition, WorkflowEventGuard } from "@openducktor/contracts";
import type { BuiltinStateId } from "./ids";

const optionalPlanning = {
  any: [
    { fact: "issueType", equals: "task" },
    { fact: "issueType", equals: "bug" },
  ],
} satisfies WorkflowCondition;
export const requiredPlanning = { not: optionalPlanning } satisfies WorkflowCondition;
export const nonClosed = { not: { stateIn: ["closed"] } } satisfies WorkflowCondition;
export const humanReview = {
  stateIn: ["ai_review", "human_review"] satisfies BuiltinStateId[],
} satisfies WorkflowCondition;
export const activeOrReview = {
  stateIn: ["in_progress", "blocked", "ai_review", "human_review"] satisfies BuiltinStateId[],
} satisfies WorkflowCondition;
const readyForDevOrLater = {
  stateIn: [
    "ready_for_dev",
    "in_progress",
    "blocked",
    "ai_review",
    "human_review",
  ] satisfies BuiltinStateId[],
} satisfies WorkflowCondition;
export const planningAvailable = {
  any: [
    { stateIn: ["spec_ready"] },
    readyForDevOrLater,
    { all: [{ stateIn: ["open"] }, optionalPlanning] },
  ],
} satisfies WorkflowCondition;
export const buildAvailable = {
  all: [nonClosed, { any: [optionalPlanning, readyForDevOrLater] }],
} satisfies WorkflowCondition;
export const qaAvailable = {
  stateIn: ["blocked", "ai_review", "human_review"] satisfies BuiltinStateId[],
} satisfies WorkflowCondition;
export const specPresent = { artifact: "spec", present: true } satisfies WorkflowCondition;
export const planPresent = { artifact: "plan", present: true } satisfies WorkflowCondition;
export const qaApproved = { artifact: "qaReport", verdict: "approved" } satisfies WorkflowCondition;
export const qaRejected = {
  all: [{ stateIn: ["in_progress", "blocked"] }, { artifact: "qaReport", verdict: "rejected" }],
} satisfies WorkflowCondition;

export const PLANNING_COMPLETE_GUARD = "planning-complete";
export const SPEC_COMPLETE_GUARD = "spec-complete";

/** Feature work enters in_progress only after planning. */
export const planningComplete = {
  id: PLANNING_COMPLETE_GUARD,
  when: { any: [optionalPlanning, readyForDevOrLater] },
  message: "Complete required planning first",
} satisfies WorkflowEventGuard;
/** Feature work leaves open only through a spec. */
export const specComplete = {
  id: SPEC_COMPLETE_GUARD,
  when: { any: [{ not: { stateIn: ["open"] } }, optionalPlanning] },
  message: "Complete required planning first",
} satisfies WorkflowEventGuard;

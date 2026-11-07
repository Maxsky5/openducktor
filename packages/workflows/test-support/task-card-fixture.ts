import type { TaskCard } from "@openducktor/contracts";
import {
  specPlanBuildWorkflow,
  SPEC_PLAN_BUILD_BOARD,
} from "../src/builtin/spec-plan-build/workflow";
import type { ResolvedTaskCard } from "../src/task-workflow-view";
import { createWorkflowTaskCardFixture } from "./shared-board-workflows";

/** A built-in task card with the workflow projection of its fields. Explicit fields win. */
export const createTaskCardFixture = (overrides: Partial<TaskCard> = {}): ResolvedTaskCard =>
  createWorkflowTaskCardFixture(specPlanBuildWorkflow, SPEC_PLAN_BUILD_BOARD, {
    id: "task-1",
    title: "Task 1",
    issueType: "task",
    status: "open",
    updatedAt: "2026-02-22T12:00:00.000Z",
    createdAt: "2026-02-22T12:00:00.000Z",
    ...overrides,
  });

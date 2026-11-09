import { specPlanBuildWorkflow, EMPTY_PROMPT_SETTINGS } from "@openducktor/workflows";
import { Effect } from "effect";
import type { createSessionTurnPreparation } from "../session-turn-preparation";

/** Policy and context fixture for tests of command sequencing, not catalog decisions. */
export const commandPreparationFixture: ReturnType<typeof createSessionTurnPreparation> = {
  context: (target) =>
    Effect.succeed(target.sessionScope.kind === "workflow" ? "Current host context" : undefined),
  taskWorkflow: () => Effect.succeed(specPlanBuildWorkflow),
  promptSettings: () => Effect.succeed(EMPTY_PROMPT_SETTINGS),
  model: (_target, selection) => Effect.succeed(selection),
};

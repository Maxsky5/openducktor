import { builtinTaskWorkflow } from "@openducktor/workflows";
import { Effect } from "effect";
import type { createSessionTurnPreparation } from "../session-turn-preparation";

/** Policy and context fixture for tests of command sequencing, not catalog decisions. */
export const commandPreparationFixture: ReturnType<typeof createSessionTurnPreparation> = {
  context: (target) =>
    Effect.succeed(target.sessionScope.kind === "workflow" ? "Current host context" : undefined),
  taskWorkflow: () => Effect.succeed(builtinTaskWorkflow),
  promptOverrides: () => Effect.succeed({}),
  model: (_target, selection) => Effect.succeed(selection),
};

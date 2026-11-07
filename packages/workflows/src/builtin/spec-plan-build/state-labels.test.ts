import { describe, expect, test } from "bun:test";
import { SPEC_PLAN_BUILD_DEFINITION } from "./definition";

describe("Spec, Plan, Build state labels", () => {
  test.each(SPEC_PLAN_BUILD_DEFINITION.states.map((state) => [state.id, state] as const))(
    "gives %s a short label that is its label or the first word of it",
    (_id, state) => {
      const shortLabel = ("shortLabel" in state ? state.shortLabel : undefined) ?? state.label;
      expect([state.label, state.label.split(" ")[0]]).toContain(shortLabel);
    },
  );
});

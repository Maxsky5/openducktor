import { describe, expect, test } from "bun:test";
import { SPEC_PLAN_BUILD_DEFINITION } from "./definition";

describe("Spec, Plan, Build state labels", () => {
  test("give a short label only to a long state, so every surface uses the same words", () => {
    const shortLabels = SPEC_PLAN_BUILD_DEFINITION.states.flatMap((state) =>
      "shortLabel" in state && state.shortLabel ? [[state.id, state.shortLabel]] : [],
    );
    expect(shortLabels).toEqual([["blocked", "Blocked"]]);
  });
});

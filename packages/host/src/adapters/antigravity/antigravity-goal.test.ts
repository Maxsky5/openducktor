import { describe, expect, test } from "bun:test";
import {
  pendingAntigravityGoalMarkerLength,
  readAntigravityGoalObjective,
  stripAntigravityGoalMarkers,
} from "./antigravity-goal";

describe("Antigravity goal text", () => {
  test("reads the objective of a /goal message only", () => {
    expect(readAntigravityGoalObjective("/goal Make the tests pass")).toBe("Make the tests pass");
    expect(readAntigravityGoalObjective("  /goal\nShip it ")).toBe("Ship it");
    expect(readAntigravityGoalObjective("/goal")).toBeNull();
    expect(readAntigravityGoalObjective("/goals list")).toBeNull();
    expect(readAntigravityGoalObjective("Set a /goal for me")).toBeNull();
  });

  test("removes the goal markers and reports their ends in text order", () => {
    expect(
      stripAntigravityGoalMarkers("Done.\n<!-- GOAL_CANCELLED --> then <!-- GOAL_COMPLETE -->"),
    ).toEqual({ text: "Done.\n then ", ends: ["cancelled", "met"] });
    expect(stripAntigravityGoalMarkers("No marker")).toEqual({ text: "No marker", ends: [] });
  });

  test("holds back an end of the text that can still grow into a marker", () => {
    expect(pendingAntigravityGoalMarkerLength("Done <!-- GOAL_")).toBe("<!-- GOAL_".length);
    expect(pendingAntigravityGoalMarkerLength("Done <")).toBe(1);
    expect(pendingAntigravityGoalMarkerLength("Done <!-- note")).toBe(0);
    expect(pendingAntigravityGoalMarkerLength("Done")).toBe(0);
  });
});

import { describe, expect, test } from "bun:test";
import type { AutopilotSettings } from "@openducktor/contracts";
import { getAutopilotSelectedValue, setAutopilotRuleAction } from "./autopilot-catalog";

const createAutopilotSettings = (): AutopilotSettings => ({
  rules: [
    {
      eventId: "taskProgressedToSpecReady",
      actionIds: ["startPlanner", "startBuilder"],
    },
    {
      eventId: "taskProgressedToReadyForDev",
      actionIds: [],
    },
    {
      eventId: "taskProgressedToAiReview",
      actionIds: [],
    },
    {
      eventId: "taskRejectedByQa",
      actionIds: [],
    },
    {
      eventId: "taskProgressedToHumanReview",
      actionIds: [],
    },
  ],
});

describe("autopilot-catalog", () => {
  test("preserves secondary actions when updating the selected action", () => {
    const nextSettings = setAutopilotRuleAction(
      createAutopilotSettings(),
      "taskProgressedToSpecReady",
      "startBuilder",
    );

    expect(nextSettings.rules[0]).toEqual({
      eventId: "taskProgressedToSpecReady",
      actionIds: ["startBuilder", "startPlanner"],
    });
    const updatedRule = nextSettings.rules[0];
    expect(updatedRule).toBeDefined();
    if (!updatedRule) {
      throw new Error("Expected spec-ready Autopilot rule to exist.");
    }
    expect(getAutopilotSelectedValue(updatedRule)).toBe("startBuilder");
  });

  test("returns the original settings object when the selected action is unchanged", () => {
    const settings = createAutopilotSettings();

    expect(setAutopilotRuleAction(settings, "taskProgressedToSpecReady", "startPlanner")).toBe(
      settings,
    );
  });
});

import { describe, expect, test } from "bun:test";
import type { AutopilotSettings } from "@openducktor/contracts";
import { getAutopilotSelectedValue, setAutopilotRuleAction } from "./autopilot-catalog";

const createAutopilotSettings = (): AutopilotSettings => ({
  alwaysStartQaReviewsFresh: false,
  rules: [
    {
      workflowId: "openducktor",
      eventId: "taskProgressedToSpecReady",
      actionIds: ["startPlanner", "startBuilder"],
    },
    {
      workflowId: "openducktor",
      eventId: "taskProgressedToReadyForDev",
      actionIds: [],
    },
    {
      workflowId: "openducktor",
      eventId: "taskProgressedToAiReview",
      actionIds: [],
    },
    {
      workflowId: "openducktor",
      eventId: "taskRejectedByQa",
      actionIds: [],
    },
    {
      workflowId: "openducktor",
      eventId: "taskProgressedToHumanReview",
      actionIds: [],
    },
  ],
});

describe("autopilot-catalog", () => {
  test("a built-in rule edit keeps another workflow's matching local IDs", () => {
    const settings = createAutopilotSettings();
    const foreign = {
      workflowId: "other",
      eventId: "taskProgressedToSpecReady",
      actionIds: ["startQa"],
    };
    expect(getAutopilotSelectedValue(foreign)).toBe("disabled");
    settings.rules.unshift(foreign);
    const updated = setAutopilotRuleAction(settings, "taskProgressedToSpecReady", "startBuilder");
    expect(updated.rules.find((rule) => rule.workflowId === "other")).toEqual(foreign);
    expect(
      updated.rules.find(
        (rule) => rule.workflowId === "openducktor" && rule.eventId === foreign.eventId,
      )?.actionIds,
    ).toEqual(["startBuilder", "startPlanner"]);
  });
  test("preserves secondary actions when updating the selected action", () => {
    const nextSettings = setAutopilotRuleAction(
      createAutopilotSettings(),
      "taskProgressedToSpecReady",
      "startBuilder",
    );

    expect(nextSettings.rules[0]).toEqual({
      workflowId: "openducktor",
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

  test("preserves default-backed rules when updating a partial settings payload", () => {
    const nextSettings = setAutopilotRuleAction(
      {
        alwaysStartQaReviewsFresh: false,
        rules: [
          {
            workflowId: "openducktor",
            eventId: "taskProgressedToSpecReady",
            actionIds: ["startPlanner"],
          },
        ],
      },
      "taskProgressedToSpecReady",
      "startBuilder",
    );

    expect(nextSettings.rules).toHaveLength(5);
    expect(nextSettings.rules[1]).toEqual({
      workflowId: "openducktor",
      eventId: "taskProgressedToReadyForDev",
      actionIds: [],
    });
    expect(nextSettings.alwaysStartQaReviewsFresh).toBe(false);
  });
});

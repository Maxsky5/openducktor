import { describe, expect, test } from "bun:test";
import type { AutopilotSettings } from "@openducktor/contracts";
import { getAutopilotSelectedValue, setAutopilotRuleAction } from "./autopilot-catalog";

const createAutopilotSettings = (): AutopilotSettings => ({
  alwaysStartQaReviewsFresh: false,
  rules: [
    {
      workflowId: "openducktor-research-plan-implement",
      eventId: "taskProgressedToSpecReady",
      actionIds: ["startPlanner", "startBuilder"],
    },
    {
      workflowId: "openducktor-research-plan-implement",
      eventId: "taskProgressedToReadyForDev",
      actionIds: [],
    },
    {
      workflowId: "openducktor-research-plan-implement",
      eventId: "taskProgressedToAiReview",
      actionIds: [],
    },
    {
      workflowId: "openducktor-research-plan-implement",
      eventId: "taskRejectedByQa",
      actionIds: [],
    },
    {
      workflowId: "openducktor-research-plan-implement",
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
    expect(getAutopilotSelectedValue(foreign)).toBe("action:startQa");
    settings.rules.unshift(foreign);
    const updated = setAutopilotRuleAction(
      settings,
      "openducktor-research-plan-implement",
      "taskProgressedToSpecReady",
      "action:startBuilder",
    );
    expect(updated.rules.find((rule) => rule.workflowId === "other")).toEqual(foreign);
    expect(
      updated.rules.find(
        (rule) =>
          rule.workflowId === "openducktor-research-plan-implement" &&
          rule.eventId === foreign.eventId,
      )?.actionIds,
    ).toEqual(["startBuilder", "startPlanner"]);
  });
  test("preserves secondary actions when updating the selected action", () => {
    const nextSettings = setAutopilotRuleAction(
      createAutopilotSettings(),
      "openducktor-research-plan-implement",
      "taskProgressedToSpecReady",
      "action:startBuilder",
    );

    expect(nextSettings.rules[0]).toEqual({
      workflowId: "openducktor-research-plan-implement",
      eventId: "taskProgressedToSpecReady",
      actionIds: ["startBuilder", "startPlanner"],
    });
    const updatedRule = nextSettings.rules[0];
    expect(updatedRule).toBeDefined();
    if (!updatedRule) {
      throw new Error("Expected spec-ready Autopilot rule to exist.");
    }
    expect(getAutopilotSelectedValue(updatedRule)).toBe("action:startBuilder");
  });

  test("returns the original settings object when the selected action is unchanged", () => {
    const settings = createAutopilotSettings();

    expect(
      setAutopilotRuleAction(
        settings,
        "openducktor-research-plan-implement",
        "taskProgressedToSpecReady",
        "action:startPlanner",
      ),
    ).toBe(settings);
  });

  test("preserves only the supplied rules when updating a partial settings payload", () => {
    const nextSettings = setAutopilotRuleAction(
      {
        alwaysStartQaReviewsFresh: false,
        rules: [
          {
            workflowId: "openducktor-research-plan-implement",
            eventId: "taskProgressedToSpecReady",
            actionIds: ["startPlanner"],
          },
        ],
      },
      "openducktor-research-plan-implement",
      "taskProgressedToSpecReady",
      "action:startBuilder",
    );

    expect(nextSettings.rules).toEqual([
      {
        workflowId: "openducktor-research-plan-implement",
        eventId: "taskProgressedToSpecReady",
        actionIds: ["startBuilder", "startPlanner"],
      },
    ]);
    expect(nextSettings.alwaysStartQaReviewsFresh).toBe(false);
  });
});

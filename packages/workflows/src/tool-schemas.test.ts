import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { reviewTaskDefinition } from "../test-support/review-task-workflow";
import { createWorkflow } from "./evaluate";
import { builtinWorkflow } from "./builtin/definition";
import { workflowToolInputSchema } from "./tool-schemas";

const inputProperties = (schema: z.ZodType) =>
  z
    .object({ properties: z.record(z.string(), z.unknown()) })
    .parse(z.toJSONSchema(schema, { io: "input" })).properties;

describe("workflowToolInputSchema", () => {
  test("lists the issue types and active states of the workflow", () => {
    const properties = inputProperties(
      workflowToolInputSchema(builtinWorkflow.definition, "odt_search_tasks"),
    );

    expect(properties.issueType).toEqual({ type: "string", enum: ["task", "feature", "bug"] });
    expect(properties.status).toMatchObject({
      enum: [
        "open",
        "spec_ready",
        "ready_for_dev",
        "in_progress",
        "blocked",
        "ai_review",
        "human_review",
      ],
    });
  });

  test("names the issue types and active states of another task workflow", () => {
    const properties = inputProperties(
      workflowToolInputSchema(
        createWorkflow(reviewTaskDefinition()).definition,
        "odt_search_tasks",
      ),
    );

    expect(properties.issueType).toMatchObject({ enum: ["article", "fix"] });
    expect(properties.status).toMatchObject({
      enum: ["backlog", "writing", "paused", "reviewing", "approval"],
    });
  });
});

import { describe, expect, test } from "bun:test";
import { KICKOFF, TASK_ID } from "./sample/studio";
import { QA_KICKOFF } from "./scenes/prompts/sample";
import { importProduct } from "./test-support/product-source";

type BuiltinPrompt = {
  id: string;
  ownerKind: "role" | "workflow";
  template: string;
};

// SAFETY: The product returns records with these prompt fields.
const { listSpecPlanBuildPromptTemplates } = await importProduct<{
  listSpecPlanBuildPromptTemplates: () => BuiltinPrompt[];
}>("packages/workflows/src/builtin/spec-plan-build/agent-prompts.ts");
const prompts = listSpecPlanBuildPromptTemplates();

/** The built-in workflow prompt with its placeholders. */
function template(id: string): string {
  const prompt = prompts.find((entry) => entry.ownerKind === "workflow" && entry.id === id);
  if (prompt === undefined) throw new Error(`The product has no built-in prompt ${id}.`);
  return prompt.template;
}

/** The built-in prompt with the placeholder values of the sample task. */
function builtin(id: string): string {
  return template(id)
    .replaceAll("{{task.id}}", TASK_ID)
    .replaceAll("{{git.targetBranch}}", "origin/main");
}

describe("prompts copied from the product", () => {
  test("the session kickoff messages are the built-in kickoff prompts", () => {
    expect(KICKOFF.spec).toBe(builtin("messages.spec_start"));
    expect(KICKOFF.planner).toBe(builtin("messages.plan_start"));
    expect(KICKOFF.build).toBe(builtin("messages.build_start"));
    expect(KICKOFF.qa).toBe(builtin("messages.qa_review"));
    expect(KICKOFF.fix).toBe(builtin("messages.build_after_qa_rejection"));
    expect(KICKOFF.pullRequest).toBe(builtin("messages.pull_request"));
  });

  test("the prompts view shows the built-in QA Kickoff prompt", () => {
    expect(QA_KICKOFF).toBe(template("messages.qa_review"));
  });
});

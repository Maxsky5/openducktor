import { describe, expect, test } from "bun:test";
import { KICKOFF, TASK_ID } from "./sample/studio";
import { taskId } from "./sample/workspace";
import { KICKOFF_MESSAGE, TASK as QUESTION_TASK } from "./scenes/mobile-question/sample";
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

/**
 * The built-in prompt with the placeholder values of the sample task. The base branch of a pull
 * request is the name of the target branch without its remote, as requirePullRequestTarget of
 * task-prompts.ts gives it.
 */
function builtin(id: string): string {
  return template(id).replaceAll("{{task.id}}", TASK_ID).replaceAll("{{git.targetBranch}}", "main");
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

  test("the Spec session of the mobile question scene starts with the built-in kickoff", () => {
    expect(KICKOFF_MESSAGE.text).toBe(
      template("messages.spec_start").replaceAll("{{task.id}}", taskId(QUESTION_TASK)),
    );
  });

  test("the prompts view shows the built-in QA Kickoff prompt", () => {
    expect(QA_KICKOFF).toBe(template("messages.qa_review"));
  });
});

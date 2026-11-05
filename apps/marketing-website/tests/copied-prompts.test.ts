import { describe, expect, test } from "bun:test";
import { QA_BASE_AFTER, QA_BASE_BEFORE, QA_KICKOFF } from "../src/sample/prompts";
import { KICKOFF, TASK_ID } from "../src/sample/studio";

type BuiltinPrompt = {
  id: string;
  ownerKind: "role" | "workflow";
  roleIds?: string[];
  template: string;
};

// The import is dynamic, so the site type check does not check the product source.
const promptsModule = new URL(
  "../../../packages/workflows/src/builtin/spec-plan-build/agent-prompts.ts",
  import.meta.url,
).href;
// SAFETY: The product returns records with these prompt fields.
const { listSpecPlanBuildPromptTemplates } = (await import(promptsModule)) as {
  listSpecPlanBuildPromptTemplates: () => BuiltinPrompt[];
};
const prompts = listSpecPlanBuildPromptTemplates();

/** The built-in workflow prompt with its placeholders. */
function template(id: string): string {
  const prompt = prompts.find((entry) => entry.ownerKind === "workflow" && entry.id === id);
  if (prompt === undefined) throw new Error(`The product has no built-in prompt ${id}.`);
  return prompt.template;
}

/** The system prompt of a built-in role. */
function rolePrompt(role: string): string {
  const prompt = prompts.find(
    (entry) => entry.ownerKind === "role" && entry.roleIds?.includes(role) === true,
  );
  if (prompt === undefined) throw new Error(`The product has no built-in role ${role}.`);
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
    expect(KICKOFF.pullRequest).toBe(builtin("messages.build_pull_request"));
  });

  test("the prompt override view shows the built-in QA prompts", () => {
    expect(QA_BASE_BEFORE + QA_BASE_AFTER).toBe(rolePrompt("qa"));
    expect(QA_KICKOFF).toBe(template("messages.qa_review"));
  });
});

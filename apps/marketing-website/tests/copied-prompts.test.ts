import { describe, expect, test } from "bun:test";
import { QA_BASE_AFTER, QA_BASE_BEFORE, QA_KICKOFF } from "../src/sample/prompts";
import { KICKOFF, TASK_ID } from "../src/sample/studio";

type BuiltinPrompt = { id: string; template: string };

// The import is dynamic, so the site type check does not check the product source.
const promptsModule = new URL(
  "../../../packages/core/src/services/agent-system-prompts.ts",
  import.meta.url,
).href;
// SAFETY: agent-system-prompts.ts exports this function, and a missing export fails the test.
const { listBuiltinAgentPromptTemplates } = (await import(promptsModule)) as {
  listBuiltinAgentPromptTemplates: () => BuiltinPrompt[];
};
const templates = new Map(
  listBuiltinAgentPromptTemplates().map(({ id, template }) => [id, template]),
);

/** The built-in prompt template with its placeholders. */
function template(id: string): string {
  const text = templates.get(id);
  if (text === undefined) throw new Error(`The product has no built-in prompt ${id}.`);
  return text;
}

/** The built-in prompt with the placeholder values of the sample task. */
function builtin(id: string): string {
  return template(id)
    .replaceAll("{{task.id}}", TASK_ID)
    .replaceAll("{{git.targetBranch}}", "origin/main");
}

describe("prompts copied from the product", () => {
  test("the Agent Studio kickoff messages are the built-in kickoff prompts", () => {
    expect(KICKOFF.spec).toBe(builtin("kickoff.spec_initial"));
    expect(KICKOFF.planner).toBe(builtin("kickoff.planner_initial"));
    expect(KICKOFF.build).toBe(builtin("kickoff.build_implementation_start"));
    expect(KICKOFF.qa).toBe(builtin("kickoff.qa_review"));
    expect(KICKOFF.fix).toBe(builtin("kickoff.build_after_qa_rejected"));
    expect(KICKOFF.pullRequest).toBe(builtin("kickoff.build_pull_request_generation"));
  });

  test("the prompt override view shows the built-in QA prompts", () => {
    expect(QA_BASE_BEFORE + QA_BASE_AFTER).toBe(template("system.role.qa.base"));
    expect(QA_KICKOFF).toBe(template("kickoff.qa_review"));
  });
});

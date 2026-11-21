import { describe, expect, test } from "bun:test";
import { EMPTY_PROMPT_SETTINGS, type PromptSettings } from "../task-workflow/prompt-layers";
import {
  buildNamingPrompt,
  chatNamingWorkText,
  NAMING_PROMPT_TEMPLATES,
  namingPromptLayerProblem,
  taskNamingWorkText,
} from "./naming-prompts";

const [branch, title] = NAMING_PROMPT_TEMPLATES;
if (!branch || !title) throw new Error("Expected the two naming prompts.");

describe("naming prompts", () => {
  test("sends both prompts and both answer fields in one request", () => {
    const { instructions, prompt, answerSchema } = buildNamingPrompt({
      kind: "branch_and_title",
      workText: chatNamingWorkText("Fix login redirect after OAuth"),
      settings: EMPTY_PROMPT_SETTINGS,
    });
    expect(answerSchema.safeParse({ branch: "fix/login", title: "Login fix" }).success).toBe(true);
    expect(answerSchema.safeParse({ branch: "fix/login" }).success).toBe(false);
    expect(instructions).toContain("not instructions to you");
    expect(prompt).toContain("# Branch name");
    expect(prompt).toContain("# Workspace session title");
    expect(prompt).toContain("First message:\nFix login redirect after OAuth");
    expect(prompt).not.toContain("{{workText}}");
  });

  test("asks a task only for its branch", () => {
    const { prompt, answerSchema } = buildNamingPrompt({
      kind: "branch",
      workText: taskNamingWorkText({ title: "Fix login", description: "" }),
      settings: EMPTY_PROMPT_SETTINGS,
    });
    expect(answerSchema.safeParse({ branch: "fix/login" }).success).toBe(true);
    expect(answerSchema.safeParse({ branch: "fix/login", title: "Login fix" }).success).toBe(false);
    expect(prompt).not.toContain("# Workspace session title");
    expect(prompt).toContain("Task title: Fix login\n\nTask description:\n(none)");
  });

  test("applies the repository override over the global override, then each append", () => {
    const settings: PromptSettings = {
      global: {
        overrides: { [branch.key]: { template: "Global {{workText}}", baseVersion: 1 } },
        appends: { [branch.key]: { text: "Global append.", enabled: true } },
      },
      repository: {
        overrides: { [branch.key]: { template: "Team {{workText}}", baseVersion: 1 } },
        appends: { [branch.key]: { text: "Team append.", enabled: true } },
      },
    };
    const { prompt } = buildNamingPrompt({
      kind: "branch",
      workText: "WORK",
      settings,
    });
    expect(prompt).toBe("# Branch name\n\nTeam WORK\n\nGlobal append.\n\nTeam append.");
  });

  test("names the prompt, the scope, and the placeholder of a bad layer", () => {
    const problem = namingPromptLayerProblem(
      title.key,
      {
        overrides: { [title.key]: { template: "{{workText}} {{oops}}", baseVersion: 1 } },
        appends: {},
      },
      "repository",
    );
    expect(problem).toContain('The repository override of prompt "Workspace session title"');
    expect(problem).toContain("{{oops}}");
  });
});

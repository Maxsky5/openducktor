import { describe, expect, test } from "bun:test";
import type { WorkflowDocument, WorkflowVersionDocument } from "@openducktor/contracts";
import { BUILTIN_ROLES } from "../builtin/roles/roles";
import { specPlanBuildWorkflow } from "../builtin/spec-plan-build/workflow";
import { createTaskWorkflow } from "../task-workflow/task-workflow";
import { withBuiltinSharedFields } from "./builtin-shared-fields";
import {
  checkWorkflowDocument,
  checkWorkflowRole,
  roleFromInput,
  roleInputOf,
  type WorkflowCheckContext,
} from "./checks";
import {
  builtinWorkflowDocument,
  definitionOfDocument,
  idFromLabel,
  newWorkflowDocument,
  nextVersionPrompts,
  promptTemplatesOfDocument,
} from "./documents";
import { renameWorkflowElement, workflowReferenceIndex } from "./references";

const context: WorkflowCheckContext = {
  roles: BUILTIN_ROLES,
  otherWorkflows: [],
  takenWorkflowIds: new Set([specPlanBuildWorkflow.definition.id]),
};

const withReview = (): WorkflowDocument => {
  const document = newWorkflowDocument("review-flow", "Review flow");
  document.definition.states.splice(1, 0, { id: "in_review", label: "In review" });
  document.definition.events.push({
    id: "submit",
    from: ["open"],
    guards: [],
    outcomes: [{ when: true, to: "in_review" }],
  });
  document.layout.states.in_review = { x: 10, y: 20 };
  return document;
};

const errors = (document: WorkflowDocument, checkContext = context) =>
  checkWorkflowDocument(document, checkContext).filter(({ severity }) => severity === "error");

describe("workflow documents", () => {
  test("a new workflow is ready to publish and compiles as a task workflow", () => {
    const document = newWorkflowDocument("my-flow", "My flow");
    // A new workflow can publish; it only reminds the user to draw the first transition.
    expect(checkWorkflowDocument(document, context)).toEqual([
      {
        severity: "warning",
        path: ["definition", "states", 0],
        message:
          'No transition leaves "Backlog", so its tasks move only when someone closes them. Draw a transition from "Backlog" to the next state.',
      },
    ]);
    const workflow = createTaskWorkflow(
      withBuiltinSharedFields(definitionOfDocument(document, 1)),
      promptTemplatesOfDocument(document.prompts),
      BUILTIN_ROLES,
    );
    expect(workflow.issueTypes).toEqual(["feature", "bug", "task"]);
  });

  test("the built-in workflow document has no problem when its ID is free", () => {
    expect(
      checkWorkflowDocument(builtinWorkflowDocument(), { ...context, takenWorkflowIds: new Set() }),
    ).toEqual([]);
  });

  test("lists every problem, not only the first, with paths in the document", () => {
    const document = withReview();
    document.definition.events[0]!.outcomes[0]!.to = "missing";
    document.definition.pullRequestRoles = ["ghost"];
    document.definition.id = specPlanBuildWorkflow.definition.id;
    const problems = errors(document);
    expect(problems.map(({ path }) => path)).toEqual([
      ["definition", "pullRequestRoles", 0],
      ["definition", "events", 0, "outcomes", 0, "to"],
      ["definition", "id"],
    ]);
    expect(problems[1]!.message).toBe(
      'Branch 1 of transition "submit" uses the missing state "missing". Add it or pick another state.',
    );
  });

  test("warns about a state that no event reaches from open", () => {
    const document = withReview();
    document.definition.events = [];
    expect(checkWorkflowDocument(document, context).filter(({ path }) => path[2] === 1)).toEqual([
      {
        severity: "warning",
        path: ["definition", "states", 1],
        message:
          'Tasks cannot reach "In review" from "Backlog". Draw a transition to it, or delete the state.',
      },
    ]);
  });

  test("warns about an event that nothing triggers until a board button sends it", () => {
    const document = withReview();
    const warnings = () =>
      checkWorkflowDocument(document, context).filter(({ severity }) => severity === "warning");
    expect(warnings()).toEqual([
      {
        severity: "warning",
        path: ["definition", "events", 0],
        message:
          'Nothing triggers the transition from "Backlog" to "In review", so it never moves a task. Add a board button for it, or let agents send it.',
      },
    ]);
    document.definition.actions.push({
      id: "submit",
      label: "Submit",
      kind: "event",
      eventId: "submit",
      availableWhen: true,
    });
    expect(warnings()).toEqual([]);
  });

  test("warns about a prompt that no way to start sends", () => {
    const document = withReview();
    document.prompts.push({
      id: "messages.unused",
      purpose: "message",
      label: "Unused",
      description: "",
      template: "Continue task {{task.id}}.",
    });
    expect(
      checkWorkflowDocument(document, context).filter(({ path }) => path[0] === "prompts"),
    ).toEqual([
      {
        severity: "warning",
        path: ["prompts", document.prompts.length - 1],
        message:
          'No way to start sends the prompt "Unused". Pick it in a way to start, or delete it.',
      },
    ]);
  });

  test("checks the role catalog: unknown roles and the workflow event tool", () => {
    const document = withReview();
    document.definition.roles = [
      { id: "spec", writes: [] },
      { id: "ghost", writes: [] },
    ];
    document.definition.events[0]!.agent = {
      roles: ["spec"],
      description: "Submit.",
      note: "optional",
    };
    expect(errors(document).map(({ message }) => message)).toEqual([
      'Role "spec" can trigger "submit", but it lacks the "Move the task" tool. Give it that tool, or remove the role from the agents of these transitions.',
      'Role "ghost" does not exist. Create it, or swap it for another role.',
    ]);
  });

  test("compares shared states with the other custom workflows, except built-in state IDs", () => {
    const other = withBuiltinSharedFields(definitionOfDocument(withReview(), 1));
    other.id = "other";
    other.label = "Other";
    const document = withReview();
    document.definition.states[1]!.label = "Reviewing";
    document.definition.states[0]!.label = "Anything";
    const problems = errors(document, { ...context, otherWorkflows: [other] });
    expect(problems).toEqual([
      {
        severity: "error",
        path: ["definition", "states", 1, "label"],
        message:
          'State "in_review" has another name in workflow "Other". Use the same name, or another state ID.',
      },
    ]);
  });

  test("gives built-in state IDs the built-in display", () => {
    const definition = definitionOfDocument(withReview(), 1);
    definition.states[0]!.label = "Anything";
    expect(withBuiltinSharedFields(definition).states[0]).toEqual({
      id: "open",
      label: "Backlog",
      title: "Backlog",
      tone: "neutral",
    });
  });

  test("makes element IDs from labels", () => {
    expect(idFromLabel("Design Review!")).toBe("design_review");
    expect(idFromLabel("Design review", new Set(["design_review"]))).toBe("design_review_2");
    expect(idFromLabel("???")).toBe("item");
  });

  test("gives each prompt of a new version its built-in version", () => {
    const [rules, tools] = newWorkflowDocument("a", "A").prompts;
    const first = nextVersionPrompts([rules!, tools!], []);
    expect(first.map(({ builtinVersion }) => builtinVersion)).toEqual([1, 1]);
    const second = nextVersionPrompts([{ ...rules!, template: "changed" }, tools!], first);
    expect(second.map(({ builtinVersion }) => builtinVersion)).toEqual([2, 1]);
  });
});

describe("workflow references", () => {
  test("renames a state and every reference, layout included", () => {
    const renamed = renameWorkflowElement(withReview(), "state", "in_review", "checking");
    expect(renamed.definition.states[1]!.id).toBe("checking");
    expect(renamed.definition.events[0]!.outcomes[0]!.to).toBe("checking");
    expect(renamed.layout.states).toEqual({ checking: { x: 10, y: 20 } });
  });

  test("indexes what each element names and what names it", () => {
    const index = workflowReferenceIndex(withReview().definition);
    expect([...index.names.get("event:submit")!]).toEqual(["state:open", "state:in_review"]);
    expect([...index.namedBy.get("state:in_review")!]).toEqual(["event:submit"]);
  });

  test("renames a review and its verdict comparisons", () => {
    const document = withReview();
    document.definition.artifacts.push({
      id: "qa",
      label: "QA",
      kind: "review",
      verdicts: [{ id: "ok", label: "OK", passes: true, eventId: "submit" }],
    });
    document.definition.events[0]!.guards.push({
      id: "passed",
      when: { artifact: "qa", verdict: "ok" },
    });
    const renamed = renameWorkflowElement(document, "artifact", "qa", "review");
    expect(renamed.definition.events[0]!.guards[0]!.when).toEqual({
      artifact: "review",
      verdict: "ok",
    });
  });
});

describe("workflow roles", () => {
  const input = {
    ...roleInputOf(BUILTIN_ROLES[2]!),
    id: "reviewer",
    label: "Reviewer",
    instructions: "Review {{task.id}}.",
  };

  test("accepts a new role and rejects a taken ID and unfillable placeholders", () => {
    expect(
      checkWorkflowRole(input, { roles: BUILTIN_ROLES, mode: "create", bindingVersions: [] }),
    ).toEqual([]);
    const problems = checkWorkflowRole(
      { ...input, id: "build", instructions: "{{git.targetBranch}}" },
      { roles: BUILTIN_ROLES, mode: "create", bindingVersions: [] },
    );
    expect(problems.map(({ path }) => path)).toEqual([["id"], ["instructions"]]);
  });

  test("rejects an update that breaks a published version", () => {
    const role = roleFromInput(input);
    const document = withReview();
    document.definition.roles = [{ id: "reviewer", writes: [] }];
    document.definition.events[0]!.agent = {
      roles: ["reviewer"],
      description: "Go.",
      note: "optional",
    };
    const version: WorkflowVersionDocument = {
      definition: definitionOfDocument(document, 1),
      prompts: nextVersionPrompts(document.prompts, []),
      layout: document.layout,
    };
    const problems = checkWorkflowRole(
      { ...input, tools: input.tools.filter((tool) => tool !== "odt_apply_workflow_event") },
      { roles: [...BUILTIN_ROLES, role], mode: "update", bindingVersions: [version] },
    );
    expect(problems.map(({ path }) => path)).toEqual([["tools"]]);
  });

  test("raises the instructions version only when the text changes", () => {
    const role = roleFromInput(input);
    expect(roleFromInput(input, role).systemPrompt.builtinVersion).toBe(1);
    expect(
      roleFromInput({ ...input, instructions: "New." }, role).systemPrompt.builtinVersion,
    ).toBe(2);
  });
});

describe("notification defaults in one workflow", () => {
  test("rejects two states that give one notification kind different defaults", () => {
    const document = withReview();
    const notification = (enabled: boolean) => ({
      kind: "workflow.custom_review" as const,
      defaultSetting: { enabled, target: "both" as const, sound: "inherit" as const },
      label: "Review",
      description: "A task needs review.",
      title: "Review",
      body: "Review the task.",
      status: "Task needs review.",
      route: "kanban" as const,
    });
    document.definition.states.splice(2, 0, { id: "second_review", label: "Second review" });
    document.definition.states[1]!.notification = notification(true);
    document.definition.states[2]!.notification = notification(false);
    document.definition.events[0]!.outcomes.push({ when: false, to: "second_review" });
    expect(errors(document)).toEqual([
      {
        severity: "error",
        path: ["definition", "states", 2, "notification", "defaultSetting"],
        message:
          'State "Second review" sends the "workflow.custom_review" notification with other defaults than state "In review". Give both the same defaults, or send another notification.',
      },
    ]);
    document.definition.states[2]!.notification = notification(true);
    expect(errors(document)).toEqual([]);
  });
});

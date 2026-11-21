import { describe, expect, test } from "bun:test";
import type { WorkflowDocument } from "@openducktor/contracts";
import {
  BUILTIN_ROLES,
  builtinWorkflowDocument,
  checkWorkflowDocument,
  elementKey,
  newWorkflowDocument,
} from "@openducktor/workflows";
import {
  addAction,
  addBoardButton,
  addEvent,
  addState,
  reconnectEvent,
  withActionKind,
} from "./create-elements";
import { findElement } from "./document-elements";
import {
  addArtifact,
  addIssueType,
  addLaunchAction,
  addStep,
  addVerdict,
  bindRole,
  deleteElement,
  newStepRole,
  renameLaunchAction,
  setIssueTypeSupported,
  updateDefinition,
  updateElement,
  updatePrompt,
  withBuiltinStateFields,
} from "./document-edits";

const stateIds = (document: WorkflowDocument) => document.definition.states.map(({ id }) => id);
const toneOf = (document: WorkflowDocument, id: string) =>
  findElement(document.definition, "state", id)?.tone;

describe("addState", () => {
  test("puts each new state before closed, so closed stays the last board column", () => {
    let document = newWorkflowDocument("flow", "Flow");
    document = addState(document, "Triage").document;
    document = addState(document, "Fixing").document;
    expect(stateIds(document)).toEqual(["open", "triage", "fixing", "closed"]);
  });

  test("puts a new state after the last other state when closed is not last in the list", () => {
    let document = newWorkflowDocument("flow", "Flow");
    document = addState(document, "Triage").document;
    document = updateDefinition(document, (definition) => ({
      ...definition,
      states: [definition.states[0]!, definition.states[2]!, definition.states[1]!],
    }));
    document = addState(document, "Review").document;
    expect(stateIds(document)).toEqual(["open", "closed", "triage", "review"]);
  });

  test("leaves the box position to the editor, so nothing about the layout is saved", () => {
    const document = addState(newWorkflowDocument("flow", "Flow"), "Triage").document;
    expect(document.layout.states).toEqual({});
  });

  test("gives each new state a tone that no state uses yet, then cycles", () => {
    let document = newWorkflowDocument("flow", "Flow");
    for (const label of ["A", "B", "C", "D", "E", "F"])
      document = addState(document, label).document;
    expect(["a", "b", "c", "d", "e", "f"].map((id) => toneOf(document, id))).toEqual([
      "pending",
      "info",
      "review",
      "warning",
      "approval",
      "pending",
    ]);
  });

  test("skips a tone that a state already uses", () => {
    let document = addState(newWorkflowDocument("flow", "Flow"), "A").document;
    document = updateElement(document, "state", "a", (state) => ({ ...state, tone: "pending" }));
    document = addState(document, "B").document;
    expect(toneOf(document, "b")).toBe("info");
    document = updateElement(document, "state", "a", (state) => ({ ...state, tone: "info" }));
    expect(toneOf(addState(document, "C").document, "c")).toBe("pending");
  });

  test("copies the display of a state that another workflow shares", () => {
    const shared = new Map([["triage", { label: "Triage", tone: "neutral" as const }]]);
    const document = addState(newWorkflowDocument("flow", "Flow"), "Triage", shared).document;
    expect(findElement(document.definition, "state", "triage")).toEqual({
      id: "triage",
      label: "Triage",
      tone: "neutral",
    });
  });
});

describe("addAction", () => {
  test("an event action sends the first event that no action sends yet", () => {
    let document = addState(newWorkflowDocument("flow", "Flow"), "Triage").document;
    document = addEvent(document, "open", "triage", "start").document;
    document = addEvent(document, "triage", "closed", "finish").document;
    document = addAction(document, "Start", "event").document;
    document = addAction(document, "Finish", "event").document;
    const eventIdOf = (id: string) => {
      const action = findElement(document.definition, "action", id);
      return action?.kind === "event" ? action.eventId : undefined;
    };
    expect(eventIdOf("start")).toBe("start");
    expect(eventIdOf("finish")).toBe("finish");
  });

  test("an event action never takes a transition that agents or a document save already send", () => {
    let document = addState(newWorkflowDocument("flow", "Flow"), "Triage").document;
    document = addEvent(document, "open", "triage", "saved").document;
    document = addArtifact(document, "Notes", "document").document;
    document = updateElement(document, "artifact", "notes", (artifact) =>
      artifact.kind === "document" ? { ...artifact, saveEventId: "saved" } : artifact,
    );
    const action = findElement(
      addAction(document, "Reopen", "event").document.definition,
      "action",
      "reopen",
    );
    // No transition is free, so the button names itself, which shows a problem until a pick.
    expect(action?.kind === "event" ? action.eventId : undefined).toBe("reopen");
  });

  test("a session action starts the first way to start that no button starts, with its step", () => {
    let document = addStep(newWorkflowDocument("flow", "Flow"), "Triage", {
      kind: "agent",
      roleId: BUILTIN_ROLES[0]!.id,
    }).document;
    document = addStep(document, "Fix", { kind: "agent", roleId: BUILTIN_ROLES[1]!.id }).document;
    document = addAction(document, "Triage", "session").document;
    document = addAction(document, "Fix", "session").document;
    expect(findElement(document.definition, "action", "triage")).toMatchObject({
      launchActionIds: ["start_triage"],
      stepId: "triage",
    });
    expect(findElement(document.definition, "action", "fix")).toMatchObject({
      launchActionIds: ["start_fix"],
      stepId: "fix",
    });
  });
});

describe("withActionKind", () => {
  const withButton = () => {
    let document = addStep(newWorkflowDocument("flow", "Flow"), "Fix", {
      kind: "agent",
      roleId: BUILTIN_ROLES[0]!.id,
    }).document;
    document = addEvent(document, "open", "closed", "reopen").document;
    return addAction(document, "Fix", "session").document;
  };

  test("a move keeps the ways to start of a session button and drops its step", () => {
    const action = findElement(
      withActionKind(withButton(), "fix", "event").definition,
      "action",
      "fix",
    );
    expect(action).toEqual({
      id: "fix",
      label: "Fix",
      availableWhen: true,
      kind: "event",
      eventId: "reopen",
      launchActionIds: ["start_fix"],
    });
  });

  test("a session button takes the step of its first way to start", () => {
    const moved = withActionKind(withButton(), "fix", "event");
    const action = findElement(withActionKind(moved, "fix", "session").definition, "action", "fix");
    expect(action).toMatchObject({
      kind: "session",
      launchActionIds: ["start_fix"],
      stepId: "fix",
    });
  });
});

describe("newStepRole", () => {
  test("picks the first role of the workflow that has no step yet", () => {
    const [first, second] = [BUILTIN_ROLES[0]!.id, BUILTIN_ROLES[1]!.id];
    let document = bindRole(newWorkflowDocument("flow", "Flow"), first).document;
    document = bindRole(document, second).document;
    document = addStep(document, "Spec", { kind: "agent", roleId: first }).document;
    expect(newStepRole(document.definition, [])).toBe(second);
  });
});

describe("launch actions", () => {
  const withStep = () =>
    addStep(newWorkflowDocument("flow", "Flow"), "Build", {
      kind: "agent",
      roleId: BUILTIN_ROLES[0]!.id,
    }).document;
  const promptOf = (document: WorkflowDocument, id: string) =>
    document.prompts.find((prompt) => prompt.id === id);

  test("gives each new way to start its own name", () => {
    let document = addLaunchAction(withStep(), "build", "Continue Build");
    document = addLaunchAction(document, "build", "Continue Build");
    const step = findElement(document.definition, "step", "build");
    const labels = step?.kind === "agent" ? step.launchActions.map(({ label }) => label) : [];
    expect(labels).toEqual(["Start Build", "Continue Build", "Continue Build 2"]);
  });

  test("a rename takes the prompt along while the prompt keeps the same name", () => {
    let document = renameLaunchAction(withStep(), "start_build", "Build the fix");
    expect(promptOf(document, "messages.start_build")?.label).toBe("Build the fix");
    document = updatePrompt(document, "messages.start_build", (prompt) => ({
      ...prompt,
      label: "Kickoff",
    }));
    document = renameLaunchAction(document, "start_build", "Build again");
    expect(promptOf(document, "messages.start_build")?.label).toBe("Kickoff");
  });
});

describe("withBuiltinStateFields", () => {
  test("gives a state with a built-in ID its built-in name and colour, and its notification default", () => {
    let document = addState(newWorkflowDocument("flow", "Flow"), "Blocked").document;
    document = updateElement(document, "state", "blocked", (state) => ({
      ...state,
      notification: {
        kind: "workflow.blocked",
        defaultSetting: { enabled: true, target: "both", sound: "inherit" },
        label: "Blocked",
        description: "",
        title: "Blocked",
        body: "{{task.title}}",
        status: "Blocked",
        route: "kanban",
      },
    }));
    const shared = findElement(withBuiltinStateFields(document).definition, "state", "blocked");
    const builtin = findElement(builtinWorkflowDocument().definition, "state", "blocked");
    expect(shared).toMatchObject({ label: builtin?.label, tone: builtin?.tone });
    expect(shared?.notification?.defaultSetting).toEqual(builtin?.notification?.defaultSetting);
  });

  test("keeps the same document when no field changes", () => {
    const document = newWorkflowDocument("flow", "Flow");
    const shared = withBuiltinStateFields(document);
    expect(withBuiltinStateFields(shared)).toBe(shared);
  });
});

describe("addBoardButton", () => {
  test("names the source state when the target label is taken, then adds a number", () => {
    let document = addState(newWorkflowDocument("flow", "Flow"), "Fixing").document;
    document = addEvent(document, "open", "fixing", "fix").document;
    const event = findElement(document.definition, "event", "fix")!;
    document = addBoardButton(document, event);
    document = addBoardButton(document, event);
    document = addBoardButton(document, event);
    expect(document.definition.actions).toEqual([
      {
        id: "move_to_fixing",
        label: "Move to Fixing",
        kind: "event",
        eventId: "fix",
        availableWhen: true,
      },
      {
        id: "move_from_backlog_to_fixing",
        label: "Move from Backlog to Fixing",
        kind: "event",
        eventId: "fix",
        availableWhen: true,
      },
      {
        id: "move_from_backlog_to_fixing_2",
        label: "Move from Backlog to Fixing 2",
        kind: "event",
        eventId: "fix",
        availableWhen: true,
      },
    ]);
  });

  test("a deleted state takes the transitions that only it uses, and keeps the others", () => {
    let document = addState(newWorkflowDocument("flow", "Flow"), "Fixing").document;
    document = addEvent(document, "open", "fixing", "fix").document;
    document = addEvent(document, "fixing", "closed", "finish").document;
    document = addEvent(document, "open", "closed", "drop").document;
    document = updateElement(document, "event", "drop", (event) => ({
      ...event,
      from: ["open", "fixing"],
    }));
    const { definition, layout } = deleteElement(document, elementKey("state", "fixing"));
    expect(definition.events.map(({ id }) => id)).toEqual(["drop"]);
    expect(definition.events[0]?.from).toEqual(["open"]);
    expect(Object.hasOwn(layout.states, "fixing")).toBe(false);
  });

  test("a deleted transition takes its buttons, also out of the button order", () => {
    let document = addState(newWorkflowDocument("flow", "Flow"), "Fixing").document;
    document = addEvent(document, "open", "fixing", "fix").document;
    document = addEvent(document, "fixing", "closed", "finish").document;
    document = addBoardButton(document, findElement(document.definition, "event", "fix")!);
    document = addBoardButton(document, findElement(document.definition, "event", "finish")!);
    document = updateDefinition(document, (definition) => ({
      ...definition,
      actionOrder: [{ when: true, actions: ["move_to_fixing", "move_to_done"] }],
    }));
    const { definition } = deleteElement(document, elementKey("event", "fix"));
    expect(definition.events.map(({ id }) => id)).toEqual(["finish"]);
    expect(definition.actions.map(({ id }) => id)).toEqual(["move_to_done"]);
    expect(definition.actionOrder).toEqual([{ when: true, actions: ["move_to_done"] }]);
  });
});

describe("addStep", () => {
  test("adds the role of a new agent step to the workflow once", () => {
    let document = newWorkflowDocument("flow", "Flow");
    document = addStep(document, "Fix", { kind: "agent", roleId: "build" }).document;
    document = addStep(document, "Polish", { kind: "agent", roleId: "build" }).document;
    expect(document.definition.roles.map(({ id }) => id)).toEqual(["build"]);
  });

  test("adds no role for a human step", () => {
    const document = addStep(newWorkflowDocument("flow", "Flow"), "Review", {
      kind: "human",
    }).document;
    expect(document.definition.roles).toEqual([]);
  });
});

describe("setIssueTypeSupported", () => {
  const issueTypeIds = (document: WorkflowDocument) =>
    document.definition.issueTypes.map(({ id }) => id);

  test("puts a type back in its place, so a toggle moves no other type", () => {
    const start = newWorkflowDocument("flow", "Flow");
    const order = issueTypeIds(start);
    for (const issueType of order) {
      const off = setIssueTypeSupported(start, issueType, false);
      expect(issueTypeIds(setIssueTypeSupported(off, issueType, true))).toEqual(order);
    }
  });

  test("keeps the order of the other types of a reordered document", () => {
    let document = updateDefinition(newWorkflowDocument("flow", "Flow"), (definition) => ({
      ...definition,
      issueTypes: definition.issueTypes.filter(({ id }) => id !== "task").reverse(),
    }));
    document = setIssueTypeSupported(document, "task", true);
    expect(issueTypeIds(document)).toEqual(["bug", "feature", "task"]);
  });

  test("drops a default type that becomes the first type or goes", () => {
    let document = newWorkflowDocument("flow", "Flow");
    document = updateDefinition(document, (definition) => ({
      ...definition,
      defaultIssueType: "task",
    }));
    for (const issueType of issueTypeIds(document).filter((id) => id !== "task"))
      document = setIssueTypeSupported(document, issueType, false);
    expect(document.definition.defaultIssueType).toBeUndefined();
  });

  test("keeps the default type of new tasks when an added type comes first", () => {
    let document = setIssueTypeSupported(newWorkflowDocument("flow", "Flow"), "feature", false);
    const first = issueTypeIds(document)[0];
    document = setIssueTypeSupported(document, "feature", true);
    expect(document.definition.defaultIssueType).toBe(first);
  });

  test("gives an added type the name, description, and icon of a new workflow, and selects it", () => {
    const start = newWorkflowDocument("flow", "Flow");
    const bug = start.definition.issueTypes.find(({ id }) => id === "bug");
    const created = addIssueType(setIssueTypeSupported(start, "bug", false), "bug");
    expect(created.key).toBe(elementKey("issueType", "bug"));
    expect(created.document.definition.issueTypes.find(({ id }) => id === "bug")).toEqual(bug);
  });
});

describe("reconnectEvent", () => {
  const flow = () => {
    let document = newWorkflowDocument("flow", "Flow");
    document = addState(document, "Triage").document;
    document = addState(document, "Fixing").document;
    return addEvent(document, "triage", "fixing", "start").document;
  };
  const event = (document: WorkflowDocument) => findElement(document.definition, "event", "start")!;

  test("moves the target in every outcome that goes to it", () => {
    const moved = reconnectEvent(flow(), "start", "target", "fixing", "closed");
    expect(event(moved).outcomes.map(({ to }) => to)).toEqual(["closed"]);
    expect(event(moved).from).toEqual(["triage"]);
  });

  test("moves the source and keeps the target", () => {
    const moved = reconnectEvent(flow(), "start", "source", "triage", "open");
    expect(event(moved).from).toEqual(["open"]);
    expect(event(moved).outcomes.map(({ to }) => to)).toEqual(["fixing"]);
  });

  test("merges a source that the event already has", () => {
    let document = updateElement(flow(), "event", "start", (current) => ({
      ...current,
      from: ["triage", "open"],
    }));
    document = reconnectEvent(document, "start", "source", "triage", "open");
    expect(event(document).from).toEqual(["open"]);
  });

  test("keeps the state when the target lands on the only source", () => {
    const moved = reconnectEvent(flow(), "start", "target", "fixing", "triage");
    expect(event(moved).outcomes.map(({ to }) => to)).toEqual([null]);
  });
});

describe("review artifacts", () => {
  const problemsOf = (document: WorkflowDocument) =>
    checkWorkflowDocument(document, {
      roles: BUILTIN_ROLES,
      otherWorkflows: [],
      takenWorkflowIds: new Set(),
    }).filter(({ severity }) => severity === "error");

  test("a new review has a verdict with its own transition, so it starts valid", () => {
    const { document } = addArtifact(newWorkflowDocument("flow", "Flow"), "Code review", "review");
    const review = document.definition.artifacts.find(({ id }) => id === "code_review");
    expect(review?.kind === "review" && review.verdicts).toEqual([
      { id: "approved", label: "Approved", passes: true, eventId: "code_review_approved" },
    ]);
    expect(document.definition.events.find(({ id }) => id === "code_review_approved")).toEqual({
      id: "code_review_approved",
      label: "Code review: Approved",
      from: ["open"],
      guards: [],
      outcomes: [{ when: true, to: null }],
    });
    expect(problemsOf(document)).toEqual([]);
  });

  test("an added verdict rejects after a passing one, with a transition from the same states", () => {
    let document = addArtifact(
      newWorkflowDocument("flow", "Flow"),
      "Code review",
      "review",
    ).document;
    document = updateDefinition(document, (definition) => ({
      ...definition,
      events: definition.events.map((event) =>
        event.id === "code_review_approved" ? { ...event, from: ["open", "closed"] } : event,
      ),
    }));
    document = addVerdict(document, "code_review").document;
    const review = document.definition.artifacts.find(({ id }) => id === "code_review");
    expect(review?.kind === "review" && review.verdicts[1]).toEqual({
      id: "rejected",
      label: "Rejected",
      passes: false,
      eventId: "code_review_rejected",
    });
    expect(
      document.definition.events.find(({ id }) => id === "code_review_rejected")?.from,
    ).toEqual(["open", "closed"]);
    expect(problemsOf(document)).toEqual([]);
  });
});

describe("addEvent", () => {
  test("names a new transition, and takes its ID from the name, not from a state", () => {
    const start = newWorkflowDocument("flow", "Flow");
    const unnamed = addEvent(start, "open", null);
    expect(unnamed.key).toBe(elementKey("event", "new_transition"));
    const moved = addEvent(start, "open", "closed");
    expect(moved.key).toBe(elementKey("event", "move_to_done"));
    expect(findElement(moved.document.definition, "event", "move_to_done")?.label).toBe(
      "Move to Done",
    );
  });
});

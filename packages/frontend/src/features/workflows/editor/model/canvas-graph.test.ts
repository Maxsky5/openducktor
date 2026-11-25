import { describe, expect, test } from "bun:test";
import type { WorkflowDocument } from "@openducktor/contracts";
import { elementKey, newWorkflowDocument, workflowReferenceIndex } from "@openducktor/workflows";
import { canvasHighlight, canvasLinks, deriveCanvasGraph, foldedLinks } from "./canvas-graph";
import { autoLayout, missingPositions, placeNewState } from "./canvas-layout";
import { addAction, addEvent, addState } from "./create-elements";
import { updateDefinition, updateElement } from "./document-edits";

/** open -> build -> review, with events that share box pairs. */
const reviewDocument = (): WorkflowDocument => {
  let document = newWorkflowDocument("flow", "Flow");
  document = addState(document, "Build").document;
  document = addState(document, "Review").document;
  document = addEvent(document, "open", "build", "start").document;
  document = addEvent(document, "build", "review", "submit").document;
  // Two outcomes to one target draw one arrow; a second source draws a second arrow.
  document = updateElement(document, "event", "submit", (event) => ({
    ...event,
    from: ["build", "open"],
    outcomes: [
      { when: { stateIn: ["build"] }, to: "review" },
      { when: true, to: "review" },
    ],
  }));
  document = addEvent(document, "review", null, "comment").document;
  document = addEvent(document, "review", "build", "reject").document;
  return document;
};

const edgeKeys = (document: WorkflowDocument) =>
  deriveCanvasGraph(document, new Map(), new Set()).edges.map(
    ({ data, source, target }) => `${data.kind}:${data.eventIds.join("+")}:${source}->${target}`,
  );

const edgeOf = (document: WorkflowDocument, eventId: string) =>
  deriveCanvasGraph(document, new Map(), new Set()).edges.find(({ data }) =>
    data.eventIds.includes(eventId),
  );

describe("canvas graph", () => {
  test("draws one line for each pair of a source and an outcome target", () => {
    expect(edgeKeys(reviewDocument())).toEqual([
      "arrow:start:open->build",
      "arrow:submit:build->review",
      "arrow:submit:open->review",
      "loop:comment:review->review",
      "arrow:reject:review->build",
    ]);
  });

  test("each transition draws its own line, even between the same two boxes", () => {
    let document = addEvent(reviewDocument(), "open", "build", "skip").document;
    document = addEvent(document, "review", null, "note").document;
    expect(edgeKeys(document)).toEqual([
      "arrow:start:open->build",
      "arrow:submit:build->review",
      "arrow:submit:open->review",
      "loop:comment:review->review",
      "arrow:reject:review->build",
      "arrow:skip:open->build",
      "loop:note:review->review",
    ]);
    expect(edgeOf(document, "skip")?.data.senders).toEqual([]);
  });

  test("an event from more than two states draws one labelled entry into its target", () => {
    let document = addState(reviewDocument(), "Blocked").document;
    document = addEvent(document, "open", "blocked", "block").document;
    document = updateElement(document, "event", "block", (event) => ({
      ...event,
      from: ["open", "build", "review", "closed"],
      outcomes: [
        { when: true, to: "blocked" },
        { when: true, to: null },
      ],
    }));
    expect(edgeKeys(document).filter((key) => key.includes("block"))).toEqual([
      "entry:block:blocked->blocked",
    ]);
    const line = edgeOf(document, "block");
    expect(line?.data.labelled).toBe(true);
    expect(line?.data.sourceLabels).toEqual(["Backlog", "Build", "Review", "Done"]);
  });

  test("an approval button draws an entry into Done from the states where it shows", () => {
    const document = updateDefinition(reviewDocument(), (definition) => ({
      ...definition,
      actions: [
        ...definition.actions,
        {
          id: "approve",
          kind: "approval",
          label: "Approve",
          availableWhen: { stateIn: ["review"] },
        },
      ],
    }));
    const line = deriveCanvasGraph(document, new Map(), new Set()).edges.find(
      ({ data }) => data.actionId === "approve",
    );
    expect(line).toMatchObject({
      source: "closed",
      target: "closed",
      data: { kind: "entry", eventIds: [], label: "Approve", sourceLabels: ["Review"] },
    });
  });

  test("a selected event from many states unfolds one arrow from each other source", () => {
    let document = addState(reviewDocument(), "Blocked").document;
    document = addEvent(document, "open", "blocked", "block").document;
    document = updateElement(document, "event", "block", (event) => ({
      ...event,
      from: ["open", "build", "review", "blocked"],
    }));
    const arrows = (key: Parameters<typeof foldedLinks>[1]) =>
      foldedLinks(document.definition, key).map(
        ({ kind, source, target, eventIds }) =>
          `${kind}:${eventIds.join("+")}:${source}->${target}`,
      );
    // The target is a source too, and the entry already shows that move.
    expect(arrows(elementKey("event", "block"))).toEqual([
      "arrow:block:open->blocked",
      "arrow:block:build->blocked",
      "arrow:block:review->blocked",
    ]);
    // An event from one or two states draws its arrows already, and a state unfolds nothing.
    expect(arrows(elementKey("event", "start"))).toEqual([]);
    expect(arrows(elementKey("state", "blocked"))).toEqual([]);
    expect(arrows(null)).toEqual([]);
  });

  test("a selected approval button unfolds one arrow from each of its states into Done", () => {
    const document = updateDefinition(reviewDocument(), (definition) => ({
      ...definition,
      actions: [
        ...definition.actions,
        {
          id: "approve",
          kind: "approval",
          label: "Approve",
          availableWhen: { stateIn: ["build", "review"] },
        },
      ],
    }));
    expect(
      foldedLinks(document.definition, elementKey("action", "approve")).map(
        ({ source, target, actionId }) => `${actionId}:${source}->${target}`,
      ),
    ).toEqual(["approve:build->closed", "approve:review->closed"]);
  });

  test("an event that draws several arrows labels only the first one", () => {
    const lines = deriveCanvasGraph(reviewDocument(), new Map(), new Set()).edges.filter(
      ({ data }) => data.eventIds.includes("submit"),
    );
    expect(lines.map(({ data }) => data.labelled)).toEqual([true, false]);
  });

  test("an arrow to a state that the document does not declare stays off the canvas", () => {
    const document = updateElement(reviewDocument(), "event", "start", (event) => ({
      ...event,
      outcomes: [{ when: true, to: "deleted" }],
    }));
    expect(edgeKeys(document).some((key) => key.includes(":start:"))).toBe(false);
  });

  test("boxes and lines carry the problem level and the shared marker", () => {
    const graph = deriveCanvasGraph(
      reviewDocument(),
      new Map([
        [elementKey("state", "build"), "warning" as const],
        [elementKey("event", "reject"), "error" as const],
      ]),
      new Set(["review", "open"]),
    );
    const build = graph.nodes.find(({ id }) => id === "build");
    const review = graph.nodes.find(({ id }) => id === "review");
    const open = graph.nodes.find(({ id }) => id === "open");
    expect(build?.data.problem).toBe("warning");
    expect(review?.data.shared).toBe(true);
    expect(open?.data.core).toBe(true);
    expect(graph.edges.find(({ data }) => data.eventIds.includes("reject"))?.data.problem).toBe(
      "error",
    );
  });

  test("a line of one event names what sends it", () => {
    const document = addAction(reviewDocument(), "Submit", "event").document;
    const withAction = updateElement(document, "action", "submit", (action) =>
      action.kind === "event" ? { ...action, eventId: "submit" } : action,
    );
    const submit = edgeOf(withAction, "submit");
    expect(submit?.data.senders).toEqual([
      { kind: "action", label: "Submit", key: elementKey("action", "submit") },
    ]);
    expect(submit?.data.triggered).toBe(true);
  });

  test("a line of an event that nothing sends is not triggered", () => {
    const start = edgeOf(reviewDocument(), "start");
    expect(start?.data.senders).toEqual([]);
    expect(start?.data.triggered).toBe(false);
  });
});

describe("canvas highlight", () => {
  test("a state selection highlights the events that name it", () => {
    const document = reviewDocument();
    const highlight = canvasHighlight(
      workflowReferenceIndex(document.definition),
      elementKey("state", "build"),
    );
    expect([...highlight.states]).toEqual(["build"]);
    expect([...highlight.events].sort()).toEqual(["reject", "start", "submit"]);
  });

  test("an event selection highlights the states that it names", () => {
    const document = reviewDocument();
    const highlight = canvasHighlight(
      workflowReferenceIndex(document.definition),
      elementKey("event", "submit"),
    );
    expect([...highlight.events]).toEqual(["submit"]);
    expect([...highlight.states].sort()).toEqual(["build", "open", "review"]);
  });

  test("a selection off the canvas, such as the workflow or a role, dims nothing", () => {
    const index = workflowReferenceIndex(reviewDocument().definition);
    expect(canvasHighlight(index, elementKey("workflow")).active).toBe(false);
    expect(canvasHighlight(index, elementKey("role", "builder")).active).toBe(false);
  });

  test("no selection highlights nothing and dims nothing", () => {
    const highlight = canvasHighlight(workflowReferenceIndex(reviewDocument().definition), null);
    expect(highlight.active).toBe(false);
  });
});

describe("canvas layout", () => {
  test("auto layout places each state on whole pixels from top to bottom in column order", () => {
    const positions = autoLayout(reviewDocument().definition);
    for (const position of Object.values(positions)) {
      expect(Number.isInteger(position.x)).toBe(true);
      expect(Number.isInteger(position.y)).toBe(true);
    }
    expect(positions.open!.y).toBeLessThan(positions.build!.y);
    expect(positions.build!.y).toBeLessThan(positions.review!.y);
    // The arrow back from review to build does not turn the order over, and Done comes last.
    expect(positions.review!.y).toBeLessThan(positions.closed!.y);
  });

  test("states without transitions stay one column in board column order", () => {
    let document = newWorkflowDocument("flow", "Flow");
    for (const label of ["Build", "Review"]) document = addState(document, label).document;
    const positions = autoLayout(document.definition);
    const order = ["open", "build", "review", "closed"];
    expect(new Set(order.map((id) => positions[id]!.x)).size).toBe(1);
    order.slice(1).forEach((id, index) => {
      expect(positions[id]!.y).toBeGreaterThan(positions[order[index]!]!.y);
    });
  });

  test("a side trip sits at the right of the row that it leaves, off the main column", () => {
    let document = newWorkflowDocument("flow", "Flow");
    for (const label of ["Build", "Blocked", "Review"])
      document = addState(document, label).document;
    document = addEvent(document, "open", "build", "start").document;
    document = addEvent(document, "build", "blocked", "block").document;
    document = addEvent(document, "blocked", "build", "resume").document;
    document = addEvent(document, "build", "review", "submit").document;
    document = updateElement(document, "event", "submit", (event) => ({
      ...event,
      from: ["build", "blocked"],
    }));
    document = addEvent(document, "review", "closed", "approve").document;
    const positions = autoLayout(document.definition);
    // Blocked moves on to Review too, but Build moves there straight, so Blocked is a side trip.
    expect(positions.blocked!.y).toBe(positions.build!.y);
    expect(positions.blocked!.x).toBeGreaterThan(positions.build!.x);
    for (const id of ["open", "review", "closed"])
      expect(positions[id]!.x).toBe(positions.build!.x);
    expect(positions.review!.y).toBeGreaterThan(positions.build!.y);
  });

  test("a new box takes the place of Done while Done is the lowest box, and Done moves down", () => {
    expect(placeNewState({ open: { x: 0, y: 0 }, closed: { x: 0, y: 136 } }, "triage")).toEqual({
      triage: { x: 0, y: 136 },
      closed: { x: 0, y: 276 },
    });
    expect(placeNewState({ open: { x: 0, y: 300 }, closed: { x: 0, y: 136 } }, "triage")).toEqual({
      triage: { x: 0, y: 440 },
    });
  });

  test("the opening layout places only the states without a saved position", () => {
    const document = newWorkflowDocument("flow", "Flow");
    expect(Object.keys(missingPositions(document.definition, document.layout)).sort()).toEqual([
      "closed",
      "open",
    ]);
    const placed = { states: { open: { x: 5, y: 5 }, closed: { x: 5, y: 300 } } };
    expect(missingPositions(document.definition, placed)).toEqual({});
  });

  test("50 states and 200 events derive the graph quickly", () => {
    let document = newWorkflowDocument("flow", "Flow");
    for (let index = 0; index < 48; index += 1)
      document = addState(document, `State ${index}`).document;
    const ids = document.definition.states.map(({ id }) => id);
    for (let index = 0; index < 200; index += 1)
      document = addEvent(
        document,
        ids[index % ids.length]!,
        ids[(index * 7 + 3) % ids.length]!,
        `event ${index}`,
      ).document;
    const started = performance.now();
    const graph = deriveCanvasGraph(document, new Map(), new Set());
    const elapsed = performance.now() - started;
    expect(graph.nodes).toHaveLength(50);
    // Each transition draws its own line.
    expect(graph.edges).toHaveLength(200);
    expect(elapsed).toBeLessThan(50);
  });
});

describe("canvas links of a branched transition", () => {
  test("draw each branch only from the states where it can apply", () => {
    let document = newWorkflowDocument("flow", "Flow");
    for (const label of ["Ready", "Building"]) document = addState(document, label).document;
    document = updateDefinition(document, (definition) => ({
      ...definition,
      events: [
        {
          id: "audit-saved",
          from: ["open", "ready", "building"],
          guards: [],
          outcomes: [
            { when: { stateIn: ["open"] }, to: "ready" },
            { when: true, to: null },
          ],
        },
      ],
    }));
    // Three sources fold into one entry, which names the one state that the branch moves.
    expect(canvasLinks(document.definition).map(({ kind, target }) => `${kind} ${target}`)).toEqual(
      ["entry ready"],
    );
    expect(edgeOf(document, "audit-saved")?.data.sourceLabels).toEqual(["Backlog"]);
    const folded = foldedLinks(document.definition, elementKey("event", "audit-saved"));
    expect(folded.map(({ source, target }) => `${source}>${target}`)).toEqual(["open>ready"]);
  });

  test("name only the sources that move into each entry", () => {
    let document = newWorkflowDocument("flow", "Flow");
    for (const label of ["Ready", "Building", "Review", "Blocked"])
      document = addState(document, label).document;
    const moving = ["open", "ready", "building"];
    document = updateDefinition(document, (definition) => ({
      ...definition,
      events: [
        {
          id: "audit-saved",
          from: [...moving, "review", "closed"],
          guards: [],
          outcomes: [
            { when: { stateIn: moving }, to: "blocked" },
            { when: true, to: null },
          ],
        },
      ],
    }));
    const entry = edgeOf(document, "audit-saved");
    expect(entry?.data).toMatchObject({
      kind: "entry",
      sourceLabels: ["Backlog", "Ready", "Building"],
      fromAnyState: false,
    });
    const folded = foldedLinks(document.definition, elementKey("event", "audit-saved"));
    expect(folded.map(({ source, target }) => `${source}>${target}`)).toEqual([
      "open>blocked",
      "ready>blocked",
      "building>blocked",
    ]);
  });

  test("say any state only when every other state moves into the entry", () => {
    let document = newWorkflowDocument("flow", "Flow");
    for (const label of ["Ready", "Building"]) document = addState(document, label).document;
    const into = (from: string[]) =>
      edgeOf(
        updateDefinition(document, (definition) => ({
          ...definition,
          events: [{ id: "reset", from, guards: [], outcomes: [{ when: true, to: "ready" }] }],
        })),
        "reset",
      )?.data.fromAnyState;
    // Done is a state too, so a transition that a done task cannot take counts its sources.
    expect(into(["open", "building", "closed"])).toBe(true);
    expect(into(["open", "ready", "building"])).toBe(false);
  });

  test("keep a branch that only may apply, and the branches after it", () => {
    let document = newWorkflowDocument("flow", "Flow");
    document = addState(document, "Ready").document;
    document = updateDefinition(document, (definition) => ({
      ...definition,
      artifacts: [{ id: "spec", label: "Spec", kind: "document" }],
      events: [
        {
          id: "save",
          from: ["open"],
          guards: [],
          outcomes: [
            { when: { artifact: "spec", present: true }, to: "ready" },
            { when: true, to: "closed" },
          ],
        },
      ],
    }));
    const links = canvasLinks(document.definition).map(
      ({ source, target }) => `${source}>${target}`,
    );
    expect(links.sort()).toEqual(["open>closed", "open>ready"]);
  });
});

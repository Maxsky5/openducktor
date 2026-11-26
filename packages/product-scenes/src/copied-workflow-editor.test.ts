import { describe, expect, test } from "bun:test";
import { type LineRoute, STATE_BOX } from "./replicas/workflows/model";
import {
  ADD_STATE_TEXT,
  availableIn,
  CANVAS_TEXT,
  EVENT_INSPECTOR_TEXT,
  HEADER_TEXT,
  OUTLINE_SECTIONS,
  OUTLINE_TEXT,
  PROBLEMS_TEXT,
  PUBLISH_TEXT,
  publishDescription,
  publishedToast,
  STATE_INSPECTOR_TEXT,
  toCheck,
  versionLabel,
} from "./replicas/workflows/text";
import {
  BUTTONS,
  CANVAS_SIZE,
  FRAMES,
  ISSUE_TYPES,
  LINES,
  NEW_EVENT,
  NEW_LINE,
  NEW_LINE_ENDS,
  OUTLINE_TRANSITIONS,
  REVEAL,
  STATE_LIST,
  STATE_PROBLEM,
  VERSION,
} from "./scenes/workflow-editor/sample";
import {
  HINT_ROOM,
  polylineOf,
  readableViewport,
  revealViewport,
  roundedPath,
  VIEWPORT_MOVE,
} from "./replicas/workflows/viewport";
import { readProduct, readProductWords } from "./test-support/product-source";
import {
  addedState,
  canvasOf,
  connected,
  connection,
  EDITOR,
  eventOf,
  eventSummary,
  idOf,
  layout,
  names,
  opening,
  published,
  readiness,
  revealTarget,
  type Positions,
  type Route,
  session,
  triggered,
  viewports,
  type WorkflowDocument,
  workflowStatus,
} from "./test-support/workflow-editor-product";

/** The words of the editor that the product has only in its markup. */
const words = await readProductWords([
  ...`editor-header.tsx editor-dialogs.tsx canvas/workflow-canvas.tsx panels/outline-panel.tsx
      panels/problems-panel.tsx panels/readiness.ts panels/new-element-button.tsx
      inspector/state-inspector.tsx inspector/state-transitions.tsx inspector/choice-fields.tsx
      inspector/event-inspector.tsx inspector/event-senders-field.tsx model/event-senders.ts
      dialogs/publish-dialog.tsx dialogs/task-moves-dialog.tsx`
    .split(/\s+/)
    .map((path) => `${EDITOR}/${path}`),
  "packages/frontend/src/features/workflows/library/workflow-availability.ts",
]);

const expectRoutes = (
  routes: Map<string, Route>,
  expected: Readonly<Record<string, LineRoute>>,
): void => {
  expect([...routes.keys()].toSorted()).toEqual(Object.keys(expected).toSorted());
  for (const [id, route] of routes)
    expect<LineRoute | undefined>({ path: route.path, label: route.labelBox }).toEqual(
      expected[id],
    );
};

describe("the workflow editor copied from the app", () => {
  test("the states, their tones, and the transitions come from the editor", () => {
    expect(triggered.definition.states.map(({ id, label, tone }) => ({ id, label, tone }))).toEqual(
      STATE_LIST.map(({ id, label, tone }) => ({ id, label, tone })),
    );
    expect(idOf(connection.key)).toBe(NEW_LINE);
    expect(published.definition.actions).toHaveLength(BUTTONS.before);
    expect(triggered.definition.actions).toHaveLength(BUTTONS.after);
    expect(triggered.definition.issueTypes).toHaveLength(ISSUE_TYPES);
    const rowNames = names.eventRowNames(triggered.definition);
    expect(
      triggered.definition.events.map((event) => ({
        id: event.id,
        name: rowNames.get(event.id),
        route: names.eventRouteLabel(triggered.definition, event),
        triggered: true,
      })),
    ).toEqual([...OUTLINE_TRANSITIONS]);
    expect(canvasOf(triggered, session).texts).toEqual(LINES.map(({ text }) => text));
  });

  test("each frame has the box places, the line routes, and the content of the editor", () => {
    const first = canvasOf(published, opening);
    expect(opening).toEqual(FRAMES.published.positions);
    expectRoutes(first.routes, FRAMES.published.routes);
    expect(first.content).toEqual(FRAMES.published.content);

    // The details open with the new state, and the editor fits the workflow again only when it
    // showed whole before the canvas narrowed.
    const added = canvasOf(addedState.document, session);
    expect(session).toEqual(FRAMES.added.positions);
    expectRoutes(added.routes, FRAMES.added.routes);
    expect(added.content).toEqual(FRAMES.added.content);
    const { x, y, zoom } = viewports.readableViewport(first.content, CANVAS_SIZE.wide);
    const { content } = FRAMES.added;
    expect(content.x * zoom + x >= 0 && content.y * zoom + y >= 0).toBe(true);
    expect((content.x + content.width) * zoom + x).toBeLessThanOrEqual(CANVAS_SIZE.wide.width);
    expect((content.y + content.height) * zoom + y).toBeLessThanOrEqual(CANVAS_SIZE.wide.height);

    const line = canvasOf(connected, session);
    expectRoutes(line.routes, FRAMES.connected.routes);
    expect(line.content).toEqual(FRAMES.connected.content);
    expect(line.routes.get(NEW_LINE)?.ends).toEqual([...NEW_LINE_ENDS]);
    const button = canvasOf(triggered, session);
    expectRoutes(button.routes, FRAMES.triggered.routes);
    expect(button.content).toEqual(FRAMES.triggered.content);

    const reopened = layout.autoLayout(triggered.definition);
    expect(reopened).toEqual(FRAMES.republished.positions);
    const last = canvasOf(triggered, reopened);
    expectRoutes(last.routes, FRAMES.republished.routes);
    expect(last.content).toEqual(FRAMES.republished.content);
  });

  test("the fit of the viewport and the round corners of a line are those of the editor", () => {
    for (const { content, routes } of Object.values(FRAMES)) {
      for (const size of Object.values(CANVAS_SIZE))
        expect(readableViewport(content, size)).toEqual(viewports.readableViewport(content, size));
      for (const { path } of Object.values(routes))
        expect(roundedPath(polylineOf(path))).toBe(path);
    }
    const reveal = (document: WorkflowDocument, key: string) => {
      const { view, boxes, routed } = canvasOf(document, session);
      return revealTarget(key, boxes, view.graph.edges, routed);
    };
    expect(reveal(addedState.document, addedState.key)).toEqual(REVEAL.state);
    expect(reveal(connected, connection.key)).toEqual(REVEAL.line);
    const start = { x: 200, y: 64, zoom: 0.8 };
    for (const size of Object.values(CANVAS_SIZE))
      for (const { selection, neighbours } of Object.values(REVEAL))
        expect(revealViewport(start, size, selection, neighbours)).toEqual(
          viewports.revealViewport(start, size, selection, neighbours),
        );
  });

  test("the box size and the motion constants of the canvas are those of the editor", async () => {
    expect<number[]>([STATE_BOX.width, STATE_BOX.height]).toEqual([
      layout.STATE_BOX_WIDTH,
      layout.STATE_BOX_HEIGHT,
    ]);
    expect(await readProduct(`${EDITOR}/canvas/canvas-overlays.tsx`)).toContain(
      `const HINT_ROOM = ${HINT_ROOM};`,
    );
    expect(await readProduct(`${EDITOR}/canvas/use-viewport-mover.ts`)).toContain(
      `const VIEWPORT_MOVE_MS = ${VIEWPORT_MOVE * 1000};`,
    );
  });

  test("the problems and the summaries are those of the workflow check", () => {
    const messages = (document: WorkflowDocument, positions: Positions): string[] =>
      canvasOf(document, positions).view.problems.map(({ severity, message }) => {
        expect(severity).toBe("warning");
        return message;
      });
    expect(messages(published, opening)).toEqual([]);
    expect(messages(addedState.document, session)).toEqual([STATE_PROBLEM]);
    expect(messages(connected, session)).toEqual([NEW_EVENT.problem]);
    expect(messages(triggered, session)).toEqual([]);
    expect(eventSummary(connected.definition, eventOf(connected, NEW_LINE), new Map())).toBe(
      NEW_EVENT.summary.untriggered,
    );
    expect(eventSummary(triggered.definition, eventOf(triggered, NEW_LINE), new Map())).toBe(
      NEW_EVENT.summary.triggered,
    );
    expect(eventOf(connected, NEW_LINE).label).toBe(NEW_EVENT.name);
  });

  test("the status, the readiness line, and the kinds use the words of the editor", () => {
    const status = (hasDraft: boolean, latestVersion: number): string =>
      workflowStatus({ builtin: false, routeVersion: null, hasDraft, latestVersion }).label;
    expect(status(false, VERSION)).toBe(versionLabel(VERSION, false));
    expect(status(true, VERSION)).toBe(versionLabel(VERSION, true));
    expect(status(false, VERSION + 1)).toBe(versionLabel(VERSION + 1, false));
    const ready = (warningCount: number, hasDraft: boolean) =>
      readiness({ errorCount: 0, warningCount, hasDraft });
    const { published, nextChange, ready: title } = PROBLEMS_TEXT;
    expect(ready(0, false)).toEqual({ level: null, title: published, detail: nextChange });
    expect(ready(1, true)).toEqual({ level: "warning", title: toCheck(1), detail: null });
    expect(ready(0, true)).toEqual({ level: null, title, detail: null });
    expect(names.elementKindLabel("state")).toBe(STATE_INSPECTOR_TEXT.kind);
    expect(names.elementKindLabel("event")).toBe(EVENT_INSPECTOR_TEXT.kind);
  });

  test("the labels of the header, the canvas, the list, the details, and the dialogs", () => {
    const { kind: _state, ...stateWords } = STATE_INSPECTOR_TEXT;
    const { kind: _event, ...eventWords } = EVENT_INSPECTOR_TEXT;
    const { published: _published, ready: _ready, ...problemWords } = PROBLEMS_TEXT;
    const copied = [
      ...Object.values(HEADER_TEXT),
      ...Object.values(CANVAS_TEXT),
      ...Object.values(OUTLINE_TEXT),
      ...Object.values(OUTLINE_SECTIONS).map((title) => `title="${title}"`),
      ...Object.values(problemWords),
      ...Object.values(stateWords),
      ...Object.values(eventWords),
      ...Object.values(ADD_STATE_TEXT),
      ...Object.values(PUBLISH_TEXT),
      "Add a transition from ${name}",
      "New tasks can use it now.",
      "Create a task",
    ];
    expect(copied.filter((text) => !words.includes(text))).toEqual([]);
    const version = "${(latestVersion ?? 0) + 1}";
    expect(words).toContain(publishDescription(2).replace("2", version));
    expect(words).toContain(availableIn("{availabilitySummary(entry.availability, workspaces)}"));
    expect(words).toContain(publishedToast(2).title.replace("2", "${result.version}"));
  });
});

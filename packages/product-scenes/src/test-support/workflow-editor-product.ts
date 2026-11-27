// The workflow editor of the product as the copied test of the workflow-editor scene reads it:
// the functions of the editor that the test calls, and the story of the scene built with them.
import type { Point } from "../motion/offset";
import type { Box, Viewport } from "../replicas/workflows/model";
import { STATE_BOX } from "../replicas/workflows/model";
import { NEW_STATE, WORKFLOW } from "../scenes/workflow-editor/sample";
import { importProduct } from "./product-source";

export type Positions = Record<string, Point>;
type Size = { width: number; height: number };
type Labels = Map<string, string>;
type Reveal = { selection: Box; neighbours: Box };
type Lines = [edges: EditorView["graph"]["edges"], routes: Map<string, Route>];
type StatusInput = Record<"routeVersion" | "latestVersion", number | null> &
  Record<"builtin" | "hasDraft", boolean>;
type WorkflowEvent = Record<"id", string> & { label?: string; from: string[] } & {
  outcomes: { to: string | null }[];
};
type Definition = {
  states: { id: string; label: string; tone?: string }[];
  events: WorkflowEvent[];
  actions: { id: string }[];
  issueTypes: { id: string }[];
};
export type WorkflowDocument = { definition: Definition; layout: { states: Positions } };
type Created = { document: WorkflowDocument; key: string };
type EdgeData = { kind: string; labelled: boolean; problem: string | null; eventIds: string[] };
type EditorView = {
  problems: { severity: string; message: string }[];
  graph: {
    edges: { id: string; source: string; target: string; data: EdgeData }[];
  };
};
export type Route = { path: string; labelBox: Box; extent: Box; ends?: [Point, Point] };
type RoutedLink = Record<"id" | "kind" | "source" | "target" | "text", string> & {
  labelled: boolean;
  marked: boolean;
};
/** The check context of a workflow on a host without roles and without other workflows. */
const CONTEXT = {
  roles: [],
  otherWorkflows: [],
  takenWorkflowIds: new Set<string>(),
  sharedStateIds: new Set<string>(),
  sharedStates: new Map<string, never>(),
};

export const EDITOR = "packages/frontend/src/features/workflows/editor";

// SAFETY: the workflows package exports this function, and a missing export fails the test.
const { newWorkflowDocument } = await importProduct<{
  newWorkflowDocument: (id: string, name: string) => WorkflowDocument;
}>("packages/workflows/src/index.ts");
// SAFETY: create-elements.ts exports these functions.
const elements = await importProduct<{
  addState: (document: WorkflowDocument, label: string) => Created;
  addEvent: (document: WorkflowDocument, from: string, to: string, name?: string) => Created;
  addBoardButton: (document: WorkflowDocument, event: WorkflowEvent) => WorkflowDocument;
}>(`${EDITOR}/model/create-elements.ts`);
// SAFETY: document-edits.ts exports this function.
const { updateDefinition } = await importProduct<{
  updateDefinition: (
    document: WorkflowDocument,
    update: (definition: Definition) => Definition,
  ) => WorkflowDocument;
}>(`${EDITOR}/model/document-edits.ts`);
// SAFETY: canvas-layout.ts exports these functions.
export const layout = await importProduct<{
  autoLayout: (definition: Definition) => Positions;
  placeNewState: (placed: Positions, stateId: string) => Positions;
  STATE_BOX_WIDTH: number;
  STATE_BOX_HEIGHT: number;
}>(`${EDITOR}/model/canvas-layout.ts`);
// SAFETY: editor-derivation.ts exports this function.
const { deriveEditorView } = await importProduct<{
  deriveEditorView: (
    document: WorkflowDocument,
    context: typeof CONTEXT,
    options: { check: boolean; hostProblems: null },
  ) => EditorView;
}>(`${EDITOR}/model/editor-derivation.ts`);
// SAFETY: edge-labels.ts exports this function.
const { edgeLabelText } = await importProduct<{
  edgeLabelText: (data: EdgeData, roleLabels: Map<string, string>) => string;
}>(`${EDITOR}/canvas/edge-labels.ts`);
// SAFETY: edge-routes.ts exports this function.
const { routeLinks } = await importProduct<{
  routeLinks: (links: RoutedLink[], boxes: Map<string, Box>) => Map<string, Route>;
}>(`${EDITOR}/canvas/edge-routes.ts`);
// SAFETY: canvas-viewport.ts exports these functions.
export const viewports = await importProduct<{
  readableViewport: (bounds: Box | null, size: Size) => Viewport;
  contentBounds: (boxes: Box[]) => Box | null;
  revealViewport: (viewport: Viewport, size: Size, selection: Box, neighbours: Box) => Viewport;
}>(`${EDITOR}/canvas/canvas-viewport.ts`);
// SAFETY: reveal-target.ts exports this function.
export const { revealTarget } = await importProduct<{
  revealTarget: (key: string, boxes: Map<string, Box>, ...rest: Lines) => Reveal | null;
}>(`${EDITOR}/canvas/reveal-target.ts`);
// SAFETY: event-summary.ts exports this function.
export const { eventSummary } = await importProduct<{
  eventSummary: (definition: Definition, event: WorkflowEvent, labels: Labels) => string;
}>(`${EDITOR}/model/event-summary.ts`);
// SAFETY: document-elements.ts exports these functions.
export const names = await importProduct<{
  eventRowNames: (definition: Definition) => Map<string, string>;
  eventRouteLabel: (definition: Definition, event: WorkflowEvent) => string;
  elementKindLabel: (kind: string) => string;
}>(`${EDITOR}/model/document-elements.ts`);
// SAFETY: readiness.ts exports this function.
export const { readiness } = await importProduct<{
  readiness: (counts: Record<"errorCount" | "warningCount", number> & { hasDraft: boolean }) => {
    level: string | null;
  } & Record<"title", string> & { detail: string | null };
}>(`${EDITOR}/panels/readiness.ts`);
// SAFETY: workflow-status-text.ts exports this function.
export const { workflowStatus } = await importProduct<{
  workflowStatus: (input: StatusInput) => { label: string };
}>("packages/frontend/src/features/workflows/workflow-status-text.ts");

export const idOf = (key: string): string => key.slice(key.indexOf(":") + 1);
export const eventOf = (document: WorkflowDocument, id: string): WorkflowEvent => {
  const event = document.definition.events.find((item) => item.id === id);
  if (!event) throw new Error(`The workflow has no transition ${id}.`);
  return event;
};

/** A transition named `name` from `from` to `to`, with a board button. */
function linked(document: WorkflowDocument, from: string, to: string, name: string) {
  const created = elements.addEvent(document, from, to, name);
  const named = updateDefinition(created.document, (definition) => ({
    ...definition,
    events: definition.events.map((event) =>
      event.id === idOf(created.key) ? { ...event, label: name } : event,
    ),
  }));
  return elements.addBoardButton(named, eventOf(named, idOf(created.key)));
}

// The story of the scene with the functions of the editor: version 1, the new state, the new
// transition, and its board button.
export const published = linked(
  linked(
    elements.addState(
      updateDefinition(newWorkflowDocument("quick-fix", WORKFLOW), (definition) => ({
        ...definition,
        issueTypes: definition.issueTypes.filter(({ id }) => id === "bug"),
      })),
      "Fixing",
    ).document,
    "open",
    "fixing",
    "Start fixing",
  ),
  "fixing",
  "closed",
  "Mark fixed",
);
export const addedState = elements.addState(published, NEW_STATE.label);
export const connection = elements.addEvent(addedState.document, "fixing", NEW_STATE.id);
export const connected = connection.document;
export const triggered = elements.addBoardButton(
  connected,
  eventOf(connected, idOf(connection.key)),
);

export const opening = layout.autoLayout(published.definition);
export const session = { ...opening, ...layout.placeNewState(opening, idOf(addedState.key)) };

/** The canvas of `document` at `positions`: the routes by transition, and the content box. */
export function canvasOf(document: WorkflowDocument, positions: Positions) {
  const view = deriveEditorView(document, CONTEXT, { check: true, hostProblems: null });
  const boxes = new Map(
    Object.entries(positions).map(([id, at]): [string, Box] => [id, { ...at, ...STATE_BOX }]),
  );
  const links = view.graph.edges.map(({ id, source, target, data }) => ({
    id,
    kind: data.kind,
    source,
    target,
    text: edgeLabelText(data, new Map()),
    labelled: data.labelled,
    marked: data.problem !== null,
  }));
  const routed = routeLinks(links, boxes);
  const routes = new Map<string, Route>();
  for (const { id, data } of view.graph.edges) {
    const route = routed.get(id);
    const [eventId] = data.eventIds;
    if (route && eventId) routes.set(eventId, route);
  }
  const content = viewports.contentBounds([
    ...boxes.values(),
    ...[...routed.values()].map(({ extent }) => extent),
  ]);
  return { view, routes, routed, boxes, content, texts: links.map(({ text }) => text) };
}

// The words of the workflow editor of packages/frontend/src/features/workflows/editor. The
// replicas show them, and src/copied-workflow-editor.test.ts compares them with the product
// source.

/** The header: editor-header.tsx and version-switcher.tsx. */
export const HEADER_TEXT = {
  crumb: "Workflows",
  saving: "Saving",
  saved: "Saved",
  publish: "Publish",
} as const;

/** The status of a custom workflow with a version, as workflowStatus of workflow-status-text.ts. */
export function versionLabel(version: number, draft: boolean): string {
  return draft ? `Version ${version} · Unpublished changes` : `Version ${version} · Published`;
}

/** The canvas toolbar of workflow-canvas.tsx. */
export const CANVAS_TEXT = {
  addState: "Add a state",
  autoLayout: "Auto layout",
  elements: "Elements",
} as const;

/** The element list of outline-panel.tsx and outline-group.tsx. */
export const OUTLINE_TEXT = {
  search: "Find a state, a role…",
  settings: "Workflow settings",
  advanced: "Advanced",
  noTrigger: "No trigger yet",
} as const;

/** The sections of the element list, in their order. */
export const OUTLINE_SECTIONS = {
  states: "States",
  transitions: "Transitions",
  buttons: "Buttons",
  roles: "Roles",
  steps: "Steps",
  artifacts: "Artifacts",
  issueTypes: "Issue types",
} as const;

export type OutlineSectionId = keyof typeof OUTLINE_SECTIONS;

/** The readiness line of readiness.ts and the toggle of problems-panel.tsx. */
export const PROBLEMS_TEXT = {
  ready: "Ready to publish",
  published: "Published",
  nextChange: "Your next change starts a draft.",
  show: "Show",
} as const;

/** The count of warnings of the readiness line: thingsToCheck of readiness.ts. */
export function toCheck(count: number): string {
  return `${count} to check`;
}

/** The details of a state: state-inspector.tsx, state-transitions.tsx, and choice-fields.tsx. */
export const STATE_INSPECTOR_TEXT = {
  kind: "State",
  name: "Name",
  colour: "Colour",
  transitions: "Transitions",
  comesFrom: "Comes from",
  goesTo: "Goes to",
  noneIn: "No transition moves tasks into this state yet.",
  noneOut: "No transition moves tasks out of this state yet.",
  notification: "Notification",
  notificationHint: "Tell people when a task arrives here.",
  studio: "Agent Studio",
  studioHint: "What opens for a task in this state.",
  session: "Session",
  automatic: "Automatic",
} as const;

/** The link of a state that starts a new transition from it. */
export function addTransitionFrom(state: string): string {
  return `Add a transition from ${state}`;
}

/** The details of a transition: event-inspector.tsx and event-senders-field.tsx. */
export const EVENT_INSPECTOR_TEXT = {
  kind: "Transition",
  name: "Name",
  route: "Route",
  from: "From",
  to: "To",
  branch: "Branch on a condition",
  triggers: "Triggers",
  addButton: "Add a button",
  boardButton: "Board button",
  agents: "Agents",
  agentsHint: "Pick the agent that moves the task when its work is done.",
  pick: "Pick",
} as const;

/** The dialog of NewElementButton in new-element-button.tsx, as the canvas toolbar opens it. */
export const ADD_STATE_TEXT = {
  title: "Add a state",
  name: "Name",
  placeholder: "State name",
  cancel: "Cancel",
  create: "Create",
} as const;

/** The publish dialog of publish-dialog.tsx and task-moves-dialog.tsx. */
export const PUBLISH_TEXT = {
  title: "Publish the draft",
  availability: "All repositories",
  moves: "Move tasks from older versions",
  cancel: "Cancel",
  confirm: "Publish",
} as const;

/** The description of the publish dialog for the next version. */
export function publishDescription(version: number): string {
  return `The draft becomes version ${version}. New tasks use it.`;
}

/** The availability line of the publish dialog. */
export function availableIn(summary: string): string {
  return `Available in: ${summary}. You can change it on the Workflows page.`;
}

/** A success toast with an action button. */
type ActionToast = { title: string; description: string; action: string };

/** The success toast of a publication in editor-dialogs.tsx. */
export function publishedToast(version: number): ActionToast {
  return {
    title: `Published version ${version}.`,
    description: "New tasks can use it now.",
    action: "Create a task",
  };
}

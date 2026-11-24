import {
  agentRoleDefinitionSchema,
  TASK_CLOSED_STATE,
  TASK_OPEN_STATE,
  type AgentRoleDefinition,
  type CompiledAgentRoleDefinition,
  type CompiledWorkflowDefinition,
  type WorkflowDocument,
  type WorkflowProblem,
  type WorkflowRoleInput,
  type WorkflowStateDefinition,
  type WorkflowVersionDocument,
} from "@openducktor/contracts";
import { collectDefinitionProblems } from "../rules/definition-rules";
import { createProblemSink, prefixedSink } from "../rules/problems";
import { collectTaskWorkflowProblems, textPlaceholderProblem } from "../rules/task-workflow-rules";
import {
  BASE_PROMPT_IDS,
  BASE_PROMPT_PLACEHOLDERS,
  workflowLaunchActions,
} from "../task-workflow/task-prompts";
import {
  builtinNotificationDefault,
  builtinSharedState,
  withBuiltinSharedFields,
} from "./builtin-shared-fields";
import { definitionOfDocument } from "./documents";

export type WorkflowCheckContext = {
  /** The host role catalog: built-in and custom roles. */
  readonly roles: readonly CompiledAgentRoleDefinition[];
  /** The latest version of each other published custom workflow. */
  readonly otherWorkflows: readonly CompiledWorkflowDefinition[];
  /** Workflow IDs that this draft cannot take. Empty after the first publication. */
  readonly takenWorkflowIds: ReadonlySet<string>;
};

/** The shared display of a state, with the defaults that a board column uses. */
const sharedDisplay = (
  state: Pick<WorkflowStateDefinition, "label" | "title" | "shortLabel" | "tone">,
) => ({
  label: state.label,
  title: state.title ?? state.label,
  shortLabel: state.shortLabel ?? state.label,
  tone: state.tone ?? "neutral",
});

/** The display fields that differ between two copies of a shared state, in plain words. */
const sharedDifference = (
  mine: Pick<WorkflowStateDefinition, "label" | "title" | "shortLabel" | "tone">,
  theirs: Pick<WorkflowStateDefinition, "label" | "title" | "shortLabel" | "tone">,
): string => {
  const [left, right] = [sharedDisplay(mine), sharedDisplay(theirs)];
  // A title or short name that follows the name differs only with it, so the name says enough.
  const set = (field: "title" | "shortLabel") =>
    mine[field] !== undefined || theirs[field] !== undefined;
  const words = [
    left.label !== right.label && "name",
    set("title") && left.title !== right.title && "title",
    set("shortLabel") && left.shortLabel !== right.shortLabel && "short name",
    left.tone !== right.tone && "colour",
  ].filter((word) => word !== false);
  if (words.length > 1) return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
  return words[0] ?? "look";
};

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue | undefined };
const sameJson = (left: JsonValue, right: JsonValue) =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * The events that something sends: an event or session action, an artifact save or verdict, a
 * step start, or agents.
 */
export const eventsWithSenders = (
  definition: Pick<CompiledWorkflowDefinition, "actions" | "artifacts" | "steps" | "events">,
): ReadonlySet<string> => {
  const sent = new Set<string>();
  // A session button only checks its event. The start event of its step moves the task.
  for (const action of definition.actions) if (action.kind === "event") sent.add(action.eventId);
  for (const artifact of definition.artifacts) {
    if (artifact.kind === "document") {
      if (artifact.saveEventId !== undefined) sent.add(artifact.saveEventId);
    } else for (const verdict of artifact.verdicts) sent.add(verdict.eventId);
  }
  for (const step of definition.steps)
    if (step.kind === "agent" && step.startEventId !== undefined) sent.add(step.startEventId);
  for (const event of definition.events) if (event.agent) sent.add(event.id);
  return sent;
};

/** The states that no event outcome can reach from `open`. `closed` is always reachable. */
export const unreachableStates = (
  definition: Pick<CompiledWorkflowDefinition, "states" | "events">,
): ReadonlySet<string> => {
  const reached = new Set([TASK_OPEN_STATE, TASK_CLOSED_STATE]);
  const pending = [TASK_OPEN_STATE];
  while (pending.length > 0) {
    const state = pending.pop()!;
    for (const event of definition.events) {
      if (!event.from.includes(state)) continue;
      for (const outcome of event.outcomes) {
        const target = outcome.to ?? state;
        if (reached.has(target)) continue;
        reached.add(target);
        pending.push(target);
      }
    }
  }
  return new Set(definition.states.map(({ id }) => id).filter((id) => !reached.has(id)));
};

/**
 * Lists every problem of a draft, not only the first one: the rules that compile a version, the
 * role catalog, the shared states and notifications of the other workflows, and the workflow ID.
 * A state that `open` cannot reach is a warning. Errors block publication.
 */
export const checkWorkflowDocument = (
  document: WorkflowDocument,
  context: WorkflowCheckContext,
): WorkflowProblem[] => {
  const sink = createProblemSink();
  const definition = withBuiltinSharedFields(definitionOfDocument(document, 1));
  collectDefinitionProblems(definition, prefixedSink(sink, ["definition"]));
  collectTaskWorkflowProblems(definition, document.prompts, context.roles, sink);
  if (context.takenWorkflowIds.has(definition.id))
    sink.error(
      ["definition", "id"],
      `Workflow ID "${definition.id}" is already used on this host. Pick another ID.`,
    );

  definition.states.forEach((state, index) => {
    const path = ["definition", "states", index];
    const others = context.otherWorkflows.filter(({ id }) => id !== definition.id);
    if (!builtinSharedState(state.id))
      for (const other of others) {
        const shared = other.states.find(({ id }) => id === state.id);
        if (shared && !sameJson(sharedDisplay(shared), sharedDisplay(state))) {
          // Both workflows show the state in one board column, so it must look the same.
          const difference = sharedDifference(state, shared);
          sink.error(
            [...path, "label"],
            `State "${state.id}" has another ${difference} in workflow "${other.label}". Use the same ${difference}, or another state ID.`,
          );
        }
      }
    const notification = state.notification;
    if (notification && !builtinNotificationDefault(notification.kind))
      for (const other of others) {
        const shared = other.states.find(
          (candidate) => candidate.notification?.kind === notification.kind,
        )?.notification;
        if (shared && !sameJson(shared.defaultSetting, notification.defaultSetting))
          sink.error(
            [...path, "notification", "defaultSetting"],
            `Notification "${notification.kind}" of state "${state.id}" is shared with workflow "${other.label}", which has another default setting. Use the same default setting, or another notification kind.`,
          );
      }
  });

  const labelOf = new Map(definition.states.map(({ id, label }) => [id, label]));
  const openLabel = labelOf.get(TASK_OPEN_STATE) ?? TASK_OPEN_STATE;
  const unreachable = unreachableStates(definition);
  definition.states.forEach((state, index) => {
    if (unreachable.has(state.id))
      sink.warning(
        ["definition", "states", index],
        `Tasks cannot reach "${state.label}" from "${openLabel}". Draw a transition to it, or delete the state.`,
      );
  });
  const leavesOpen = definition.events.some(
    (event) =>
      event.from.includes(TASK_OPEN_STATE) &&
      event.outcomes.some(({ to }) => to !== null && to !== TASK_OPEN_STATE),
  );
  const openIndex = definition.states.findIndex(({ id }) => id === TASK_OPEN_STATE);
  if (!leavesOpen && openIndex >= 0)
    sink.warning(
      ["definition", "states", openIndex],
      `No transition leaves "${openLabel}", so its tasks move only when someone closes them. Draw a transition from "${openLabel}" to the next state.`,
    );
  const sent = eventsWithSenders(definition);
  const routeOf = (event: (typeof definition.events)[number]) => {
    const sources =
      event.from.length > 2
        ? `any of ${event.from.length} states`
        : event.from.map((id) => `"${labelOf.get(id) ?? id}"`).join(" or ");
    const targets = [
      ...new Set(
        event.outcomes.flatMap(({ to }) => (to === null ? [] : [`"${labelOf.get(to) ?? to}"`])),
      ),
    ].join(" or ");
    return targets ? `from ${sources} to ${targets}` : `in ${sources}`;
  };
  definition.events.forEach((event, index) => {
    if (sent.has(event.id)) return;
    sink.warning(
      ["definition", "events", index],
      `Nothing triggers the transition ${routeOf(event)}, so it never moves a task. Add a board button for it, or let agents send it.`,
    );
  });
  const usedPrompts = new Set(workflowLaunchActions(definition).map(({ template }) => template.id));
  document.prompts.forEach((prompt, index) => {
    if (BASE_PROMPT_IDS.has(prompt.id) || usedPrompts.has(prompt.id)) return;
    sink.warning(
      ["prompts", index],
      `No way to start sends the prompt "${prompt.label || prompt.id}". Pick it in a way to start, or delete it.`,
    );
  });
  return sink.problems;
};

/** The catalog role of a role input. The instructions become its system prompt. */
export const roleFromInput = (
  input: WorkflowRoleInput,
  previous?: CompiledAgentRoleDefinition,
): AgentRoleDefinition => {
  const { instructions, ...fields } = structuredClone(input);
  const builtinVersion =
    previous === undefined
      ? 1
      : previous.systemPrompt.template === instructions
        ? previous.systemPrompt.builtinVersion
        : previous.systemPrompt.builtinVersion + 1;
  return {
    ...fields,
    systemPrompt: {
      builtinVersion,
      template: instructions,
      label: `${input.label} Instructions`,
      description: `The instructions of the ${input.label} role.`,
    },
  };
};

/** The role form and file shape of a catalog role. */
export const roleInputOf = (role: CompiledAgentRoleDefinition): WorkflowRoleInput => {
  const { systemPrompt, ...fields }: AgentRoleDefinition = structuredClone(
    agentRoleDefinitionSchema.parse(role),
  );
  return { ...fields, instructions: systemPrompt.template };
};

/** Whether two role inputs have the same content. Tool and scope order count. */
export const sameRoleInput = (left: WorkflowRoleInput, right: WorkflowRoleInput): boolean => {
  const canonical = (role: WorkflowRoleInput) =>
    Object.fromEntries(
      Object.entries(role)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  return sameJson(canonical(left), canonical(right));
};

/**
 * Lists the problems of a role input. A role with a problem cannot save. On update, each
 * published version that binds the role must still compile with the new role.
 */
export const checkWorkflowRole = (
  role: WorkflowRoleInput,
  context: {
    readonly roles: readonly CompiledAgentRoleDefinition[];
    readonly mode: "create" | "update";
    readonly bindingVersions: readonly WorkflowVersionDocument[];
  },
): WorkflowProblem[] => {
  const sink = createProblemSink();
  if (role.label.trim().length === 0)
    sink.error(["label"], "The role has no label. Enter a label.");
  const existing = context.roles.find(({ id }) => id === role.id);
  if (context.mode === "create" && existing)
    sink.error(["id"], `Role ID "${role.id}" is already used on this host. Pick another ID.`);
  if (context.mode === "update" && !existing)
    sink.error(["id"], `Role "${role.id}" does not exist. Create the role instead.`);
  const placeholderProblem = textPlaceholderProblem(
    role.instructions,
    [],
    BASE_PROMPT_PLACEHOLDERS,
  );
  if (placeholderProblem !== undefined)
    sink.error(
      ["instructions"],
      `The instructions have a placeholder problem. ${placeholderProblem}`,
    );
  if (context.mode !== "update" || !existing) return sink.problems;

  const updated = roleFromInput(role, existing);
  const catalog = context.roles.map((candidate) =>
    candidate.id === role.id ? updated : candidate,
  );
  const versionErrors = (
    version: WorkflowVersionDocument,
    roles: readonly CompiledAgentRoleDefinition[],
  ) => {
    const versionSink = createProblemSink();
    collectTaskWorkflowProblems(
      withBuiltinSharedFields(version.definition),
      version.prompts,
      roles,
      versionSink,
    );
    return versionSink.problems.filter(({ severity }) => severity === "error");
  };
  for (const version of context.bindingVersions) {
    // Only the problems that the new role adds count; others are not this save's fault.
    const before = new Set(versionErrors(version, context.roles).map(({ message }) => message));
    const added = versionErrors(version, catalog).find(({ message }) => !before.has(message));
    if (added)
      sink.error(
        ["tools"],
        `Version ${version.definition.revision} of workflow "${version.definition.label}" would stop working: ${added.message}`,
      );
  }
  return sink.problems;
};

import {
  TASK_CLOSED_STATE,
  TASK_OPEN_STATE,
  WORKFLOW_MESSAGE_PROMPT_PREFIX,
  type IssueType,
  type WorkflowAgentStepDefinition,
  type WorkflowArtifactDefinition,
  type WorkflowDocument,
  type WorkflowDocumentDefinition,
  type WorkflowEventDefinition,
  type WorkflowIssueTypeDefinition,
  type WorkflowLaunchActionDefinition,
  type WorkflowLibraryRole,
  type WorkflowPrompt,
  type WorkflowStepDefinition,
} from "@openducktor/contracts";
import {
  builtinWorkflowDocument,
  elementKey,
  idFromLabel,
  parseElementKey,
  type WorkflowElementKey,
  withBuiltinSharedFields,
} from "@openducktor/workflows";
import {
  DEFINITION_LISTS,
  type ElementOf,
  elementIds,
  isListElementKind,
  type ListElementKind,
  listOf,
} from "./document-elements";

/** Sets an optional field, or removes it for `undefined`, so a document never holds undefined. */
export const withOptional = <Value extends object, Key extends keyof Value>(
  value: Value,
  key: Key,
  field: Value[Key] | undefined,
): Value => {
  const next = { ...value };
  if (field === undefined) delete next[key];
  else next[key] = field;
  return next;
};

export const updateDefinition = (
  document: WorkflowDocument,
  update: (definition: WorkflowDocumentDefinition) => WorkflowDocumentDefinition,
): WorkflowDocument => ({ ...document, definition: update(document.definition) });

export const updateElement = <Kind extends ListElementKind>(
  document: WorkflowDocument,
  kind: Kind,
  id: string,
  update: (item: ElementOf<Kind>) => ElementOf<Kind>,
): WorkflowDocument =>
  updateDefinition(document, (definition) => ({
    ...definition,
    [DEFINITION_LISTS[kind]]: listOf(definition, kind).map((item) =>
      item.id === id ? update(item) : item,
    ),
  }));

export const updatePrompt = (
  document: WorkflowDocument,
  id: string,
  update: (prompt: WorkflowPrompt) => WorkflowPrompt,
): WorkflowDocument => ({
  ...document,
  prompts: document.prompts.map((prompt) => (prompt.id === id ? update(prompt) : prompt)),
});

export const appendElement = <Kind extends ListElementKind>(
  document: WorkflowDocument,
  kind: Kind,
  item: ElementOf<Kind>,
): WorkflowDocument =>
  updateDefinition(document, (definition) => ({
    ...definition,
    [DEFINITION_LISTS[kind]]: [...listOf(definition, kind), item],
  }));

/**
 * The document with the built-in name, title, short label, colour, and notification default of
 * each state ID and notification kind that the built-in workflow uses. The host applies the same
 * fields when it compiles a version, so the draft and its export hold what tasks get. The
 * document stays the same object when no field changes.
 */
export const withBuiltinStateFields = (document: WorkflowDocument): WorkflowDocument => {
  const { states } = document.definition;
  let changed = false;
  const next = withBuiltinSharedFields({ states }).states.map((state, index) => {
    const current = states[index]!;
    if (JSON.stringify(state) === JSON.stringify(current)) return current;
    changed = true;
    return state;
  });
  return changed
    ? updateDefinition(document, (definition) => ({ ...definition, states: next }))
    : document;
};

/** The result of an edit that creates an element: the document and the key to select. */
export type CreatedElement = {
  readonly document: WorkflowDocument;
  readonly key: WorkflowElementKey;
};

export const newId = (
  document: WorkflowDocument,
  kind: Parameters<typeof elementIds>[1],
  label: string,
) => idFromLabel(label, elementIds(document, kind));

/** A message prompt ID that no other prompt uses. */
const newMessagePromptId = (document: WorkflowDocument, launchId: string): string => {
  const taken = new Set(
    document.prompts
      .filter(({ id }) => id.startsWith(WORKFLOW_MESSAGE_PROMPT_PREFIX))
      .map(({ id }) => id.slice(WORKFLOW_MESSAGE_PROMPT_PREFIX.length)),
  );
  return `${WORKFLOW_MESSAGE_PROMPT_PREFIX}${idFromLabel(launchId, taken)}`;
};

/** The launch actions of every agent step. */
const allLaunchActions = (document: WorkflowDocument): WorkflowLaunchActionDefinition[] =>
  document.definition.steps.flatMap((step) => (step.kind === "agent" ? step.launchActions : []));

/** The agent step that owns a launch action, or undefined. */
export const stepOfLaunch = (
  document: WorkflowDocument,
  launchId: string | undefined,
): string | undefined =>
  launchId === undefined
    ? undefined
    : document.definition.steps.find(
        (step) =>
          step.kind === "agent" && step.launchActions.some((launch) => launch.id === launchId),
      )?.id;

/** The label, or the label with the first free number, so two ways to start never share a name. */
const freeLaunchLabel = (document: WorkflowDocument, label: string): string => {
  const taken = new Set(allLaunchActions(document).map((launch) => launch.label));
  let free = label;
  for (let suffix = 2; taken.has(free); suffix += 1) free = `${label} ${suffix}`;
  return free;
};

/**
 * A launch action of a step and its kickoff prompt. The prompt takes the name of the launch
 * action, and keeps it in step while the user renames the launch action.
 */
const newLaunch = (document: WorkflowDocument, requestedLabel: string) => {
  const label = freeLaunchLabel(document, requestedLabel);
  const id = newId(document, "launchAction", label);
  const promptId = newMessagePromptId(document, id);
  const launch: WorkflowLaunchActionDefinition = {
    id,
    label,
    startModes: ["fresh"],
    defaultStartMode: "fresh",
    template: { kind: "kickoff", id: promptId },
  };
  const prompt: WorkflowPrompt = {
    id: promptId,
    purpose: "kickoff",
    label,
    description: "",
    template: "Work on task {{task.id}}: {{task.title}}.\n\n{{task.description}}",
  };
  return { launch, prompt };
};

/**
 * Renames a launch action. Its prompt takes the new name too while the prompt still has the old
 * name and no other launch action uses it, so a new prompt never keeps a stale name.
 */
export const renameLaunchAction = (
  document: WorkflowDocument,
  launchId: string,
  label: string,
): WorkflowDocument => {
  const launch = allLaunchActions(document).find(({ id }) => id === launchId);
  if (!launch) return document;
  const promptId = launch.template.id;
  const shared = allLaunchActions(document).some(
    (other) => other.id !== launchId && other.template.id === promptId,
  );
  const renamed = updateDefinition(document, (definition) => ({
    ...definition,
    steps: definition.steps.map((step) =>
      step.kind === "agent"
        ? {
            ...step,
            launchActions: step.launchActions.map((current) =>
              current.id === launchId ? { ...current, label } : current,
            ),
          }
        : step,
    ),
  }));
  if (shared) return renamed;
  return updatePrompt(renamed, promptId, (prompt) =>
    prompt.label === launch.label ? { ...prompt, label } : prompt,
  );
};

/**
 * The role of a new agent step: the first bound role without a step, since each role does one
 * step, else the first bound role, else the first catalog role. Undefined when no role exists, so
 * no agent step can be added.
 */
export const newStepRole = (
  definition: WorkflowDocumentDefinition,
  catalogRoles: readonly WorkflowLibraryRole[],
): string | undefined => {
  const withStep = new Set(
    definition.steps.flatMap((step) => (step.kind === "agent" ? [step.roleId] : [])),
  );
  return (
    definition.roles.find(({ id }) => !withStep.has(id))?.id ??
    definition.roles[0]?.id ??
    catalogRoles[0]?.role.id
  );
};

/** A new step. An agent step gets a launch action and its message prompt. */
export const addStep = (
  document: WorkflowDocument,
  label: string,
  kind: { readonly kind: "human" } | { readonly kind: "agent"; readonly roleId: string },
): CreatedElement => {
  const id = newId(document, "step", label);
  const common = {
    id,
    label,
    inputs: [],
    outputs: [],
    requiredWhen: true,
    availableWhen: true,
    completedWhen: false,
  };
  if (kind.kind === "human") {
    const step: WorkflowStepDefinition = { ...common, kind: "human" };
    return { document: appendElement(document, "step", step), key: elementKey("step", id) };
  }
  const { launch, prompt } = newLaunch(document, `Start ${label}`);
  const step: WorkflowAgentStepDefinition = {
    ...common,
    kind: "agent",
    roleId: kind.roleId,
    launchActions: [launch],
  };
  // The workflow takes the role of a new agent step, so the step starts valid.
  const withRole = document.definition.roles.some(({ id: bound }) => bound === kind.roleId)
    ? document
    : bindRole(document, kind.roleId).document;
  const withStep = appendElement(withRole, "step", step);
  return {
    document: { ...withStep, prompts: [...withStep.prompts, prompt] },
    key: elementKey("step", id),
  };
};

/** Adds a launch action and its message prompt to an agent step. */
export const addLaunchAction = (
  document: WorkflowDocument,
  stepId: string,
  label: string,
): WorkflowDocument => {
  const { launch, prompt } = newLaunch(document, label);
  const next = updateElement(document, "step", stepId, (step) =>
    step.kind === "agent" ? { ...step, launchActions: [...step.launchActions, launch] } : step,
  );
  return { ...next, prompts: [...next.prompts, prompt] };
};

/**
 * The transition of a new verdict. It starts from the given states and keeps the state, so the
 * review is valid at once, and the user then picks the state that the verdict moves the task to.
 */
const verdictEvent = (
  document: WorkflowDocument,
  artifact: { readonly id: string; readonly label: string },
  verdictLabel: string,
  from: readonly string[],
): WorkflowEventDefinition => ({
  id: newId(document, "event", `${artifact.id} ${verdictLabel}`),
  label: `${artifact.label || artifact.id}: ${verdictLabel}`,
  from: [...from],
  guards: [],
  outcomes: [{ when: true, to: null }],
});

/** A new artifact. A review gets one passing verdict, with its own transition. */
export const addArtifact = (
  document: WorkflowDocument,
  label: string,
  kind: WorkflowArtifactDefinition["kind"],
): CreatedElement => {
  const id = newId(document, "artifact", label);
  const key = elementKey("artifact", id);
  if (kind === "document")
    return { document: appendElement(document, "artifact", { id, label, kind }), key };
  const event = verdictEvent(document, { id, label }, "Approved", [TASK_OPEN_STATE]);
  const artifact: WorkflowArtifactDefinition = {
    id,
    label,
    kind,
    verdicts: [{ id: "approved", label: "Approved", passes: true, eventId: event.id }],
  };
  return {
    document: appendElement(appendElement(document, "event", event), "artifact", artifact),
    key,
  };
};

/**
 * A new verdict of a review, with its own transition from the states of the first verdict. After
 * a passing verdict, the new verdict rejects the work, since that is the next verdict of most
 * reviews.
 */
export const addVerdict = (document: WorkflowDocument, artifactId: string): CreatedElement => {
  const key = elementKey("artifact", artifactId);
  const artifact = document.definition.artifacts.find(({ id }) => id === artifactId);
  if (artifact?.kind !== "review") return { document, key };
  const passes = !artifact.verdicts.some((verdict) => verdict.passes);
  const label = passes ? "Approved" : "Rejected";
  const sources = document.definition.events.find(({ id }) => id === artifact.verdicts[0]?.eventId)
    ?.from ?? [TASK_OPEN_STATE];
  const event = verdictEvent(document, artifact, label, sources);
  const verdict = {
    id: idFromLabel(label, new Set(artifact.verdicts.map(({ id }) => id))),
    label,
    passes,
    eventId: event.id,
  };
  const withEvent = appendElement(document, "event", event);
  return {
    document: updateDefinition(withEvent, (definition) => ({
      ...definition,
      artifacts: definition.artifacts.map((current) =>
        current.id === artifactId && current.kind === "review"
          ? { ...current, verdicts: [...current.verdicts, verdict] }
          : current,
      ),
    })),
    key,
  };
};

export const addSignal = (document: WorkflowDocument, label: string): CreatedElement => {
  const id = newId(document, "signal", label);
  return {
    document: appendElement(document, "signal", { id, label, description: "", automations: [] }),
    key: elementKey("signal", id),
  };
};

export const addAutomation = (document: WorkflowDocument, label: string): CreatedElement => {
  const id = newId(document, "automation", label);
  const launchActionId = [...elementIds(document, "launchAction")][0] ?? id;
  return {
    document: appendElement(document, "automation", {
      id,
      label,
      description: "",
      launchActionId,
    }),
    key: elementKey("automation", id),
  };
};

/** Binds a catalog role. The workflow then lists what the role may write. */
export const bindRole = (document: WorkflowDocument, roleId: string): CreatedElement => ({
  document: appendElement(document, "role", { id: roleId, writes: [] }),
  key: elementKey("role", roleId),
});

/**
 * The name, description, and icon of each built-in issue type, as a new workflow has them. The
 * built-in guidance names built-in roles, so it stays out.
 */
export const BUILTIN_ISSUE_TYPES: ReadonlyMap<IssueType, WorkflowIssueTypeDefinition> = new Map(
  builtinWorkflowDocument().definition.issueTypes.map(({ id, label, description, icon }) => [
    id,
    { id, label, description, icon },
  ]),
);

/** The order of the issue types in the editor: the order of the built-in workflow. */
export const ISSUE_TYPE_ORDER: readonly IssueType[] = [...BUILTIN_ISSUE_TYPES.keys()];

/**
 * Puts a type back after the last supported type that comes before it in `ISSUE_TYPE_ORDER`, so
 * a toggle never moves the other types or changes the first one by accident.
 */
const withIssueTypeInPlace = (
  issueTypes: WorkflowIssueTypeDefinition[],
  added: WorkflowIssueTypeDefinition,
): WorkflowIssueTypeDefinition[] => {
  const before = new Set(ISSUE_TYPE_ORDER.slice(0, ISSUE_TYPE_ORDER.indexOf(added.id)));
  const anchor = issueTypes.findLastIndex(({ id }) => before.has(id));
  return [...issueTypes.slice(0, anchor + 1), added, ...issueTypes.slice(anchor + 1)];
};

/**
 * The definition without a default issue type that is gone or that is the first type, since new
 * tasks take the first type without a default.
 */
const withPlainDefaultIssueType = (
  definition: WorkflowDocumentDefinition,
): WorkflowDocumentDefinition => {
  const chosen = definition.defaultIssueType;
  if (chosen === undefined) return definition;
  const kept = definition.issueTypes.some(({ id }) => id === chosen);
  return kept && definition.issueTypes[0]?.id !== chosen
    ? definition
    : withOptional(definition, "defaultIssueType", undefined);
};

/**
 * Adds or removes a supported issue type. An added type gets its built-in name, description, and
 * icon. The default issue type goes with a removed type, and with a type that becomes the first.
 */
export const setIssueTypeSupported = (
  document: WorkflowDocument,
  issueType: IssueType,
  supported: boolean,
): WorkflowDocument =>
  updateDefinition(document, (definition) => {
    if (supported) {
      if (definition.issueTypes.some(({ id }) => id === issueType)) return definition;
      // A type that comes first does not take the place of the default type of new tasks.
      const defaultIssueType = definition.defaultIssueType ?? definition.issueTypes[0]?.id;
      return withPlainDefaultIssueType(
        withOptional(
          {
            ...definition,
            issueTypes: withIssueTypeInPlace(
              definition.issueTypes,
              BUILTIN_ISSUE_TYPES.get(issueType) ?? { id: issueType, label: issueType },
            ),
          },
          "defaultIssueType",
          defaultIssueType,
        ),
      );
    }
    return withPlainDefaultIssueType({
      ...definition,
      issueTypes: definition.issueTypes.filter(({ id }) => id !== issueType),
    });
  });

/** Adds a built-in issue type, which the editor then selects. */
export const addIssueType = (document: WorkflowDocument, issueType: IssueType): CreatedElement => ({
  document: setIssueTypeSupported(document, issueType, true),
  key: elementKey("issueType", issueType),
});

/** Adds a prompt. A message prompt ID starts with `messages.`. */
export const addPrompt = (document: WorkflowDocument, prompt: WorkflowPrompt): CreatedElement => ({
  document: { ...document, prompts: [...document.prompts, prompt] },
  key: elementKey("prompt", prompt.id),
});

/** A new message prompt with an ID from its label. */
export const addMessagePrompt = (document: WorkflowDocument, label: string): CreatedElement =>
  addPrompt(document, {
    id: newMessagePromptId(document, label),
    purpose: "message",
    label,
    description: "",
    template: "Continue task {{task.id}}: {{task.title}}.",
  });

/** The board buttons that only send the event, which go with a deleted transition. */
export const buttonsOfEvent = (
  definition: Pick<WorkflowDocumentDefinition, "actions">,
  eventId: string,
): readonly WorkflowDocumentDefinition["actions"][number][] =>
  definition.actions.filter((action) => action.kind === "event" && action.eventId === eventId);

/** Deletes a transition with its board buttons, and takes the buttons out of the button order. */
const deleteEvent = (document: WorkflowDocument, eventId: string): WorkflowDocument =>
  updateDefinition(document, (definition) => {
    const buttons = new Set(buttonsOfEvent(definition, eventId).map(({ id }) => id));
    const withoutButtons = (rules: typeof definition.actionOrder) =>
      rules.map((rule) => ({ ...rule, actions: rule.actions.filter((id) => !buttons.has(id)) }));
    return {
      ...definition,
      events: definition.events.filter(({ id }) => id !== eventId),
      actions: definition.actions.filter(({ id }) => !buttons.has(id)),
      actionOrder: withoutButtons(definition.actionOrder),
      actionPriority: withoutButtons(definition.actionPriority),
    };
  });

/**
 * The transitions that a deleted state takes with it: those that leave only from it, and those
 * that lead only to it. A transition from other states too keeps them.
 */
export const eventsOfState = (
  definition: Pick<WorkflowDocumentDefinition, "events">,
  stateId: string,
): readonly WorkflowDocumentDefinition["events"][number][] =>
  definition.events.filter((event) => {
    const targets = event.outcomes.flatMap(({ to }) => (to === null ? [] : [to]));
    const onlyFrom = event.from.length > 0 && event.from.every((id) => id === stateId);
    const onlyTo = targets.length > 0 && targets.every((to) => to === stateId);
    return onlyFrom || onlyTo;
  });

/** Deletes a state with the transitions that only it uses, and its place on the canvas. */
const deleteState = (document: WorkflowDocument, stateId: string): WorkflowDocument => {
  const withoutEvents = eventsOfState(document.definition, stateId).reduce(
    (current, event) => deleteEvent(current, event.id),
    document,
  );
  const next = updateDefinition(withoutEvents, (definition) => ({
    ...definition,
    states: definition.states.filter(({ id }) => id !== stateId),
    events: definition.events.map((event) =>
      event.from.includes(stateId)
        ? { ...event, from: event.from.filter((id) => id !== stateId) }
        : event,
    ),
  }));
  if (!Object.hasOwn(next.layout.states, stateId)) return next;
  const { [stateId]: _removed, ...states } = next.layout.states;
  return { ...next, layout: { states } };
};

/**
 * Deletes an element. References to it stay, so each one shows as a problem until the user fixes
 * it. A deleted transition takes its board buttons, which only send it. A deleted state takes the
 * transitions that only it uses, and leaves the canvas layout.
 */
export const deleteElement = (
  document: WorkflowDocument,
  key: WorkflowElementKey,
): WorkflowDocument => {
  const { kind, id } = parseElementKey(key);
  if (kind === "event") return deleteEvent(document, id);
  if (kind === "state") return deleteState(document, id);
  if (kind === "prompt")
    return { ...document, prompts: document.prompts.filter((prompt) => prompt.id !== id) };
  if (!isListElementKind(kind)) return document;
  return updateDefinition(document, (definition) => ({
    ...definition,
    [DEFINITION_LISTS[kind]]: listOf(definition, kind).filter((item) => item.id !== id),
  }));
};

/** The core states stay in every workflow. */
export const isCoreState = (id: string): boolean =>
  id === TASK_OPEN_STATE || id === TASK_CLOSED_STATE;

/** Whether the user can delete the element: a list item or a prompt, but not a core state. */
export const isDeletable = (key: WorkflowElementKey): boolean => {
  const { kind, id } = parseElementKey(key);
  if (kind === "prompt") return id !== "";
  return isListElementKind(kind) && !(kind === "state" && isCoreState(id));
};

/** Moves an item of a list by one place. The board shows states in this column order. */
export const moveInList = <Item>(list: readonly Item[], index: number, offset: -1 | 1): Item[] => {
  const target = index + offset;
  if (target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
};

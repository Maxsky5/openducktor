import {
  ISSUE_TYPE_VALUES,
  PULL_REQUEST_LAUNCH_ID,
  type WorkflowCondition,
  type WorkflowDocument,
  type WorkflowDocumentDefinition,
} from "@openducktor/contracts";

/** The kinds of workflow elements that other elements can name. */
export const WORKFLOW_ELEMENT_KINDS = [
  "workflow",
  "issueType",
  "role",
  "artifact",
  "verdict",
  "state",
  "step",
  "launchAction",
  "action",
  "event",
  "signal",
  "automation",
  "prompt",
  "actionOrder",
  "actionPriority",
  "launchOrder",
] as const;
export type WorkflowElementKind = (typeof WORKFLOW_ELEMENT_KINDS)[number];

/**
 * A stable key of an element: `state:open`, `event:submit`. A verdict key names its review:
 * `verdict:qa_report/approved`. The rule lists have one key each, such as `actionOrder`.
 */
export type WorkflowElementKey = string;

export const elementKey = (kind: WorkflowElementKind, id = ""): WorkflowElementKey =>
  id === "" ? kind : `${kind}:${id}`;
export const verdictKey = (artifactId: string, verdictId: string): WorkflowElementKey =>
  elementKey("verdict", `${artifactId}/${verdictId}`);

/** An element: its kind and its ID. A rule list has an empty ID. */
export type WorkflowElement = { readonly kind: WorkflowElementKind; readonly id: string };

export const parseElementKey = (key: WorkflowElementKey): WorkflowElement => {
  const separator = key.indexOf(":");
  const name = separator < 0 ? key : key.slice(0, separator);
  const kind = WORKFLOW_ELEMENT_KINDS.find((candidate) => candidate === name);
  if (!kind) throw new Error(`Unknown workflow element key "${key}".`);
  return { kind, id: separator < 0 ? "" : key.slice(separator + 1) };
};

/** Issue types are a fixed vocabulary, so no rename reaches them. */
const fixedIssueType = (): never => {
  throw new Error("Issue types are fixed. Pick another issue type instead.");
};

type Reference = {
  readonly owner: WorkflowElementKey;
  readonly kind: WorkflowElementKind;
  readonly id: string;
  /** Replaces the ID in the definition that the visit walks. */
  readonly replace: (id: string) => void;
};

/** Walks every reference of a condition. A verdict comparison also names its review. */
const visitCondition = (
  condition: WorkflowCondition,
  owner: WorkflowElementKey,
  visit: (reference: Reference) => void,
): void => {
  if (condition === true || condition === false) return;
  if ("fact" in condition) {
    const issueType = ISSUE_TYPE_VALUES.find((value) => value === condition.equals);
    if (condition.fact === "issueType" && issueType)
      visit({ owner, kind: "issueType", id: issueType, replace: fixedIssueType });
    return;
  }
  if ("artifact" in condition) {
    visit({
      owner,
      kind: "artifact",
      id: condition.artifact,
      replace: (id) => {
        condition.artifact = id;
      },
    });
    if ("verdict" in condition)
      visit({
        owner,
        kind: "verdict",
        id: `${condition.artifact}/${condition.verdict}`,
        replace: (id) => {
          condition.verdict = id.slice(id.indexOf("/") + 1);
        },
      });
    return;
  }
  if ("stateIn" in condition) {
    condition.stateIn.forEach((state, index) =>
      visit({
        owner,
        kind: "state",
        id: state,
        replace: (id) => {
          condition.stateIn[index] = id;
        },
      }),
    );
    return;
  }
  if ("not" in condition) {
    visitCondition(condition.not, owner, visit);
    return;
  }
  for (const child of "all" in condition ? condition.all : condition.any)
    visitCondition(child, owner, visit);
};

const visitList = (
  list: string[],
  owner: WorkflowElementKey,
  kind: WorkflowElementKind,
  visit: (reference: Reference) => void,
) =>
  list.forEach((value, index) =>
    visit({
      owner,
      kind,
      id: value,
      replace: (id) => {
        list[index] = id;
      },
    }),
  );

/**
 * Walks every reference that a definition holds, with the element that holds it. The walk can
 * replace IDs, so a caller that changes them passes a copy.
 */
export const visitWorkflowReferences = (
  definition: WorkflowDocumentDefinition,
  visit: (reference: Reference) => void,
): void => {
  const ref = (
    owner: WorkflowElementKey,
    kind: WorkflowElementKind,
    id: string | undefined,
    replace: (id: string) => void,
  ) => {
    if (id !== undefined) visit({ owner, kind, id, replace });
  };
  ref("workflow", "issueType", definition.defaultIssueType, fixedIssueType);
  visitList(definition.pullRequestRoles, "workflow", "role", visit);
  for (const role of definition.roles) {
    const owner = elementKey("role", role.id);
    visitList(role.writes, owner, "artifact", visit);
    ref(owner, "artifact", role.defaultArtifact, (id) => {
      role.defaultArtifact = id;
    });
  }
  for (const artifact of definition.artifacts) {
    const owner = elementKey("artifact", artifact.id);
    if (artifact.kind === "document") {
      ref(owner, "event", artifact.saveEventId, (id) => {
        artifact.saveEventId = id;
      });
      continue;
    }
    for (const verdict of artifact.verdicts)
      ref(owner, "event", verdict.eventId, (id) => {
        verdict.eventId = id;
      });
  }
  for (const state of definition.states) {
    const owner = elementKey("state", state.id);
    const notification = state.notification;
    if (notification)
      ref(owner, "role", notification.role, (id) => {
        notification.role = id;
      });
    ref(owner, "role", state.studioRole, (id) => {
      state.studioRole = id;
    });
    if (state.historyRoles) visitList(state.historyRoles, owner, "role", visit);
  }
  for (const step of definition.steps) {
    const owner = elementKey("step", step.id);
    visitList(step.inputs, owner, "artifact", visit);
    visitList(step.outputs, owner, "artifact", visit);
    visitCondition(step.requiredWhen, owner, visit);
    visitCondition(step.availableWhen, owner, visit);
    visitCondition(step.completedWhen, owner, visit);
    if (step.kind !== "agent") continue;
    ref(owner, "role", step.roleId, (id) => {
      step.roleId = id;
    });
    ref(owner, "event", step.startEventId, (id) => {
      step.startEventId = id;
    });
    for (const rule of step.displayRules ?? []) visitCondition(rule.when, owner, visit);
    for (const launch of step.launchActions) {
      const launchOwner = elementKey("launchAction", launch.id);
      ref(owner, "launchAction", launch.id, (id) => {
        launch.id = id;
      });
      ref(launchOwner, "prompt", launch.template.id, (id) => {
        launch.template.id = id;
      });
      if (launch.selectWhen !== undefined) visitCondition(launch.selectWhen, launchOwner, visit);
      if (launch.showWhen !== undefined) visitCondition(launch.showWhen, launchOwner, visit);
    }
  }
  for (const action of definition.actions) {
    const owner = elementKey("action", action.id);
    ref(owner, "step", action.stepId, (id) => {
      action.stepId = id;
    });
    visitCondition(action.availableWhen, owner, visit);
    for (const variant of action.labels ?? []) visitCondition(variant.when, owner, visit);
    if (action.kind !== "event" && action.kind !== "session") continue;
    ref(owner, "event", action.eventId, (id) => {
      action.eventId = id;
    });
    if (action.launchActionIds) visitList(action.launchActionIds, owner, "launchAction", visit);
  }
  for (const event of definition.events) {
    const owner = elementKey("event", event.id);
    visitList(event.from, owner, "state", visit);
    if (event.agent) visitList(event.agent.roles, owner, "role", visit);
    for (const effect of event.effects ?? [])
      visitList(effect.clearsSessionsOf, owner, "role", visit);
    for (const guard of event.guards) visitCondition(guard.when, owner, visit);
    for (const outcome of event.outcomes) {
      ref(owner, "state", outcome.to ?? undefined, (id) => {
        outcome.to = id;
      });
      ref(owner, "signal", outcome.signal, (id) => {
        outcome.signal = id;
      });
      ref(owner, "role", outcome.sourceRole, (id) => {
        outcome.sourceRole = id;
      });
      visitCondition(outcome.when, owner, visit);
    }
  }
  for (const signal of definition.signals)
    visitList(signal.automations, elementKey("signal", signal.id), "automation", visit);
  for (const automation of definition.automations)
    ref(
      elementKey("automation", automation.id),
      "launchAction",
      automation.launchActionId,
      (id) => {
        automation.launchActionId = id;
      },
    );
  for (const key of ["actionOrder", "actionPriority"] as const)
    for (const rule of definition[key]) {
      visitCondition(rule.when, key, visit);
      visitList(rule.actions, key, "action", visit);
    }
  for (const rule of definition.launchOrder) {
    visitCondition(rule.when, "launchOrder", visit);
    visitList(rule.order, "launchOrder", "launchAction", visit);
  }
};

/** For each element, the elements that it names, and the elements that name it. */
export type WorkflowReferenceIndex = {
  readonly names: ReadonlyMap<WorkflowElementKey, ReadonlySet<WorkflowElementKey>>;
  readonly namedBy: ReadonlyMap<WorkflowElementKey, ReadonlySet<WorkflowElementKey>>;
};

const addTo = (
  map: Map<WorkflowElementKey, Set<WorkflowElementKey>>,
  key: WorkflowElementKey,
  value: WorkflowElementKey,
) => {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
};

/** The references of a definition. The core pull request launch has no element. */
export const workflowReferenceIndex = (
  definition: WorkflowDocumentDefinition,
): WorkflowReferenceIndex => {
  const names = new Map<WorkflowElementKey, Set<WorkflowElementKey>>();
  const namedBy = new Map<WorkflowElementKey, Set<WorkflowElementKey>>();
  visitWorkflowReferences(definition, ({ owner, kind, id }) => {
    if (kind === "launchAction" && id === PULL_REQUEST_LAUNCH_ID) return;
    const target = elementKey(kind, id);
    if (target === owner) return;
    addTo(names, owner, target);
    addTo(namedBy, target, owner);
    // A verdict comparison names its review too.
    if (kind === "verdict") {
      const review = elementKey("artifact", id.slice(0, id.indexOf("/")));
      addTo(names, owner, review);
      addTo(namedBy, review, owner);
    }
  });
  return { names, namedBy };
};

/** The kinds of elements whose ID a draft can change. */
export type RenameableElementKind = Exclude<
  WorkflowElementKind,
  "workflow" | "issueType" | "actionOrder" | "actionPriority" | "launchOrder"
>;

/**
 * Changes the ID of an element and every reference to it, layout keys included. For a verdict,
 * `from` and `to` are `artifact/verdict`. For a role, the draft binds another catalog role.
 */
export const renameWorkflowElement = (
  document: WorkflowDocument,
  kind: RenameableElementKind,
  from: string,
  to: string,
): WorkflowDocument => {
  if (from === to) return document;
  const next = structuredClone(document);
  const definition = next.definition;
  visitWorkflowReferences(definition, (reference) => {
    if (reference.kind === kind && reference.id === from) reference.replace(to);
    // A review rename moves its verdict references too.
    if (kind === "artifact" && reference.kind === "verdict" && reference.id.startsWith(`${from}/`))
      reference.replace(`${to}/${reference.id.slice(from.length + 1)}`);
  });
  const renameIn = (items: { id: string }[]) => {
    for (const item of items) if (item.id === from) item.id = to;
  };
  switch (kind) {
    case "role":
      renameIn(definition.roles);
      break;
    case "artifact":
      renameIn(definition.artifacts);
      break;
    case "verdict": {
      const [artifactId, verdictId] = [
        from.slice(0, from.indexOf("/")),
        from.slice(from.indexOf("/") + 1),
      ];
      const newVerdictId = to.slice(to.indexOf("/") + 1);
      const artifact = definition.artifacts.find(({ id }) => id === artifactId);
      if (artifact?.kind === "review")
        for (const verdict of artifact.verdicts)
          if (verdict.id === verdictId) verdict.id = newVerdictId;
      break;
    }
    case "state":
      renameIn(definition.states);
      if (Object.hasOwn(next.layout.states, from)) {
        const states: typeof next.layout.states = {};
        for (const [id, position] of Object.entries(next.layout.states))
          states[id === from ? to : id] = position;
        next.layout.states = states;
      }
      break;
    case "step":
      renameIn(definition.steps);
      break;
    case "launchAction":
      // The visit renames launch actions through their step.
      break;
    case "action":
      renameIn(definition.actions);
      break;
    case "event":
      renameIn(definition.events);
      break;
    case "signal":
      renameIn(definition.signals);
      break;
    case "automation":
      renameIn(definition.automations);
      break;
    case "prompt":
      renameIn(next.prompts);
      break;
  }
  return next;
};

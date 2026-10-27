import {
  workflowConditionSchema,
  workflowDefinitionSchema,
  type CompiledWorkflowDefinition,
  type WorkflowArtifactDefinition,
  type WorkflowCondition,
  type WorkflowDecision,
  type WorkflowDefinition,
  type WorkflowFactDefinition,
  type WorkflowIds,
  type WorkflowInput,
  type WorkflowStepProjection,
  type WorkflowValue,
} from "@openducktor/contracts";
import { deepFreeze } from "./deep-freeze";

export type WorkflowEvaluationErrorCode =
  | "invalid_definition"
  | "invalid_condition"
  | "invalid_input"
  | "unknown_state"
  | "missing_fact"
  | "missing_artifact"
  | "unknown_action"
  | "unknown_event"
  | "unknown_step"
  | "missing_launch_action"
  | "missing_event_outcome";

export class WorkflowEvaluationError extends Error {
  constructor(
    readonly code: WorkflowEvaluationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowEvaluationError";
  }
}

export type WorkflowPredicate = (input: WorkflowInput) => boolean;

/** The ID types that a definition declares. */
export type WorkflowIdsOf<Definition extends WorkflowDefinition> = {
  state: Definition["states"][number]["id"];
  event: Definition["events"][number]["id"];
  action: Definition["actions"][number]["id"];
  step: Definition["steps"][number]["id"];
  role: Definition["roles"][number]["id"];
  signal: Definition["signals"][number]["id"];
  launchAction: Extract<
    Definition["steps"][number],
    { kind: "agent" }
  >["launchActions"][number]["id"];
};

export type Workflow<Ids extends WorkflowIds = WorkflowIds> = {
  readonly definition: CompiledWorkflowDefinition;
  steps(input: WorkflowInput): WorkflowStepProjection[];
  availableActions(input: WorkflowInput): Ids["action"][];
  isEventAvailable(input: WorkflowInput, eventId: Ids["event"]): boolean;
  decide(input: WorkflowInput, eventId: Ids["event"]): WorkflowDecision<Ids>;
  /** Checks an extra condition against this definition once and returns its predicate. */
  condition(condition: WorkflowCondition): WorkflowPredicate;
  /** The default launch action of an agent step. */
  stepLaunchAction(input: WorkflowInput, stepId: Ids["step"]): Ids["launchAction"];
  /** The launch action that an action starts. */
  actionLaunchAction(input: WorkflowInput, actionId: Ids["action"]): Ids["launchAction"];
  actionLabel(input: WorkflowInput, actionId: Ids["action"]): string;
  /**
   * Puts the actions of the first matching priority rule first, then the actions of the first
   * matching order rule. Other actions keep their given order at the end. A caller that knows
   * live state can replace the priority rule with its own leading actions.
   */
  orderActions<Action extends Ids["action"]>(
    input: WorkflowInput,
    actionIds: readonly Action[],
    ahead?: readonly Ids["action"][],
  ): Action[];
};

type Denial = { reason: "source_state" } | { reason: "guard"; guardId: string } | null;
type CompiledOutcome = {
  test: WorkflowPredicate;
  to: string | null;
  signal: string | undefined;
  sourceRole: string | undefined;
};
type CompiledEvent = {
  from: ReadonlySet<string>;
  guards: readonly { id: string; test: WorkflowPredicate }[];
  outcomes: readonly CompiledOutcome[];
};
type CompiledLaunchCandidate = { id: string; select: WorkflowPredicate | null };
type LaunchCandidates = readonly [CompiledLaunchCandidate, ...CompiledLaunchCandidate[]];
type CompiledAction = {
  id: string;
  label: string;
  labels: readonly { test: WorkflowPredicate; label: string }[];
  available: WorkflowPredicate;
  event: CompiledEvent | null;
  launchCandidates: LaunchCandidates | null;
};
type CompiledRule = { test: WorkflowPredicate; actions: readonly string[] };

/** Parses, checks, freezes, and compiles a private copy. Conditions and outcomes short-circuit in order. */
export const createWorkflow = <const Definition extends WorkflowDefinition>(
  source: Definition,
): Workflow<WorkflowIdsOf<Definition>> => {
  const definition = parseDefinition(source);
  const identity = { workflowId: definition.id, definitionRevision: definition.revision };
  const states = new Set(definition.states.map((state) => state.id));
  const terminalStates = new Set(
    definition.states.filter((state) => state.terminal).map((state) => state.id),
  );
  const facts = new Map(
    definition.facts.map((fact) => [fact.id, { fact, accepts: valueTest(fact) }] as const),
  );
  const artifacts = new Map(definition.artifacts.map((artifact) => [artifact.id, artifact]));
  checkDefinition(definition);

  const events = new Map(
    definition.events.map((event): [string, CompiledEvent] => [
      event.id,
      {
        from: new Set(event.from),
        guards: event.guards.map((guard) => ({ id: guard.id, test: compile(guard.when) })),
        outcomes: event.outcomes.map((outcome) => ({
          test: compile(outcome.when),
          to: outcome.to,
          signal: outcome.signal,
          sourceRole: outcome.sourceRole,
        })),
      },
    ]),
  );
  const launchSelectors = new Map<string, WorkflowPredicate | null>();
  for (const step of definition.steps) {
    if (step.kind !== "agent") continue;
    for (const launch of step.launchActions) {
      launchSelectors.set(
        launch.id,
        launch.selectWhen === undefined ? null : compile(launch.selectWhen),
      );
    }
  }
  const launchCandidates = (ids: readonly string[]): LaunchCandidates | null => {
    const [first, ...rest] = ids.map((id) => ({ id, select: launchSelectors.get(id) ?? null }));
    return first === undefined ? null : [first, ...rest];
  };
  const actions = definition.actions.map((action): CompiledAction => ({
    id: action.id,
    label: action.label,
    labels: (action.labels ?? []).map((variant) => ({
      test: compile(variant.when),
      label: variant.label,
    })),
    available: compile(action.availableWhen),
    event:
      action.kind !== "view" && action.eventId !== undefined ? eventById(action.eventId) : null,
    launchCandidates:
      action.kind === "view" ? null : launchCandidates(action.launchActionIds ?? []),
  }));
  const actionsById = new Map(actions.map((action) => [action.id, action]));
  const steps = definition.steps.map((step) => ({
    step,
    required: compile(step.requiredWhen),
    available: compile(step.availableWhen),
    completed: compile(step.completedWhen),
  }));
  const stepLaunchCandidates = new Map(
    definition.steps.flatMap((step) =>
      step.kind === "agent"
        ? [[step.id, launchCandidates(step.launchActions.map((launch) => launch.id))] as const]
        : [],
    ),
  );
  const compileRules = (rules: WorkflowDefinition["actionOrder"]): CompiledRule[] =>
    rules.map((rule) => ({ test: compile(rule.when), actions: rule.actions }));
  const actionOrder = compileRules(definition.actionOrder);
  const actionPriority = compileRules(definition.actionPriority);
  // Board renders order actions often, so each pair of matched rules builds its ranks once.
  const ruleRanks = new Map<number, ReadonlyMap<string, number>>();
  const ranksFor = (priorityIndex: number, orderIndex: number): ReadonlyMap<string, number> => {
    const key = (priorityIndex + 1) * (actionOrder.length + 1) + orderIndex + 1;
    const cached = ruleRanks.get(key);
    if (cached) return cached;
    const ranks = rankActions(
      actionPriority[priorityIndex]?.actions ?? [],
      actionOrder[orderIndex]?.actions ?? [],
    );
    ruleRanks.set(key, ranks);
    return ranks;
  };

  const workflow: Workflow = {
    definition,
    steps(input) {
      checkInput(input);
      return steps.map(({ step, required, available, completed }): WorkflowStepProjection => {
        const fields = {
          id: step.id,
          label: step.label,
          inputs: step.inputs,
          outputs: step.outputs,
          required: required(input),
          available: available(input),
          completed: completed(input),
        };
        return step.kind === "agent"
          ? { ...fields, kind: "agent", roleId: step.roleId }
          : { ...fields, kind: "human" };
      });
    },
    availableActions(input) {
      checkInput(input);
      const available: string[] = [];
      for (const action of actions) {
        if (actionAvailable(input, action)) available.push(action.id);
      }
      return available;
    },
    isEventAvailable(input, eventId) {
      checkInput(input);
      return findDenial(input, eventById(eventId)) === null;
    },
    decide(input, eventId) {
      checkInput(input);
      const event = eventById(eventId);
      const denial = findDenial(input, event);
      if (denial !== null)
        return { ...identity, kind: "denied", eventId, state: input.state, ...denial };
      for (const outcome of event.outcomes) {
        if (!outcome.test(input)) continue;
        const to = outcome.to ?? input.state;
        if (to === input.state)
          return { ...identity, kind: "unchanged", eventId, state: input.state };
        if (terminalStates.has(input.state)) {
          return {
            ...identity,
            kind: "denied",
            eventId,
            state: input.state,
            reason: "terminal_state",
          };
        }
        const decision: Extract<WorkflowDecision, { kind: "transition" }> = {
          ...identity,
          kind: "transition",
          eventId,
          from: input.state,
          to,
        };
        if (outcome.signal !== undefined) decision.signal = outcome.signal;
        if (outcome.sourceRole !== undefined) decision.sourceRole = outcome.sourceRole;
        return decision;
      }
      throw new WorkflowEvaluationError(
        "missing_event_outcome",
        `Workflow "${definition.id}" has no matching outcome for event "${eventId}" in state "${input.state}". Add a matching outcome or fix its conditions.`,
      );
    },
    condition(condition) {
      const parsed = workflowConditionSchema.safeParse(condition);
      if (!parsed.success) {
        throw new WorkflowEvaluationError(
          "invalid_condition",
          `Invalid condition for workflow "${definition.id}": ${firstIssueMessage(parsed.error.issues, "condition")}. Use a data-only workflow condition.`,
        );
      }
      createConditionCheck(definition, (message) => {
        throw new WorkflowEvaluationError(
          "invalid_condition",
          `Invalid condition for workflow "${definition.id}". ${message}`,
        );
      })(parsed.data, "condition");
      const test = compile(parsed.data);
      return (input) => {
        checkInput(input);
        return test(input);
      };
    },
    stepLaunchAction(input, stepId) {
      checkInput(input);
      const candidates = stepLaunchCandidates.get(stepId);
      if (!candidates) {
        throw new WorkflowEvaluationError(
          "unknown_step",
          `Workflow "${definition.id}" has no agent step "${stepId}". Use an agent step ID.`,
        );
      }
      return selectLaunchAction(input, candidates);
    },
    actionLaunchAction(input, actionId) {
      checkInput(input);
      const action = actionById(actionId);
      if (action.launchCandidates === null) {
        throw new WorkflowEvaluationError(
          "missing_launch_action",
          `Action "${actionId}" of workflow "${definition.id}" starts no session. Use an action with launch actions.`,
        );
      }
      return selectLaunchAction(input, action.launchCandidates);
    },
    actionLabel(input, actionId) {
      checkInput(input);
      const action = actionById(actionId);
      for (const variant of action.labels) if (variant.test(input)) return variant.label;
      return action.label;
    },
    orderActions(input, actionIds, ahead) {
      checkInput(input);
      const orderIndex = actionOrder.findIndex((rule) => rule.test(input));
      const rank = ahead
        ? rankActions(ahead, actionOrder[orderIndex]?.actions ?? [])
        : ranksFor(
            actionPriority.findIndex((rule) => rule.test(input)),
            orderIndex,
          );
      const ranked = actionIds.filter((id) => rank.has(id));
      ranked.sort((left, right) => (rank.get(left) ?? 0) - (rank.get(right) ?? 0));
      for (const id of actionIds) if (!rank.has(id)) ranked.push(id);
      return ranked;
    },
  };
  // SAFETY: parseDefinition checked that every ID that a query returns is declared by this definition.
  return workflow as Workflow<WorkflowIdsOf<Definition>>;

  function checkInput(input: WorkflowInput): void {
    if (input.workflowId !== definition.id || input.definitionRevision !== definition.revision) {
      throw new WorkflowEvaluationError(
        "invalid_input",
        `Input identifies workflow "${input.workflowId}" revision ${input.definitionRevision}. Use workflowId "${definition.id}" and definitionRevision ${definition.revision}.`,
      );
    }
    if (!states.has(input.state)) {
      throw new WorkflowEvaluationError(
        "unknown_state",
        `Workflow "${definition.id}" has no state "${input.state}". Use an ID from its states.`,
      );
    }
    const suppliedFacts = input.facts;
    for (const id in suppliedFacts) {
      const declared = facts.get(id);
      if (!declared) {
        throw new WorkflowEvaluationError(
          "invalid_input",
          `Workflow "${definition.id}" has no fact "${id}". Remove facts.${id} or declare the fact.`,
        );
      }
      if (!declared.accepts(suppliedFacts[id])) {
        throw new WorkflowEvaluationError(
          "invalid_input",
          `Invalid facts.${id} for workflow "${definition.id}". Supply ${valueDescription(declared.fact)}.`,
        );
      }
    }
    const suppliedArtifacts = input.artifacts;
    for (const id in suppliedArtifacts) {
      const declared = artifacts.get(id);
      if (!declared) {
        throw new WorkflowEvaluationError(
          "invalid_input",
          `Workflow "${definition.id}" has no artifact "${id}". Remove artifacts.${id} or declare the artifact.`,
        );
      }
      const state = suppliedArtifacts[id];
      if (state === undefined || !acceptsArtifactState(declared, state)) {
        throw new WorkflowEvaluationError(
          "invalid_input",
          `Invalid artifacts.${id} for workflow "${definition.id}". Supply ${artifactStateDescription(declared)}.`,
        );
      }
    }
  }

  function compile(condition: WorkflowCondition): WorkflowPredicate {
    if (condition === true) return () => true;
    if (condition === false) return () => false;
    if ("fact" in condition) {
      const { fact, equals } = condition;
      return (input) => {
        if (!Object.hasOwn(input.facts, fact)) {
          throw new WorkflowEvaluationError(
            "missing_fact",
            `Workflow "${definition.id}" needs fact "${fact}". Supply it in input.facts.`,
          );
        }
        return input.facts[fact] === equals;
      };
    }
    if ("artifact" in condition) {
      const { artifact } = condition;
      const read = (input: WorkflowInput) => {
        const state = Object.hasOwn(input.artifacts, artifact)
          ? input.artifacts[artifact]
          : undefined;
        if (state === undefined) {
          throw new WorkflowEvaluationError(
            "missing_artifact",
            `Workflow "${definition.id}" needs artifact "${artifact}". Supply it in input.artifacts.`,
          );
        }
        return state;
      };
      if ("present" in condition) {
        const { present } = condition;
        return (input) => read(input).present === present;
      }
      const { verdict } = condition;
      return (input) => read(input).verdict === verdict;
    }
    if ("stateIn" in condition) {
      const stateIn = new Set(condition.stateIn);
      return (input) => stateIn.has(input.state);
    }
    if ("not" in condition) {
      const test = compile(condition.not);
      return (input) => !test(input);
    }
    if ("all" in condition) {
      const tests = condition.all.map(compile);
      return (input) => {
        for (const test of tests) if (!test(input)) return false;
        return true;
      };
    }
    const tests = condition.any.map(compile);
    return (input) => {
      for (const test of tests) if (test(input)) return true;
      return false;
    };
  }

  function eventById(eventId: string): CompiledEvent {
    const event = events.get(eventId);
    if (!event) {
      throw new WorkflowEvaluationError(
        "unknown_event",
        `Workflow "${definition.id}" has no event "${eventId}". Use an ID from its events.`,
      );
    }
    return event;
  }

  function actionById(actionId: string): CompiledAction {
    const action = actionsById.get(actionId);
    if (!action) {
      throw new WorkflowEvaluationError(
        "unknown_action",
        `Workflow "${definition.id}" has no action "${actionId}". Use an ID from its actions.`,
      );
    }
    return action;
  }

  function findDenial(input: WorkflowInput, event: CompiledEvent): Denial {
    if (!event.from.has(input.state)) return { reason: "source_state" };
    for (const guard of event.guards) {
      if (!guard.test(input)) return { reason: "guard", guardId: guard.id };
    }
    return null;
  }

  function actionAvailable(input: WorkflowInput, action: CompiledAction): boolean {
    return (
      (action.event === null || findDenial(input, action.event) === null) && action.available(input)
    );
  }
};

/** The first candidate whose selection matches, else the first candidate. */
const selectLaunchAction = (input: WorkflowInput, candidates: LaunchCandidates): string =>
  candidates.find((candidate) => candidate.select?.(input))?.id ?? candidates[0].id;

/** Ranks the leading actions first, then the declared order. */
const rankActions = (
  lead: readonly string[],
  order: readonly string[],
): ReadonlyMap<string, number> => {
  const rank = new Map<string, number>();
  for (const id of [...lead, ...order]) if (!rank.has(id)) rank.set(id, rank.size);
  return rank;
};

const acceptsArtifactState = (
  artifact: WorkflowArtifactDefinition,
  state: WorkflowInput["artifacts"][string],
): boolean => {
  if (state.present !== true && state.present !== false) return false;
  if (state.verdict === undefined) return true;
  return (
    artifact.kind === "review" &&
    state.present &&
    artifact.verdicts.some((verdict) => verdict.id === state.verdict)
  );
};

const artifactStateDescription = (artifact: WorkflowArtifactDefinition): string =>
  artifact.kind === "review"
    ? `{ present } and, for a present review, a verdict from ${artifact.verdicts.map((verdict) => JSON.stringify(verdict.id)).join(", ")}`
    : "{ present } without a verdict";

const parseDefinition = (source: WorkflowDefinition): WorkflowDefinition => {
  const parsed = workflowDefinitionSchema.safeParse(source);
  if (!parsed.success) {
    throw new WorkflowEvaluationError(
      "invalid_definition",
      `Invalid workflow definition at ${firstIssueMessage(parsed.error.issues, "definition")}. Fix the definition.`,
    );
  }
  return deepFreeze(parsed.data);
};

const firstIssueMessage = (
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  root: string,
): string => {
  const issue = issues[0];
  return `${issue?.path.map(String).join(".") || root}: ${issue?.message}`;
};

type ConditionCheck = (condition: WorkflowCondition, path: string) => void;

const createConditionCheck = (
  definition: WorkflowDefinition,
  invalid: (message: string) => never,
): ConditionCheck => {
  const facts = new Map(definition.facts.map((fact) => [fact.id, fact]));
  const artifacts = new Map(definition.artifacts.map((artifact) => [artifact.id, artifact]));
  const states = new Set(definition.states.map((state) => state.id));
  const check: ConditionCheck = (condition, path) => {
    if (condition === true || condition === false) return;
    if ("fact" in condition) {
      const fact = facts.get(condition.fact);
      if (!fact) {
        return invalid(`Unknown fact "${condition.fact}" at ${path}.fact. Declare it in facts.`);
      }
      if (!valueTest(fact)(condition.equals)) {
        invalid(
          `Invalid comparison at ${path}.equals for fact "${condition.fact}". Use ${valueDescription(fact)}.`,
        );
      }
    } else if ("artifact" in condition) {
      const artifact = artifacts.get(condition.artifact);
      if (!artifact) {
        return invalid(
          `Unknown artifact "${condition.artifact}" at ${path}.artifact. Declare it in artifacts.`,
        );
      }
      if ("verdict" in condition) {
        if (artifact.kind !== "review") {
          return invalid(
            `Artifact "${condition.artifact}" at ${path}.artifact has no verdicts. Compare a review artifact.`,
          );
        }
        if (!artifact.verdicts.some((verdict) => verdict.id === condition.verdict)) {
          invalid(
            `Unknown verdict "${condition.verdict}" at ${path}.verdict. Use a verdict of artifact "${artifact.id}".`,
          );
        }
      }
    } else if ("stateIn" in condition) {
      condition.stateIn.forEach((id, index) => {
        if (!states.has(id)) {
          invalid(`Unknown states ID "${id}" at ${path}.stateIn[${index}]. Use an ID from states.`);
        }
      });
    } else if ("not" in condition) {
      check(condition.not, `${path}.not`);
    } else {
      const key = "all" in condition ? "all" : "any";
      const children = "all" in condition ? condition.all : condition.any;
      children.forEach((child, index) => check(child, `${path}.${key}[${index}]`));
    }
  };
  return check;
};

const checkDefinition = (definition: WorkflowDefinition): void => {
  const invalid = (message: string): never => {
    throw new WorkflowEvaluationError(
      "invalid_definition",
      `Workflow "${definition.id}" is invalid. ${message}`,
    );
  };
  const checkCondition = createConditionCheck(definition, invalid);
  const checkIds = (
    items: readonly { id: string }[],
    collection: string,
    result = new Set<string>(),
  ): Set<string> => {
    for (const item of items) {
      if (result.has(item.id))
        invalid(`Duplicate ID "${item.id}" in ${collection}. Use unique IDs.`);
      result.add(item.id);
    }
    return result;
  };
  const checkReference = (id: string, known: Set<string>, collection: string, path: string) => {
    if (!known.has(id))
      invalid(`Unknown ${collection} ID "${id}" at ${path}. Use an ID from ${collection}.`);
  };
  const checkRule = (
    rule: WorkflowDefinition["actionOrder"][number],
    path: string,
    actions: Set<string>,
  ) => {
    checkCondition(rule.when, `${path}.when`);
    rule.actions.forEach((id, index) =>
      checkReference(id, actions, "actions", `${path}.actions[${index}]`),
    );
  };

  checkIds(definition.facts, "facts");
  const roles = checkIds(definition.roles, "roles");
  const artifacts = checkIds(definition.artifacts, "artifacts");
  const states = checkIds(definition.states, "states");
  const steps = checkIds(definition.steps, "steps");
  const events = checkIds(definition.events, "events");
  const actions = checkIds(definition.actions, "actions");
  const signals = checkIds(definition.signals, "signals");
  const automations = checkIds(definition.automations, "automations");
  const launchActions = new Set<string>();
  definition.steps.forEach((step, index) => {
    if (step.kind === "agent")
      checkIds(step.launchActions, `steps[${index}].launchActions`, launchActions);
  });

  checkReference(definition.initialState, states, "states", "initialState");
  definition.roles.forEach((role, index) =>
    role.writes.forEach((id, writeIndex) =>
      checkReference(id, artifacts, "artifacts", `roles[${index}].writes[${writeIndex}]`),
    ),
  );
  definition.artifacts.forEach((artifact, index) => {
    const path = `artifacts[${index}]`;
    if (artifact.kind === "document") {
      if (artifact.saveEventId !== undefined)
        checkReference(artifact.saveEventId, events, "events", `${path}.saveEventId`);
      return;
    }
    checkIds(artifact.verdicts, `${path}.verdicts`);
    artifact.verdicts.forEach((verdict, verdictIndex) =>
      checkReference(
        verdict.eventId,
        events,
        "events",
        `${path}.verdicts[${verdictIndex}].eventId`,
      ),
    );
  });
  definition.states.forEach((state, index) => {
    const path = `states[${index}]`;
    if (state.notification?.role !== undefined)
      checkReference(state.notification.role, roles, "roles", `${path}.notification.role`);
    if (state.studioRole !== undefined)
      checkReference(state.studioRole, roles, "roles", `${path}.studioRole`);
  });
  definition.steps.forEach((step, index) => {
    const path = `steps[${index}]`;
    step.inputs.forEach((id, artifactIndex) =>
      checkReference(id, artifacts, "artifacts", `${path}.inputs[${artifactIndex}]`),
    );
    step.outputs.forEach((id, artifactIndex) =>
      checkReference(id, artifacts, "artifacts", `${path}.outputs[${artifactIndex}]`),
    );
    checkCondition(step.requiredWhen, `${path}.requiredWhen`);
    checkCondition(step.availableWhen, `${path}.availableWhen`);
    checkCondition(step.completedWhen, `${path}.completedWhen`);
    if (step.kind !== "agent") return;
    checkReference(step.roleId, roles, "roles", `${path}.roleId`);
    if (step.startEventId !== undefined)
      checkReference(step.startEventId, events, "events", `${path}.startEventId`);
    step.launchActions.forEach((launch, launchIndex) => {
      const launchPath = `${path}.launchActions[${launchIndex}]`;
      if (!launch.startModes.includes(launch.defaultStartMode))
        invalid(
          `Default start mode "${launch.defaultStartMode}" at ${launchPath}.defaultStartMode is not in its start modes. Add it to startModes.`,
        );
      if (launch.selectWhen !== undefined)
        checkCondition(launch.selectWhen, `${launchPath}.selectWhen`);
    });
  });
  definition.actions.forEach((action, index) => {
    const path = `actions[${index}]`;
    if (action.stepId !== undefined)
      checkReference(action.stepId, steps, "steps", `${path}.stepId`);
    checkCondition(action.availableWhen, `${path}.availableWhen`);
    action.labels?.forEach((variant, variantIndex) =>
      checkCondition(variant.when, `${path}.labels[${variantIndex}].when`),
    );
    if (action.kind === "view") return;
    if (action.eventId !== undefined)
      checkReference(action.eventId, events, "events", `${path}.eventId`);
    action.launchActionIds?.forEach((id, launchIndex) =>
      checkReference(
        id,
        launchActions,
        "launch actions",
        `${path}.launchActionIds[${launchIndex}]`,
      ),
    );
  });
  const effectPaths = new Map<string, string>();
  const statusTargets = new Set<string>();
  definition.events.forEach((event, index) => {
    const path = `events[${index}]`;
    if (event.effect === "status.set") {
      const [outcome] = event.outcomes;
      const target = event.outcomes.length === 1 && outcome?.when === true ? outcome.to : null;
      if (target === null)
        return invalid(
          `The status.set event at ${path} needs one outcome with when true and a state.`,
        );
      if (statusTargets.has(target))
        invalid(`Two status.set events move to "${target}". Keep one of them.`);
      statusTargets.add(target);
    } else if (event.effect !== undefined) {
      const firstPath = effectPaths.get(event.effect);
      if (firstPath !== undefined)
        invalid(
          `The effect "${event.effect}" is at ${firstPath}.effect and ${path}.effect. Give each effect one event.`,
        );
      effectPaths.set(event.effect, path);
    }
    event.from.forEach((id, fromIndex) =>
      checkReference(id, states, "states", `${path}.from[${fromIndex}]`),
    );
    checkIds(event.guards, `${path}.guards`);
    event.guards.forEach((guard, guardIndex) =>
      checkCondition(guard.when, `${path}.guards[${guardIndex}].when`),
    );
    event.outcomes.forEach((outcome, outcomeIndex) => {
      const outcomePath = `${path}.outcomes[${outcomeIndex}]`;
      if (outcome.to !== null) checkReference(outcome.to, states, "states", `${outcomePath}.to`);
      if (outcome.signal !== undefined)
        checkReference(outcome.signal, signals, "signals", `${outcomePath}.signal`);
      if (outcome.sourceRole !== undefined)
        checkReference(outcome.sourceRole, roles, "roles", `${outcomePath}.sourceRole`);
      checkCondition(outcome.when, `${outcomePath}.when`);
    });
  });
  definition.signals.forEach((signal, index) =>
    signal.automations.forEach((id, automationIndex) =>
      checkReference(
        id,
        automations,
        "automations",
        `signals[${index}].automations[${automationIndex}]`,
      ),
    ),
  );
  const launchStartModes = new Map(
    definition.steps.flatMap((step) =>
      step.kind === "agent"
        ? step.launchActions.map((launch) => [launch.id, launch.startModes] as const)
        : [],
    ),
  );
  definition.automations.forEach((automation, index) => {
    const path = `automations[${index}]`;
    checkReference(
      automation.launchActionId,
      launchActions,
      "launch actions",
      `${path}.launchActionId`,
    );
    const startModes = launchStartModes.get(automation.launchActionId);
    if (
      automation.startMode !== undefined &&
      startModes &&
      !startModes.includes(automation.startMode)
    )
      invalid(
        `Start mode "${automation.startMode}" at ${path}.startMode is not a start mode of launch action "${automation.launchActionId}". Use ${startModes.join(", ")}.`,
      );
  });
  definition.actionOrder.forEach((rule, index) =>
    checkRule(rule, `actionOrder[${index}]`, actions),
  );
  definition.actionPriority.forEach((rule, index) =>
    checkRule(rule, `actionPriority[${index}]`, actions),
  );
};

const valueTest = (
  fact: WorkflowFactDefinition,
): ((value: WorkflowValue | undefined) => boolean) => {
  switch (fact.type) {
    case "boolean":
      return (value) => value === true || value === false;
    case "number":
      return (value) => Number.isFinite(value);
    case "string":
      // Only a primitive string equals its own String conversion.
      return (value) => String(value) === value;
    case "enum": {
      const values = new Set<WorkflowValue | undefined>(fact.values);
      return (value) => values.has(value);
    }
  }
};

const valueDescription = (fact: WorkflowFactDefinition): string =>
  fact.type === "enum"
    ? `one of ${fact.values.map((value) => JSON.stringify(value)).join(", ")}`
    : `a ${fact.type} value`;

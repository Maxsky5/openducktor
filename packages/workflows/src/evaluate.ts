import {
  TASK_CLOSED_STATE,
  workflowConditionSchema,
  workflowDefinitionSchema,
  type CompiledWorkflowDefinition,
  type WorkflowArtifactDefinition,
  type WorkflowCondition,
  type WorkflowDecision,
  type WorkflowDefinition,
  type WorkflowIds,
  type WorkflowInput,
  type WorkflowStepProjection,
} from "@openducktor/contracts";
import { deepFreeze } from "./deep-freeze";
import {
  createConditionCheck,
  declaredFacts,
  factValueDescription as valueDescription,
  factValueTest as valueTest,
} from "./rules/condition-rules";
import { collectDefinitionProblems } from "./rules/definition-rules";
import { createProblemSink, firstError, problemText } from "./rules/problems";

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

type WorkflowPredicate = (input: WorkflowInput) => boolean;
type CompiledWorkflowCondition = CompiledWorkflowDefinition["steps"][number]["requiredWhen"];

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
  /** Compiles a condition once per condition object. */
  condition(condition: WorkflowCondition | CompiledWorkflowCondition): WorkflowPredicate;
  /** Selects from retained launch choices after their originating action commits. */
  selectLaunchAction(
    input: WorkflowInput,
    launchActionIds: readonly Ids["launchAction"][],
  ): Ids["launchAction"] | null;
  /** The default launch action of an agent step. */
  stepLaunchAction(input: WorkflowInput, stepId: Ids["step"]): Ids["launchAction"];
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
  // An object condition is cached by identity, so a temporary object does not stay in memory.
  const compiledConditions = new WeakMap<object, WorkflowPredicate>();
  const constantConditions = new Map<boolean, WorkflowPredicate>();
  const identity = { workflowId: definition.id, definitionRevision: definition.revision };
  const states = new Set(definition.states.map((state) => state.id));
  const facts = new Map(
    declaredFacts(definition).map((fact) => [fact.id, { fact, accepts: valueTest(fact) }] as const),
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
      (action.kind === "event" || action.kind === "session") && action.eventId !== undefined
        ? eventById(action.eventId)
        : null,
    launchCandidates:
      action.kind === "event" || action.kind === "session"
        ? launchCandidates(action.launchActionIds ?? [])
        : null,
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
        if (input.state === TASK_CLOSED_STATE) {
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
      const constant = condition === true || condition === false;
      const cached = constant
        ? constantConditions.get(condition)
        : compiledConditions.get(condition);
      if (cached) return cached;
      const parsed = workflowConditionSchema.safeParse(condition);
      if (!parsed.success) {
        throw new WorkflowEvaluationError(
          "invalid_condition",
          `Invalid condition for workflow "${definition.id}": ${firstIssueMessage(parsed.error.issues, "condition")}. Use a data-only workflow condition.`,
        );
      }
      const sink = createProblemSink(["condition"]);
      createConditionCheck(definition, sink.error)(parsed.data, [], "The condition");
      const problem = firstError(sink.problems);
      if (problem)
        throw new WorkflowEvaluationError(
          "invalid_condition",
          `Invalid condition for workflow "${definition.id}". ${problemText(problem)}`,
        );
      const test = compile(parsed.data);
      const predicate: WorkflowPredicate = (input) => {
        checkInput(input);
        return test(input);
      };
      if (constant) constantConditions.set(condition, predicate);
      else compiledConditions.set(condition, predicate);
      return predicate;
    },
    selectLaunchAction(input, launchActionIds) {
      checkInput(input);
      for (const id of launchActionIds) {
        if (!launchSelectors.has(id))
          throw new WorkflowEvaluationError(
            "missing_launch_action",
            `Workflow "${definition.id}" has no launch action "${id}". Use a declared launch action ID.`,
          );
      }
      const candidates = launchCandidates(launchActionIds);
      return candidates ? selectLaunchAction(input, candidates) : null;
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

const selectLaunchAction = (input: WorkflowInput, candidates: LaunchCandidates): string =>
  candidates.find((candidate) => candidate.select?.(input))?.id ?? candidates[0].id;

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

const checkDefinition = (definition: WorkflowDefinition): void => {
  const sink = createProblemSink();
  collectDefinitionProblems(definition, sink);
  const problem = firstError(sink.problems);
  if (problem)
    throw new WorkflowEvaluationError(
      "invalid_definition",
      `Workflow "${definition.id}" is invalid. ${problemText(problem)}`,
    );
};
